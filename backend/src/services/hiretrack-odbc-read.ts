import { spawn } from 'child_process';
import path from 'path';

interface BridgeResponse<T> {
  ok: boolean;
  result?: T;
  error?: string;
}

function resolveBridgePath() {
  return path.resolve(process.cwd(), 'backend', 'python', 'hiretrack_stocktake_read.py');
}

export function runHiretrackStocktakeRead<T>(): Promise<T> {
  const pythonExecutable = process.env.HIRETRACK_PYTHON || 'python';
  const timeoutMs = Number(process.env.HIRETRACK_ODBC_TIMEOUT_MS || 90000);
  const responseLimit = Number(process.env.HIRETRACK_ODBC_RESPONSE_LIMIT || 64_000_000);

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
      finish(() => reject(new Error(`HireTrack ODBC read timed out after ${timeoutMs}ms.`)));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (stdout.length > responseLimit) {
        child.kill();
        finish(() => reject(new Error('HireTrack ODBC response exceeded the configured size limit.')));
      }
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-16_000);
    });
    child.on('error', (error) => {
      finish(() => reject(new Error(`Unable to start HireTrack ODBC bridge: ${error.message}`)));
    });
    child.on('close', (code) => {
      finish(() => {
        let response: BridgeResponse<T>;
        try {
          response = JSON.parse(stdout) as BridgeResponse<T>;
        } catch {
          reject(new Error(`Invalid response from HireTrack ODBC bridge: ${stderr || stdout || `exit ${code}`}`));
          return;
        }
        if (code !== 0 || !response.ok) {
          reject(new Error(response.error || stderr || `HireTrack ODBC bridge exited with code ${code}.`));
          return;
        }
        resolve(response.result as T);
      });
    });

    child.stdin.end(JSON.stringify({ operation: 'stocktake-history' }));
  });
}
