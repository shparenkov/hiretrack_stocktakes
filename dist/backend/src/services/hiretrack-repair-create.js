"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLoggedFaultInHiretrack = createLoggedFaultInHiretrack;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const https_1 = __importDefault(require("https"));
const http_1 = __importDefault(require("http"));
const url_1 = require("url");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const iconv = require('iconv-lite');
function resolveConfigPath() {
    return path_1.default.resolve(process.cwd(), '..', 'hiretrack.config.json');
}
function loadHiretrackConfig() {
    const configPath = resolveConfigPath();
    return JSON.parse(fs_1.default.readFileSync(configPath, 'utf8'));
}
function requestJson(method, targetUrl, headers, timeoutMs) {
    const url = new url_1.URL(targetUrl);
    const transport = url.protocol === 'https:' ? https_1.default : http_1.default;
    return new Promise((resolve, reject) => {
        const req = transport.request({
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port,
            path: `${url.pathname}${url.search}`,
            method,
            headers,
            rejectUnauthorized: false,
            timeout: timeoutMs,
        }, (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                let parsed = data;
                try {
                    parsed = data ? JSON.parse(data) : null;
                }
                catch (error) {
                    reject(new Error(`Invalid JSON from ${targetUrl}: ${error instanceof Error ? error.message : String(error)}`));
                    return;
                }
                if ((res.statusCode || 0) >= 400) {
                    reject(new Error(`HTTP ${res.statusCode} from ${targetUrl}: ${JSON.stringify(parsed)}`));
                    return;
                }
                resolve(parsed);
            });
        });
        req.on('timeout', () => {
            req.destroy(new Error(`Request timeout after ${timeoutMs}ms: ${targetUrl}`));
        });
        req.on('error', reject);
        req.end();
    });
}
function normalizeInt(value) {
    if (value == null || value === '') {
        return null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}
function toWin1251ChrExpression(value) {
    if (!value) {
        return '';
    }
    const bytes = iconv.encode(value, 'win1251');
    return Array.from(bytes)
        .map((byte) => `CHR(${byte})`)
        .join('+');
}
async function createLoggedFaultInHiretrack(input) {
    const config = loadHiretrackConfig();
    const qbeId = Number(config.hiretrack?.repairCreateQbeId || 0);
    if (!qbeId) {
        throw new Error('HireTrack logged fault QBE is not configured.');
    }
    const searchParams = new URLSearchParams({
        qbe_id: String(qbeId),
        ItemRef: String(input.itemRef),
        BadEqlistId: input.badEqlistId ? String(input.badEqlistId) : '0',
        FaultDescriptionExpr: toWin1251ChrExpression(input.faultDescription || ''),
        EngineerNotesExpr: toWin1251ChrExpression(input.engineerNotes || ''),
        ReportedBy: input.reportedBy || '',
    });
    const url = `${config.hiretrack?.baseUrl}/api_v1/PostData?${searchParams.toString()}`;
    const raw = await requestJson('POST', url, config.hiretrack?.headers || {}, Number(config.poller?.timeoutMs || 15000));
    if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error('HireTrack logged fault QBE returned no rows.');
    }
    const row = raw[0];
    const serviceRecordNo = normalizeInt(row.ServiceRecordNo ?? row.RecordNo);
    if (!serviceRecordNo) {
        throw new Error(`HireTrack logged fault QBE returned invalid service record: ${JSON.stringify(row)}`);
    }
    const resultValue = String(row.Result || '').toLowerCase();
    return {
        result: resultValue === 'existing' ? 'existing' : 'created',
        serviceRecordNo,
        repairLineRef: normalizeInt(row.RepairLineRef),
    };
}
