"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkHiretrackAvailability = checkHiretrackAvailability;
exports.initialiseHiretrackBooking = initialiseHiretrackBooking;
exports.createHiretrackBooking = createHiretrackBooking;
exports.appendToHiretrackBooking = appendToHiretrackBooking;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const https_1 = __importDefault(require("https"));
const http_1 = __importDefault(require("http"));
const url_1 = require("url");
// Confirmed live against production (2026-08-09): warehouse 1 = "Moscow" (IsDefault),
// pricelist 6 = "SA Rental Scheme", user 1 = "HireTrack_Admin" (SystemAdmin), client 2 =
// "Test client". These are fallbacks only -- override via hiretrack.config.json's
// `hiretrack.defaultUserId` / `defaultWarehouseId` / `defaultPricelistId` / `testClientId`.
const FALLBACK_USER_ID = 1;
const FALLBACK_WAREHOUSE_ID = 1;
const FALLBACK_PRICELIST_ID = 6;
const FALLBACK_TEST_CLIENT_ID = 2;
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
function normalizeInt(value) {
    if (value == null || value === '') {
        return null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}
function normalizeFloat(value) {
    if (value == null || value === '') {
        return null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}
function parseWriteResult(row) {
    const wr = row.WriteResult || {};
    return {
        writeAction: normalizeInt(wr.WriteAction),
        recordId: normalizeInt(wr.RecordID),
        validationResult: normalizeInt(wr.ValidationResult),
    };
}
async function checkHiretrackAvailability(input) {
    const config = loadHiretrackConfig();
    const baseUrl = config.hiretrack?.baseUrl;
    if (!baseUrl) {
        throw new Error('HireTrack baseUrl is not configured.');
    }
    const params = new URLSearchParams({
        hiretrack_user_id: String(input.userId ?? config.hiretrack?.defaultUserId ?? FALLBACK_USER_ID),
        hiretrack_client_id: String(input.clientId ?? config.hiretrack?.testClientId ?? FALLBACK_TEST_CLIENT_ID),
        hiretrack_type_id: String(input.typeId),
        hiretrack_warehouse_id: String(input.warehouseId ?? config.hiretrack?.defaultWarehouseId ?? FALLBACK_WAREHOUSE_ID),
        hiretrack_pricelist_id: String(input.pricelistId ?? config.hiretrack?.defaultPricelistId ?? FALLBACK_PRICELIST_ID),
        quantity_required: String(input.quantity),
        availability_datetime_from: input.dateFrom,
        availability_datetime_to: input.dateTo,
    });
    const url = `${baseUrl}/api_v2/check_availability?${params.toString()}`;
    // The doc labels this GET, but its own curl example (and live testing, 2026-08-09) uses POST -- GET 500s with
    // "No item found with name check_availability".
    const raw = await requestJson('POST', url, config.hiretrack?.headers || {}, Number(config.poller?.timeoutMs || 15000));
    if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error('HireTrack check_availability returned no rows.');
    }
    const row = raw[0];
    return {
        typeDescription: row.TypeDescription ?? null,
        requestedQty: normalizeInt(row.RequestedQty),
        stocklevelForWarehouse: normalizeInt(row.StocklevelForWarehouse),
        availableQty: normalizeInt(row.AvailableQty),
        bookingQty: normalizeInt(row.BookingQty),
        periodPrice: normalizeFloat(row.PeriodPrice),
        writeResult: parseWriteResult(row),
    };
}
async function initialiseHiretrackBooking(input) {
    const config = loadHiretrackConfig();
    const baseUrl = config.hiretrack?.baseUrl;
    if (!baseUrl) {
        throw new Error('HireTrack baseUrl is not configured.');
    }
    const params = new URLSearchParams({
        hiretrack_user_id: String(input.userId ?? config.hiretrack?.defaultUserId ?? FALLBACK_USER_ID),
        hiretrack_client_id: String(input.clientId),
        hiretrack_type_id: String(input.typeId),
        hiretrack_warehouse_id: String(input.warehouseId ?? config.hiretrack?.defaultWarehouseId ?? FALLBACK_WAREHOUSE_ID),
        hiretrack_pricelist_id: String(input.pricelistId ?? config.hiretrack?.defaultPricelistId ?? FALLBACK_PRICELIST_ID),
        quantity_required: String(input.quantity),
        availability_datetime_from: input.dateFrom,
        availability_datetime_to: input.dateTo,
        job_name: input.jobName,
    });
    const url = `${baseUrl}/api_v2/initialise_new_booking?${params.toString()}`;
    const raw = await requestJson('POST', url, config.hiretrack?.headers || {}, Number(config.poller?.timeoutMs || 15000));
    if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error('HireTrack initialise_new_booking returned no rows.');
    }
    const row = raw[0];
    return {
        jobId: normalizeInt(row.JobID),
        jobRef: row.JobRef ?? null,
        eqlistId: normalizeInt(row.EqlistID),
        eqRef: row.EqRef ?? null,
        writeResult: parseWriteResult(row),
    };
}
// Batches initialise_new_booking (first line, creates the Job+Eqlist) +
// append_to_booking (remaining lines) into one call, mirroring
// createEquipmentNoteWithLines's shape. Callers (the rider-matching Claude
// Skill) must have already shown the proposed line list to the user and
// gotten explicit confirmation before calling this - unlike the Note write
// path, this creates a real Job and Eqlist in production HireTrack.
async function createHiretrackBooking(input) {
    if (input.lines.length === 0) {
        throw new Error('createHiretrackBooking requires at least one line.');
    }
    const [firstLine, ...restLines] = input.lines;
    const init = await initialiseHiretrackBooking({
        typeId: firstLine.typeId,
        quantity: firstLine.quantity,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        jobName: input.jobName,
        userId: input.userId,
        clientId: input.clientId,
        warehouseId: input.warehouseId,
        pricelistId: input.pricelistId,
    });
    if (!init.jobId || !init.eqlistId) {
        throw new Error(`HireTrack initialise_new_booking did not return a JobID/EqlistID: ${JSON.stringify(init)}`);
    }
    let linesWritten = 1;
    const failedLines = [];
    // Sequential on purpose, same reasoning as the Note write path: rider line
    // counts are small, and this isolates each line's failure instead of
    // aborting the whole booking on the first bad line.
    for (const line of restLines) {
        try {
            await appendToHiretrackBooking({
                typeId: line.typeId,
                quantity: line.quantity,
                dateFrom: input.dateFrom,
                dateTo: input.dateTo,
                eqlistId: init.eqlistId,
                userId: input.userId,
                clientId: input.clientId,
                warehouseId: input.warehouseId,
                pricelistId: input.pricelistId,
            });
            linesWritten += 1;
        }
        catch (error) {
            failedLines.push({
                typeId: line.typeId,
                error: error instanceof Error ? error.message : 'append_to_booking failed',
            });
        }
    }
    return {
        jobId: init.jobId,
        jobRef: init.jobRef,
        eqlistId: init.eqlistId,
        eqRef: init.eqRef,
        linesWritten,
        failedLines,
    };
}
async function appendToHiretrackBooking(input) {
    const config = loadHiretrackConfig();
    const baseUrl = config.hiretrack?.baseUrl;
    if (!baseUrl) {
        throw new Error('HireTrack baseUrl is not configured.');
    }
    const params = new URLSearchParams({
        hiretrack_user_id: String(input.userId ?? config.hiretrack?.defaultUserId ?? FALLBACK_USER_ID),
        hiretrack_client_id: String(input.clientId),
        hiretrack_type_id: String(input.typeId),
        hiretrack_warehouse_id: String(input.warehouseId ?? config.hiretrack?.defaultWarehouseId ?? FALLBACK_WAREHOUSE_ID),
        hiretrack_pricelist_id: String(input.pricelistId ?? config.hiretrack?.defaultPricelistId ?? FALLBACK_PRICELIST_ID),
        quantity_required: String(input.quantity),
        availability_datetime_from: input.dateFrom,
        availability_datetime_to: input.dateTo,
        hiretrack_eqlist_id: String(input.eqlistId),
    });
    const url = `${baseUrl}/api_v2/append_to_booking?${params.toString()}`;
    const raw = await requestJson('POST', url, config.hiretrack?.headers || {}, Number(config.poller?.timeoutMs || 15000));
    if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error('HireTrack append_to_booking returned no rows.');
    }
    const row = raw[0];
    return {
        typeDescription: row.TypeDescription ?? null,
        lineRefId: normalizeInt(row.LineRefID),
        requestedQty: normalizeInt(row.RequestedQty),
        stocklevelForWarehouse: normalizeInt(row.StocklevelForWarehouse),
        availableQty: normalizeInt(row.AvailableQty),
        bookingQty: normalizeInt(row.BookingQty),
        currencyIso: row.CurrencyISO ?? null,
        preDiscountPrice: normalizeFloat(row.PreDiscountPrice),
        discountedPrice: normalizeFloat(row.DiscountedPrice),
        discountRate: normalizeFloat(row.DiscountRate),
        writeResult: parseWriteResult(row),
    };
}
