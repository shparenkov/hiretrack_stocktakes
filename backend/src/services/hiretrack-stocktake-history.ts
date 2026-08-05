import { HiretrackStocktakeHistoryRecord } from '../types';
import { runHiretrackOdbcRead } from './hiretrack-odbc-read';

export type StocktakeSessionState = 'all' | 'active' | 'inactive';

function normalizeString(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function normalizeInt(value: unknown): number | null {
  if (value == null || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeBool(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  const text = String(value ?? '').trim().toLowerCase();
  return text === '1' || text === 'true' || text === 'y';
}

function normalizeDisposalReason(value: unknown): number | null {
  return normalizeInt(value);
}

function mapDisposalReasonLabel(reason: number | null): string | null {
  switch (reason) {
    case 0:
      return 'unspecified';
    case 1:
      return 'stock_transfer';
    case 2:
      return 'beyond_repair';
    case 3:
      return 'end_of_life';
    case 4:
      return 'lost';
    case 5:
      return 'stolen';
    case 6:
      return 'sold';
    case 7:
      return 'sales_order_return';
    default:
      return null;
  }
}

function normalizeItemState(value: unknown): 'active' | 'inactive' | 'unknown' {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'active') {
    return 'active';
  }
  if (text === 'inactive') {
    return 'inactive';
  }
  return 'unknown';
}

function deriveItemState(commissionStatus: number | null): 'active' | 'inactive' | 'unknown' {
  if (commissionStatus == null) {
    return 'unknown';
  }
  if ([0, 1, 2].includes(commissionStatus)) {
    return 'active';
  }
  if ([3, 4].includes(commissionStatus)) {
    return 'inactive';
  }
  return 'unknown';
}

function mapHistoryRows(raw: Record<string, unknown>[]): HiretrackStocktakeHistoryRecord[] {
  return raw
    .map((row) => {
      const commissionStatus = normalizeInt(row.CommissionStatus);
      const disposalReason = normalizeDisposalReason(row.DisposalReason);
      const reportedState = normalizeItemState(row.CurrentItemState);
      return {
        stockTakeId: normalizeInt(row.StockTakeId),
        stockTakeTitle: normalizeString(row.StockTakeTitle ?? row.Title),
        stockTakeActive: normalizeBool(row.StockTakeActive ?? row.Active),
        startDate: normalizeString(row.StartDate),
        inActiveDate: normalizeString(row.InActiveDate),
        warehouseName: normalizeString(row.WarehouseName),
        equipmentTypeId: normalizeInt(row.EquipmentTypeId ?? row.Type),
        equipmentType: normalizeString(row.EquipmentType ?? row.Description),
        categoryId: normalizeInt(row.CategoryId ?? row.Category),
        categoryName: normalizeString(row.CategoryName ?? row.CategoryDescription),
        masterCategoryId: normalizeInt(row.MasterCategoryId ?? row.MasterCatId),
        masterCategoryName: normalizeString(row.MasterCategoryName ?? row.McDescription),
        itemRef: normalizeInt(row.ItemRef),
        barcode: normalizeString(row.Barcode),
        serialNumber: normalizeString(row.SerialNumber ?? row.SerialNo),
        commissionStatus,
        currentEqlistId: normalizeInt(row.CurrentEqlistId ?? row.CurrentJob),
        currentEqlistName: normalizeString(row.CurrentEqlistName),
        currentJobNo: normalizeInt(row.CurrentJobNo),
        currentJobRef: normalizeString(row.CurrentJobRef),
        currentClientName: normalizeString(row.CurrentClientName),
        currentItemState: reportedState === 'unknown' ? deriveItemState(commissionStatus) : reportedState,
        seenDate: normalizeString(row.SeenDate),
        processedDate: normalizeString(row.ProcessedDate),
        actionedDate: normalizeString(row.ActionedDate),
        actionNotes: normalizeString(row.ActionNotes),
        actionedNotes: normalizeString(row.ActionedNotes),
        disposalReason,
        disposalReasonLabel:
          normalizeString(row.DisposalReasonLabel ?? row.DisposalReasonName) || mapDisposalReasonLabel(disposalReason),
        disposalDate: normalizeString(row.DisposalDate),
        disposalNotes: normalizeString(row.DisposalNotes ?? row.BatchDisposalNotes),
      } satisfies HiretrackStocktakeHistoryRecord;
    })
    .filter((row) => row.stockTakeId !== null);
}

const configuredCacheMs = Number(process.env.STOCKTAKE_ODBC_CACHE_MS || 30000);
const cacheMs = Number.isFinite(configuredCacheMs) ? Math.max(0, configuredCacheMs) : 30000;
let historyCache: { expiresAt: number; items: HiretrackStocktakeHistoryRecord[] } | null = null;
let pendingHistoryRead: Promise<HiretrackStocktakeHistoryRecord[]> | null = null;

function refreshHistoryRows(): Promise<HiretrackStocktakeHistoryRecord[]> {
  if (!pendingHistoryRead) {
    pendingHistoryRead = runHiretrackOdbcRead<Record<string, unknown>[]>({ operation: 'stocktake-history' })
      .then(mapHistoryRows)
      .then((items) => {
        historyCache = { expiresAt: Date.now() + cacheMs, items };
        return items;
      })
      .finally(() => {
        pendingHistoryRead = null;
      });
  }
  return pendingHistoryRead;
}

async function loadHistoryRows(): Promise<HiretrackStocktakeHistoryRecord[]> {
  if (!historyCache) {
    return refreshHistoryRows();
  }
  if (historyCache.expiresAt <= Date.now()) {
    void refreshHistoryRows().catch((error) => {
      console.error('Background HireTrack stock-take refresh failed:', error);
    });
  }
  return historyCache.items;
}

export async function lookupStocktakeHistoryInHiretrack(input?: {
  sessionState?: StocktakeSessionState;
  limit?: number;
}): Promise<HiretrackStocktakeHistoryRecord[]> {
  const items = await loadHistoryRows();

  const sessionState = input?.sessionState || 'all';
  const filteredItems = items.filter((row) => {
    if (sessionState === 'active') {
      return row.stockTakeActive;
    }
    if (sessionState === 'inactive') {
      return !row.stockTakeActive;
    }
    return true;
  });

  if (input?.limit == null) {
    return filteredItems;
  }

  const limit = Math.max(1, Math.min(Number(input.limit), 50000));
  return filteredItems.slice(0, limit);
}
