import { spawn } from 'child_process';
import path from 'path';

// Deliberately a separate spawn helper from hiretrack-odbc-read.ts, pointing
// at its own bridge script (hiretrack_crew_read.py) and its own DSN env var
// (CREW_ODBC_DSN) - unrelated queries/tables from the stock-take read path.

interface BridgeResponse<T> {
  ok: boolean;
  result?: T;
  error?: string;
}

export interface CrewBookingsPosition {
  role: string;
  position: string;
  description: string;
  status: 'Unprocessed' | 'Pencilled' | 'Booked';
  assignee: string | null;
  qtyPerDay: number[];
  crewId: number;
  roleNotes: string;
  shiftIds: (number | null)[];
  shiftNotes: string[];
}

export interface CrewBookingsPhase {
  name: string;
  start: string;
  end: string;
  positions: CrewBookingsPosition[];
}

export interface CrewBookingsJob {
  id: string;
  status: string;
  statusRank: number;
  name: string;
  start: string;
  end: string;
  activityStart: string;
  activityEnd: string;
  crewBoss: string;
  client: string;
  jobType: string;
  venue: string;
  phases: CrewBookingsPhase[];
}

export interface CrewBookingsData {
  jobs: CrewBookingsJob[];
  crewRoster: string[];
}

function resolveBridgePath() {
  return path.resolve(process.cwd(), 'backend', 'python', 'hiretrack_crew_read.py');
}

function runCrewOdbcRead<T>(request: Record<string, unknown>): Promise<T> {
  const pythonExecutable = process.env.HIRETRACK_PYTHON || 'python';
  const timeoutMs = Number(process.env.CREW_ODBC_TIMEOUT_MS || 90000);
  const responseLimit = Number(process.env.CREW_ODBC_RESPONSE_LIMIT || 64_000_000);

  return new Promise<T>((resolve, reject) => {
    const child = spawn(pythonExecutable, [resolveBridgePath()], {
      env: process.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      callback();
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error(`Crew ODBC read timed out after ${timeoutMs}ms.`)));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.length > responseLimit) {
        child.kill();
        finish(() => reject(new Error('Crew ODBC read response exceeded the configured size limit.')));
      }
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-16_000);
    });
    child.on('error', (error) => {
      finish(() => reject(new Error(`Unable to start crew ODBC read bridge: ${error.message}`)));
    });
    child.on('close', (code) => {
      finish(() => {
        let response: BridgeResponse<T>;
        try {
          response = JSON.parse(stdout) as BridgeResponse<T>;
        } catch {
          reject(new Error(`Invalid response from crew ODBC read bridge: ${stderr || stdout || `exit ${code}`}`));
          return;
        }
        if (code !== 0 || !response.ok) {
          reject(new Error(response.error || stderr || `Crew ODBC read bridge exited with code ${code}.`));
          return;
        }
        resolve(response.result as T);
      });
    });

    child.stdin.end(JSON.stringify(request));
  });
}

const configuredCacheMs = Number(process.env.CREW_ODBC_CACHE_MS || 30000);
const cacheMs = Number.isFinite(configuredCacheMs) ? Math.max(0, configuredCacheMs) : 30000;
let dataCache: { expiresAt: number; data: CrewBookingsData } | null = null;
let pendingRead: Promise<CrewBookingsData> | null = null;

function refreshCrewData(): Promise<CrewBookingsData> {
  if (!pendingRead) {
    pendingRead = runCrewOdbcRead<CrewBookingsData>({ operation: 'crew-data' })
      .then((data) => {
        dataCache = { expiresAt: Date.now() + cacheMs, data };
        return data;
      })
      .finally(() => {
        pendingRead = null;
      });
  }
  return pendingRead;
}

export async function getCrewBookingsData(options?: { forceRefresh?: boolean }): Promise<CrewBookingsData> {
  if (options?.forceRefresh || !dataCache) {
    return refreshCrewData();
  }
  if (dataCache.expiresAt <= Date.now()) {
    void refreshCrewData().catch((error) => {
      console.error('Background crew-bookings refresh failed:', error);
    });
  }
  return dataCache.data;
}
