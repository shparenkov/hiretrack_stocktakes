import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { URL } from 'url';

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
  return {
    jobId: normalizeInt(row.JobID),
    jobRef: (row.JobRef as string) ?? null,
    eqlistId: normalizeInt(row.EqlistID),
    eqRef: (row.EqRef as string) ?? null,
    writeResult: parseWriteResult(row),
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

// Batches initialise_new_booking (first line, creates the Job+Eqlist) +
// append_to_booking (remaining lines) into one call, mirroring
// createEquipmentNoteWithLines's shape. Callers (the rider-matching Claude
// Skill) must have already shown the proposed line list to the user and
// gotten explicit confirmation before calling this - unlike the Note write
// path, this creates a real Job and Eqlist in production HireTrack.
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

  let linesWritten = 1;
  const failedLines: { typeId: number; error: string }[] = [];

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
    writeResult: parseWriteResult(row),
  };
}
