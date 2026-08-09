"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ticketsRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const bitrix_ticket_sync_1 = require("../services/bitrix-ticket-sync");
const hiretrack_eqlist_lookup_1 = require("../services/hiretrack-eqlist-lookup");
const hiretrack_repair_create_1 = require("../services/hiretrack-repair-create");
const hiretrack_equipment_lookup_1 = require("../services/hiretrack-equipment-lookup");
const hiretrack_stocktake_history_1 = require("../services/hiretrack-stocktake-history");
const hiretrack_equipment_catalog_1 = require("../services/hiretrack-equipment-catalog");
const hiretrack_equipment_note_write_1 = require("../services/hiretrack-equipment-note-write");
const hiretrack_booking_api_1 = require("../services/hiretrack-booking-api");
const stocktake_problem_pdf_1 = require("../services/stocktake-problem-pdf");
const ticket_store_1 = require("../services/ticket-store");
const ticketStatusSchema = zod_1.z.enum([
    'received',
    'diagnosing',
    'waiting_parts',
    'in_repair',
    'ready',
    'handed_over',
    'cancelled',
]);
const ticketPrioritySchema = zod_1.z.enum(['low', 'normal', 'high', 'critical']);
const barcodeTypeSchema = zod_1.z.enum(['EAN13', 'CODE128', 'CODE39', 'DATAMATRIX', 'QR', 'OTHER']);
const createTicketSchema = zod_1.z.object({
    equipmentName: zod_1.z.string().min(1),
    serialNumber: zod_1.z.string().min(1),
    barcodeRaw: zod_1.z.string().optional().nullable(),
    barcodeType: barcodeTypeSchema.optional().nullable(),
    hiretrackItemRef: zod_1.z.coerce.number().int().optional().nullable(),
    hiretrackEquipmentTypeId: zod_1.z.coerce.number().int().optional().nullable(),
    hiretrackEqlistId: zod_1.z.coerce.number().int().optional().nullable(),
    hiretrackEqlistName: zod_1.z.string().optional().nullable(),
    hiretrackJobNo: zod_1.z.coerce.number().int().optional().nullable(),
    hiretrackJobRef: zod_1.z.string().optional().nullable(),
    clientName: zod_1.z.string().optional(),
    clientCompany: zod_1.z.string().optional().nullable(),
    clientPhone: zod_1.z.string().optional().nullable(),
    clientEmail: zod_1.z.string().email().optional().nullable().or(zod_1.z.literal('')),
    faultDescription: zod_1.z.string().min(1),
    engineerNotes: zod_1.z.string().optional().nullable(),
    assignedEngineerId: zod_1.z.string().optional().nullable(),
    assignedEngineerName: zod_1.z.string().optional().nullable(),
    priority: ticketPrioritySchema.optional(),
    receivedAt: zod_1.z.string().datetime().optional(),
    createdBy: zod_1.z.string().optional(),
});
const updateTicketSchema = zod_1.z.object({
    equipmentName: zod_1.z.string().min(1).optional(),
    serialNumber: zod_1.z.string().min(1).optional(),
    barcodeRaw: zod_1.z.string().optional().nullable(),
    barcodeType: barcodeTypeSchema.optional().nullable(),
    hiretrackItemRef: zod_1.z.coerce.number().int().optional().nullable(),
    hiretrackEquipmentTypeId: zod_1.z.coerce.number().int().optional().nullable(),
    hiretrackEqlistId: zod_1.z.coerce.number().int().optional().nullable(),
    hiretrackEqlistName: zod_1.z.string().optional().nullable(),
    hiretrackJobNo: zod_1.z.coerce.number().int().optional().nullable(),
    hiretrackJobRef: zod_1.z.string().optional().nullable(),
    clientName: zod_1.z.string().optional(),
    clientCompany: zod_1.z.string().optional().nullable(),
    clientPhone: zod_1.z.string().optional().nullable(),
    clientEmail: zod_1.z.string().email().optional().nullable().or(zod_1.z.literal('')).optional(),
    faultDescription: zod_1.z.string().min(1).optional(),
    engineerNotes: zod_1.z.string().optional().nullable(),
    assignedEngineerId: zod_1.z.string().optional().nullable(),
    assignedEngineerName: zod_1.z.string().optional().nullable(),
    priority: ticketPrioritySchema.optional(),
    diagnosedAt: zod_1.z.string().datetime().optional().nullable(),
    estimatedReadyAt: zod_1.z.string().datetime().optional().nullable(),
    completedAt: zod_1.z.string().datetime().optional().nullable(),
    handedOverAt: zod_1.z.string().datetime().optional().nullable(),
});
const changeStatusSchema = zod_1.z.object({
    status: ticketStatusSchema,
    actor: zod_1.z.string().optional(),
});
const equipmentLookupSchema = zod_1.z.object({
    barcodeRaw: zod_1.z.string().optional(),
    serialNumber: zod_1.z.string().optional(),
});
const eqlistLookupSchema = zod_1.z.object({
    itemRef: zod_1.z.coerce.number().int().optional(),
    barcodeRaw: zod_1.z.string().optional(),
    serialNumber: zod_1.z.string().optional(),
});
const stocktakeHistorySchema = zod_1.z.object({
    sessionState: zod_1.z.enum(['all', 'active', 'inactive']).optional(),
    limit: zod_1.z.coerce.number().int().min(1).max(50000).optional(),
});
const equipmentNoteLineSchema = zod_1.z.object({
    eqtype: zod_1.z.coerce.number().int().positive(),
    qty: zod_1.z.coerce.number().positive(),
    priceEach: zod_1.z.coerce.number().optional(),
});
const equipmentNoteCreateSchema = zod_1.z.object({
    title: zod_1.z.string().min(1).max(50),
    user: zod_1.z.coerce.number().int().optional(),
    site: zod_1.z.coerce.number().int().optional(),
    currency: zod_1.z.coerce.number().int().optional(),
    priceScheme: zod_1.z.coerce.number().int().optional(),
    clientName: zod_1.z.string().max(255).optional(),
    clientId: zod_1.z.coerce.number().int().optional(),
    lines: zod_1.z.array(equipmentNoteLineSchema).min(1).max(500),
});
const equipmentAvailabilitySchema = zod_1.z.object({
    typeId: zod_1.z.coerce.number().int().positive(),
    quantity: zod_1.z.coerce.number().positive().default(1),
    dateFrom: zod_1.z.string().min(1),
    dateTo: zod_1.z.string().min(1),
    userId: zod_1.z.coerce.number().int().optional(),
    clientId: zod_1.z.coerce.number().int().optional(),
    warehouseId: zod_1.z.coerce.number().int().optional(),
    pricelistId: zod_1.z.coerce.number().int().optional(),
});
const bookingInitialiseSchema = zod_1.z.object({
    typeId: zod_1.z.coerce.number().int().positive(),
    quantity: zod_1.z.coerce.number().positive(),
    dateFrom: zod_1.z.string().min(1),
    dateTo: zod_1.z.string().min(1),
    jobName: zod_1.z.string().min(1).max(50),
    userId: zod_1.z.coerce.number().int().optional(),
    clientId: zod_1.z.coerce.number().int().positive(),
    warehouseId: zod_1.z.coerce.number().int().optional(),
    pricelistId: zod_1.z.coerce.number().int().optional(),
});
const bookingAppendSchema = zod_1.z.object({
    typeId: zod_1.z.coerce.number().int().positive(),
    quantity: zod_1.z.coerce.number().positive(),
    dateFrom: zod_1.z.string().min(1),
    dateTo: zod_1.z.string().min(1),
    eqlistId: zod_1.z.coerce.number().int().positive(),
    userId: zod_1.z.coerce.number().int().optional(),
    clientId: zod_1.z.coerce.number().int().positive(),
    warehouseId: zod_1.z.coerce.number().int().optional(),
    pricelistId: zod_1.z.coerce.number().int().optional(),
});
const bookingLineSchema = zod_1.z.object({
    typeId: zod_1.z.coerce.number().int().positive(),
    quantity: zod_1.z.coerce.number().positive(),
});
const bookingCreateSchema = zod_1.z.object({
    jobName: zod_1.z.string().min(1).max(50),
    clientId: zod_1.z.coerce.number().int().positive(),
    dateFrom: zod_1.z.string().min(1),
    dateTo: zod_1.z.string().min(1),
    userId: zod_1.z.coerce.number().int().optional(),
    warehouseId: zod_1.z.coerce.number().int().optional(),
    pricelistId: zod_1.z.coerce.number().int().optional(),
    lines: zod_1.z.array(bookingLineSchema).min(1).max(200),
});
const stocktakeProblemPdfSchema = zod_1.z.object({
    latestSession: zod_1.z.string().max(500),
    previousSession: zod_1.z.string().max(500).default(''),
    generatedAt: zod_1.z.string().max(100),
    rows: zod_1.z.array(zod_1.z.object({
        equipmentType: zod_1.z.string().max(500),
        barcode: zod_1.z.string().max(200),
        serialNumber: zod_1.z.string().max(200),
        inventoryStatus: zod_1.z.string().max(200),
        currentStatus: zod_1.z.string().max(500),
        currentStatusNote: zod_1.z.string().max(1000),
        lastObservation: zod_1.z.string().max(200),
        lastObservationSource: zod_1.z.string().max(500),
        kind: zod_1.z.enum(['missing', 'repair', 'inactive']),
    })).min(1).max(50000),
});
const stocktakeSummaryPdfSchema = zod_1.z.object({
    latestSession: zod_1.z.string().max(500),
    previousSession: zod_1.z.string().max(500).default(''),
    generatedAt: zod_1.z.string().max(100),
    category: zod_1.z.string().max(500),
    search: zod_1.z.string().max(500).default(''),
    hideZero: zod_1.z.boolean().default(false),
    rows: zod_1.z.array(zod_1.z.object({
        equipmentType: zod_1.z.string().max(500),
        equipmentTypeId: zod_1.z.string().max(100),
        total: zod_1.z.number().int().nonnegative(),
        barcoded: zod_1.z.number().int().nonnegative(),
        active: zod_1.z.number().int().nonnegative(),
        repair: zod_1.z.number().int().nonnegative(),
        previousSeen: zod_1.z.number().int().nonnegative(),
        latestSeen: zod_1.z.number().int().nonnegative(),
        notSeen: zod_1.z.number().int().nonnegative(),
        writtenOff: zod_1.z.number().int().nonnegative(),
        sold: zod_1.z.number().int().nonnegative(),
        level: zod_1.z.enum(['ok', 'minor', 'zero', 'low', 'critical']),
    })).min(1).max(50000),
});
exports.ticketsRouter = (0, express_1.Router)();
const ticketStore = (0, ticket_store_1.createTicketStore)();
function normalizeLookupText(value) {
    const text = String(value ?? '').trim().toLowerCase();
    return text.length > 0 ? text : null;
}
function isTicketActive(status) {
    return status !== 'handed_over' && status !== 'cancelled';
}
async function findActiveDuplicateTicket(input) {
    const tickets = await ticketStore.listTickets();
    const serialNumber = normalizeLookupText(input.serialNumber);
    const barcodeRaw = normalizeLookupText(input.barcodeRaw ?? null);
    return (tickets.find((ticket) => {
        if (!isTicketActive(ticket.status)) {
            return false;
        }
        if (input.hiretrackItemRef && ticket.hiretrackItemRef === input.hiretrackItemRef) {
            return true;
        }
        if (serialNumber && normalizeLookupText(ticket.serialNumber) === serialNumber) {
            return true;
        }
        if (barcodeRaw && normalizeLookupText(ticket.barcodeRaw) === barcodeRaw) {
            return true;
        }
        return false;
    }) || null);
}
async function syncLoggedFaultForTicket(ticketId) {
    const ticket = await ticketStore.getTicket(ticketId);
    if (!ticket) {
        return null;
    }
    if (!ticket.hiretrackItemRef) {
        return {
            ok: false,
            skipped: true,
            reason: 'Ticket has no matched HireTrack item.',
        };
    }
    try {
        const result = await (0, hiretrack_repair_create_1.createLoggedFaultInHiretrack)({
            itemRef: ticket.hiretrackItemRef,
            badEqlistId: ticket.hiretrackEqlistId,
            faultDescription: ticket.faultDescription,
            engineerNotes: ticket.engineerNotes,
            reportedBy: ticket.clientName || ticket.clientCompany || ticket.createdBy,
        });
        const updated = await ticketStore.updateTicket(ticketId, {
            hiretrackTicketId: String(result.serviceRecordNo),
            syncHiretrackState: 'ok',
            syncHiretrackError: null,
            syncHiretrackUpdatedAt: new Date().toISOString(),
        }, 'hiretrack-sync');
        return {
            ok: true,
            skipped: false,
            result,
            ticket: updated,
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'HireTrack logged fault creation failed.';
        const updated = await ticketStore.updateTicket(ticketId, {
            syncHiretrackState: 'error',
            syncHiretrackError: message,
            syncHiretrackUpdatedAt: new Date().toISOString(),
        }, 'hiretrack-sync');
        return {
            ok: false,
            skipped: false,
            reason: message,
            ticket: updated,
        };
    }
}
async function syncBitrixForTicket(ticketId) {
    const ticket = await ticketStore.getTicket(ticketId);
    if (!ticket) {
        return null;
    }
    if (ticket.bitrixItemId) {
        return {
            ok: true,
            skipped: true,
            reason: 'Bitrix item already exists.',
            ticket,
        };
    }
    try {
        const result = await (0, bitrix_ticket_sync_1.createBitrixTicketItem)(ticket);
        const updated = await ticketStore.updateTicket(ticketId, {
            bitrixItemId: result.bitrixItemId,
            syncBitrixState: 'ok',
            syncBitrixError: null,
            syncBitrixUpdatedAt: new Date().toISOString(),
        }, 'bitrix-sync');
        return {
            ok: true,
            skipped: false,
            result,
            ticket: updated,
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Bitrix ticket item creation failed.';
        const updated = await ticketStore.updateTicket(ticketId, {
            syncBitrixState: 'error',
            syncBitrixError: message,
            syncBitrixUpdatedAt: new Date().toISOString(),
        }, 'bitrix-sync');
        return {
            ok: false,
            skipped: false,
            reason: message,
            ticket: updated,
        };
    }
}
async function buildHiretrackStockCheck(input) {
    const item = await (0, hiretrack_equipment_lookup_1.lookupEquipmentInHiretrack)(input.barcodeRaw, input.serialNumber);
    if (!item) {
        return {
            item: null,
            eqlists: [],
            status: 'not_found',
            currentEqlistId: null,
            currentEqlistName: null,
            currentJobNo: null,
            currentJobRef: null,
            currentClientName: null,
        };
    }
    const eqlists = await (0, hiretrack_eqlist_lookup_1.lookupEquipmentEqlistsInHiretrack)({
        itemRef: item.itemRef,
        barcodeRaw: item.barcode ?? input.barcodeRaw ?? null,
        serialNumber: item.serialNumber ?? input.serialNumber ?? null,
    });
    const current = eqlists.find((entry) => entry.isCurrent) || eqlists[0] || null;
    return {
        item,
        eqlists,
        status: current ? 'on_eqlist' : 'in_stock',
        currentEqlistId: current?.eqlistId ?? null,
        currentEqlistName: current?.eqlistName ?? null,
        currentJobNo: current?.jobNo ?? null,
        currentJobRef: current?.jobRef ?? null,
        currentClientName: current?.clientName ?? null,
    };
}
exports.ticketsRouter.get('/', async (_req, res) => {
    res.json({ items: await ticketStore.listTickets() });
});
exports.ticketsRouter.get('/lookups/equipment', async (req, res) => {
    const parsed = equipmentLookupSchema.safeParse(req.query);
    if (!parsed.success) {
        return res.status(400).json({
            ok: false,
            error: 'Validation failed',
            issues: parsed.error.flatten(),
        });
    }
    try {
        const item = await (0, hiretrack_equipment_lookup_1.lookupEquipmentInHiretrack)(parsed.data.barcodeRaw, parsed.data.serialNumber);
        return res.json({ ok: true, item });
    }
    catch (error) {
        return res.status(502).json({
            ok: false,
            error: error instanceof Error ? error.message : 'HireTrack lookup failed',
        });
    }
});
exports.ticketsRouter.get('/lookups/stock-check', async (req, res) => {
    const parsed = equipmentLookupSchema.safeParse(req.query);
    if (!parsed.success) {
        return res.status(400).json({
            ok: false,
            error: 'Validation failed',
            issues: parsed.error.flatten(),
        });
    }
    try {
        const result = await buildHiretrackStockCheck(parsed.data);
        return res.json({ ok: true, result });
    }
    catch (error) {
        return res.status(502).json({
            ok: false,
            error: error instanceof Error ? error.message : 'HireTrack stock check failed',
        });
    }
});
exports.ticketsRouter.get('/lookups/eqlists', async (req, res) => {
    const parsed = eqlistLookupSchema.safeParse(req.query);
    if (!parsed.success) {
        return res.status(400).json({
            ok: false,
            error: 'Validation failed',
            issues: parsed.error.flatten(),
        });
    }
    try {
        const items = await (0, hiretrack_eqlist_lookup_1.lookupEquipmentEqlistsInHiretrack)(parsed.data);
        return res.json({ ok: true, items });
    }
    catch (error) {
        return res.status(502).json({
            ok: false,
            error: error instanceof Error ? error.message : 'HireTrack eqlist lookup failed',
        });
    }
});
exports.ticketsRouter.get('/lookups/stocktake-history', async (req, res) => {
    const parsed = stocktakeHistorySchema.safeParse(req.query);
    if (!parsed.success) {
        return res.status(400).json({
            ok: false,
            error: 'Validation failed',
            issues: parsed.error.flatten(),
        });
    }
    try {
        const items = await (0, hiretrack_stocktake_history_1.lookupStocktakeHistoryInHiretrack)(parsed.data);
        return res.json({
            ok: true,
            sessionState: parsed.data.sessionState || 'all',
            limit: parsed.data.limit ?? null,
            items,
        });
    }
    catch (error) {
        return res.status(502).json({
            ok: false,
            error: error instanceof Error ? error.message : 'HireTrack stock-take history lookup failed',
        });
    }
});
exports.ticketsRouter.get('/lookups/equipment-catalog', async (_req, res) => {
    try {
        const items = await (0, hiretrack_equipment_catalog_1.getEquipmentCatalog)();
        return res.json({ ok: true, items });
    }
    catch (error) {
        return res.status(502).json({
            ok: false,
            error: error instanceof Error ? error.message : 'HireTrack equipment catalog lookup failed',
        });
    }
});
exports.ticketsRouter.post('/lookups/equipment-notes', async (req, res) => {
    const parsed = equipmentNoteCreateSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            ok: false,
            error: 'Validation failed',
            issues: parsed.error.flatten(),
        });
    }
    try {
        const result = await (0, hiretrack_equipment_note_write_1.createEquipmentNoteWithLines)(parsed.data);
        return res.json({ ok: true, ...result });
    }
    catch (error) {
        return res.status(502).json({
            ok: false,
            error: error instanceof Error ? error.message : 'HireTrack note creation failed',
        });
    }
});
exports.ticketsRouter.get('/lookups/equipment-availability', async (req, res) => {
    const parsed = equipmentAvailabilitySchema.safeParse(req.query);
    if (!parsed.success) {
        return res.status(400).json({
            ok: false,
            error: 'Validation failed',
            issues: parsed.error.flatten(),
        });
    }
    try {
        const result = await (0, hiretrack_booking_api_1.checkHiretrackAvailability)(parsed.data);
        return res.json({ ok: true, ...result });
    }
    catch (error) {
        return res.status(502).json({
            ok: false,
            error: error instanceof Error ? error.message : 'HireTrack availability check failed',
        });
    }
});
exports.ticketsRouter.post('/lookups/equipment-bookings/initialise', async (req, res) => {
    const parsed = bookingInitialiseSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            ok: false,
            error: 'Validation failed',
            issues: parsed.error.flatten(),
        });
    }
    try {
        const result = await (0, hiretrack_booking_api_1.initialiseHiretrackBooking)(parsed.data);
        return res.json({ ok: true, ...result });
    }
    catch (error) {
        return res.status(502).json({
            ok: false,
            error: error instanceof Error ? error.message : 'HireTrack booking initialise failed',
        });
    }
});
exports.ticketsRouter.post('/lookups/equipment-bookings/append', async (req, res) => {
    const parsed = bookingAppendSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            ok: false,
            error: 'Validation failed',
            issues: parsed.error.flatten(),
        });
    }
    try {
        const result = await (0, hiretrack_booking_api_1.appendToHiretrackBooking)(parsed.data);
        return res.json({ ok: true, ...result });
    }
    catch (error) {
        return res.status(502).json({
            ok: false,
            error: error instanceof Error ? error.message : 'HireTrack booking append failed',
        });
    }
});
exports.ticketsRouter.post('/lookups/equipment-bookings', async (req, res) => {
    const parsed = bookingCreateSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            ok: false,
            error: 'Validation failed',
            issues: parsed.error.flatten(),
        });
    }
    try {
        const result = await (0, hiretrack_booking_api_1.createHiretrackBooking)(parsed.data);
        return res.json({ ok: true, ...result });
    }
    catch (error) {
        return res.status(502).json({
            ok: false,
            error: error instanceof Error ? error.message : 'HireTrack booking creation failed',
        });
    }
});
exports.ticketsRouter.post('/lookups/stocktake-problems.pdf', async (req, res) => {
    const parsed = stocktakeProblemPdfSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            ok: false,
            error: 'Validation failed',
            issues: parsed.error.flatten(),
        });
    }
    try {
        const pdf = await (0, stocktake_problem_pdf_1.renderStocktakeProblemPdf)(parsed.data);
        const date = new Date().toISOString().slice(0, 10);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="stockcheck-problems-${date}.pdf"`);
        res.setHeader('Content-Length', String(pdf.length));
        return res.send(pdf);
    }
    catch (error) {
        return res.status(500).json({
            ok: false,
            error: error instanceof Error ? error.message : 'PDF generation failed',
        });
    }
});
exports.ticketsRouter.post('/lookups/stocktake-summary.pdf', async (req, res) => {
    const parsed = stocktakeSummaryPdfSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            ok: false,
            error: 'Validation failed',
            issues: parsed.error.flatten(),
        });
    }
    try {
        const pdf = await (0, stocktake_problem_pdf_1.renderStocktakeSummaryPdf)(parsed.data);
        const date = new Date().toISOString().slice(0, 10);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="stockcheck-current-state-${date}.pdf"`);
        res.setHeader('Content-Length', String(pdf.length));
        return res.send(pdf);
    }
    catch (error) {
        return res.status(500).json({
            ok: false,
            error: error instanceof Error ? error.message : 'PDF generation failed',
        });
    }
});
exports.ticketsRouter.post('/', async (req, res) => {
    const parsed = createTicketSchema.safeParse({
        ...req.body,
        clientEmail: req.body?.clientEmail === '' ? null : req.body?.clientEmail,
    });
    if (!parsed.success) {
        return res.status(400).json({
            ok: false,
            error: 'Validation failed',
            issues: parsed.error.flatten(),
        });
    }
    const duplicate = await findActiveDuplicateTicket(parsed.data);
    if (duplicate) {
        return res.status(409).json({
            ok: false,
            error: `Active ticket ${duplicate.ticketNumber} already exists for this equipment.`,
            ticket: duplicate,
        });
    }
    let ticket = await ticketStore.createTicket(parsed.data);
    const bitrixSyncResult = await syncBitrixForTicket(ticket.id);
    if (bitrixSyncResult?.ticket) {
        ticket = bitrixSyncResult.ticket;
    }
    const syncResult = await syncLoggedFaultForTicket(ticket.id);
    if (syncResult?.ticket) {
        ticket = syncResult.ticket;
    }
    return res.status(201).json({ ok: true, ticket });
});
exports.ticketsRouter.get('/:id/activity', async (req, res) => {
    const ticket = await ticketStore.getTicket(req.params.id);
    if (!ticket) {
        return res.status(404).json({ ok: false, error: 'Ticket not found' });
    }
    return res.json({
        ok: true,
        items: await ticketStore.getTicketActivity(req.params.id),
    });
});
exports.ticketsRouter.get('/:id', async (req, res) => {
    const ticket = await ticketStore.getTicket(req.params.id);
    if (!ticket) {
        return res.status(404).json({ ok: false, error: 'Ticket not found' });
    }
    return res.json({ ticket });
});
exports.ticketsRouter.patch('/:id', async (req, res) => {
    const parsed = updateTicketSchema.safeParse({
        ...req.body,
        clientEmail: req.body?.clientEmail === '' ? null : req.body?.clientEmail,
    });
    if (!parsed.success) {
        return res.status(400).json({
            ok: false,
            error: 'Validation failed',
            issues: parsed.error.flatten(),
        });
    }
    const ticket = await ticketStore.updateTicket(req.params.id, parsed.data);
    if (!ticket) {
        return res.status(404).json({ ok: false, error: 'Ticket not found' });
    }
    return res.json({ ok: true, ticket });
});
exports.ticketsRouter.post('/:id/status', async (req, res) => {
    const parsed = changeStatusSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            ok: false,
            error: 'Validation failed',
            issues: parsed.error.flatten(),
        });
    }
    const ticket = await ticketStore.setStatus(req.params.id, parsed.data.status, parsed.data.actor || 'system');
    if (!ticket) {
        return res.status(404).json({ ok: false, error: 'Ticket not found' });
    }
    return res.json({ ok: true, ticket });
});
async function postHiretrackFaultSync(req, res) {
    const ticketId = String(req.params.id);
    const ticket = await ticketStore.getTicket(ticketId);
    if (!ticket) {
        return res.status(404).json({ ok: false, error: 'Ticket not found' });
    }
    const result = await syncLoggedFaultForTicket(ticketId);
    if (!result) {
        return res.status(404).json({ ok: false, error: 'Ticket not found' });
    }
    if (result.skipped) {
        return res.status(409).json({ ok: false, error: result.reason, ticket });
    }
    if (!result.ok) {
        return res.status(502).json({ ok: false, error: result.reason, ticket: result.ticket });
    }
    return res.json({ ok: true, ticket: result.ticket, loggedFault: result.result });
}
exports.ticketsRouter.post('/:id/hiretrack-repair', postHiretrackFaultSync);
exports.ticketsRouter.post('/:id/hiretrack-fault', postHiretrackFaultSync);
async function postBitrixItemSync(req, res) {
    const ticketId = String(req.params.id);
    const ticket = await ticketStore.getTicket(ticketId);
    if (!ticket) {
        return res.status(404).json({ ok: false, error: 'Ticket not found' });
    }
    const result = await syncBitrixForTicket(ticketId);
    if (!result) {
        return res.status(404).json({ ok: false, error: 'Ticket not found' });
    }
    if (result.skipped) {
        return res.status(200).json({ ok: true, skipped: true, ticket: result.ticket, reason: result.reason });
    }
    if (!result.ok) {
        return res.status(502).json({ ok: false, error: result.reason, ticket: result.ticket });
    }
    return res.json({ ok: true, ticket: result.ticket, bitrixItem: result.result });
}
exports.ticketsRouter.post('/:id/bitrix-item', postBitrixItemSync);
