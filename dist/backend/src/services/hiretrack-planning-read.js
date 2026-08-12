"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPlanningOccupancyData = getPlanningOccupancyData;
exports.getPlanningJobsGanttData = getPlanningJobsGanttData;
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
function resolveBridgePath() {
    return path_1.default.resolve(process.cwd(), 'backend', 'python', 'hiretrack_planning_read.py');
}
function runPlanningOdbcRead(request) {
    const pythonExecutable = process.env.HIRETRACK_PYTHON || 'python';
    const timeoutMs = Number(process.env.PLANNING_ODBC_TIMEOUT_MS || 90000);
    const responseLimit = Number(process.env.PLANNING_ODBC_RESPONSE_LIMIT || 64_000_000);
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
            finish(() => reject(new Error(`Planning ODBC read timed out after ${timeoutMs}ms.`)));
        }, timeoutMs);
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
            stdout += chunk;
            if (stdout.length > responseLimit) {
                child.kill();
                finish(() => reject(new Error('Planning ODBC read response exceeded the configured size limit.')));
            }
        });
        child.stderr.on('data', (chunk) => {
            stderr = (stderr + chunk).slice(-16_000);
        });
        child.on('error', (error) => {
            finish(() => reject(new Error(`Unable to start planning ODBC read bridge: ${error.message}`)));
        });
        child.on('close', (code) => {
            finish(() => {
                let response;
                try {
                    response = JSON.parse(stdout);
                }
                catch {
                    reject(new Error(`Invalid response from planning ODBC read bridge: ${stderr || stdout || `exit ${code}`}`));
                    return;
                }
                if (code !== 0 || !response.ok) {
                    reject(new Error(response.error || stderr || `Planning ODBC read bridge exited with code ${code}.`));
                    return;
                }
                resolve(response.result);
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
let dataCache = null;
let pendingRead = null;
function refreshOccupancyData() {
    if (!pendingRead) {
        pendingRead = runPlanningOdbcRead({ operation: 'equipment-occupancy' })
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
async function getPlanningOccupancyData(options) {
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
let ganttCache = null;
let pendingGanttRead = null;
function refreshJobsGanttData() {
    if (!pendingGanttRead) {
        pendingGanttRead = runPlanningOdbcRead({ operation: 'jobs-gantt' })
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
async function getPlanningJobsGanttData(options) {
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
