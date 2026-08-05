import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { createBitrixTicketItem } from '../services/bitrix-ticket-sync';
import { lookupEquipmentEqlistsInHiretrack } from '../services/hiretrack-eqlist-lookup';
import { createLoggedFaultInHiretrack } from '../services/hiretrack-repair-create';
import { lookupEquipmentInHiretrack } from '../services/hiretrack-equipment-lookup';
import { lookupStocktakeHistoryInHiretrack } from '../services/hiretrack-stocktake-history';
import { getEquipmentCatalog } from '../services/hiretrack-equipment-catalog';
import { createEquipmentNoteWithLines } from '../services/hiretrack-equipment-note-write';
import { renderStocktakeProblemPdf, renderStocktakeSummaryPdf } from '../services/stocktake-problem-pdf';
import { HiretrackStockCheckRecord } from '../types';
import { createTicketStore } from '../services/ticket-store';

const ticketStatusSchema = z.enum([
  'received',
  'diagnosing',
  'waiting_parts',
  'in_repair',
  'ready',
  'handed_over',
  'cancelled',
]);

const ticketPrioritySchema = z.enum(['low', 'normal', 'high', 'critical']);

const barcodeTypeSchema = z.enum(['EAN13', 'CODE128', 'CODE39', 'DATAMATRIX', 'QR', 'OTHER']);

const createTicketSchema = z.object({
  equipmentName: z.string().min(1),
  serialNumber: z.string().min(1),
  barcodeRaw: z.string().optional().nullable(),
  barcodeType: barcodeTypeSchema.optional().nullable(),
  hiretrackItemRef: z.coerce.number().int().optional().nullable(),
  hiretrackEquipmentTypeId: z.coerce.number().int().optional().nullable(),
  hiretrackEqlistId: z.coerce.number().int().optional().nullable(),
  hiretrackEqlistName: z.string().optional().nullable(),
  hiretrackJobNo: z.coerce.number().int().optional().nullable(),
  hiretrackJobRef: z.string().optional().nullable(),
  clientName: z.string().optional(),
  clientCompany: z.string().optional().nullable(),
  clientPhone: z.string().optional().nullable(),
  clientEmail: z.string().email().optional().nullable().or(z.literal('')),
  faultDescription: z.string().min(1),
  engineerNotes: z.string().optional().nullable(),
  assignedEngineerId: z.string().optional().nullable(),
  assignedEngineerName: z.string().optional().nullable(),
  priority: ticketPrioritySchema.optional(),
  receivedAt: z.string().datetime().optional(),
  createdBy: z.string().optional(),
});

const updateTicketSchema = z.object({
  equipmentName: z.string().min(1).optional(),
  serialNumber: z.string().min(1).optional(),
  barcodeRaw: z.string().optional().nullable(),
  barcodeType: barcodeTypeSchema.optional().nullable(),
  hiretrackItemRef: z.coerce.number().int().optional().nullable(),
  hiretrackEquipmentTypeId: z.coerce.number().int().optional().nullable(),
  hiretrackEqlistId: z.coerce.number().int().optional().nullable(),
  hiretrackEqlistName: z.string().optional().nullable(),
  hiretrackJobNo: z.coerce.number().int().optional().nullable(),
  hiretrackJobRef: z.string().optional().nullable(),
  clientName: z.string().optional(),
  clientCompany: z.string().optional().nullable(),
  clientPhone: z.string().optional().nullable(),
  clientEmail: z.string().email().optional().nullable().or(z.literal('')).optional(),
  faultDescription: z.string().min(1).optional(),
  engineerNotes: z.string().optional().nullable(),
  assignedEngineerId: z.string().optional().nullable(),
  assignedEngineerName: z.string().optional().nullable(),
  priority: ticketPrioritySchema.optional(),
  diagnosedAt: z.string().datetime().optional().nullable(),
  estimatedReadyAt: z.string().datetime().optional().nullable(),
  completedAt: z.string().datetime().optional().nullable(),
  handedOverAt: z.string().datetime().optional().nullable(),
});

const changeStatusSchema = z.object({
  status: ticketStatusSchema,
  actor: z.string().optional(),
});

const equipmentLookupSchema = z.object({
  barcodeRaw: z.string().optional(),
  serialNumber: z.string().optional(),
});

const eqlistLookupSchema = z.object({
  itemRef: z.coerce.number().int().optional(),
  barcodeRaw: z.string().optional(),
  serialNumber: z.string().optional(),
});

const stocktakeHistorySchema = z.object({
  sessionState: z.enum(['all', 'active', 'inactive']).optional(),
  limit: z.coerce.number().int().min(1).max(50000).optional(),
});

const equipmentNoteLineSchema = z.object({
  eqtype: z.coerce.number().int().positive(),
  qty: z.coerce.number().positive(),
  priceEach: z.coerce.number().optional(),
});

const equipmentNoteCreateSchema = z.object({
  title: z.string().min(1).max(50),
  user: z.coerce.number().int().optional(),
  site: z.coerce.number().int().optional(),
  currency: z.coerce.number().int().optional(),
  priceScheme: z.coerce.number().int().optional(),
  clientName: z.string().max(255).optional(),
  clientId: z.coerce.number().int().optional(),
  lines: z.array(equipmentNoteLineSchema).min(1).max(500),
});

const stocktakeProblemPdfSchema = z.object({
  latestSession: z.string().max(500),
  previousSession: z.string().max(500).default(''),
  generatedAt: z.string().max(100),
  rows: z.array(z.object({
    equipmentType: z.string().max(500),
    barcode: z.string().max(200),
    serialNumber: z.string().max(200),
    inventoryStatus: z.string().max(200),
    currentStatus: z.string().max(500),
    currentStatusNote: z.string().max(1000),
    lastObservation: z.string().max(200),
    lastObservationSource: z.string().max(500),
    kind: z.enum(['missing', 'repair', 'inactive']),
  })).min(1).max(50000),
});

const stocktakeSummaryPdfSchema = z.object({
  latestSession: z.string().max(500),
  previousSession: z.string().max(500).default(''),
  generatedAt: z.string().max(100),
  category: z.string().max(500),
  search: z.string().max(500).default(''),
  hideZero: z.boolean().default(false),
  rows: z.array(z.object({
    equipmentType: z.string().max(500),
    equipmentTypeId: z.string().max(100),
    total: z.number().int().nonnegative(),
    barcoded: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    repair: z.number().int().nonnegative(),
    previousSeen: z.number().int().nonnegative(),
    latestSeen: z.number().int().nonnegative(),
    notSeen: z.number().int().nonnegative(),
    writtenOff: z.number().int().nonnegative(),
    sold: z.number().int().nonnegative(),
    level: z.enum(['ok', 'minor', 'zero', 'low', 'critical']),
  })).min(1).max(50000),
});

export const ticketsRouter = Router();
const ticketStore = createTicketStore();

function normalizeLookupText(value: string | null | undefined) {
  const text = String(value ?? '').trim().toLowerCase();
  return text.length > 0 ? text : null;
}

function isTicketActive(status: string) {
  return status !== 'handed_over' && status !== 'cancelled';
}

async function findActiveDuplicateTicket(input: z.infer<typeof createTicketSchema>) {
  const tickets = await ticketStore.listTickets();
  const serialNumber = normalizeLookupText(input.serialNumber);
  const barcodeRaw = normalizeLookupText(input.barcodeRaw ?? null);

  return (
    tickets.find((ticket) => {
      if (!isTicketActive(ticket.status)) {
        return false;
      }

      if (input.hiretrackItemRef && ticket.hiretrackItemRef === input.hiretrackItemRef) {
        return true;
      }

      if (serialNumber && normalizeLookupText(ticket.serialNumber) === serialNumber) {
        return true;
      }

      if (barcodeRaw && normalizeLookupText(ticket.barcodeRaw) === barcodeRaw) {
        return true;
      }

      return false;
    }) || null
  );
}

async function syncLoggedFaultForTicket(ticketId: string) {
  const ticket = await ticketStore.getTicket(ticketId);
  if (!ticket) {
    return null;
  }

  if (!ticket.hiretrackItemRef) {
    return {
      ok: false as const,
      skipped: true,
      reason: 'Ticket has no matched HireTrack item.',
    };
  }

  try {
    const result = await createLoggedFaultInHiretrack({
      itemRef: ticket.hiretrackItemRef,
      badEqlistId: ticket.hiretrackEqlistId,
      faultDescription: ticket.faultDescription,
      engineerNotes: ticket.engineerNotes,
      reportedBy: ticket.clientName || ticket.clientCompany || ticket.createdBy,
    });

    const updated = await ticketStore.updateTicket(
      ticketId,
      {
        hiretrackTicketId: String(result.serviceRecordNo),
        syncHiretrackState: 'ok',
        syncHiretrackError: null,
        syncHiretrackUpdatedAt: new Date().toISOString(),
      },
      'hiretrack-sync',
    );

    return {
      ok: true as const,
      skipped: false,
      result,
      ticket: updated,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'HireTrack logged fault creation failed.';
    const updated = await ticketStore.updateTicket(
      ticketId,
      {
        syncHiretrackState: 'error',
        syncHiretrackError: message,
        syncHiretrackUpdatedAt: new Date().toISOString(),
      },
      'hiretrack-sync',
    );

    return {
      ok: false as const,
      skipped: false,
      reason: message,
      ticket: updated,
    };
  }
}

async function syncBitrixForTicket(ticketId: string) {
  const ticket = await ticketStore.getTicket(ticketId);
  if (!ticket) {
    return null;
  }

  if (ticket.bitrixItemId) {
    return {
      ok: true as const,
      skipped: true,
      reason: 'Bitrix item already exists.',
      ticket,
    };
  }

  try {
    const result = await createBitrixTicketItem(ticket);
    const updated = await ticketStore.updateTicket(
      ticketId,
      {
        bitrixItemId: result.bitrixItemId,
        syncBitrixState: 'ok',
        syncBitrixError: null,
        syncBitrixUpdatedAt: new Date().toISOString(),
      },
      'bitrix-sync',
    );

    return {
      ok: true as const,
      skipped: false,
      result,
      ticket: updated,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Bitrix ticket item creation failed.';
    const updated = await ticketStore.updateTicket(
      ticketId,
      {
        syncBitrixState: 'error',
        syncBitrixError: message,
        syncBitrixUpdatedAt: new Date().toISOString(),
      },
      'bitrix-sync',
    );

    return {
      ok: false as const,
      skipped: false,
      reason: message,
      ticket: updated,
    };
  }
}

async function buildHiretrackStockCheck(input: {
  barcodeRaw?: string;
  serialNumber?: string;
}): Promise<HiretrackStockCheckRecord> {
  const item = await lookupEquipmentInHiretrack(input.barcodeRaw, input.serialNumber);

  if (!item) {
    return {
      item: null,
      eqlists: [],
      status: 'not_found',
      currentEqlistId: null,
      currentEqlistName: null,
      currentJobNo: null,
      currentJobRef: null,
      currentClientName: null,
    };
  }

  const eqlists = await lookupEquipmentEqlistsInHiretrack({
    itemRef: item.itemRef,
    barcodeRaw: item.barcode ?? input.barcodeRaw ?? null,
    serialNumber: item.serialNumber ?? input.serialNumber ?? null,
  });
  const current = eqlists.find((entry) => entry.isCurrent) || eqlists[0] || null;

  return {
    item,
    eqlists,
    status: current ? 'on_eqlist' : 'in_stock',
    currentEqlistId: current?.eqlistId ?? null,
    currentEqlistName: current?.eqlistName ?? null,
    currentJobNo: current?.jobNo ?? null,
    currentJobRef: current?.jobRef ?? null,
    currentClientName: current?.clientName ?? null,
  };
}

ticketsRouter.get('/', async (_req, res) => {
  res.json({ items: await ticketStore.listTickets() });
});

ticketsRouter.get('/lookups/equipment', async (req, res) => {
  const parsed = equipmentLookupSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: 'Validation failed',
      issues: parsed.error.flatten(),
    });
  }

  try {
    const item = await lookupEquipmentInHiretrack(parsed.data.barcodeRaw, parsed.data.serialNumber);
    return res.json({ ok: true, item });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : 'HireTrack lookup failed',
    });
  }
});

ticketsRouter.get('/lookups/stock-check', async (req, res) => {
  const parsed = equipmentLookupSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: 'Validation failed',
      issues: parsed.error.flatten(),
    });
  }

  try {
    const result = await buildHiretrackStockCheck(parsed.data);
    return res.json({ ok: true, result });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : 'HireTrack stock check failed',
    });
  }
});

ticketsRouter.get('/lookups/eqlists', async (req, res) => {
  const parsed = eqlistLookupSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: 'Validation failed',
      issues: parsed.error.flatten(),
    });
  }

  try {
    const items = await lookupEquipmentEqlistsInHiretrack(parsed.data);
    return res.json({ ok: true, items });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : 'HireTrack eqlist lookup failed',
    });
  }
});

ticketsRouter.get('/lookups/stocktake-history', async (req, res) => {
  const parsed = stocktakeHistorySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: 'Validation failed',
      issues: parsed.error.flatten(),
    });
  }

  try {
    const items = await lookupStocktakeHistoryInHiretrack(parsed.data);
    return res.json({
      ok: true,
      sessionState: parsed.data.sessionState || 'all',
      limit: parsed.data.limit ?? null,
      items,
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : 'HireTrack stock-take history lookup failed',
    });
  }
});

ticketsRouter.get('/lookups/equipment-catalog', async (_req, res) => {
  try {
    const items = await getEquipmentCatalog();
    return res.json({ ok: true, items });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : 'HireTrack equipment catalog lookup failed',
    });
  }
});

ticketsRouter.post('/lookups/equipment-notes', async (req, res) => {
  const parsed = equipmentNoteCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: 'Validation failed',
      issues: parsed.error.flatten(),
    });
  }

  try {
    const result = await createEquipmentNoteWithLines(parsed.data);
    return res.json({ ok: true, ...result });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : 'HireTrack note creation failed',
    });
  }
});

ticketsRouter.post('/lookups/stocktake-problems.pdf', async (req, res) => {
  const parsed = stocktakeProblemPdfSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: 'Validation failed',
      issues: parsed.error.flatten(),
    });
  }

  try {
    const pdf = await renderStocktakeProblemPdf(parsed.data);
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="stockcheck-problems-${date}.pdf"`);
    res.setHeader('Content-Length', String(pdf.length));
    return res.send(pdf);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'PDF generation failed',
    });
  }
});

ticketsRouter.post('/lookups/stocktake-summary.pdf', async (req, res) => {
  const parsed = stocktakeSummaryPdfSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: 'Validation failed',
      issues: parsed.error.flatten(),
    });
  }

  try {
    const pdf = await renderStocktakeSummaryPdf(parsed.data);
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="stockcheck-current-state-${date}.pdf"`);
    res.setHeader('Content-Length', String(pdf.length));
    return res.send(pdf);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'PDF generation failed',
    });
  }
});

ticketsRouter.post('/', async (req, res) => {
  const parsed = createTicketSchema.safeParse({
    ...req.body,
    clientEmail: req.body?.clientEmail === '' ? null : req.body?.clientEmail,
  });

  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: 'Validation failed',
      issues: parsed.error.flatten(),
    });
  }

  const duplicate = await findActiveDuplicateTicket(parsed.data);
  if (duplicate) {
    return res.status(409).json({
      ok: false,
      error: `Active ticket ${duplicate.ticketNumber} already exists for this equipment.`,
      ticket: duplicate,
    });
  }

  let ticket = await ticketStore.createTicket(parsed.data);
  const bitrixSyncResult = await syncBitrixForTicket(ticket.id);
  if (bitrixSyncResult?.ticket) {
    ticket = bitrixSyncResult.ticket;
  }
  const syncResult = await syncLoggedFaultForTicket(ticket.id);
  if (syncResult?.ticket) {
    ticket = syncResult.ticket;
  }

  return res.status(201).json({ ok: true, ticket });
});

ticketsRouter.get('/:id/activity', async (req, res) => {
  const ticket = await ticketStore.getTicket(req.params.id);
  if (!ticket) {
    return res.status(404).json({ ok: false, error: 'Ticket not found' });
  }

  return res.json({
    ok: true,
    items: await ticketStore.getTicketActivity(req.params.id),
  });
});

ticketsRouter.get('/:id', async (req, res) => {
  const ticket = await ticketStore.getTicket(req.params.id);
  if (!ticket) {
    return res.status(404).json({ ok: false, error: 'Ticket not found' });
  }
  return res.json({ ticket });
});

ticketsRouter.patch('/:id', async (req, res) => {
  const parsed = updateTicketSchema.safeParse({
    ...req.body,
    clientEmail: req.body?.clientEmail === '' ? null : req.body?.clientEmail,
  });

  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: 'Validation failed',
      issues: parsed.error.flatten(),
    });
  }

  const ticket = await ticketStore.updateTicket(req.params.id, parsed.data);
  if (!ticket) {
    return res.status(404).json({ ok: false, error: 'Ticket not found' });
  }

  return res.json({ ok: true, ticket });
});

ticketsRouter.post('/:id/status', async (req, res) => {
  const parsed = changeStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: 'Validation failed',
      issues: parsed.error.flatten(),
    });
  }

  const ticket = await ticketStore.setStatus(req.params.id, parsed.data.status, parsed.data.actor || 'system');
  if (!ticket) {
    return res.status(404).json({ ok: false, error: 'Ticket not found' });
  }

  return res.json({ ok: true, ticket });
});

async function postHiretrackFaultSync(req: Request, res: Response) {
  const ticketId = String(req.params.id);
  const ticket = await ticketStore.getTicket(ticketId);
  if (!ticket) {
    return res.status(404).json({ ok: false, error: 'Ticket not found' });
  }

  const result = await syncLoggedFaultForTicket(ticketId);
  if (!result) {
    return res.status(404).json({ ok: false, error: 'Ticket not found' });
  }

  if (result.skipped) {
    return res.status(409).json({ ok: false, error: result.reason, ticket });
  }

  if (!result.ok) {
    return res.status(502).json({ ok: false, error: result.reason, ticket: result.ticket });
  }

  return res.json({ ok: true, ticket: result.ticket, loggedFault: result.result });
}

ticketsRouter.post('/:id/hiretrack-repair', postHiretrackFaultSync);
ticketsRouter.post('/:id/hiretrack-fault', postHiretrackFaultSync);

async function postBitrixItemSync(req: Request, res: Response) {
  const ticketId = String(req.params.id);
  const ticket = await ticketStore.getTicket(ticketId);
  if (!ticket) {
    return res.status(404).json({ ok: false, error: 'Ticket not found' });
  }

  const result = await syncBitrixForTicket(ticketId);
  if (!result) {
    return res.status(404).json({ ok: false, error: 'Ticket not found' });
  }

  if (result.skipped) {
    return res.status(200).json({ ok: true, skipped: true, ticket: result.ticket, reason: result.reason });
  }

  if (!result.ok) {
    return res.status(502).json({ ok: false, error: result.reason, ticket: result.ticket });
  }

  return res.json({ ok: true, ticket: result.ticket, bitrixItem: result.result });
}

ticketsRouter.post('/:id/bitrix-item', postBitrixItemSync);
