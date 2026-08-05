"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runHiretrackOdbcWrite = runHiretrackOdbcWrite;
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
function resolveBridgePath() {
    return path_1.default.resolve(process.cwd(), 'backend', 'python', 'hiretrack_equipment_note_write.py');
}
function runHiretrackOdbcWrite(request) {
    const pythonExecutable = process.env.HIRETRACK_PYTHON || 'python';
    const timeoutMs = Number(process.env.HIRETRACK_WRITE_ODBC_TIMEOUT_MS || 30000);
    const responseLimit = Number(process.env.HIRETRACK_WRITE_ODBC_RESPONSE_LIMIT || 1_000_000);
    return new Promise((resolve, reject) => {
        const child = (0, child_process_1.spawn)(pythonExecutable, [resolveBridgePath()], {
            env: process.env,
            windowsHide: true,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const finish = (callback) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            callback();
        };
        const timer = setTimeout(() => {
            child.kill();
            finish(() => reject(new Error(`HireTrack ODBC write timed out after ${timeoutMs}ms.`)));
        }, timeoutMs);
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
            if (stdout.length > responseLimit) {
                child.kill();
                finish(() => reject(new Error('HireTrack ODBC write response exceeded the configured size limit.')));
            }
        });
        child.stderr.on('data', (chunk) => {
            stderr = (stderr + chunk).slice(-16_000);
        });
        child.on('error', (error) => {
            finish(() => reject(new Error(`Unable to start HireTrack ODBC write bridge: ${error.message}`)));
        });
        child.on('close', (code) => {
            finish(() => {
                let response;
                try {
                    response = JSON.parse(stdout);
                }
                catch {
                    reject(new Error(`Invalid response from HireTrack ODBC write bridge: ${stderr || stdout || `exit ${code}`}`));
                    return;
                }
                if (code !== 0 || !response.ok) {
                    reject(new Error(response.error || stderr || `HireTrack ODBC write bridge exited with code ${code}.`));
                    return;
                }
                resolve(response.result);
            });
        });
        child.stdin.end(JSON.stringify(request));
    });
}
