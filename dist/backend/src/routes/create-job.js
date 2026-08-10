"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createJobRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const hiretrack_equipment_catalog_1 = require("../services/hiretrack-equipment-catalog");
const hiretrack_company_search_1 = require("../services/hiretrack-company-search");
const hiretrack_job_lookup_1 = require("../services/hiretrack-job-lookup");
const hiretrack_booking_api_1 = require("../services/hiretrack-booking-api");
exports.createJobRouter = (0, express_1.Router)();
exports.createJobRouter.get('/catalog', async (_req, res) => {
    try {
        const items = await (0, hiretrack_equipment_catalog_1.getEquipmentCatalog)();
        res.json({ ok: true, items });
    }
    catch (error) {
        res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
});
exports.createJobRouter.get('/companies', async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    try {
        const companies = await (0, hiretrack_company_search_1.searchHiretrackCompanies)(query);
        res.json({ ok: true, companies });
    }
    catch (error) {
        res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
});
const availabilitySchema = zod_1.z.object({
    typeId: zod_1.z.coerce.number().int().positive(),
    quantity: zod_1.z.coerce.number().positive().default(1),
    dateFrom: zod_1.z.string().min(1),
    dateTo: zod_1.z.string().min(1),
});
exports.createJobRouter.get('/availability', async (req, res) => {
    const parsed = availabilitySchema.safeParse(req.query);
    if (!parsed.success) {
        res.status(400).json({ ok: false, error: 'Validation failed', issues: parsed.error.flatten() });
        return;
    }
    try {
        const result = await (0, hiretrack_booking_api_1.checkHiretrackAvailability)(parsed.data);
        res.json({ ok: true, ...result });
    }
    catch (error) {
        res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
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
    lines: zod_1.z.array(bookingLineSchema).min(1).max(200),
});
exports.createJobRouter.post('/bookings', async (req, res) => {
    const parsed = bookingCreateSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ ok: false, error: 'Validation failed', issues: parsed.error.flatten() });
        return;
    }
    try {
        const result = await (0, hiretrack_booking_api_1.createHiretrackBooking)(parsed.data);
        res.json({ ok: true, ...result });
    }
    catch (error) {
        res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
});
exports.createJobRouter.get('/jobs', async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    try {
        const jobs = await (0, hiretrack_job_lookup_1.searchHiretrackJobs)(query);
        res.json({ ok: true, jobs });
    }
    catch (error) {
        res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
});
exports.createJobRouter.get('/jobs/:jobRef', async (req, res) => {
    try {
        const job = await (0, hiretrack_job_lookup_1.lookupHiretrackJob)(String(req.params.jobRef));
        if (!job) {
            res.status(404).json({ ok: false, error: 'Job not found' });
            return;
        }
        res.json({ ok: true, job });
    }
    catch (error) {
        res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
});
const appendLinesSchema = zod_1.z.object({
    eqlistId: zod_1.z.coerce.number().int().positive(),
    clientId: zod_1.z.coerce.number().int().positive(),
    dateFrom: zod_1.z.string().min(1),
    dateTo: zod_1.z.string().min(1),
    lines: zod_1.z.array(bookingLineSchema).min(1).max(200),
});
exports.createJobRouter.post('/jobs/:jobRef/lines', async (req, res) => {
    const parsed = appendLinesSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ ok: false, error: 'Validation failed', issues: parsed.error.flatten() });
        return;
    }
    try {
        const result = await (0, hiretrack_booking_api_1.appendLinesToExistingBooking)(parsed.data);
        res.json({ ok: true, ...result });
    }
    catch (error) {
        res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
});
const changeQuantitySchema = zod_1.z.object({
    quantity: zod_1.z.coerce.number().positive(),
    clientId: zod_1.z.coerce.number().int().positive(),
    userId: zod_1.z.coerce.number().int().optional(),
});
exports.createJobRouter.put('/jobs/:jobRef/lines/:lineRefId', async (req, res) => {
    const parsed = changeQuantitySchema.safeParse(req.body);
    const lineRefId = Number(req.params.lineRefId);
    if (!parsed.success || !Number.isInteger(lineRefId) || lineRefId <= 0) {
        res.status(400).json({ ok: false, error: 'Validation failed', issues: parsed.success ? undefined : parsed.error.flatten() });
        return;
    }
    try {
        const result = await (0, hiretrack_booking_api_1.changeHiretrackBookingQuantity)({ ...parsed.data, lineRefId });
        res.json({ ok: true, ...result });
    }
    catch (error) {
        res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
});
const removeLineSchema = zod_1.z.object({
    jobId: zod_1.z.coerce.number().int().positive(),
    clientId: zod_1.z.coerce.number().int().positive(),
});
exports.createJobRouter.delete('/jobs/:jobRef/lines/:lineRefId', async (req, res) => {
    const parsed = removeLineSchema.safeParse(req.query);
    const lineRefId = Number(req.params.lineRefId);
    if (!parsed.success || !Number.isInteger(lineRefId) || lineRefId <= 0) {
        res.status(400).json({ ok: false, error: 'Validation failed', issues: parsed.success ? undefined : parsed.error.flatten() });
        return;
    }
    try {
        const result = await (0, hiretrack_booking_api_1.removeFromHiretrackBooking)({ ...parsed.data, lineRefId });
        res.json({ ok: true, ...result });
    }
    catch (error) {
        res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
});
