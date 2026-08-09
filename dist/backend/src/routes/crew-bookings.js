"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.crewBookingsRouter = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const hiretrack_crew_read_1 = require("../services/hiretrack-crew-read");
const hiretrack_crew_write_1 = require("../services/hiretrack-crew-write");
const assignSchema = zod_1.z.object({
    jobRef: zod_1.z.string().min(1),
    phaseTitle: zod_1.z.string().min(1),
    positionIndex: zod_1.z.coerce.number().int().min(0),
    personName: zod_1.z.string().min(1),
});
exports.crewBookingsRouter = (0, express_1.Router)();
exports.crewBookingsRouter.get('/data', async (req, res) => {
    try {
        const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
        const data = await (0, hiretrack_crew_read_1.getCrewBookingsData)({ forceRefresh });
        res.json(data);
    }
    catch (error) {
        res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
    }
});
exports.crewBookingsRouter.post('/assign', async (req, res) => {
    const parsed = assignSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: parsed.error.message });
        return;
    }
    try {
        const result = await (0, hiretrack_crew_write_1.assignCrewPosition)(parsed.data);
        res.json(result);
    }
    catch (error) {
        res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
    }
});
