import { spawn } from 'child_process';
import path from 'path';

// Deliberately a separate spawn helper from hiretrack-odbc-write.ts, pointing
// at a separate Python bridge script and a separate writable DSN
// (CREW_WRITE_ODBC_DSN). Do not merge this with the crew read bridge or with
// hiretrack-odbc-write.ts - each writable DSN is scoped to one feature on
// purpose.

interface BridgeResponse<T> {
  ok: boolean;
  result?: T;
  error?: string;
}

export interface AssignPositionResult {
  jobRef: string;
  phaseTitle: string;
  positionIndex: number;
  positionId: number;
  assignee: string;
}

function resolveBridgePath() {
  return path.resolve(process.cwd(), 'backend', 'python', 'hiretrack_crew_write.py');
}

export function runCrewOdbcWrite<T>(request: Record<string, unknown>): Promise<T> {
  const pythonExecutable = process.env.HIRETRACK_PYTHON || 'python';
  const timeoutMs = Number(process.env.CREW_WRITE_ODBC_TIMEOUT_MS || 30000);
  const responseLimit = Number(process.env.CREW_WRITE_ODBC_RESPONSE_LIMIT || 1_000_000);

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
      finish(() => reject(new Error(`Crew ODBC write timed out after ${timeoutMs}ms.`)));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.length > responseLimit) {
        child.kill();
        finish(() => reject(new Error('Crew ODBC write response exceeded the configured size limit.')));
      }
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-16_000);
    });
    child.on('error', (error) => {
      finish(() => reject(new Error(`Unable to start crew ODBC write bridge: ${error.message}`)));
    });
    child.on('close', (code) => {
      finish(() => {
        let response: BridgeResponse<T>;
        try {
          response = JSON.parse(stdout) as BridgeResponse<T>;
        } catch {
          reject(new Error(`Invalid response from crew ODBC write bridge: ${stderr || stdout || `exit ${code}`}`));
          return;
        }
        if (code !== 0 || !response.ok) {
          reject(new Error(response.error || stderr || `Crew ODBC write bridge exited with code ${code}.`));
          return;
        }
        resolve(response.result as T);
      });
    });

    child.stdin.end(JSON.stringify(request));
  });
}

export async function assignCrewPosition(params: {
  jobRef: string;
  phaseTitle: string;
  positionIndex: number;
  personName: string;
}): Promise<AssignPositionResult> {
  return runCrewOdbcWrite<AssignPositionResult>({ operation: 'assign-position', ...params });
}
