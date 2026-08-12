import { checkHiretrackAvailability } from './hiretrack-booking-api';
import { getPlanningOccupancyData, PlanningOccupancyType } from './hiretrack-planning-read';

// Two-tier shortage detection, per the Phase 4 plan: a free "cheap pass"
// over data the occupancy op already computed (Whlevel.SiteOwns isn't
// authoritative - see hiretrack-planning-read.ts/EQUIPMENT_CATALOG_MATCH_BLUEPRINT.md),
// then a precise confirm pass through the SAME rate-limited/retried
// check_availability client every other booking flow already uses
// (hiretrack-booking-api.ts's availabilityLimiter) - no new throttling code.
//
// Confirmed live (this session): the cheap pass alone flags ~3000+ (type,
// day) cells over a 60-day horizon - Whlevel disagrees with real bookings
// far more often than "a small minority", per its own known unreliability.
// One check_availability call per flagged DAY (the original design) took
// ~600s to reach barely a third done, projecting to ~30 minutes total -
// not usable. Fixed by collapsing each type's own CONSECUTIVE flagged days
// into a single run and confirming the whole run with one call
// (dateFrom/dateTo spanning the run, quantity = the run's peak booked qty)
// - most real shortages come from one job's multi-day booking, so this
// collapses the call count by roughly the average job length.

export interface PlanningShortageDetail {
  typeId: number;
  typeName: string;
  dayStart: string;
  dayEnd: string;
  booked: number;
  owned: number;
  availableQty: number | null;
}

export interface PlanningShortageJob {
  jobId: number;
  jobRef: string;
  jobTitle: string;
  // Carried straight from occupancy.lines (see PlanningOccupancyLine) so
  // the frontend can group/filter shortages by stage (Запрос/Бронь/
  // Подтверждено) without a second lookup.
  jobStatus: string;
  jobStatusRank: number;
  shortages: PlanningShortageDetail[];
}

export interface PlanningShortagesData {
  generatedAt: string;
  jobs: PlanningShortageJob[];
}

interface FlaggedRun {
  typeId: number;
  typeName: string;
  dayStart: string;
  dayEnd: string;
  booked: number;
  owned: number;
}

interface ConfirmedRun extends FlaggedRun {
  availableQty: number | null;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Collapses each type's own consecutive over-booked days into one run,
// carrying the PEAK booked qty within the run - if check_availability says
// that peak is available for the whole run, every lesser day in it is too.
function findShortageRuns(types: PlanningOccupancyType[], start: string): FlaggedRun[] {
  const runs: FlaggedRun[] = [];
  for (const type of types) {
    if (type.siteOwns == null) continue;
    const owned = type.siteOwns;
    let runStartIndex = -1;
    let runPeakBooked = 0;
    const flushRun = (endIndexExclusive: number) => {
      if (runStartIndex === -1) return;
      runs.push({
        typeId: type.typeId,
        typeName: type.name,
        dayStart: addDaysIso(start, runStartIndex),
        dayEnd: addDaysIso(start, endIndexExclusive - 1),
        booked: runPeakBooked,
        owned,
      });
      runStartIndex = -1;
      runPeakBooked = 0;
    };
    type.dayTotals.forEach((qty, index) => {
      if (qty > owned) {
        if (runStartIndex === -1) runStartIndex = index;
        runPeakBooked = Math.max(runPeakBooked, qty);
      } else {
        flushRun(index);
      }
    });
    flushRun(type.dayTotals.length);
  }
  return runs;
}

// Exposed via GET /api/planning/shortages/progress so the frontend can poll
// it while the (potentially slow, real-api_v2-calls) confirm pass runs
// inside one long-lived request - same "small mutable counter, updated via
// .finally() on each fetch" shape as frontend-create-job/app.js's own
// availability-loading progress bar, just server-side since this pass runs
// entirely inside the request handler rather than being driven by the
// browser.
const progress = { total: 0, done: 0 };

export function getShortagesConfirmProgress(): { total: number; done: number } {
  return { ...progress };
}

async function confirmShortageRuns(flagged: FlaggedRun[]): Promise<ConfirmedRun[]> {
  progress.total = flagged.length;
  progress.done = 0;
  const confirmed: ConfirmedRun[] = [];
  await Promise.all(
    flagged.map(async (run) => {
      try {
        const result = await checkHiretrackAvailability({
          typeId: run.typeId,
          quantity: run.booked,
          dateFrom: run.dayStart,
          dateTo: addDaysIso(run.dayEnd, 1),
        });
        const availableQty = result.availableQty ?? result.stocklevelForWarehouse ?? null;
        if (availableQty == null || availableQty < run.booked) {
          confirmed.push({ ...run, availableQty });
        }
      } catch (error) {
        // A failed confirm call is kept as still-flagged - a possible false
        // positive surfaced to the user is safer than silently dropping a
        // real shortage because the confirm check itself errored.
        confirmed.push({ ...run, availableQty: null });
      } finally {
        progress.done += 1;
      }
    }),
  );
  return confirmed;
}

async function computeShortages(): Promise<PlanningShortagesData> {
  const occupancy = await getPlanningOccupancyData();
  const flagged = findShortageRuns(occupancy.types, occupancy.start);
  const confirmed = await confirmShortageRuns(flagged);

  const jobMap = new Map<number, PlanningShortageJob>();
  for (const run of confirmed) {
    const contributingLines = occupancy.lines.filter(
      (line) => line.typeId === run.typeId && line.start <= run.dayEnd && line.end >= run.dayStart,
    );
    for (const line of contributingLines) {
      let job = jobMap.get(line.jobId);
      if (!job) {
        job = {
          jobId: line.jobId,
          jobRef: line.jobRef,
          jobTitle: line.jobTitle,
          jobStatus: line.jobStatus,
          jobStatusRank: line.jobStatusRank,
          shortages: [],
        };
        jobMap.set(line.jobId, job);
      }
      if (!job.shortages.some((s) => s.typeId === run.typeId && s.dayStart === run.dayStart && s.dayEnd === run.dayEnd)) {
        job.shortages.push({
          typeId: run.typeId,
          typeName: run.typeName,
          dayStart: run.dayStart,
          dayEnd: run.dayEnd,
          booked: run.booked,
          owned: run.owned,
          availableQty: run.availableQty,
        });
      }
    }
  }

  const jobs = Array.from(jobMap.values());
  jobs.forEach((job) => job.shortages.sort((a, b) => a.dayStart.localeCompare(b.dayStart) || a.typeName.localeCompare(b.typeName, 'ru')));
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
