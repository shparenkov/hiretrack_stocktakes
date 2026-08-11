import { runHiretrackOdbcWrite } from './hiretrack-odbc-write';

// Writes matched equipment into a HireTrack Note (Notebook/notebookdetails) -
// NOT into a live Job Eqlist. See EQUIPMENT_CATALOG_MATCH_BLUEPRINT.md for
// why. Callers (the rider-matching Claude Skill) must have already shown the
// proposed line list to the user and gotten explicit confirmation before
// calling this - it is a real write to production HireTrack data.

export interface EquipmentNoteLineInput {
  eqtype: number;
  qty: number;
  priceEach?: number;
}

export interface EquipmentNoteWriteInput {
  title: string;
  user?: number;
  site?: number;
  currency?: number;
  priceScheme?: number;
  clientName?: string;
  clientId?: number;
  lines: EquipmentNoteLineInput[];
}

export interface EquipmentNoteWriteResult {
  noteId: number;
  linesWritten: number;
  failedLines: { eqtype: number; error: string }[];
}

export async function createEquipmentNoteWithLines(
  input: EquipmentNoteWriteInput,
): Promise<EquipmentNoteWriteResult> {
  const { noteId } = await runHiretrackOdbcWrite<{ noteId: number }>({
    operation: 'create-note',
    title: input.title,
    user: input.user ?? null,
    site: input.site ?? 1,
    currency: input.currency ?? 0,
    priceScheme: input.priceScheme ?? 0,
    clientName: input.clientName ?? null,
    clientId: input.clientId ?? null,
  });

  let linesWritten = 0;
  const failedLines: { eqtype: number; error: string }[] = [];

  // Sequential on purpose: rider line counts are small (tens, not thousands),
  // and this keeps each line's failure isolated and reported rather than
  // aborting the whole note on the first bad line.
  for (const line of input.lines) {
    try {
      await runHiretrackOdbcWrite({
        operation: 'add-note-line',
        noteId,
        eqtype: line.eqtype,
        qty: line.qty,
        // Omit entirely rather than defaulting to 0 - the write bridge falls
        // back to the equipment's own Hetype.Daily rate when priceEach isn't
        // supplied, so 0 here would wrongly force every line to price zero.
        priceEach: line.priceEach ?? null,
      });
      linesWritten += 1;
    } catch (error) {
      failedLines.push({
        eqtype: line.eqtype,
        error: error instanceof Error ? error.message : 'add-note-line failed',
      });
    }
  }

  return { noteId, linesWritten, failedLines };
}

// EqSections CRUD for the create-job existing-job tree view. Confirmed live
// (2026-08-10) against a throwaway section on the Р7167МСК test job: idx is
// LASTAUTOINC same as CreateNewNote, sortOrder is a plain FLOAT (append new
// sections after the highest existing one), and Sort.sectionID accepts NULL
// so deleting a section can move its lines back to "no section" instead of
// leaving them pointing at a row that no longer exists.

export interface RenameSectionResult {
  sectionId: number;
  sectionText: string;
}

export async function renameHiretrackSection(sectionId: number, sectionText: string): Promise<RenameSectionResult> {
  return runHiretrackOdbcWrite<RenameSectionResult>({ operation: 'rename-section', sectionId, sectionText });
}

export interface CreateSectionResult {
  sectionId: number;
  eqlistId: number;
  sectionText: string;
  sortOrder: number;
}

export async function createHiretrackSection(eqlistId: number, sectionText: string): Promise<CreateSectionResult> {
  return runHiretrackOdbcWrite<CreateSectionResult>({ operation: 'create-section', eqlistId, sectionText });
}

export interface DeleteSectionResult {
  sectionId: number;
  linesReassigned: number;
}

export async function deleteHiretrackSection(sectionId: number, eqlistId: number): Promise<DeleteSectionResult> {
  return runHiretrackOdbcWrite<DeleteSectionResult>({ operation: 'delete-section', sectionId, eqlistId });
}

// api_v2's append_to_booking has no section param - a freshly appended line
// lands wherever HireTrack itself decides (observed live: an auto-created
// "Warehouse Added Equipment" section), not the section the create-job UI's
// per-section "add equipment" widget was actually used from. Called right
// after a successful append to move the new line into the right section.
export interface SetLineSectionResult {
  lineRefId: number;
  sectionId: number;
}

export async function setHiretrackLineSection(
  lineRefId: number,
  eqlistId: number,
  sectionId: number,
): Promise<SetLineSectionResult> {
  return runHiretrackOdbcWrite<SetLineSectionResult>({ operation: 'set-line-section', lineRefId, eqlistId, sectionId });
}

// api_v2's change_booking_quantity/append_to_booking silently cap the
// persisted quantity to whatever stock is actually available instead of
// rejecting an over-quantity request (ValidationResult stays 0 - confirmed
// live 2026-08-10, see EQUIPMENT_CATALOG_MATCH_BLUEPRINT.md) - there is no
// api_v2 parameter to opt out of that cap. Per explicit user instruction,
// quantity must always reflect exactly what was requested regardless of
// stock, so callers use this to overwrite it directly whenever the api_v2
// call's own BookingQty came back lower than requested. Deliberately does
// NOT touch Daily/Price/PreDiscount/Discount/InvoicedTotal, so pricing for
// the forced excess is not automatic.
export interface ForceLineQuantityResult {
  lineRefId: number;
  quantity: number;
}

export async function forceHiretrackLineQuantity(
  lineRefId: number,
  eqlistId: number,
  quantity: number,
): Promise<ForceLineQuantityResult> {
  return runHiretrackOdbcWrite<ForceLineQuantityResult>({ operation: 'force-line-quantity', lineRefId, eqlistId, quantity });
}

// api_v2's initialise_new_booking never sets Jobs.Type/Handler/SalesPerson at
// all (confirmed live - all three were NULL on every job created through
// /create-job/ so far). Plain Jobs columns, no pricing/stored-function
// entanglement like Eqlists has, so a direct UPDATE is safe. Only sets
// whichever of the three fields is actually passed.
export interface UpdateJobHeaderInput {
  jobId: number;
  type?: number;
  handler?: number;
  salesPerson?: number;
}

export async function updateHiretrackJobHeader(input: UpdateJobHeaderInput): Promise<void> {
  await runHiretrackOdbcWrite({
    operation: 'update-job-header',
    jobId: input.jobId,
    type: input.type ?? null,
    handler: input.handler ?? null,
    salesPerson: input.salesPerson ?? null,
  });
}

// CONTACTS has no standalone "company address book" - HireTrack NX itself
// creates a fresh row per job even when it's really the same real Name2
// person being reused (confirmed live: the same Person id recurs across many
// CONTACTS rows with different xLink/job numbers), so this mirrors that
// convention. MainContact=TRUE always, since v1 only has one contact-picker
// slot per job.
export interface AddJobContactResult {
  companyId: number;
  personId: number;
  jobId: number;
}

export async function addHiretrackJobContact(companyId: number, personId: number, jobId: number): Promise<AddJobContactResult> {
  return runHiretrackOdbcWrite<AddJobContactResult>({ operation: 'add-job-contact', companyId, personId, jobId });
}
