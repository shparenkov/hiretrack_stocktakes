"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planningRouter = void 0;
const express_1 = require("express");
const hiretrack_planning_read_1 = require("../services/hiretrack-planning-read");
exports.planningRouter = (0, express_1.Router)();
exports.planningRouter.get('/occupancy', async (req, res) => {
    try {
        const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
        const data = await (0, hiretrack_planning_read_1.getPlanningOccupancyData)({ forceRefresh });
        res.json(data);
    }
    catch (error) {
        res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
    }
});
