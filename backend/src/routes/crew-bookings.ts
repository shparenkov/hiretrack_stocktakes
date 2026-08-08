import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { getCrewBookingsData } from '../services/hiretrack-crew-read';
import { assignCrewPosition } from '../services/hiretrack-crew-write';

const assignSchema = z.object({
  jobRef: z.string().min(1),
  phaseTitle: z.string().min(1),
  positionIndex: z.coerce.number().int().min(0),
  personName: z.string().min(1),
});

export const crewBookingsRouter = Router();

crewBookingsRouter.get('/data', async (req: Request, res: Response) => {
  try {
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const data = await getCrewBookingsData({ forceRefresh });
    res.json(data);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

crewBookingsRouter.post('/assign', async (req: Request, res: Response) => {
  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const result = await assignCrewPosition(parsed.data);
    res.json(result);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});
