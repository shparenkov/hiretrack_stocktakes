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
  // Real CrewPositions.IDX - the stable key writes (assign/unassign/
  // sync-shifts) now address directly, instead of re-deriving "the Nth
  // position" by index at write time.
  positionId: number;
  role: string;
  // Raw CrewType id - only used to fetch affinity/skills candidate data
  // (see CrewCandidate below); role/position above are the display text.
  crewTypeId: number | null;
  position: string;
  description: string;
  status: 'Unprocessed' | 'Pencilled' | 'Booked';
  assignee: string | null;
  qtyPerDay: number[];
  crewId: number;
  roleNotes: string;
  shiftIds: (number | null)[];
  shiftNotes: string[];
  // TShiftStatus per day (0 Unprocessed/"Not Allocated", 2 Pencilled, 3
  // Booked); null where no CrewShifts row exists that day for this position.
  shiftStatuses: (number | null)[];
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
  // Raw ids for the optional affinity feature - crewBossId is the same
  // person as crewBoss above (Name2.NameCounter), handlerId is
  // JOBS."Handler" (Users.UID, a HireTrack staff account - unrelated to
  // Name2/crew people).
  crewBossId: number | null;
  handlerId: number | null;
  phases: CrewBookingsPhase[];
}

export interface CrewBookingsData {
  jobs: CrewBookingsJob[];
  crewRoster: string[];
  // When this snapshot was actually pulled from HireTrack (not when this
  // particular HTTP response was served - a request can be served straight
  // from the cache below) - lets the frontend show a real "data as of..."
  // freshness indicator instead of just "when did my browser last ask".
  fetchedAt: string;
}

export interface CrewJobDetail {
  jobRef: string;
  phases: CrewBookingsPhase[];
  fetchedAt: string;
}

export interface CrewAttributeInfo {
  description: string;
  expiryDate: string | null;
  expired: boolean;
}

export interface CrewAffinityScore {
  score: number;
  isNegative: boolean;
}

// Optional affinity/skills enrichment for the assignee picker (off by
// default in the UI, a separate toggle) - see the "Surface crew affinity..."
// plan. Mirrors a query pattern found via strings analysis of the HireTrack
// NX client binary itself.
export interface CrewCandidate {
  name: string;
  rating: number;
  attributes: CrewAttributeInfo[];
  handlerAffinity: CrewAffinityScore | null;
  crewBossAffinity: CrewAffinityScore | null;
}

export interface CrewCandidatesResult {
  candidates: CrewCandidate[];
  fetchedAt: string;
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
    pendingRead = runCrewOdbcRead<Omit<CrewBookingsData, 'fetchedAt'>>({ operation: 'crew-data' })
      .then((raw) => {
        const data: CrewBookingsData = { ...raw, fetchedAt: new Date().toISOString() };
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

// Position/shift detail for one job, fetched on demand (job row expanded,
// or a periodic refresh while it stays expanded) rather than folded into
// the list above - see hiretrack_crew_read.py's read_crew_list() docstring
// for why the two are split. Deliberately uncached: scoped to one job, this
// is fast enough (confirmed live: ~1s even for the largest job in
// production) that every call can just hit HireTrack directly and always
// be current.
export async function getCrewJobDetail(jobRef: string): Promise<CrewJobDetail> {
  const raw = await runCrewOdbcRead<Omit<CrewJobDetail, 'fetchedAt'>>({ operation: 'crew-job-detail', jobRef });
  return { ...raw, fetchedAt: new Date().toISOString() };
}

// Deliberately uncached, same reasoning as getCrewJobDetail - scoped to the
// ~100-person active roster, fast enough to always hit live.
export async function getCrewCandidates(params: {
  crewTypeId: number | null;
  handlerId: number | null;
  crewBossId: number | null;
}): Promise<CrewCandidatesResult> {
  const raw = await runCrewOdbcRead<Omit<CrewCandidatesResult, 'fetchedAt'>>({
    operation: 'crew-candidates',
    ...params,
  });
  return { ...raw, fetchedAt: new Date().toISOString() };
}
