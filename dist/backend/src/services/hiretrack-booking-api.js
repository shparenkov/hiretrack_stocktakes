"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkHiretrackAvailability = checkHiretrackAvailability;
exports.initialiseHiretrackBooking = initialiseHiretrackBooking;
exports.updateHiretrackEqlistDates = updateHiretrackEqlistDates;
exports.updateHiretrackEqlistTitle = updateHiretrackEqlistTitle;
exports.createHiretrackEqlist = createHiretrackEqlist;
exports.createHiretrackJobShell = createHiretrackJobShell;
exports.createHiretrackBooking = createHiretrackBooking;
exports.appendLinesToExistingBooking = appendLinesToExistingBooking;
exports.appendToHiretrackBooking = appendToHiretrackBooking;
exports.changeHiretrackBookingQuantity = changeHiretrackBookingQuantity;
exports.removeFromHiretrackBooking = removeFromHiretrackBooking;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const https_1 = __importDefault(require("https"));
const http_1 = __importDefault(require("http"));
const url_1 = require("url");
const hiretrack_odbc_write_1 = require("./hiretrack-odbc-write");
const hiretrack_equipment_note_write_1 = require("./hiretrack-equipment-note-write");
// Confirmed live against production (2026-08-09): warehouse 1 = "Moscow" (IsDefault),
// pricelist 6 = "SA Rental Scheme", user 1 = "HireTrack_Admin" (SystemAdmin), client 2 =
// "Test client". These are fallbacks only -- override via hiretrack.config.json's
// `hiretrack.defaultUserId` / `defaultWarehouseId` / `defaultPricelistId` / `testClientId`.
const FALLBACK_USER_ID = 1;
const FALLBACK_WAREHOUSE_ID = 1;
const FALLBACK_PRICELIST_ID = 6;
const FALLBACK_TEST_CLIENT_ID = 2;
// jobtypes.Type_idx for "Аренда" (Rental) - confirmed live 2026-08-11.
const RENTAL_JOB_TYPE_ID = 2;
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
// TnxBookingValidationResult, from the api_v2 doc. HireTrack returns HTTP 200
// even when a booking action is rejected (e.g. no stock for the requested
// dates/qty) - the rejection only shows up here, as a non-zero
// ValidationResult with BookingQty/RecordID left at 0. Never treat a 200
// response as success without checking this.
const VALIDATION_RESULT_MESSAGES = {
    0: 'OK',
    1: 'no equipment list id (bvrNoEquipmentListID)',
    2: 'no equipment line id (bvrNoEquipmentLineID)',
    3: 'record not found (bvrRecordNotFound)',
    4: 'not a Nexus job (bvrNotNexusJob)',
    5: 'eqline is for a different job (bvrEqlineIsForDifferentJob)',
    6: 'booking dates do not match the Eqlist dates (bvrBookingDatesNEQListDates)',
    7: 'no stock available for the requested dates/quantity (bvrNoStockAvailable)',
    8: 'warehouse differs from Eqlist (bvrWarehouseDiffersFromEqlist)',
};
function assertBookingSuccess(action, row, writeResult) {
    const code = writeResult.validationResult;
    if (code === null || code === 0) {
        return;
    }
    const message = VALIDATION_RESULT_MESSAGES[code] || `unknown validation code ${code}`;
    throw new Error(`HireTrack ${action} rejected: ${message} (ValidationResult=${code}, row=${JSON.stringify(row)})`);
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
    const writeResult = parseWriteResult(row);
    assertBookingSuccess('initialise_new_booking', row, writeResult);
    return {
        jobId: normalizeInt(row.JobID),
        jobRef: row.JobRef ?? null,
        eqlistId: normalizeInt(row.EqlistID),
        eqRef: row.EqRef ?? null,
        writeResult,
    };
}
// Corrects Eqlists.DateOut/DateBack for a confirmed api_v2 bug - see the
// comment inside createHiretrackBooking for the full mechanism. Only touches
// the two plain date columns (via the writable DSN, same bridge as the Note
// write path) - no pricing/Sort/invoicing fields, unlike a raw Sort insert.
// Exported: also used by hiretrack-job-lookup.ts to self-heal Eqlists whose
// DateOut/DateBack carry sub-second precision (confirmed live 2026-08-09:
// append_to_booking's date-match rejects ANY stored value with a fractional
// second, regardless of what precision the request itself uses - only
// fixing the stored value works). Legacy jobs created before this whole fix
// was deployed got such a value from CreateNewEqlist's CURRENT_TIMESTAMP
// clamp, which carries full microsecond precision.
async function updateHiretrackEqlistDates(eqlistId, dateFrom, dateTo) {
    await (0, hiretrack_odbc_write_1.runHiretrackOdbcWrite)({
        operation: 'update-eqlist-dates',
        eqlistId,
        dateFrom,
        dateTo,
    });
}
// CreateNewEqlist (db.sql:9143-9144) always sets Eql_Title itself to
// `Job_Title || ':' || Eql_name` (the auto-generated internal reference
// code) with no way to opt out via api_v2 - confirmed live across every
// Eqlist created through /create-job/ so far. This corrects it to just the
// clean job name right after creation. Eql_name (the short reference code)
// is left alone - it's not what's shown as the list's name.
async function updateHiretrackEqlistTitle(eqlistId, title) {
    await (0, hiretrack_odbc_write_1.runHiretrackOdbcWrite)({
        operation: 'update-eqlist-title',
        eqlistId,
        title,
    });
}
// CreateNewEqlist (db.sql:9015) directly - adds a FURTHER Eqlist to an
// ALREADY-EXISTING job. api_v2 has no action for this at all
// (initialise_new_booking only ever creates a brand-new Job). Real
// production jobs commonly carry many Eqlists with their own distinct date
// ranges (one confirmed job has 27, one per act on a multi-day booking), so
// this is a genuinely separate operation from creating the job itself, not
// a variant of it. Also applies the same Eql_Title cleanup as the job's own
// first Eqlist - see updateHiretrackEqlistTitle's comment - since
// CreateNewEqlist produces the same "Title:AutoCode" concatenation here too.
async function createHiretrackEqlist(jobId, title, dateFrom, dateTo) {
    const { eqlistId } = await (0, hiretrack_odbc_write_1.runHiretrackOdbcWrite)({
        operation: 'create-eqlist',
        jobId,
        dateFrom,
        dateTo,
    });
    await updateHiretrackEqlistTitle(eqlistId, title);
    return { eqlistId, jobId };
}
// Creates an empty Job+Eqlist shell with no real equipment lines - for the
// "just create the job header, then add equipment through the same
// per-section UI as an existing job" flow. Deliberately does not append any
// lines (unlike createHiretrackBooking below), so the placeholder type never
// becomes a real Sort row either.
async function createHiretrackJobShell(input) {
    const init = await initialiseHiretrackBooking({
        typeId: input.placeholderTypeId,
        quantity: 1,
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
    // Same api_v2 date-clamp bug as createHiretrackBooking - initialise_new_booking
    // never forwards availability_datetime_from/to to CreateNewEqlist, so it
    // always falls back to a past-date safety clamp. Correct it directly.
    await updateHiretrackEqlistDates(init.eqlistId, input.dateFrom, input.dateTo);
    // Same for the Eql_Title "JobName:AutoCode" concatenation - see
    // updateHiretrackEqlistTitle's own comment.
    await updateHiretrackEqlistTitle(init.eqlistId, input.jobName);
    // api_v2 never sets Jobs.Type/Handler/SalesPerson at all - see
    // updateHiretrackJobHeader's own comment.
    await (0, hiretrack_equipment_note_write_1.updateHiretrackJobHeader)({
        jobId: init.jobId,
        type: RENTAL_JOB_TYPE_ID,
        handler: FALLBACK_USER_ID,
        salesPerson: input.salesPersonId ?? FALLBACK_USER_ID,
    });
    if (input.contactPersonId) {
        await (0, hiretrack_equipment_note_write_1.addHiretrackJobContact)(input.clientId, input.contactPersonId, init.jobId);
    }
    return { jobId: init.jobId, jobRef: init.jobRef, eqlistId: init.eqlistId, eqRef: init.eqRef };
}
// Batches initialise_new_booking (creates the Job+Eqlist shell) +
// append_to_booking (every line, including the "first" one) into one call,
// mirroring createEquipmentNoteWithLines's shape. Callers (the rider-matching
// Claude Skill) must have already shown the proposed line list to the user
// and gotten explicit confirmation before calling this - unlike the Note
// write path, this creates a real Job and Eqlist in production HireTrack.
//
// IMPORTANT (confirmed live 2026-08-09): initialise_new_booking's embedded
// "first line" (its own hiretrack_type_id/quantity_required params) never
// actually persists a Sort row on this server - it only creates the Job and
// Eqlist shell. Verified by calling it alone and reading Sort straight after:
// zero rows for the new Eqlist. Confirmed independently when a real user
// booking only got its second (appended) line recorded, not the first
// (initialise-only) one. So every line, including the first, goes through
// append_to_booking - initialiseHiretrackBooking's own typeId/quantity here
// are only "required shape" for the API call, not a real write.
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
    // Confirmed live 2026-08-09: initialise_new_booking's availability_datetime_from/to
    // never reach CreateNewEqlist's aStartDate/aEndDate - it always falls back to that
    // function's own past-date safety clamp (DateOut=now, DateBack=tomorrow 08:00).
    // Every append_to_booking call then fails with ValidationResult 6
    // (bvrBookingDatesNEQListDates) because the line's dates don't match the Eqlist's
    // actual (wrong) header dates. Correct it directly before appending anything.
    await updateHiretrackEqlistDates(init.eqlistId, input.dateFrom, input.dateTo);
    // Same for the Eql_Title "JobName:AutoCode" concatenation - see
    // updateHiretrackEqlistTitle's own comment.
    await updateHiretrackEqlistTitle(init.eqlistId, input.jobName);
    let linesWritten = 0;
    const failedLines = [];
    // Sequential on purpose, same reasoning as the Note write path: rider line
    // counts are small, and this isolates each line's failure instead of
    // aborting the whole booking on the first bad line.
    for (const line of [firstLine, ...restLines]) {
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
// Adds lines to an EXISTING Eqlist (the "open an existing job" flow) - no
// initialise_new_booking involved, since the Job/Eqlist already exist.
// dateFrom/dateTo must be exactly the target Eqlist's own DateOut/DateBack
// (append_to_booking rejects any mismatch with ValidationResult 6,
// bvrBookingDatesNEQListDates - see hiretrack-job-lookup.ts, which is where
// these dates should come from, not user-typed values).
async function appendLinesToExistingBooking(input) {
    if (input.lines.length === 0) {
        throw new Error('appendLinesToExistingBooking requires at least one line.');
    }
    let linesWritten = 0;
    const failedLines = [];
    const writtenLines = [];
    for (const line of input.lines) {
        try {
            const result = await appendToHiretrackBooking({
                typeId: line.typeId,
                quantity: line.quantity,
                dateFrom: input.dateFrom,
                dateTo: input.dateTo,
                eqlistId: input.eqlistId,
                userId: input.userId,
                clientId: input.clientId,
                warehouseId: input.warehouseId,
                pricelistId: input.pricelistId,
            });
            if (result.lineRefId == null) {
                throw new Error('append_to_booking did not return a LineRefID.');
            }
            if (line.sectionId != null) {
                await (0, hiretrack_equipment_note_write_1.setHiretrackLineSection)(result.lineRefId, input.eqlistId, line.sectionId);
            }
            linesWritten += 1;
            writtenLines.push({
                typeId: line.typeId,
                // BookingQty is the real persisted amount - confirmed live
                // (2026-08-10) that HireTrack silently caps this below
                // RequestedQty when stock is insufficient, still with
                // ValidationResult 0 (success) and no other signal of the
                // shortfall. Falling back to the requested value only if the API
                // ever omits BookingQty entirely.
                quantity: result.bookingQty ?? line.quantity,
                requestedQuantity: line.quantity,
                sectionId: line.sectionId ?? null,
                lineRefId: result.lineRefId,
            });
        }
        catch (error) {
            failedLines.push({
                typeId: line.typeId,
                error: error instanceof Error ? error.message : 'append_to_booking failed',
            });
        }
    }
    return { linesWritten, failedLines, writtenLines };
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
    const writeResult = parseWriteResult(row);
    // HireTrack returns HTTP 200 even when it rejects the line (e.g. no stock
    // for the requested dates/qty) - only ValidationResult/BookingQty reveal
    // that. Without this check a rejected line was silently counted as written.
    assertBookingSuccess('append_to_booking', row, writeResult);
    const lineRefId = normalizeInt(row.LineRefID);
    let bookingQty = normalizeInt(row.BookingQty);
    // HireTrack silently caps bookingQty below the requested quantity when
    // stock is insufficient instead of rejecting the write (ValidationResult
    // stays 0) - confirmed live 2026-08-10. Per explicit user instruction,
    // the persisted quantity must always match what was requested regardless
    // of availability, so force it directly when HireTrack didn't honor it.
    if (lineRefId != null && bookingQty != null && bookingQty < input.quantity) {
        await (0, hiretrack_equipment_note_write_1.forceHiretrackLineQuantity)(lineRefId, input.eqlistId, input.quantity);
        bookingQty = input.quantity;
    }
    return {
        typeDescription: row.TypeDescription ?? null,
        lineRefId,
        requestedQty: normalizeInt(row.RequestedQty),
        stocklevelForWarehouse: normalizeInt(row.StocklevelForWarehouse),
        availableQty: normalizeInt(row.AvailableQty),
        bookingQty,
        currencyIso: row.CurrencyISO ?? null,
        preDiscountPrice: normalizeFloat(row.PreDiscountPrice),
        discountedPrice: normalizeFloat(row.DiscountedPrice),
        discountRate: normalizeFloat(row.DiscountRate),
        writeResult,
    };
}
// Changes the quantity on an already-existing line (targets Sort.Lineref,
// the same value append_to_booking returns as LineRefID) - for editing a
// line on a job opened via "open existing job", not a line still being
// staged for a new booking.
async function changeHiretrackBookingQuantity(input) {
    const config = loadHiretrackConfig();
    const baseUrl = config.hiretrack?.baseUrl;
    if (!baseUrl) {
        throw new Error('HireTrack baseUrl is not configured.');
    }
    const params = new URLSearchParams({
        hiretrack_user_id: String(input.userId ?? config.hiretrack?.defaultUserId ?? FALLBACK_USER_ID),
        hiretrack_client_id: String(input.clientId),
        lineref_id: String(input.lineRefId),
        quantity_required: String(input.quantity),
    });
    const url = `${baseUrl}/api_v2/change_booking_quantity?${params.toString()}`;
    const raw = await requestJson('PUT', url, config.hiretrack?.headers || {}, Number(config.poller?.timeoutMs || 15000));
    if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error('HireTrack change_booking_quantity returned no rows.');
    }
    const row = raw[0];
    const writeResult = parseWriteResult(row);
    assertBookingSuccess('change_booking_quantity', row, writeResult);
    let bookingQty = normalizeInt(row.BookingQty);
    // See appendToHiretrackBooking's matching comment - same silent-cap
    // behavior, same forced override so the persisted quantity always
    // matches what was requested.
    if (bookingQty != null && bookingQty < input.quantity) {
        await (0, hiretrack_equipment_note_write_1.forceHiretrackLineQuantity)(input.lineRefId, input.eqlistId, input.quantity);
        bookingQty = input.quantity;
    }
    return {
        typeDescription: row.TypeDescription ?? null,
        requestedQty: normalizeInt(row.RequestedQty),
        stocklevelForWarehouse: normalizeInt(row.StocklevelForWarehouse),
        availableQty: normalizeInt(row.AvailableQty),
        bookingQty,
        writeResult,
    };
}
// Removes an already-existing line entirely (Sort.Lineref). Note the api_v2
// param is misleadingly named "jobref_id" but per the doc it's the numeric
// JobID (Jobs.JobNo), not the string Job_Ref.
async function removeFromHiretrackBooking(input) {
    const config = loadHiretrackConfig();
    const baseUrl = config.hiretrack?.baseUrl;
    if (!baseUrl) {
        throw new Error('HireTrack baseUrl is not configured.');
    }
    const params = new URLSearchParams({
        hiretrack_user_id: String(input.userId ?? config.hiretrack?.defaultUserId ?? FALLBACK_USER_ID),
        hiretrack_client_id: String(input.clientId),
        lineref_id: String(input.lineRefId),
        jobref_id: String(input.jobId),
    });
    const url = `${baseUrl}/api_v2/remove_from_booking?${params.toString()}`;
    const raw = await requestJson('PUT', url, config.hiretrack?.headers || {}, Number(config.poller?.timeoutMs || 15000));
    if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error('HireTrack remove_from_booking returned no rows.');
    }
    const row = raw[0];
    const writeResult = parseWriteResult(row);
    assertBookingSuccess('remove_from_booking', row, writeResult);
    return { writeResult };
}
