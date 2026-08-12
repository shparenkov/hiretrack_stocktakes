import { spawn } from 'child_process';
import path from 'path';

// Deliberately a separate spawn helper from hiretrack-odbc-read.ts/
// hiretrack-crew-read.ts, pointing at its own bridge script
// (hiretrack_planning_read.py) and its own DSN env var (PLANNING_ODBC_DSN) -
// unrelated queries/tables, own cache lifecycle. Backs the /planning/ app
// (equipment occupancy, shortage dashboard, jobs Gantt).

interface BridgeResponse<T> {
  ok: boolean;
  result?: T;
  error?: string;
}

export interface PlanningOccupancyType {
  typeId: number;
  name: string;
  categoryName: string;
  siteOwns: number | null;
  dayTotals: number[];
}

export interface PlanningOccupancyLine {
  typeId: number;
  jobId: number;
  jobRef: string;
  jobTitle: string;
  // Job status text (e.g. "Запрос"/"Бронь"/"Подтверждено") and its bucketed
  // priority rank (1/2/3 - see hiretrack_planning_read.py's read_defcon
  // comment) - lets shortages/other consumers group or filter by stage
  // without a second job lookup.
  jobStatus: string;
  jobStatusRank: number;
  start: string;
  end: string;
  qty: number;
}

export interface PlanningOccupancyData {
  start: string;
  end: string;
  types: PlanningOccupancyType[];
  lines: PlanningOccupancyLine[];
}

function resolveBridgePath() {
  return path.resolve(process.cwd(), 'backend', 'python', 'hiretrack_planning_read.py');
}

function runPlanningOdbcRead<T>(request: Record<string, unknown>): Promise<T> {
  const pythonExecutable = process.env.HIRETRACK_PYTHON || 'python';
  const timeoutMs = Number(process.env.PLANNING_ODBC_TIMEOUT_MS || 90000);
  const responseLimit = Number(process.env.PLANNING_ODBC_RESPONSE_LIMIT || 64_000_000);

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
      finish(() => reject(new Error(`Planning ODBC read timed out after ${timeoutMs}ms.`)));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.length > responseLimit) {
        child.kill();
        finish(() => reject(new Error('Planning ODBC read response exceeded the configured size limit.')));
      }
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-16_000);
    });
    child.on('error', (error) => {
      finish(() => reject(new Error(`Unable to start planning ODBC read bridge: ${error.message}`)));
    });
    child.on('close', (code) => {
      finish(() => {
        let response: BridgeResponse<T>;
        try {
          response = JSON.parse(stdout) as BridgeResponse<T>;
        } catch {
          reject(new Error(`Invalid response from planning ODBC read bridge: ${stderr || stdout || `exit ${code}`}`));
          return;
        }
        if (code !== 0 || !response.ok) {
          reject(new Error(response.error || stderr || `Planning ODBC read bridge exited with code ${code}.`));
          return;
        }
        resolve(response.result as T);
      });
    });

    child.stdin.end(JSON.stringify(request));
  });
}

// Heavier query than crew's 30s cache (scans every real job's Sort lines
// across the whole horizon) and far less time-critical than live crew
// assignment - default TTL is minutes, not seconds.
const configuredCacheMs = Number(process.env.PLANNING_ODBC_CACHE_MS || 300000);
const cacheMs = Number.isFinite(configuredCacheMs) ? Math.max(0, configuredCacheMs) : 300000;
let dataCache: { expiresAt: number; data: PlanningOccupancyData } | null = null;
let pendingRead: Promise<PlanningOccupancyData> | null = null;

function refreshOccupancyData(): Promise<PlanningOccupancyData> {
  if (!pendingRead) {
    pendingRead = runPlanningOdbcRead<PlanningOccupancyData>({ operation: 'equipment-occupancy' })
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

export async function getPlanningOccupancyData(options?: { forceRefresh?: boolean }): Promise<PlanningOccupancyData> {
  if (options?.forceRefresh || !dataCache) {
    return refreshOccupancyData();
  }
  if (dataCache.expiresAt <= Date.now()) {
    void refreshOccupancyData().catch((error) => {
      console.error('Background planning-occupancy refresh failed:', error);
    });
  }
  return dataCache.data;
}

export interface PlanningGanttEqlist {
  eqlNo: number;
  eqlName: string;
  eqlTitle: string;
  dateOut: string;
  dateBack: string;
  lineCount: number;
}

export interface PlanningGanttJob {
  jobId: number;
  jobRef: string;
  jobTitle: string;
  start: string;
  end: string;
  eqlists: PlanningGanttEqlist[];
}

export interface PlanningJobsGanttData {
  generatedAt: string;
  jobs: PlanningGanttJob[];
}

let ganttCache: { expiresAt: number; data: PlanningJobsGanttData } | null = null;
let pendingGanttRead: Promise<PlanningJobsGanttData> | null = null;

function refreshJobsGanttData(): Promise<PlanningJobsGanttData> {
  if (!pendingGanttRead) {
    pendingGanttRead = runPlanningOdbcRead<PlanningJobsGanttData>({ operation: 'jobs-gantt' })
      .then((data) => {
        ganttCache = { expiresAt: Date.now() + cacheMs, data };
        return data;
      })
      .finally(() => {
        pendingGanttRead = null;
      });
  }
  return pendingGanttRead;
}

export async function getPlanningJobsGanttData(options?: { forceRefresh?: boolean }): Promise<PlanningJobsGanttData> {
  if (options?.forceRefresh || !ganttCache) {
    return refreshJobsGanttData();
  }
  if (ganttCache.expiresAt <= Date.now()) {
    void refreshJobsGanttData().catch((error) => {
      console.error('Background jobs-gantt refresh failed:', error);
    });
  }
  return ganttCache.data;
}
