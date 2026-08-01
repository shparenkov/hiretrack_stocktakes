import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { URL } from 'url';
import { HiretrackEqlistLookupRecord } from '../types';

interface HiretrackConfig {
  hiretrack?: {
    baseUrl?: string;
    headers?: Record<string, string>;
    equipmentEqlistLookupQbeId?: number;
  };
  poller?: {
    timeoutMs?: number;
  };
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

export async function lookupEquipmentEqlistsInHiretrack(input: {
  itemRef?: number | null;
  barcodeRaw?: string | null;
  serialNumber?: string | null;
}): Promise<HiretrackEqlistLookupRecord[]> {
  const config = loadHiretrackConfig();
  const qbeId = Number(config.hiretrack?.equipmentEqlistLookupQbeId || 0);

  if (!qbeId) {
    return [];
  }

  const params = new URLSearchParams({
    qbe_id: String(qbeId),
  });

  if (input.itemRef) {
    params.set('ItemRef', String(input.itemRef));
  }

  const lookupText = normalizeString(input.barcodeRaw) || normalizeString(input.serialNumber);
  if (lookupText) {
    params.set('Lookup', lookupText);
  }

  if (!input.itemRef && !lookupText) {
    return [];
  }

  const url = `${config.hiretrack?.baseUrl}/api_v1/GetSearchResults?${params.toString()}`;
  const raw = await requestJson(
    'GET',
    url,
    config.hiretrack?.headers || {},
    Number(config.poller?.timeoutMs || 15000),
  );

  if (!Array.isArray(raw) || raw.length === 0) {
    return [];
  }

  return raw
    .map((entry) => {
      const row = entry as Record<string, unknown>;
      const eqlistId = normalizeInt(row.EqlistId ?? row.Eql_no);
      if (!eqlistId) {
        return null;
      }

      return {
        eqlistId,
        eqlistName: normalizeString(row.EqlistName ?? row.Eql_Name),
        jobNo: normalizeInt(row.JobNo ?? row.Job_no),
        jobRef: normalizeString(row.JobRef ?? row.Job_Ref),
        clientName: normalizeString(row.ClientName ?? row.Customer),
        lastSeenAt: normalizeString(row.LastSeenAt ?? row.ScanDate),
        operationType: normalizeInt(row.OperationType ?? row.OpsType),
        isCurrent: normalizeBool(row.IsCurrent),
      } satisfies HiretrackEqlistLookupRecord;
    })
    .filter((row): row is HiretrackEqlistLookupRecord => row !== null);
}
