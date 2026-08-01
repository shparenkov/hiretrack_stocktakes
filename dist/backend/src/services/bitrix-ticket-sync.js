"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBitrixTicketItem = createBitrixTicketItem;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const https_1 = __importDefault(require("https"));
const http_1 = __importDefault(require("http"));
const url_1 = require("url");
function resolveHiretrackRoot() {
    const candidates = [
        path_1.default.resolve(__dirname, '..', '..', '..', '..'),
        path_1.default.resolve(__dirname, '..', '..', '..', '..', '..'),
    ];
    const matched = candidates.find((candidate) => fs_1.default.existsSync(path_1.default.join(candidate, 'hiretrack.config.json')));
    return matched || candidates[candidates.length - 1];
}
function loadConfig() {
    const configPath = path_1.default.join(resolveHiretrackRoot(), 'hiretrack.config.json');
    return JSON.parse(fs_1.default.readFileSync(configPath, 'utf8'));
}
function requestJson(method, targetUrl, body, timeoutMs) {
    const url = new url_1.URL(targetUrl);
    const transport = url.protocol === 'https:' ? https_1.default : http_1.default;
    const payload = body == null ? null : JSON.stringify(body);
    return new Promise((resolve, reject) => {
        const req = transport.request({
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port,
            path: `${url.pathname}${url.search}`,
            method,
            headers: payload
                ? {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                }
                : undefined,
            rejectUnauthorized: false,
            timeout: timeoutMs,
        }, (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                let parsed = null;
                try {
                    parsed = data ? JSON.parse(data) : null;
                }
                catch (error) {
                    reject(new Error(`Invalid JSON from ${targetUrl}: ${String(error)}`));
                    return;
                }
                if ((res.statusCode || 500) >= 400) {
                    reject(new Error(`HTTP ${res.statusCode} from ${targetUrl}: ${JSON.stringify(parsed)}`));
                    return;
                }
                resolve(parsed || {});
            });
        });
        req.on('timeout', () => {
            req.destroy(new Error(`Request timeout after ${timeoutMs}ms: ${targetUrl}`));
        });
        req.on('error', reject);
        if (payload) {
            req.write(payload);
        }
        req.end();
    });
}
function getTicketsBitrixConfig() {
    const config = loadConfig();
    const tickets = config.bitrix.tickets || {};
    const entityTypeId = tickets.entityTypeId || config.bitrix.modes?.test?.entityTypeId;
    if (!entityTypeId) {
        throw new Error('Bitrix tickets entityTypeId is not configured.');
    }
    return {
        timeoutMs: config.poller?.timeoutMs || 15000,
        baseUrl: config.bitrix.baseUrl.endsWith('/')
            ? config.bitrix.baseUrl
            : `${config.bitrix.baseUrl}/`,
        enabled: tickets.enabled !== false,
        entityTypeId,
        categoryId: tickets.categoryId ?? null,
        stageId: tickets.stageId ?? null,
        opened: tickets.opened || 'Y',
        fields: tickets.fields || {},
    };
}
function buildTitle(ticket) {
    const parts = [ticket.equipmentName, ticket.serialNumber].filter(Boolean);
    return parts.length > 0 ? parts.join(' | ') : ticket.ticketNumber;
}
function buildComments(ticket) {
    return [
        `Ticket: ${ticket.ticketNumber}`,
        `Fault: ${ticket.faultDescription || ''}`,
        `Barcode: ${ticket.barcodeRaw || ''}`,
        `Barcode type: ${ticket.barcodeType || ''}`,
        `Serial: ${ticket.serialNumber || ''}`,
        `HireTrack item: ${ticket.hiretrackItemRef ?? ''}`,
        `Eqlist: ${ticket.hiretrackEqlistName || ''}`,
        `Job: ${ticket.hiretrackJobRef || ''}`,
    ].join('\n');
}
function mapFields(ticket, config) {
    const fields = {
        title: buildTitle(ticket),
        opened: config.opened,
    };
    if (config.categoryId != null) {
        fields.categoryId = config.categoryId;
    }
    if (config.stageId) {
        fields.stageId = config.stageId;
    }
    if (config.fields.description) {
        fields[config.fields.description] = ticket.faultDescription;
    }
    if (config.fields.serialNumber) {
        fields[config.fields.serialNumber] = ticket.serialNumber;
    }
    if (config.fields.barcodeRaw) {
        fields[config.fields.barcodeRaw] = ticket.barcodeRaw || '';
    }
    if (config.fields.barcodeType) {
        fields[config.fields.barcodeType] = ticket.barcodeType || '';
    }
    if (config.fields.hiretrackItemRef) {
        fields[config.fields.hiretrackItemRef] = ticket.hiretrackItemRef;
    }
    if (config.fields.hiretrackEqlistName) {
        fields[config.fields.hiretrackEqlistName] = ticket.hiretrackEqlistName || '';
    }
    if (config.fields.hiretrackJobRef) {
        fields[config.fields.hiretrackJobRef] = ticket.hiretrackJobRef || '';
    }
    if (config.fields.hiretrackTicketNumber) {
        fields[config.fields.hiretrackTicketNumber] = ticket.ticketNumber;
    }
    if (config.fields.status) {
        fields[config.fields.status] = ticket.status;
    }
    if (!config.fields.description) {
        fields.comments = buildComments(ticket);
    }
    return fields;
}
async function createBitrixTicketItem(ticket) {
    const config = getTicketsBitrixConfig();
    if (!config.enabled) {
        throw new Error('Bitrix ticket sync is disabled in config.');
    }
    const response = await requestJson('POST', `${config.baseUrl}crm.item.add.json`, {
        entityTypeId: config.entityTypeId,
        fields: mapFields(ticket, config),
    }, config.timeoutMs);
    const result = response.result;
    const itemId = result?.item?.id;
    if (!itemId) {
        throw new Error(`Bitrix did not return item id: ${JSON.stringify(response)}`);
    }
    return {
        bitrixItemId: String(itemId),
        response,
    };
}
