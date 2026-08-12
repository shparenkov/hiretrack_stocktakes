"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planningRouter = void 0;
const express_1 = require("express");
const hiretrack_planning_read_1 = require("../services/hiretrack-planning-read");
const hiretrack_planning_shortages_1 = require("../services/hiretrack-planning-shortages");
exports.planningRouter = (0, express_1.Router)();
function parseWindow(req) {
    const start = typeof req.query.start === 'string' && req.query.start ? req.query.start : undefined;
    const days = typeof req.query.days === 'string' && req.query.days ? Number(req.query.days) : undefined;
    return { start, days: days != null && Number.isFinite(days) ? days : undefined };
}
exports.planningRouter.get('/occupancy', async (req, res) => {
    try {
        const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
        const data = await (0, hiretrack_planning_read_1.getPlanningOccupancyData)({ forceRefresh, ...parseWindow(req) });
        res.json(data);
    }
    catch (error) {
        res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
    }
});
exports.planningRouter.get('/shortages', async (req, res) => {
    try {
        const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
        const data = await (0, hiretrack_planning_shortages_1.getPlanningShortagesData)({ forceRefresh, ...parseWindow(req) });
        res.json(data);
    }
    catch (error) {
        res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
    }
});
exports.planningRouter.get('/shortages/progress', (_req, res) => {
    res.json((0, hiretrack_planning_shortages_1.getShortagesConfirmProgress)());
});
exports.planningRouter.get('/jobs-gantt', async (req, res) => {
    try {
        const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
        const data = await (0, hiretrack_planning_read_1.getPlanningJobsGanttData)({ forceRefresh });
        res.json(data);
    }
    catch (error) {
        res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
    }
});
