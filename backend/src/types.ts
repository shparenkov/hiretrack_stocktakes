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

export interface HiretrackStocktakeHistoryRecord {
  stockTakeId: number | null;
  stockTakeTitle: string | null;
  stockTakeActive: boolean;
  startDate: string | null;
  inActiveDate: string | null;
  warehouseName: string | null;
  equipmentTypeId: number | null;
  equipmentType: string | null;
  categoryId: number | null;
  categoryName: string | null;
  masterCategoryId: number | null;
  masterCategoryName: string | null;
  itemRef: number | null;
  barcode: string | null;
  serialNumber: string | null;
  commissionStatus: number | null;
  currentEqlistId: number | null;
  currentEqlistName: string | null;
  currentJobNo: number | null;
  currentJobRef: string | null;
  currentClientName: string | null;
  currentItemState: 'active' | 'inactive' | 'unknown';
  seenDate: string | null;
  processedDate: string | null;
  actionedDate: string | null;
  actionNotes: string | null;
  actionedNotes: string | null;
  disposalReason: number | null;
  disposalReasonLabel: string | null;
  disposalDate: string | null;
  disposalNotes: string | null;
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

export interface TicketActivityRecord {
  id: string;
  ticketId: string;
  type: string;
  message: string;
  actor: string | null;
  payloadJson: string | null;
  createdAt: string;
}

export interface HiretrackEquipmentCatalogItem {
  typeId: number;
  name: string | null;
  categoryId: number | null;
  categoryName: string | null;
  shortcode: string | null;
  comments: string | null;
  longDescription: string | null;
  class: number | null;
  visibility: number | null;
}

export interface HiretrackEqlistLookupRecord {
  eqlistId: number;
  eqlistName: string | null;
  jobNo: number | null;
  jobRef: string | null;
  clientName: string | null;
  lastSeenAt: string | null;
  operationType: number | null;
  isCurrent: boolean;
}
