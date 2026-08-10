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
