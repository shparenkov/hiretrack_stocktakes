import { Request, Response, Router } from 'express';
import { getPlanningOccupancyData } from '../services/hiretrack-planning-read';
import { getPlanningShortagesData } from '../services/hiretrack-planning-shortages';

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
