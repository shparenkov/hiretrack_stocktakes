"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.lookupEquipmentEqlistsInHiretrack = lookupEquipmentEqlistsInHiretrack;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const https_1 = __importDefault(require("https"));
const http_1 = __importDefault(require("http"));
const url_1 = require("url");
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
function normalizeString(value) {
    if (value == null) {
        return null;
    }
    const text = String(value).trim();
    return text.length > 0 ? text : null;
}
function normalizeInt(value) {
    if (value == null || value === '') {
        return null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}
function normalizeBool(value) {
    if (typeof value === 'boolean') {
        return value;
    }
    const text = String(value ?? '').trim().toLowerCase();
    return text === '1' || text === 'true' || text === 'y';
}
async function lookupEquipmentEqlistsInHiretrack(input) {
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
    const raw = await requestJson('GET', url, config.hiretrack?.headers || {}, Number(config.poller?.timeoutMs || 15000));
    if (!Array.isArray(raw) || raw.length === 0) {
        return [];
    }
    return raw
        .map((entry) => {
        const row = entry;
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
        };
    })
        .filter((row) => row !== null);
}
