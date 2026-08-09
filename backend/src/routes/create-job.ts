import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { getEquipmentCatalog } from '../services/hiretrack-equipment-catalog';
import { searchHiretrackCompanies } from '../services/hiretrack-company-search';
import { lookupHiretrackJob, searchHiretrackJobs } from '../services/hiretrack-job-lookup';
import {
  checkHiretrackAvailability,
  createHiretrackBooking,
  appendLinesToExistingBooking,
} from '../services/hiretrack-booking-api';

export const createJobRouter = Router();

createJobRouter.get('/catalog', async (_req: Request, res: Response) => {
  try {
    const items = await getEquipmentCatalog();
    res.json({ ok: true, items });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

createJobRouter.get('/companies', async (req: Request, res: Response) => {
  const query = typeof req.query.q === 'string' ? req.query.q : '';
  try {
    const companies = await searchHiretrackCompanies(query);
    res.json({ ok: true, companies });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

const availabilitySchema = z.object({
  typeId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().positive().default(1),
  dateFrom: z.string().min(1),
  dateTo: z.string().min(1),
});

createJobRouter.get('/availability', async (req: Request, res: Response) => {
  const parsed = availabilitySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'Validation failed', issues: parsed.error.flatten() });
    return;
  }
  try {
    const result = await checkHiretrackAvailability(parsed.data);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

const bookingLineSchema = z.object({
  typeId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().positive(),
});

const bookingCreateSchema = z.object({
  jobName: z.string().min(1).max(50),
  clientId: z.coerce.number().int().positive(),
  dateFrom: z.string().min(1),
  dateTo: z.string().min(1),
  lines: z.array(bookingLineSchema).min(1).max(200),
});

createJobRouter.post('/bookings', async (req: Request, res: Response) => {
  const parsed = bookingCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'Validation failed', issues: parsed.error.flatten() });
    return;
  }
  try {
    const result = await createHiretrackBooking(parsed.data);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

createJobRouter.get('/jobs', async (req: Request, res: Response) => {
  const query = typeof req.query.q === 'string' ? req.query.q : '';
  try {
    const jobs = await searchHiretrackJobs(query);
    res.json({ ok: true, jobs });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

createJobRouter.get('/jobs/:jobRef', async (req: Request, res: Response) => {
  try {
    const job = await lookupHiretrackJob(String(req.params.jobRef));
    if (!job) {
      res.status(404).json({ ok: false, error: 'Job not found' });
      return;
    }
    res.json({ ok: true, job });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

const appendLinesSchema = z.object({
  eqlistId: z.coerce.number().int().positive(),
  clientId: z.coerce.number().int().positive(),
  dateFrom: z.string().min(1),
  dateTo: z.string().min(1),
  lines: z.array(bookingLineSchema).min(1).max(200),
});

createJobRouter.post('/jobs/:jobRef/lines', async (req: Request, res: Response) => {
  const parsed = appendLinesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'Validation failed', issues: parsed.error.flatten() });
    return;
  }
  try {
    const result = await appendLinesToExistingBooking(parsed.data);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
