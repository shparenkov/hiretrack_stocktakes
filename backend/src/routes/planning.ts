import { Request, Response, Router } from 'express';
import { getPlanningJobsGanttData, getPlanningOccupancyData } from '../services/hiretrack-planning-read';
import { getPlanningShortagesData, getShortagesConfirmProgress } from '../services/hiretrack-planning-shortages';

export const planningRouter = Router();

planningRouter.get('/occupancy', async (req: Request, res: Response) => {
  try {
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const data = await getPlanningOccupancyData({ forceRefresh });
    res.json(data);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

planningRouter.get('/shortages', async (req: Request, res: Response) => {
  try {
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const data = await getPlanningShortagesData({ forceRefresh });
    res.json(data);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

planningRouter.get('/shortages/progress', (_req: Request, res: Response) => {
  res.json(getShortagesConfirmProgress());
});

planningRouter.get('/jobs-gantt', async (req: Request, res: Response) => {
  try {
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const data = await getPlanningJobsGanttData({ forceRefresh });
    res.json(data);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});
