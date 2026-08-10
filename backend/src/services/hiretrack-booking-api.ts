import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import { runHiretrackOdbcWrite } from './hiretrack-odbc-write';
import { setHiretrackLineSection } from './hiretrack-equipment-note-write';

interface HiretrackConfig {
  hiretrack?: {
    baseUrl?: string;
    headers?: Record<string, string>;
    defaultUserId?: number;
    defaultWarehouseId?: number;
    defaultPricelistId?: number;
    testClientId?: number;
  };
  poller?: {
    timeoutMs?: number;
  };
}

// Confirmed live against production (2026-08-09): warehouse 1 = "Moscow" (IsDefault),
// pricelist 6 = "SA Rental Scheme", user 1 = "HireTrack_Admin" (SystemAdmin), client 2 =
// "Test client". These are fallbacks only -- override via hiretrack.config.json's
// `hiretrack.defaultUserId` / `defaultWarehouseId` / `defaultPricelistId` / `testClientId`.
const FALLBACK_USER_ID = 1;
const FALLBACK_WAREHOUSE_ID = 1;
const FALLBACK_PRICELIST_ID = 6;
const FALLBACK_TEST_CLIENT_ID = 2;

function resolveConfigPath() {
  return path.resolve(process.cwd(), '..', 'hiretrack.config.json');
}

function loadHiretrackConfig(): HiretrackConfig {
  const configPath = resolveConfigPath();
  return JSON.parse(fs.readFileSync(configPath, 'utf8')) as HiretrackConfig;
}

function requestJson(method: string, targetUrl: string, headers: Record<string, string>, timeoutMs: number) {
  const url = new URL(targetUrl);
  const transport = url.protocol === 'https:' ? https : http;

  return new Promise<unknown>((resolve, reject) => {
    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
        rejectUnauthorized: false,
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let parsed: unknown = data;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch (error) {
            reject(
              new Error(`Invalid JSON from ${targetUrl}: ${error instanceof Error ? error.message : String(error)}`),
            );
            return;
          }

          if ((res.statusCode || 0) >= 400) {
            reject(new Error(`HTTP ${res.statusCode} from ${targetUrl}: ${JSON.stringify(parsed)}`));
            return;
          }

          resolve(parsed);
        });
      },
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Request timeout after ${timeoutMs}ms: ${targetUrl}`));
    });
    req.on('error', reject);
    req.end();
  });
}

function normalizeInt(value: unknown): number | null {
  if (value == null || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeFloat(value: unknown): number | null {
  if (value == null || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export interface WriteResult {
  writeAction: number | null;
  recordId: number | null;
  validationResult: number | null;
}

function parseWriteResult(row: Record<string, unknown>): WriteResult {
  const wr = (row.WriteResult as Record<string, unknown> | undefined) || {};
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
const VALIDATION_RESULT_MESSAGES: Record<number, string> = {
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

function assertBookingSuccess(action: string, row: Record<string, unknown>, writeResult: WriteResult): void {
  const code = writeResult.validationResult;
  if (code === null || code === 0) {
    return;
  }
  const message = VALIDATION_RESULT_MESSAGES[code] || `unknown validation code ${code}`;
  throw new Error(`HireTrack ${action} rejected: ${message} (ValidationResult=${code}, row=${JSON.stringify(row)})`);
}

export interface CheckAvailabilityInput {
  typeId: number;
  quantity: number;
  dateFrom: string;
  dateTo: string;
  userId?: number;
  clientId?: number;
  warehouseId?: number;
  pricelistId?: number;
}

export interface CheckAvailabilityResult {
  typeDescription: string | null;
  requestedQty: number | null;
  stocklevelForWarehouse: number | null;
  availableQty: number | null;
  bookingQty: number | null;
  periodPrice: number | null;
  writeResult: WriteResult;
}

export async function checkHiretrackAvailability(input: CheckAvailabilityInput): Promise<CheckAvailabilityResult> {
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

  const row = raw[0] as Record<string, unknown>;
  return {
    typeDescription: (row.TypeDescription as string) ?? null,
    requestedQty: normalizeInt(row.RequestedQty),
    stocklevelForWarehouse: normalizeInt(row.StocklevelForWarehouse),
    availableQty: normalizeInt(row.AvailableQty),
    bookingQty: normalizeInt(row.BookingQty),
    periodPrice: normalizeFloat(row.PeriodPrice),
    writeResult: parseWriteResult(row),
  };
}

export interface InitialiseBookingInput {
  typeId: number;
  quantity: number;
  dateFrom: string;
  dateTo: string;
  jobName: string;
  userId?: number;
  clientId: number;
  warehouseId?: number;
  pricelistId?: number;
}

export interface InitialiseBookingResult {
  jobId: number | null;
  jobRef: string | null;
  eqlistId: number | null;
  eqRef: string | null;
  writeResult: WriteResult;
}

export async function initialiseHiretrackBooking(input: InitialiseBookingInput): Promise<InitialiseBookingResult> {
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

  const row = raw[0] as Record<string, unknown>;
  const writeResult = parseWriteResult(row);
  assertBookingSuccess('initialise_new_booking', row, writeResult);
  return {
    jobId: normalizeInt(row.JobID),
    jobRef: (row.JobRef as string) ?? null,
    eqlistId: normalizeInt(row.EqlistID),
    eqRef: (row.EqRef as string) ?? null,
    writeResult,
  };
}

export interface CreateBookingLineInput {
  typeId: number;
  quantity: number;
}

export interface CreateBookingInput {
  jobName: string;
  clientId: number;
  dateFrom: string;
  dateTo: string;
  userId?: number;
  warehouseId?: number;
  pricelistId?: number;
  lines: CreateBookingLineInput[];
}

export interface CreateBookingResult {
  jobId: number;
  jobRef: string | null;
  eqlistId: number;
  eqRef: string | null;
  linesWritten: number;
  failedLines: { typeId: number; error: string }[];
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
export async function updateHiretrackEqlistDates(eqlistId: number, dateFrom: string, dateTo: string): Promise<void> {
  await runHiretrackOdbcWrite({
    operation: 'update-eqlist-dates',
    eqlistId,
    dateFrom,
    dateTo,
  });
}

export interface CreateJobShellInput {
  jobName: string;
  clientId: number;
  dateFrom: string;
  dateTo: string;
  userId?: number;
  warehouseId?: number;
  pricelistId?: number;
  // initialise_new_booking requires a valid hiretrack_type_id/quantity_required
  // in its own params even though (see createHiretrackBooking's comment
  // below) that embedded line never actually persists a Sort row - this
  // value has no real effect on the result, it only satisfies the
  // required-shape. Callers pass any real catalog typeId they already have
  // loaded client-side.
  placeholderTypeId: number;
}

export interface CreateJobShellResult {
  jobId: number;
  jobRef: string | null;
  eqlistId: number;
  eqRef: string | null;
}

// Creates an empty Job+Eqlist shell with no real equipment lines - for the
// "just create the job header, then add equipment through the same
// per-section UI as an existing job" flow. Deliberately does not append any
// lines (unlike createHiretrackBooking below), so the placeholder type never
// becomes a real Sort row either.
export async function createHiretrackJobShell(input: CreateJobShellInput): Promise<CreateJobShellResult> {
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
export async function createHiretrackBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
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

  let linesWritten = 0;
  const failedLines: { typeId: number; error: string }[] = [];

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
    } catch (error) {
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

export interface AppendBookingLineInput extends CreateBookingLineInput {
  // Which EqSections row this line should land in - see setHiretrackLineSection.
  sectionId?: number;
}

export interface AppendLinesToExistingBookingInput {
  eqlistId: number;
  clientId: number;
  dateFrom: string;
  dateTo: string;
  userId?: number;
  warehouseId?: number;
  pricelistId?: number;
  lines: AppendBookingLineInput[];
}

export interface AppendLinesToExistingBookingResult {
  linesWritten: number;
  failedLines: { typeId: number; error: string }[];
  // Per-line detail for successful writes, so a caller (the create-job
  // frontend) can insert the new line into its own DOM directly instead of
  // refetching the whole job just to learn the lineRefId HireTrack assigned.
  // quantity is the REAL persisted amount (BookingQty), not necessarily what
  // was requested - see the comment on appendToHiretrackBooking's own
  // BookingQty field for why these can differ.
  writtenLines: { typeId: number; quantity: number; requestedQuantity: number; sectionId: number | null; lineRefId: number }[];
}

// Adds lines to an EXISTING Eqlist (the "open an existing job" flow) - no
// initialise_new_booking involved, since the Job/Eqlist already exist.
// dateFrom/dateTo must be exactly the target Eqlist's own DateOut/DateBack
// (append_to_booking rejects any mismatch with ValidationResult 6,
// bvrBookingDatesNEQListDates - see hiretrack-job-lookup.ts, which is where
// these dates should come from, not user-typed values).
export async function appendLinesToExistingBooking(
  input: AppendLinesToExistingBookingInput,
): Promise<AppendLinesToExistingBookingResult> {
  if (input.lines.length === 0) {
    throw new Error('appendLinesToExistingBooking requires at least one line.');
  }

  let linesWritten = 0;
  const failedLines: { typeId: number; error: string }[] = [];
  const writtenLines: { typeId: number; quantity: number; requestedQuantity: number; sectionId: number | null; lineRefId: number }[] = [];

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
        await setHiretrackLineSection(result.lineRefId, input.eqlistId, line.sectionId);
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
    } catch (error) {
      failedLines.push({
        typeId: line.typeId,
        error: error instanceof Error ? error.message : 'append_to_booking failed',
      });
    }
  }

  return { linesWritten, failedLines, writtenLines };
}

export interface AppendToBookingInput {
  typeId: number;
  quantity: number;
  dateFrom: string;
  dateTo: string;
  eqlistId: number;
  userId?: number;
  clientId: number;
  warehouseId?: number;
  pricelistId?: number;
}

export interface AppendToBookingResult {
  typeDescription: string | null;
  lineRefId: number | null;
  requestedQty: number | null;
  stocklevelForWarehouse: number | null;
  availableQty: number | null;
  // The REAL persisted quantity - NOT necessarily requestedQty. Confirmed
  // live (2026-08-10): when requestedQty exceeds what's actually available,
  // HireTrack silently caps bookingQty to the available amount while still
  // returning ValidationResult 0 (success) - assertBookingSuccess below
  // only checks ValidationResult, so it does NOT catch this on its own.
  // Every caller that echoes a quantity back to the user must use this
  // field, not the quantity it requested.
  bookingQty: number | null;
  currencyIso: string | null;
  preDiscountPrice: number | null;
  discountedPrice: number | null;
  discountRate: number | null;
  writeResult: WriteResult;
}

export async function appendToHiretrackBooking(input: AppendToBookingInput): Promise<AppendToBookingResult> {
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

  const row = raw[0] as Record<string, unknown>;
  const writeResult = parseWriteResult(row);
  // HireTrack returns HTTP 200 even when it rejects the line (e.g. no stock
  // for the requested dates/qty) - only ValidationResult/BookingQty reveal
  // that. Without this check a rejected line was silently counted as written.
  assertBookingSuccess('append_to_booking', row, writeResult);
  return {
    typeDescription: (row.TypeDescription as string) ?? null,
    lineRefId: normalizeInt(row.LineRefID),
    requestedQty: normalizeInt(row.RequestedQty),
    stocklevelForWarehouse: normalizeInt(row.StocklevelForWarehouse),
    availableQty: normalizeInt(row.AvailableQty),
    bookingQty: normalizeInt(row.BookingQty),
    currencyIso: (row.CurrencyISO as string) ?? null,
    preDiscountPrice: normalizeFloat(row.PreDiscountPrice),
    discountedPrice: normalizeFloat(row.DiscountedPrice),
    discountRate: normalizeFloat(row.DiscountRate),
    writeResult,
  };
}

export interface ChangeBookingQuantityInput {
  lineRefId: number;
  quantity: number;
  clientId: number;
  userId?: number;
}

export interface ChangeBookingQuantityResult {
  typeDescription: string | null;
  requestedQty: number | null;
  stocklevelForWarehouse: number | null;
  availableQty: number | null;
  // The REAL persisted quantity, not necessarily requestedQty - see the
  // matching comment on AppendToBookingResult.bookingQty. Confirmed live
  // (2026-08-10) with the exact same silent-cap behavior here: requesting
  // 13 on a line with 3 truly available returned ValidationResult 0
  // (success), RequestedQty 13, but BookingQty 3 - the change was silently
  // capped, not rejected, so it must be surfaced to the caller explicitly.
  bookingQty: number | null;
  writeResult: WriteResult;
}

// Changes the quantity on an already-existing line (targets Sort.Lineref,
// the same value append_to_booking returns as LineRefID) - for editing a
// line on a job opened via "open existing job", not a line still being
// staged for a new booking.
export async function changeHiretrackBookingQuantity(
  input: ChangeBookingQuantityInput,
): Promise<ChangeBookingQuantityResult> {
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

  const row = raw[0] as Record<string, unknown>;
  const writeResult = parseWriteResult(row);
  assertBookingSuccess('change_booking_quantity', row, writeResult);
  return {
    typeDescription: (row.TypeDescription as string) ?? null,
    requestedQty: normalizeInt(row.RequestedQty),
    stocklevelForWarehouse: normalizeInt(row.StocklevelForWarehouse),
    availableQty: normalizeInt(row.AvailableQty),
    bookingQty: normalizeInt(row.BookingQty),
    writeResult,
  };
}

export interface RemoveFromBookingInput {
  lineRefId: number;
  jobId: number;
  clientId: number;
  userId?: number;
}

// Removes an already-existing line entirely (Sort.Lineref). Note the api_v2
// param is misleadingly named "jobref_id" but per the doc it's the numeric
// JobID (Jobs.JobNo), not the string Job_Ref.
export async function removeFromHiretrackBooking(input: RemoveFromBookingInput): Promise<{ writeResult: WriteResult }> {
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

  const row = raw[0] as Record<string, unknown>;
  const writeResult = parseWriteResult(row);
  assertBookingSuccess('remove_from_booking', row, writeResult);
  return { writeResult };
}
