"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.lookupStocktakeHistoryInHiretrack = lookupStocktakeHistoryInHiretrack;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const https_1 = __importDefault(require("https"));
const http_1 = __importDefault(require("http"));
const url_1 = require("url");
function resolveConfigPath() {
    return path_1.default.resolve(process.cwd(), '..', 'hiretrack.config.json');
}
function loadHiretrackConfig() {
    const configPath = resolveConfigPath();
    return JSON.parse(fs_1.default.readFileSync(configPath, 'utf8'));
}
function requestJson(method, targetUrl, headers, timeoutMs) {
    const url = new url_1.URL(targetUrl);
    const transport = url.protocol === 'https:' ? https_1.default : http_1.default;
    return new Promise((resolve, reject) => {
        const req = transport.request({
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port,
            path: `${url.pathname}${url.search}`,
            method,
            headers,
            rejectUnauthorized: false,
            timeout: timeoutMs,
        }, (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                let parsed = data;
                try {
                    parsed = data ? JSON.parse(data) : null;
                }
                catch (error) {
                    reject(new Error(`Invalid JSON from ${targetUrl}: ${error instanceof Error ? error.message : String(error)}`));
                    return;
                }
                if ((res.statusCode || 0) >= 400) {
                    reject(new Error(`HTTP ${res.statusCode} from ${targetUrl}: ${JSON.stringify(parsed)}`));
                    return;
                }
                resolve(parsed);
            });
        });
        req.on('timeout', () => {
            req.destroy(new Error(`Request timeout after ${timeoutMs}ms: ${targetUrl}`));
        });
        req.on('error', reject);
        req.end();
    });
}
function normalizeString(value) {
    if (value == null) {
        return null;
    }
    const text = String(value).trim();
    return text.length > 0 ? text : null;
}
function normalizeInt(value) {
    if (value == null || value === '') {
        return null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}
function normalizeBool(value) {
    if (typeof value === 'boolean') {
        return value;
    }
    const text = String(value ?? '').trim().toLowerCase();
    return text === '1' || text === 'true' || text === 'y';
}
function normalizeDisposalReason(value) {
    return normalizeInt(value);
}
function mapDisposalReasonLabel(reason) {
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
function normalizeItemState(value) {
    const text = String(value ?? '').trim().toLowerCase();
    if (text === 'active') {
        return 'active';
    }
    if (text === 'inactive') {
        return 'inactive';
    }
    return 'unknown';
}
function deriveItemState(commissionStatus) {
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
async function lookupStocktakeHistoryInHiretrack(input) {
    const config = loadHiretrackConfig();
    const qbeId = Number(config.hiretrack?.stockTakeHistoryQbeId || 0);
    if (!qbeId) {
        throw new Error('HireTrack stock-take history QBE is not configured. Add hiretrack.stockTakeHistoryQbeId after creating the QBE.');
    }
    const params = new URLSearchParams({
        qbe_id: String(qbeId),
    });
    const url = `${config.hiretrack?.baseUrl}/api_v1/GetSearchResults?${params.toString()}`;
    const raw = await requestJson('GET', url, config.hiretrack?.headers || {}, Number(config.poller?.timeoutMs || 15000));
    if (!Array.isArray(raw) || raw.length === 0) {
        return [];
    }
    const items = raw
        .map((entry) => {
        const row = entry;
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
            currentItemState: reportedState === 'unknown' ? deriveItemState(commissionStatus) : reportedState,
            seenDate: normalizeString(row.SeenDate),
            processedDate: normalizeString(row.ProcessedDate),
            actionedDate: normalizeString(row.ActionedDate),
            actionNotes: normalizeString(row.ActionNotes),
            actionedNotes: normalizeString(row.ActionedNotes),
            disposalReason,
            disposalReasonLabel: normalizeString(row.DisposalReasonLabel ?? row.DisposalReasonName) || mapDisposalReasonLabel(disposalReason),
            disposalDate: normalizeString(row.DisposalDate),
            disposalNotes: normalizeString(row.DisposalNotes ?? row.BatchDisposalNotes),
        };
    })
        .filter((row) => row.stockTakeId !== null);
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
