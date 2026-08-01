export type TicketStatus =
  | 'received'
  | 'diagnosing'
  | 'waiting_parts'
  | 'in_repair'
  | 'ready'
  | 'handed_over'
  | 'cancelled';

export type TicketPriority =
  | 'low'
  | 'normal'
  | 'high'
  | 'critical';

export type BarcodeType =
  | 'EAN13'
  | 'CODE128'
  | 'CODE39'
  | 'DATAMATRIX'
  | 'QR'
  | 'OTHER';

export type SyncState = 'pending' | 'ok' | 'error';

export interface EquipmentLookupRecord {
  barcode: string | null;
  serialNumber: string | null;
  itemRef: number | null;
  equipmentTypeId: number | null;
  equipmentName: string | null;
}

export interface HiretrackStockCheckRecord {
  item: EquipmentLookupRecord | null;
  eqlists: HiretrackEqlistLookupRecord[];
  status: 'not_found' | 'in_stock' | 'on_eqlist';
  currentEqlistId: number | null;
  currentEqlistName: string | null;
  currentJobNo: number | null;
  currentJobRef: string | null;
  currentClientName: string | null;
}

export interface HiretrackEqlistLookupRecord {
  eqlistId: number;
  eqlistName: string | null;
  jobNo: number | null;
  jobRef: string | null;
  clientName: string | null;
  lastSeenAt: string | null;
  isCurrent: boolean;
}

export interface TicketRecord {
  id: string;
  ticketNumber: string;
  status: TicketStatus;
  priority: TicketPriority;
  equipmentName: string;
  serialNumber: string;
  barcodeRaw: string | null;
  barcodeType: BarcodeType | null;
  hiretrackItemRef: number | null;
  hiretrackEquipmentTypeId: number | null;
  hiretrackEqlistId: number | null;
  hiretrackEqlistName: string | null;
  hiretrackJobNo: number | null;
  hiretrackJobRef: string | null;
  clientName: string;
  clientCompany: string | null;
  clientPhone: string | null;
  clientEmail: string | null;
  faultDescription: string;
  engineerNotes: string | null;
  assignedEngineerId: string | null;
  assignedEngineerName: string | null;
  receivedAt: string;
  diagnosedAt: string | null;
  estimatedReadyAt: string | null;
  completedAt: string | null;
  handedOverAt: string | null;
  bitrixItemId: string | null;
  hiretrackTicketId: string | null;
  syncBitrixState: SyncState;
  syncHiretrackState: SyncState;
  syncBitrixError: string | null;
  syncHiretrackError: string | null;
  syncBitrixUpdatedAt: string | null;
  syncHiretrackUpdatedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTicketPayload {
  equipmentName: string;
  serialNumber: string;
  barcodeRaw?: string | null;
  barcodeType?: BarcodeType | null;
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

export interface TicketActivityRecord {
  id: string;
  ticketId: string;
  type: string;
  message: string;
  actor: string | null;
  payloadJson: string | null;
  createdAt: string;
}
