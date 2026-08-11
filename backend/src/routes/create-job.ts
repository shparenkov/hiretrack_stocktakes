import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { getEquipmentCatalog } from '../services/hiretrack-equipment-catalog';
import { searchHiretrackCompanies } from '../services/hiretrack-company-search';
import {
  lookupHiretrackJob,
  searchHiretrackJobs,
  listRecentHiretrackJobs,
  getHiretrackJobDefaults,
  listHiretrackUsers,
  listHiretrackClientContacts,
} from '../services/hiretrack-job-lookup';
import {
  checkHiretrackAvailability,
  createHiretrackBooking,
  createHiretrackJobShell,
  appendLinesToExistingBooking,
  changeHiretrackBookingQuantity,
  removeFromHiretrackBooking,
} from '../services/hiretrack-booking-api';
import {
  renameHiretrackSection,
  createHiretrackSection,
  deleteHiretrackSection,
} from '../services/hiretrack-equipment-note-write';

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

const createJobShellSchema = z.object({
  jobName: z.string().min(1).max(50),
  clientId: z.coerce.number().int().positive(),
  dateFrom: z.string().min(1),
  dateTo: z.string().min(1),
  placeholderTypeId: z.coerce.number().int().positive(),
  salesPersonId: z.coerce.number().int().positive().optional(),
  contactPersonId: z.coerce.number().int().positive().optional(),
});

// Job-defaults (HireTrack's own Jobs>Defaults time/period settings) + the
// Sales Person picker's user list - fetched together since both are needed
// before the new-job form can render its full set of defaults/pickers.
createJobRouter.get('/form-options', async (_req: Request, res: Response) => {
  try {
    const [jobDefaults, salesPeople] = await Promise.all([getHiretrackJobDefaults(), listHiretrackUsers()]);
    res.json({ ok: true, jobDefaults, salesPeople });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

const clientContactsSchema = z.object({
  clientId: z.coerce.number().int().positive(),
});

createJobRouter.get('/contacts', async (req: Request, res: Response) => {
  const parsed = clientContactsSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'Validation failed', issues: parsed.error.flatten() });
    return;
  }
  try {
    const contacts = await listHiretrackClientContacts(parsed.data.clientId);
    res.json({ ok: true, contacts });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

createJobRouter.post('/jobs', async (req: Request, res: Response) => {
  const parsed = createJobShellSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'Validation failed', issues: parsed.error.flatten() });
    return;
  }
  try {
    const result = await createHiretrackJobShell(parsed.data);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

// Registered before /jobs/:jobRef so "recent" isn't swallowed as a jobRef.
createJobRouter.get('/jobs/recent', async (req: Request, res: Response) => {
  try {
    const jobs = await listRecentHiretrackJobs();
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

const appendBookingLineSchema = bookingLineSchema.extend({
  // Which EqSections row to move the newly appended line into - api_v2's
  // append_to_booking has no section param of its own, see
  // hiretrack-equipment-note-write.ts's setHiretrackLineSection.
  sectionId: z.coerce.number().int().positive().optional(),
});

const appendLinesSchema = z.object({
  eqlistId: z.coerce.number().int().positive(),
  clientId: z.coerce.number().int().positive(),
  dateFrom: z.string().min(1),
  dateTo: z.string().min(1),
  lines: z.array(appendBookingLineSchema).min(1).max(200),
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

const changeQuantitySchema = z.object({
  quantity: z.coerce.number().positive(),
  clientId: z.coerce.number().int().positive(),
  eqlistId: z.coerce.number().int().positive(),
  userId: z.coerce.number().int().optional(),
});

createJobRouter.put('/jobs/:jobRef/lines/:lineRefId', async (req: Request, res: Response) => {
  const parsed = changeQuantitySchema.safeParse(req.body);
  const lineRefId = Number(req.params.lineRefId);
  if (!parsed.success || !Number.isInteger(lineRefId) || lineRefId <= 0) {
    res.status(400).json({ ok: false, error: 'Validation failed', issues: parsed.success ? undefined : parsed.error.flatten() });
    return;
  }
  try {
    const result = await changeHiretrackBookingQuantity({ ...parsed.data, lineRefId });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

const removeLineSchema = z.object({
  jobId: z.coerce.number().int().positive(),
  clientId: z.coerce.number().int().positive(),
});

createJobRouter.delete('/jobs/:jobRef/lines/:lineRefId', async (req: Request, res: Response) => {
  const parsed = removeLineSchema.safeParse(req.query);
  const lineRefId = Number(req.params.lineRefId);
  if (!parsed.success || !Number.isInteger(lineRefId) || lineRefId <= 0) {
    res.status(400).json({ ok: false, error: 'Validation failed', issues: parsed.success ? undefined : parsed.error.flatten() });
    return;
  }
  try {
    const result = await removeFromHiretrackBooking({ ...parsed.data, lineRefId });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

const createSectionSchema = z.object({
  eqlistId: z.coerce.number().int().positive(),
  sectionText: z.string().trim().min(1).max(255),
});

createJobRouter.post('/jobs/:jobRef/sections', async (req: Request, res: Response) => {
  const parsed = createSectionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: 'Validation failed', issues: parsed.error.flatten() });
    return;
  }
  try {
    const result = await createHiretrackSection(parsed.data.eqlistId, parsed.data.sectionText);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

const renameSectionSchema = z.object({
  sectionText: z.string().trim().min(1).max(255),
});

createJobRouter.put('/jobs/:jobRef/sections/:sectionId', async (req: Request, res: Response) => {
  const parsed = renameSectionSchema.safeParse(req.body);
  const sectionId = Number(req.params.sectionId);
  if (!parsed.success || !Number.isInteger(sectionId) || sectionId <= 0) {
    res.status(400).json({ ok: false, error: 'Validation failed', issues: parsed.success ? undefined : parsed.error.flatten() });
    return;
  }
  try {
    const result = await renameHiretrackSection(sectionId, parsed.data.sectionText);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

const deleteSectionSchema = z.object({
  eqlistId: z.coerce.number().int().positive(),
});

createJobRouter.delete('/jobs/:jobRef/sections/:sectionId', async (req: Request, res: Response) => {
  const parsed = deleteSectionSchema.safeParse(req.query);
  const sectionId = Number(req.params.sectionId);
  if (!parsed.success || !Number.isInteger(sectionId) || sectionId <= 0) {
    res.status(400).json({ ok: false, error: 'Validation failed', issues: parsed.success ? undefined : parsed.error.flatten() });
    return;
  }
  try {
    const result = await deleteHiretrackSection(sectionId, parsed.data.eqlistId);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
