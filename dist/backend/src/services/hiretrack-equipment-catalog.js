"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEquipmentCatalog = getEquipmentCatalog;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const hiretrack_odbc_read_1 = require("./hiretrack-odbc-read");
function normalizeString(value) {
    if (value == null)
        return null;
    const text = String(value).trim();
    return text.length > 0 ? text : null;
}
function normalizeInt(value) {
    if (value == null || value === '')
        return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}
function mapRawItem(row) {
    const typeId = normalizeInt(row.EquipmentTypeId);
    if (typeId == null)
        return null;
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
        // TEquipmentType: 0=etSimple, 1=etCompositeKit, 2=etAliasKit,
        // 3=etPricedAliasKit, 4=etMarkup - prefer an existing Composite/Alias kit
        // over hand-assembling components when one fits a rider line.
        equipmentType: normalizeInt(row.EquipmentType),
        // Similars = curated functional taxonomy ("vocal mic", "DI box", "crash
        // cymbal", ...) - match rider text against this before raw item names.
        similarGroupId: normalizeInt(row.SimilarGroupId),
        similarGroupName: normalizeString(row.SimilarGroupName),
        accessories: [],
    };
}
function applyAccessories(map, rows) {
    const grouped = new Map();
    for (const row of rows) {
        const masterTypeId = normalizeInt(row.MasterTypeId);
        const subtypeId = normalizeInt(row.SubtypeId);
        if (masterTypeId == null || subtypeId == null)
            continue;
        const list = grouped.get(masterTypeId) || [];
        list.push({
            subtypeId,
            subtypeName: normalizeString(row.SubtypeName),
            quantity: normalizeInt(row.Quantity) ?? 1,
            required: Boolean(row.Required),
        });
        grouped.set(masterTypeId, list);
    }
    for (const [masterTypeId, accessories] of grouped) {
        const item = map.get(masterTypeId);
        if (item)
            item.accessories = accessories;
    }
}
function resolveSnapshotPath() {
    const configured = process.env.EQUIPMENT_CATALOG_SNAPSHOT_PATH?.trim();
    return configured || path_1.default.resolve(process.cwd(), 'data', 'equipment-catalog-snapshot.json');
}
function loadPersistedSnapshot() {
    const snapshotPath = resolveSnapshotPath();
    try {
        const raw = fs_1.default.readFileSync(snapshotPath, 'utf8');
        const parsed = JSON.parse(raw);
        const map = new Map();
        for (const [key, item] of Object.entries(parsed.items || {})) {
            const typeId = Number(key);
            if (Number.isFinite(typeId)) {
                map.set(typeId, item);
            }
        }
        if (!parsed.syncedAt || map.size === 0)
            return null;
        return { map, syncedAt: parsed.syncedAt };
    }
    catch {
        return null;
    }
}
function persistSnapshot(map, syncedAt) {
    const snapshotPath = resolveSnapshotPath();
    const items = {};
    for (const [typeId, item] of map) {
        items[String(typeId)] = item;
    }
    const payload = { syncedAt, items };
    try {
        fs_1.default.mkdirSync(path_1.default.dirname(snapshotPath), { recursive: true });
        fs_1.default.writeFileSync(snapshotPath, JSON.stringify(payload), 'utf8');
    }
    catch (error) {
        console.error('Failed to persist equipment catalog snapshot:', error);
    }
}
let catalogMap = null;
let lastSyncAt = null;
let lastRefreshCheckAt = 0;
let pendingSync = null;
const configuredSyncMs = Number(process.env.EQUIPMENT_CATALOG_SYNC_MS || 10 * 60 * 1000);
const syncIntervalMs = Number.isFinite(configuredSyncMs) ? Math.max(30_000, configuredSyncMs) : 10 * 60 * 1000;
async function runFullSync() {
    const result = await (0, hiretrack_odbc_read_1.runHiretrackOdbcRead)({ operation: 'equipment-catalog-full' });
    const map = new Map();
    for (const row of result.items) {
        const item = mapRawItem(row);
        if (item)
            map.set(item.typeId, item);
    }
    applyAccessories(map, result.accessories);
    catalogMap = map;
    lastSyncAt = result.syncedAt;
    lastRefreshCheckAt = Date.now();
    persistSnapshot(map, result.syncedAt);
}
async function runDeltaSync() {
    if (!catalogMap || !lastSyncAt) {
        return runFullSync();
    }
    const result = await (0, hiretrack_odbc_read_1.runHiretrackOdbcRead)({
        operation: 'equipment-catalog-changes',
        since: lastSyncAt,
    });
    for (const row of result.updated) {
        const item = mapRawItem(row);
        if (item)
            catalogMap.set(item.typeId, item);
    }
    applyAccessories(catalogMap, result.accessories);
    for (const typeId of result.deletedIds) {
        catalogMap.delete(typeId);
    }
    lastSyncAt = result.syncedAt;
    lastRefreshCheckAt = Date.now();
    persistSnapshot(catalogMap, result.syncedAt);
}
async function ensureCatalogLoaded() {
    if (catalogMap)
        return;
    if (pendingSync)
        return pendingSync;
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
function maybeScheduleRefresh() {
    if (pendingSync)
        return;
    if (Date.now() - lastRefreshCheckAt < syncIntervalMs)
        return;
    pendingSync = runDeltaSync()
        .catch((error) => {
        console.error('Background HireTrack equipment catalog refresh failed:', error);
    })
        .finally(() => {
        pendingSync = null;
    });
}
async function getEquipmentCatalog() {
    await ensureCatalogLoaded();
    maybeScheduleRefresh();
    return Array.from((catalogMap || new Map()).values());
}
