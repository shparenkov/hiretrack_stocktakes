import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { getCrewBookingsData, getCrewCandidates, getCrewJobDetail } from '../services/hiretrack-crew-read';
import {
  assignCrewPosition,
  setCrewRoleNote,
  setCrewShiftNote,
  syncCrewShifts,
  unassignCrewPosition,
} from '../services/hiretrack-crew-write';

// Sent back on every position write so the bridge can detect that HireTrack
// (or another browser tab) already changed this position since the page
// last loaded it - see check_not_stale() in hiretrack_crew_write.py.
const staleCheckFields = {
  expectedStatus: z.enum(['Unprocessed', 'Pencilled', 'Booked']).optional(),
  expectedAssignee: z.string().nullable().optional(),
};

const assignSchema = z.object({
  positionId: z.coerce.number().int(),
  personName: z.string().min(1),
  offerStatus: z.enum(['pencilled', 'booked']),
  ...staleCheckFields,
});

const unassignSchema = z.object({
  positionId: z.coerce.number().int(),
  ...staleCheckFields,
});

const syncShiftsSchema = z.object({
  positionId: z.coerce.number().int(),
  ...staleCheckFields,
});

const roleNoteSchema = z.object({
  crewId: z.coerce.number().int(),
  notes: z.string().max(4000),
});

const shiftNoteSchema = z.object({
  shiftId: z.coerce.number().int(),
  notes: z.string().max(4000),
});

export const crewBookingsRouter = Router();

// The write bridge raises a plain ValueError with a "CONFLICT: " prefix
// when the optimistic-concurrency check fails - surfaced as 409 so the
// frontend can show a distinct "data is stale, refresh" message instead of
// a generic failure.
function handleWriteError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const conflictPrefix = 'CONFLICT: ';
  if (message.startsWith(conflictPrefix)) {
    res.status(409).json({ error: message.slice(conflictPrefix.length), conflict: true });
    return;
  }
  res.status(502).json({ error: message });
}

crewBookingsRouter.get('/data', async (req: Request, res: Response) => {
  try {
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const data = await getCrewBookingsData({ forceRefresh });
    res.json(data);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

crewBookingsRouter.get('/job-detail', async (req: Request, res: Response) => {
  const jobRef = typeof req.query.jobRef === 'string' ? req.query.jobRef : '';
  if (!jobRef) {
    res.status(400).json({ error: "'jobRef' query param is required" });
    return;
  }
  try {
    const data = await getCrewJobDetail(jobRef);
    res.json(data);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

function parseOptionalId(value: unknown): number | null {
  if (typeof value !== 'string' || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

crewBookingsRouter.get('/candidates', async (req: Request, res: Response) => {
  try {
    const data = await getCrewCandidates({
      crewTypeId: parseOptionalId(req.query.crewTypeId),
      handlerId: parseOptionalId(req.query.handlerId),
      crewBossId: parseOptionalId(req.query.crewBossId),
    });
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
    handleWriteError(res, error);
  }
});

crewBookingsRouter.post('/unassign', async (req: Request, res: Response) => {
  const parsed = unassignSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const result = await unassignCrewPosition(parsed.data);
    res.json(result);
  } catch (error) {
    handleWriteError(res, error);
  }
});

crewBookingsRouter.post('/sync-shifts', async (req: Request, res: Response) => {
  const parsed = syncShiftsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const result = await syncCrewShifts(parsed.data);
    res.json(result);
  } catch (error) {
    handleWriteError(res, error);
  }
});

crewBookingsRouter.post('/role-note', async (req: Request, res: Response) => {
  const parsed = roleNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const result = await setCrewRoleNote(parsed.data);
    res.json(result);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

crewBookingsRouter.post('/shift-note', async (req: Request, res: Response) => {
  const parsed = shiftNoteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const result = await setCrewShiftNote(parsed.data);
    res.json(result);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});
