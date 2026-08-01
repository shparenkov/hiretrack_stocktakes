import { randomUUID } from 'crypto';
import { PrismaClient, Ticket as PrismaTicket, TicketActivityLog as PrismaTicketActivityLog } from '@prisma/client';
import { TicketActivityRecord, TicketPriority, TicketRecord, TicketStatus } from '../types';
import { buildTicketNumber } from './ticket-number';

export interface CreateTicketInput {
  equipmentName: string;
  serialNumber: string;
  barcodeRaw?: string | null;
  barcodeType?: TicketRecord['barcodeType'];
  hiretrackItemRef?: number | null;
  hiretrackEquipmentTypeId?: number | null;
  hiretrackEqlistId?: number | null;
  hiretrackEqlistName?: string | null;
  hiretrackJobNo?: number | null;
  hiretrackJobRef?: string | null;
  clientName?: string;
  clientCompany?: string | null;
  clientPhone?: string | null;
  clientEmail?: string | null;
  faultDescription: string;
  engineerNotes?: string | null;
  assignedEngineerId?: string | null;
  assignedEngineerName?: string | null;
  priority?: TicketPriority;
  receivedAt?: string;
  createdBy?: string;
}

export interface UpdateTicketInput {
  equipmentName?: string;
  serialNumber?: string;
  barcodeRaw?: string | null;
  barcodeType?: TicketRecord['barcodeType'];
  hiretrackItemRef?: number | null;
  hiretrackEquipmentTypeId?: number | null;
  hiretrackEqlistId?: number | null;
  hiretrackEqlistName?: string | null;
  hiretrackJobNo?: number | null;
  hiretrackJobRef?: string | null;
  clientName?: string;
  clientCompany?: string | null;
  clientPhone?: string | null;
  clientEmail?: string | null;
  faultDescription?: string;
  engineerNotes?: string | null;
  assignedEngineerId?: string | null;
  assignedEngineerName?: string | null;
  priority?: TicketPriority;
  diagnosedAt?: string | null;
  estimatedReadyAt?: string | null;
  completedAt?: string | null;
  handedOverAt?: string | null;
  bitrixItemId?: string | null;
  syncBitrixState?: TicketRecord['syncBitrixState'];
  syncBitrixError?: string | null;
  syncBitrixUpdatedAt?: string | null;
  hiretrackTicketId?: string | null;
  syncHiretrackState?: TicketRecord['syncHiretrackState'];
  syncHiretrackError?: string | null;
  syncHiretrackUpdatedAt?: string | null;
}

export interface TicketStore {
  listTickets(): Promise<TicketRecord[]>;
  getTicket(id: string): Promise<TicketRecord | null>;
  getTicketActivity(ticketId: string): Promise<TicketActivityRecord[]>;
  createTicket(input: CreateTicketInput): Promise<TicketRecord>;
  updateTicket(id: string, patch: UpdateTicketInput, actor?: string): Promise<TicketRecord | null>;
  setStatus(id: string, status: TicketStatus, actor?: string): Promise<TicketRecord | null>;
}

function serializeDate(value: Date | string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapTicketRow(row: PrismaTicket): TicketRecord {
  return {
    id: row.id,
    ticketNumber: row.ticketNumber,
    status: row.status as TicketStatus,
    priority: row.priority as TicketPriority,
    equipmentName: row.equipmentName,
    serialNumber: row.serialNumber,
    barcodeRaw: row.barcodeRaw,
    barcodeType: row.barcodeType as TicketRecord['barcodeType'],
    hiretrackItemRef: row.hiretrackItemRef,
    hiretrackEquipmentTypeId: row.hiretrackEquipmentTypeId,
    hiretrackEqlistId: row.hiretrackEqlistId,
    hiretrackEqlistName: row.hiretrackEqlistName,
    hiretrackJobNo: row.hiretrackJobNo,
    hiretrackJobRef: row.hiretrackJobRef,
    clientName: row.clientName,
    clientCompany: row.clientCompany,
    clientPhone: row.clientPhone,
    clientEmail: row.clientEmail,
    faultDescription: row.faultDescription,
    engineerNotes: row.engineerNotes,
    assignedEngineerId: row.assignedEngineerId,
    assignedEngineerName: row.assignedEngineerName,
    receivedAt: row.receivedAt.toISOString(),
    diagnosedAt: serializeDate(row.diagnosedAt),
    estimatedReadyAt: serializeDate(row.estimatedReadyAt),
    completedAt: serializeDate(row.completedAt),
    handedOverAt: serializeDate(row.handedOverAt),
    bitrixItemId: row.bitrixItemId,
    hiretrackTicketId: row.hiretrackTicketId,
    syncBitrixState: row.syncBitrixState as TicketRecord['syncBitrixState'],
    syncHiretrackState: row.syncHiretrackState as TicketRecord['syncHiretrackState'],
    syncBitrixError: row.syncBitrixError,
    syncHiretrackError: row.syncHiretrackError,
    syncBitrixUpdatedAt: serializeDate(row.syncBitrixUpdatedAt),
    syncHiretrackUpdatedAt: serializeDate(row.syncHiretrackUpdatedAt),
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapActivityRow(row: PrismaTicketActivityLog): TicketActivityRecord {
  return {
    id: row.id,
    ticketId: row.ticketId,
    type: row.type,
    message: row.message,
    actor: row.actor,
    payloadJson: row.payloadJson,
    createdAt: row.createdAt.toISOString(),
  };
}

class InMemoryTicketStore implements TicketStore {
  private sequence = 0;
  private tickets = new Map<string, TicketRecord>();
  private activityLogs = new Map<string, TicketActivityRecord[]>();

  async listTickets(): Promise<TicketRecord[]> {
    return [...this.tickets.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getTicket(id: string): Promise<TicketRecord | null> {
    return this.tickets.get(id) || null;
  }

  async getTicketActivity(ticketId: string): Promise<TicketActivityRecord[]> {
    return [...(this.activityLogs.get(ticketId) || [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async createTicket(input: CreateTicketInput): Promise<TicketRecord> {
    this.sequence += 1;

    const now = new Date().toISOString();
    const ticket: TicketRecord = {
      id: randomUUID(),
      ticketNumber: buildTicketNumber(this.sequence),
      status: 'received',
      priority: input.priority || 'normal',
      equipmentName: input.equipmentName,
      serialNumber: input.serialNumber,
      barcodeRaw: input.barcodeRaw ?? null,
      barcodeType: input.barcodeType ?? null,
      hiretrackItemRef: input.hiretrackItemRef ?? null,
      hiretrackEquipmentTypeId: input.hiretrackEquipmentTypeId ?? null,
      hiretrackEqlistId: input.hiretrackEqlistId ?? null,
      hiretrackEqlistName: input.hiretrackEqlistName ?? null,
      hiretrackJobNo: input.hiretrackJobNo ?? null,
      hiretrackJobRef: input.hiretrackJobRef ?? null,
      clientName: input.clientName || '',
      clientCompany: input.clientCompany ?? null,
      clientPhone: input.clientPhone ?? null,
      clientEmail: input.clientEmail ?? null,
      faultDescription: input.faultDescription,
      engineerNotes: input.engineerNotes ?? null,
      assignedEngineerId: input.assignedEngineerId ?? null,
      assignedEngineerName: input.assignedEngineerName ?? null,
      receivedAt: input.receivedAt || now,
      diagnosedAt: null,
      estimatedReadyAt: null,
      completedAt: null,
      handedOverAt: null,
      bitrixItemId: null,
      hiretrackTicketId: null,
      syncBitrixState: 'pending',
      syncHiretrackState: 'pending',
      syncBitrixError: null,
      syncHiretrackError: null,
      syncBitrixUpdatedAt: null,
      syncHiretrackUpdatedAt: null,
      createdBy: input.createdBy || 'system',
      createdAt: now,
      updatedAt: now,
    };

    this.tickets.set(ticket.id, ticket);
    this.appendActivity(ticket.id, 'ticket_created', `Ticket ${ticket.ticketNumber} created.`, ticket.createdBy, ticket);

    if (ticket.barcodeRaw || ticket.barcodeType) {
      this.appendActivity(
        ticket.id,
        'barcode_scanned',
        'Barcode data captured on ticket creation.',
        ticket.createdBy,
        {
          barcodeRaw: ticket.barcodeRaw,
          barcodeType: ticket.barcodeType,
          serialNumber: ticket.serialNumber,
        }
      );
    }

    return ticket;
  }

  async updateTicket(id: string, patch: UpdateTicketInput, actor = 'system'): Promise<TicketRecord | null> {
    const current = this.tickets.get(id);
    if (!current) {
      return null;
    }

    const updated: TicketRecord = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    this.tickets.set(id, updated);
    this.appendActivity(id, 'ticket_updated', `Ticket ${updated.ticketNumber} updated.`, actor, patch);
    return updated;
  }

  async setStatus(id: string, status: TicketStatus, actor = 'system'): Promise<TicketRecord | null> {
    const current = this.tickets.get(id);
    if (!current) {
      return null;
    }

    const now = new Date().toISOString();
    const patch: Partial<TicketRecord> = {
      status,
      updatedAt: now,
    };

    if (status === 'diagnosing' && !current.diagnosedAt) {
      patch.diagnosedAt = now;
    }
    if (status === 'ready' && !current.completedAt) {
      patch.completedAt = now;
    }
    if (status === 'handed_over' && !current.handedOverAt) {
      patch.handedOverAt = now;
    }

    const updated: TicketRecord = { ...current, ...patch };
    this.tickets.set(id, updated);
    this.appendActivity(id, 'status_changed', `Status changed to ${status}.`, actor, { status });
    return updated;
  }

  private appendActivity(
    ticketId: string,
    type: string,
    message: string,
    actor: string | null,
    payload: unknown
  ): void {
    const entry: TicketActivityRecord = {
      id: randomUUID(),
      ticketId,
      type,
      message,
      actor,
      payloadJson: payload == null ? null : JSON.stringify(payload),
      createdAt: new Date().toISOString(),
    };

    const current = this.activityLogs.get(ticketId) || [];
    current.push(entry);
    this.activityLogs.set(ticketId, current);
  }
}

class PrismaTicketStore implements TicketStore {
  constructor(private readonly prisma: PrismaClient) {}

  async listTickets(): Promise<TicketRecord[]> {
    const rows = await this.prisma.ticket.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(mapTicketRow);
  }

  async getTicket(id: string): Promise<TicketRecord | null> {
    const row = await this.prisma.ticket.findUnique({ where: { id } });
    return row ? mapTicketRow(row) : null;
  }

  async getTicketActivity(ticketId: string): Promise<TicketActivityRecord[]> {
    const rows = await this.prisma.ticketActivityLog.findMany({
      where: { ticketId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(mapActivityRow);
  }

  async createTicket(input: CreateTicketInput): Promise<TicketRecord> {
    const ticket = await this.prisma.$transaction(async (tx) => {
      const sequence = await tx.ticket.count();
      const created = await tx.ticket.create({
        data: {
          ticketNumber: buildTicketNumber(sequence + 1),
          status: 'received',
          priority: input.priority || 'normal',
          equipmentName: input.equipmentName,
          serialNumber: input.serialNumber,
          barcodeRaw: input.barcodeRaw ?? null,
          barcodeType: input.barcodeType ?? null,
          hiretrackItemRef: input.hiretrackItemRef ?? null,
          hiretrackEquipmentTypeId: input.hiretrackEquipmentTypeId ?? null,
          hiretrackEqlistId: input.hiretrackEqlistId ?? null,
          hiretrackEqlistName: input.hiretrackEqlistName ?? null,
          hiretrackJobNo: input.hiretrackJobNo ?? null,
          hiretrackJobRef: input.hiretrackJobRef ?? null,
          clientName: input.clientName || '',
          clientCompany: input.clientCompany ?? null,
          clientPhone: input.clientPhone ?? null,
          clientEmail: input.clientEmail ?? null,
          faultDescription: input.faultDescription,
          engineerNotes: input.engineerNotes ?? null,
          assignedEngineerId: input.assignedEngineerId ?? null,
          assignedEngineerName: input.assignedEngineerName ?? null,
          receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(),
          bitrixItemId: null,
          hiretrackTicketId: null,
          syncBitrixState: 'pending',
          syncHiretrackState: 'pending',
          syncBitrixError: null,
          syncHiretrackError: null,
          syncBitrixUpdatedAt: null,
          syncHiretrackUpdatedAt: null,
          createdBy: input.createdBy || 'system',
        },
      });

      await tx.ticketActivityLog.create({
        data: {
          ticketId: created.id,
          type: 'ticket_created',
          message: `Ticket ${created.ticketNumber} created.`,
          actor: created.createdBy,
          payloadJson: JSON.stringify(mapTicketRow(created)),
        },
      });

      if (created.barcodeRaw || created.barcodeType) {
        await tx.ticketActivityLog.create({
          data: {
            ticketId: created.id,
            type: 'barcode_scanned',
            message: 'Barcode data captured on ticket creation.',
            actor: created.createdBy,
            payloadJson: JSON.stringify({
              barcodeRaw: created.barcodeRaw,
              barcodeType: created.barcodeType,
              serialNumber: created.serialNumber,
            }),
          },
        });
      }

      return created;
    });

    return mapTicketRow(ticket);
  }

  async updateTicket(id: string, patch: UpdateTicketInput, actor = 'system'): Promise<TicketRecord | null> {
    const current = await this.prisma.ticket.findUnique({ where: { id } });
    if (!current) {
      return null;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.ticket.update({
        where: { id },
        data: {
          ...mapUpdatePatch(patch),
        },
      });

      await tx.ticketActivityLog.create({
        data: {
          ticketId: id,
          type: 'ticket_updated',
          message: `Ticket ${row.ticketNumber} updated.`,
          actor,
          payloadJson: JSON.stringify(patch),
        },
      });

      return row;
    });

    return mapTicketRow(updated);
  }

  async setStatus(id: string, status: TicketStatus, actor = 'system'): Promise<TicketRecord | null> {
    const current = await this.prisma.ticket.findUnique({ where: { id } });
    if (!current) {
      return null;
    }

    const now = new Date();
    const data: Record<string, unknown> = { status };
    if (status === 'diagnosing' && !current.diagnosedAt) {
      data.diagnosedAt = now;
    }
    if (status === 'ready' && !current.completedAt) {
      data.completedAt = now;
    }
    if (status === 'handed_over' && !current.handedOverAt) {
      data.handedOverAt = now;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.ticket.update({
        where: { id },
        data,
      });
      await tx.ticketActivityLog.create({
        data: {
          ticketId: id,
          type: 'status_changed',
          message: `Status changed to ${status}.`,
          actor,
          payloadJson: JSON.stringify({ status }),
        },
      });
      return row;
    });

    return mapTicketRow(updated);
  }
}

function mapUpdatePatch(patch: UpdateTicketInput): Record<string, unknown> {
  return {
    ...(patch.equipmentName !== undefined ? { equipmentName: patch.equipmentName } : {}),
    ...(patch.serialNumber !== undefined ? { serialNumber: patch.serialNumber } : {}),
    ...(patch.barcodeRaw !== undefined ? { barcodeRaw: patch.barcodeRaw } : {}),
    ...(patch.barcodeType !== undefined ? { barcodeType: patch.barcodeType } : {}),
    ...(patch.hiretrackItemRef !== undefined ? { hiretrackItemRef: patch.hiretrackItemRef } : {}),
    ...(patch.hiretrackEquipmentTypeId !== undefined ? { hiretrackEquipmentTypeId: patch.hiretrackEquipmentTypeId } : {}),
    ...(patch.hiretrackEqlistId !== undefined ? { hiretrackEqlistId: patch.hiretrackEqlistId } : {}),
    ...(patch.hiretrackEqlistName !== undefined ? { hiretrackEqlistName: patch.hiretrackEqlistName } : {}),
    ...(patch.hiretrackJobNo !== undefined ? { hiretrackJobNo: patch.hiretrackJobNo } : {}),
    ...(patch.hiretrackJobRef !== undefined ? { hiretrackJobRef: patch.hiretrackJobRef } : {}),
    ...(patch.clientName !== undefined ? { clientName: patch.clientName } : {}),
    ...(patch.clientCompany !== undefined ? { clientCompany: patch.clientCompany } : {}),
    ...(patch.clientPhone !== undefined ? { clientPhone: patch.clientPhone } : {}),
    ...(patch.clientEmail !== undefined ? { clientEmail: patch.clientEmail } : {}),
    ...(patch.faultDescription !== undefined ? { faultDescription: patch.faultDescription } : {}),
    ...(patch.engineerNotes !== undefined ? { engineerNotes: patch.engineerNotes } : {}),
    ...(patch.assignedEngineerId !== undefined ? { assignedEngineerId: patch.assignedEngineerId } : {}),
    ...(patch.assignedEngineerName !== undefined ? { assignedEngineerName: patch.assignedEngineerName } : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    ...(patch.diagnosedAt !== undefined ? { diagnosedAt: patch.diagnosedAt ? new Date(patch.diagnosedAt) : null } : {}),
    ...(patch.estimatedReadyAt !== undefined ? { estimatedReadyAt: patch.estimatedReadyAt ? new Date(patch.estimatedReadyAt) : null } : {}),
    ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt ? new Date(patch.completedAt) : null } : {}),
    ...(patch.handedOverAt !== undefined ? { handedOverAt: patch.handedOverAt ? new Date(patch.handedOverAt) : null } : {}),
    ...(patch.bitrixItemId !== undefined ? { bitrixItemId: patch.bitrixItemId } : {}),
    ...(patch.syncBitrixState !== undefined ? { syncBitrixState: patch.syncBitrixState } : {}),
    ...(patch.syncBitrixError !== undefined ? { syncBitrixError: patch.syncBitrixError } : {}),
    ...(patch.syncBitrixUpdatedAt !== undefined ? { syncBitrixUpdatedAt: patch.syncBitrixUpdatedAt ? new Date(patch.syncBitrixUpdatedAt) : null } : {}),
    ...(patch.hiretrackTicketId !== undefined ? { hiretrackTicketId: patch.hiretrackTicketId } : {}),
    ...(patch.syncHiretrackState !== undefined ? { syncHiretrackState: patch.syncHiretrackState } : {}),
    ...(patch.syncHiretrackError !== undefined ? { syncHiretrackError: patch.syncHiretrackError } : {}),
    ...(patch.syncHiretrackUpdatedAt !== undefined ? { syncHiretrackUpdatedAt: patch.syncHiretrackUpdatedAt ? new Date(patch.syncHiretrackUpdatedAt) : null } : {}),
  };
}

let prismaSingleton: PrismaClient | null = null;

function getPrismaClient(): PrismaClient {
  if (!prismaSingleton) {
    prismaSingleton = new PrismaClient();
  }
  return prismaSingleton;
}

export function createTicketStore(): TicketStore {
  const mode = (process.env.TICKETS_STORE_MODE || 'memory').toLowerCase();

  if (mode === 'prisma') {
    return new PrismaTicketStore(getPrismaClient());
  }

  return new InMemoryTicketStore();
}
