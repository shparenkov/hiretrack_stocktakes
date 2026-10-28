import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { getLinkableCompanies } from '../services/hiretrack-crew-read';
import { getAllLinks, getBitrixCompanies, saveLink } from '../services/client-links';

// Sandbox for matching HireTrack companies with the Bitrix24 "Заказчики"
// (1C-synced companies). Everything here reads HireTrack/Bitrix and writes
// only the local staging file - see services/client-links.ts.

export const clientLinksRouter = Router();

const saveSchema = z.object({
  status: z.enum(['linked', 'none']),
  entities: z
    .array(z.object({ bitrixId: z.coerce.number().int().positive(), isDefault: z.boolean().optional() }))
    .max(20)
    .default([]),
  note: z.string().max(500).optional(),
});

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// One payload for the whole page: ~570 HireTrack companies, ~240 Bitrix
// companies and every saved decision. Bitrix being unreachable must not take
// the HireTrack list down with it, so its failure is reported alongside.
clientLinksRouter.get('/state', async (req: Request, res: Response) => {
  const forceRefresh = req.query.refresh === '1';
  try {
    const [companies, bitrixResult] = await Promise.all([
      getLinkableCompanies(forceRefresh),
      getBitrixCompanies(forceRefresh).then(
        (data) => ({ data, error: null as string | null }),
        (error) => ({ data: [], error: message(error) })
      ),
    ]);
    res.json({
      companies,
      bitrix: bitrixResult.data,
      bitrixError: bitrixResult.error,
      links: getAllLinks(),
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    res.status(502).json({ error: message(error) });
  }
});

clientLinksRouter.put('/:htId', (req: Request, res: Response) => {
  const htId = Number(req.params.htId);
  if (!Number.isInteger(htId) || htId <= 0) {
    res.status(400).json({ error: 'Invalid HireTrack company id.' });
    return;
  }
  const parsed = saveSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid link payload.', details: parsed.error.flatten() });
    return;
  }
  try {
    res.json({ link: saveLink(htId, parsed.data) });
  } catch (error) {
    res.status(400).json({ error: message(error) });
  }
});

clientLinksRouter.delete('/:htId', (req: Request, res: Response) => {
  const htId = Number(req.params.htId);
  if (!Number.isInteger(htId) || htId <= 0) {
    res.status(400).json({ error: 'Invalid HireTrack company id.' });
    return;
  }
  try {
    saveLink(htId, null);
    res.json({ link: null });
  } catch (error) {
    res.status(400).json({ error: message(error) });
  }
});

// Flat mapping for the Bitrix connector: HireTrack company id -> default
// Bitrix company id plus the alternates. Only decided companies appear.
clientLinksRouter.get('/export', (_req: Request, res: Response) => {
  const links = getAllLinks();
  const mapping: Record<string, { status: string; defaultBitrixId: number | null; bitrixIds: number[] }> = {};
  for (const [htId, link] of Object.entries(links)) {
    const defaultEntity = link.entities.find((e) => e.isDefault) || link.entities[0] || null;
    mapping[htId] = {
      status: link.status,
      defaultBitrixId: defaultEntity ? defaultEntity.bitrixId : null,
      bitrixIds: link.entities.map((e) => e.bitrixId),
    };
  }
  res.json({ mapping, exportedAt: new Date().toISOString() });
});
