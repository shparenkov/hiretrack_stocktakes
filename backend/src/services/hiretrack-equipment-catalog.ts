import fs from 'fs';
import path from 'path';
import { HiretrackEquipmentCatalogItem } from '../types';
import { runHiretrackOdbcRead } from './hiretrack-odbc-read';

// Equipment catalog (Hetype) cache. Deliberately does NOT do a full re-query
// on a normal refresh: the catalog is 7000+ rows, and HireTrack DB resources
// are limited. The full join runs once ever (first load, or if no persisted
// snapshot exists yet); every refresh after that is a cheap Lookups_LOG delta.
// See EQUIPMENT_CATALOG_MATCH_BLUEPRINT.md for the design and the reason
// Hetype.xManufacturer/MPN are excluded from the item shape.

interface RawEquipmentCatalogRow {
  EquipmentTypeId: number;
  EquipmentName: string | null;
  Shortcode: string | null;
  Comments: string | null;
  LongDescription: string | null;
  Class: number | null;
  Visibility: number | null;
  CategoryId: number | null;
  CategoryName: string | null;
}

interface EquipmentCatalogFullResult {
  items: RawEquipmentCatalogRow[];
  syncedAt: string;
}

interface EquipmentCatalogChangesResult {
  updated: RawEquipmentCatalogRow[];
  deletedIds: number[];
  syncedAt: string;
}

interface PersistedSnapshot {
  syncedAt: string;
  items: Record<string, HiretrackEquipmentCatalogItem>;
}

function normalizeString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function normalizeInt(value: unknown): number | null {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function mapRawItem(row: RawEquipmentCatalogRow): HiretrackEquipmentCatalogItem | null {
  const typeId = normalizeInt(row.EquipmentTypeId);
  if (typeId == null) return null;
  return {
    typeId,
    name: normalizeString(row.EquipmentName),
    categoryId: normalizeInt(row.CategoryId),
    categoryName: normalizeString(row.CategoryName),
    shortcode: normalizeString(row.Shortcode),
    comments: normalizeString(row.Comments),
    longDescription: normalizeString(row.LongDescription),
    class: normalizeInt(row.Class),
    visibility: normalizeInt(row.Visibility),
  };
}

function resolveSnapshotPath(): string {
  const configured = process.env.EQUIPMENT_CATALOG_SNAPSHOT_PATH?.trim();
  return configured || path.resolve(process.cwd(), 'data', 'equipment-catalog-snapshot.json');
}

function loadPersistedSnapshot(): { map: Map<number, HiretrackEquipmentCatalogItem>; syncedAt: string } | null {
  const snapshotPath = resolveSnapshotPath();
  try {
    const raw = fs.readFileSync(snapshotPath, 'utf8');
    const parsed = JSON.parse(raw) as PersistedSnapshot;
    const map = new Map<number, HiretrackEquipmentCatalogItem>();
    for (const [key, item] of Object.entries(parsed.items || {})) {
      const typeId = Number(key);
      if (Number.isFinite(typeId)) {
        map.set(typeId, item);
      }
    }
    if (!parsed.syncedAt || map.size === 0) return null;
    return { map, syncedAt: parsed.syncedAt };
  } catch {
    return null;
  }
}

function persistSnapshot(map: Map<number, HiretrackEquipmentCatalogItem>, syncedAt: string): void {
  const snapshotPath = resolveSnapshotPath();
  const items: Record<string, HiretrackEquipmentCatalogItem> = {};
  for (const [typeId, item] of map) {
    items[String(typeId)] = item;
  }
  const payload: PersistedSnapshot = { syncedAt, items };
  try {
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    fs.writeFileSync(snapshotPath, JSON.stringify(payload), 'utf8');
  } catch (error) {
    console.error('Failed to persist equipment catalog snapshot:', error);
  }
}

let catalogMap: Map<number, HiretrackEquipmentCatalogItem> | null = null;
let lastSyncAt: string | null = null;
let lastRefreshCheckAt = 0;
let pendingSync: Promise<void> | null = null;

const configuredSyncMs = Number(process.env.EQUIPMENT_CATALOG_SYNC_MS || 10 * 60 * 1000);
const syncIntervalMs = Number.isFinite(configuredSyncMs) ? Math.max(30_000, configuredSyncMs) : 10 * 60 * 1000;

async function runFullSync(): Promise<void> {
  const result = await runHiretrackOdbcRead<EquipmentCatalogFullResult>({ operation: 'equipment-catalog-full' });
  const map = new Map<number, HiretrackEquipmentCatalogItem>();
  for (const row of result.items) {
    const item = mapRawItem(row);
    if (item) map.set(item.typeId, item);
  }
  catalogMap = map;
  lastSyncAt = result.syncedAt;
  lastRefreshCheckAt = Date.now();
  persistSnapshot(map, result.syncedAt);
}

async function runDeltaSync(): Promise<void> {
  if (!catalogMap || !lastSyncAt) {
    return runFullSync();
  }
  const result = await runHiretrackOdbcRead<EquipmentCatalogChangesResult>({
    operation: 'equipment-catalog-changes',
    since: lastSyncAt,
  });
  for (const row of result.updated) {
    const item = mapRawItem(row);
    if (item) catalogMap.set(item.typeId, item);
  }
  for (const typeId of result.deletedIds) {
    catalogMap.delete(typeId);
  }
  lastSyncAt = result.syncedAt;
  lastRefreshCheckAt = Date.now();
  persistSnapshot(catalogMap, result.syncedAt);
}

async function ensureCatalogLoaded(): Promise<void> {
  if (catalogMap) return;
  if (pendingSync) return pendingSync;

  const persisted = loadPersistedSnapshot();
  if (persisted) {
    catalogMap = persisted.map;
    lastSyncAt = persisted.syncedAt;
    lastRefreshCheckAt = Date.now();
    return;
  }

  pendingSync = runFullSync().finally(() => {
    pendingSync = null;
  });
  return pendingSync;
}

function maybeScheduleRefresh(): void {
  if (pendingSync) return;
  if (Date.now() - lastRefreshCheckAt < syncIntervalMs) return;

  pendingSync = runDeltaSync()
    .catch((error) => {
      console.error('Background HireTrack equipment catalog refresh failed:', error);
    })
    .finally(() => {
      pendingSync = null;
    });
}

export async function getEquipmentCatalog(): Promise<HiretrackEquipmentCatalogItem[]> {
  await ensureCatalogLoaded();
  maybeScheduleRefresh();
  return Array.from((catalogMap || new Map()).values());
}
