import { checkHiretrackAvailability } from './hiretrack-booking-api';
import { getPlanningOccupancyData, PlanningOccupancyType } from './hiretrack-planning-read';

// Two-tier shortage detection, per the Phase 4 plan: a free "cheap pass"
// over data the occupancy op already computed (Whlevel.SiteOwns isn't
// authoritative - see hiretrack-planning-read.ts/EQUIPMENT_CATALOG_MATCH_BLUEPRINT.md),
// then a precise confirm pass through the SAME rate-limited/retried
// check_availability client every other booking flow already uses
// (hiretrack-booking-api.ts's availabilityLimiter) - no new throttling code.

export interface PlanningShortageDetail {
  typeId: number;
  typeName: string;
  day: string;
  booked: number;
  owned: number;
  availableQty: number | null;
}

export interface PlanningShortageJob {
  jobId: number;
  jobRef: string;
  jobTitle: string;
  shortages: PlanningShortageDetail[];
}

export interface PlanningShortagesData {
  generatedAt: string;
  jobs: PlanningShortageJob[];
}

interface FlaggedCell {
  typeId: number;
  typeName: string;
  day: string;
  booked: number;
  owned: number;
}

interface ConfirmedCell extends FlaggedCell {
  availableQty: number | null;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function findShortageCells(types: PlanningOccupancyType[], start: string): FlaggedCell[] {
  const flagged: FlaggedCell[] = [];
  for (const type of types) {
    if (type.siteOwns == null) continue;
    type.dayTotals.forEach((qty, index) => {
      if (qty > type.siteOwns!) {
        flagged.push({
          typeId: type.typeId,
          typeName: type.name,
          day: addDaysIso(start, index),
          booked: qty,
          owned: type.siteOwns!,
        });
      }
    });
  }
  return flagged;
}

async function confirmShortageCells(flagged: FlaggedCell[]): Promise<ConfirmedCell[]> {
  const confirmed: ConfirmedCell[] = [];
  await Promise.all(
    flagged.map(async (cell) => {
      try {
        const result = await checkHiretrackAvailability({
          typeId: cell.typeId,
          quantity: cell.booked,
          dateFrom: cell.day,
          dateTo: addDaysIso(cell.day, 1),
        });
        const availableQty = result.availableQty ?? result.stocklevelForWarehouse ?? null;
        if (availableQty == null || availableQty < cell.booked) {
          confirmed.push({ ...cell, availableQty });
        }
      } catch (error) {
        // A failed confirm call is kept as still-flagged - a possible false
        // positive surfaced to the user is safer than silently dropping a
        // real shortage because the confirm check itself errored.
        confirmed.push({ ...cell, availableQty: null });
      }
    }),
  );
  return confirmed;
}

async function computeShortages(): Promise<PlanningShortagesData> {
  const occupancy = await getPlanningOccupancyData();
  const flagged = findShortageCells(occupancy.types, occupancy.start);
  const confirmed = await confirmShortageCells(flagged);

  const jobMap = new Map<number, PlanningShortageJob>();
  for (const cell of confirmed) {
    const contributingLines = occupancy.lines.filter(
      (line) => line.typeId === cell.typeId && line.start <= cell.day && line.end >= cell.day,
    );
    for (const line of contributingLines) {
      let job = jobMap.get(line.jobId);
      if (!job) {
        job = { jobId: line.jobId, jobRef: line.jobRef, jobTitle: line.jobTitle, shortages: [] };
        jobMap.set(line.jobId, job);
      }
      if (!job.shortages.some((s) => s.typeId === cell.typeId && s.day === cell.day)) {
        job.shortages.push({
          typeId: cell.typeId,
          typeName: cell.typeName,
          day: cell.day,
          booked: cell.booked,
          owned: cell.owned,
          availableQty: cell.availableQty,
        });
      }
    }
  }

  const jobs = Array.from(jobMap.values());
  jobs.forEach((job) => job.shortages.sort((a, b) => a.day.localeCompare(b.day) || a.typeName.localeCompare(b.typeName, 'ru')));
  jobs.sort((a, b) => a.jobRef.localeCompare(b.jobRef, 'ru'));

  return { generatedAt: new Date().toISOString(), jobs };
}

// Longer TTL than occupancy's own cache (20 min default) - the confirm pass
// makes real api_v2 calls, so this shouldn't silently re-run on every page
// load. Same single-flight/background-refresh shape as every other cache in
// this codebase (hiretrack-crew-read.ts, hiretrack-planning-read.ts).
const configuredCacheMs = Number(process.env.PLANNING_SHORTAGES_CACHE_MS || 20 * 60 * 1000);
const cacheMs = Number.isFinite(configuredCacheMs) ? Math.max(0, configuredCacheMs) : 20 * 60 * 1000;
let dataCache: { expiresAt: number; data: PlanningShortagesData } | null = null;
let pendingRead: Promise<PlanningShortagesData> | null = null;

function refreshShortagesData(): Promise<PlanningShortagesData> {
  if (!pendingRead) {
    pendingRead = computeShortages()
      .then((data) => {
        dataCache = { expiresAt: Date.now() + cacheMs, data };
        return data;
      })
      .finally(() => {
        pendingRead = null;
      });
  }
  return pendingRead;
}

export async function getPlanningShortagesData(options?: { forceRefresh?: boolean }): Promise<PlanningShortagesData> {
  if (options?.forceRefresh || !dataCache) {
    return refreshShortagesData();
  }
  if (dataCache.expiresAt <= Date.now()) {
    void refreshShortagesData().catch((error) => {
      console.error('Background planning-shortages refresh failed:', error);
    });
  }
  return dataCache.data;
}
