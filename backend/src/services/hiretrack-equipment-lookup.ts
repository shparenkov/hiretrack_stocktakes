import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { URL } from 'url';

interface HiretrackConfig {
  hiretrack?: {
    baseUrl?: string;
    headers?: Record<string, string>;
    equipmentLookupQbeId?: number;
  };
  poller?: {
    timeoutMs?: number;
  };
}

export interface EquipmentLookupResult {
  barcode: string | null;
  serialNumber: string | null;
  itemRef: number | null;
  equipmentTypeId: number | null;
  equipmentName: string | null;
}

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
              new Error(`Invalid JSON from ${targetUrl}: ${error instanceof Error ? error.message : String(error)}`)
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
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

export async function lookupEquipmentInHiretrack(
  barcodeRaw?: string | null,
  serialNumber?: string | null,
): Promise<EquipmentLookupResult | null> {
  const config = loadHiretrackConfig();
  const qbeId = Number(config.hiretrack?.equipmentLookupQbeId || 0);

  if (!qbeId) {
    throw new Error('HireTrack equipment lookup QBE is not configured.');
  }

  const lookupValue = normalizeString(barcodeRaw) || normalizeString(serialNumber);
  if (!lookupValue) {
    return null;
  }

  const searchParams = new URLSearchParams({
    qbe_id: String(qbeId),
    Lookup: lookupValue,
  });

  const url = `${config.hiretrack?.baseUrl}/api_v1/GetSearchResults?${searchParams.toString()}`;
  const raw = await requestJson(
    'GET',
    url,
    config.hiretrack?.headers || {},
    Number(config.poller?.timeoutMs || 15000),
  );

  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }

  const row = raw[0] as Record<string, unknown>;
  return {
    barcode: normalizeString(row.Barcode),
    serialNumber: normalizeString(row.SerialNumber ?? row.SerialNo),
    itemRef: normalizeInt(row.ItemRef),
    equipmentTypeId: normalizeInt(row.EquipmentTypeId ?? row.Type),
    equipmentName: normalizeString(row.EquipmentName ?? row.Description ?? row.EqTypeDescription),
  };
}
