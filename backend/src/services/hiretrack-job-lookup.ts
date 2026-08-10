import { runHiretrackOdbcRead } from './hiretrack-odbc-read';
import { updateHiretrackEqlistDates } from './hiretrack-booking-api';

// "Open an existing job" lookup for the create-job page - looks up a Job by
// its ref (e.g. "Р7169МСК"), its Eqlist(s) (with their real DateOut/DateBack
// - append_to_booking must match those exactly, see
// EQUIPMENT_CATALOG_MATCH_BLUEPRINT.md), and each Eqlist's current lines.

export interface HiretrackJobLookupLine {
  typeId: number;
  name: string | null;
  qty: number;
  sectionId: number | null;
  // TEquipmentType: 0=etSimple, 1=etCompositeKit, 2=etAliasKit,
  // 3=etPricedAliasKit, 4=etMarkup - the frontend cross-references this
  // type's `components` from the already-loaded catalog cache to render a
  // nested view for Composite/Alias lines, so no extra fetch is needed here.
  equipmentType: number | null;
  // Hetype.Class - TEquipmentClass: 0=ecRental, 1=ecConsumable,
  // 2=ecNewSales, 3=ecExRentalSales (confirmed live via #Fields.FIELD_DESC).
  // 1 (Consumable) gets its own badge in the frontend.
  equipmentClass: number | null;
  // Sort.Lineref - what api_v2's change_booking_quantity/remove_from_booking
  // target (the same value append_to_booking returns as LineRefID).
  lineRefId: number;
}

export interface HiretrackJobLookupSection {
  sectionId: number;
  sectionText: string | null;
  sortOrder: number | null;
}

export interface HiretrackJobLookupEqlist {
  eqlistId: number;
  eqlistName: string | null;
  dateOut: string;
  dateBack: string;
  clientId: number | null;
  clientName: string | null;
  sections: HiretrackJobLookupSection[];
  lines: HiretrackJobLookupLine[];
}

export interface HiretrackJobLookupResult {
  jobNo: number;
  jobRef: string;
  name: string | null;
  eqlists: HiretrackJobLookupEqlist[];
}

interface RawSectionRow {
  SectionId: number;
  SectionText: string | null;
  sortOrder: number | null;
}

interface RawEqlistRow {
  Eql_no: number;
  Eql_name: string | null;
  DateOut: string;
  DateBack: string;
  Client_no: number | null;
  Client_name: string | null;
  lines: {
    EquipmentTypeId: number;
    EquipmentName: string | null;
    Quant: number;
    SectionId: number | null;
    EquipmentType: number | null;
    LineRefId: number;
    Class: number | null;
  }[];
  sections: RawSectionRow[];
}

interface RawJobLookupResult {
  jobNo: number;
  jobRef: string;
  name: string | null;
  eqlists: RawEqlistRow[];
}

export interface HiretrackJobSearchResult {
  jobNo: number;
  jobRef: string;
  jobTitle: string | null;
  clientName: string | null;
}

interface RawJobSearchRow {
  JobNo: number;
  Job_Ref: string;
  Job_Title: string | null;
  Name: string | null;
}

// Interactive job search - users search by name (client or job title), not
// the job number, so this matches Job_Title/Name/Job_Ref and returns the
// job numbers (Job_Ref) to pick from, for lookupHiretrackJob above.
export async function searchHiretrackJobs(query: string): Promise<HiretrackJobSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return [];
  }

  const rows = await runHiretrackOdbcRead<RawJobSearchRow[]>({
    operation: 'job-search',
    query: trimmed,
  });

  return rows.map((row) => ({
    jobNo: row.JobNo,
    jobRef: row.Job_Ref,
    jobTitle: row.Job_Title ?? null,
    clientName: row.Name ?? null,
  }));
}

// Drops any fractional-second component and normalizes to a bare space
// separator ("YYYY-MM-DD HH:MM:SS") - the ODBC bridge serializes datetimes
// via Python's .isoformat(), which is "T"-separated and includes
// microseconds when present. String-only on purpose (no Date parsing) to
// avoid any timezone reinterpretation - this machine and the DB share one
// timezone, so the wall-clock digits themselves are exactly what's needed.
function normalizeHiretrackDateTime(raw: string): string {
  return raw.split('.')[0].replace('T', ' ');
}

export async function lookupHiretrackJob(jobRef: string): Promise<HiretrackJobLookupResult | null> {
  const trimmed = jobRef.trim();
  if (!trimmed) {
    return null;
  }

  const raw = await runHiretrackOdbcRead<RawJobLookupResult | null>({
    operation: 'job-lookup',
    jobRef: trimmed,
  });

  if (!raw) {
    return null;
  }

  const eqlists: HiretrackJobLookupEqlist[] = [];
  for (const eqlist of raw.eqlists) {
    const hadFraction = eqlist.DateOut.includes('.') || eqlist.DateBack.includes('.');
    const dateOut = normalizeHiretrackDateTime(eqlist.DateOut);
    const dateBack = normalizeHiretrackDateTime(eqlist.DateBack);

    if (hadFraction) {
      // Self-heal: confirmed live that append_to_booking rejects ANY stored
      // DateOut/DateBack with sub-second precision, no matter what precision
      // the request itself uses - legacy jobs created before the
      // Eqlist-dates fix was deployed got such a value from
      // CreateNewEqlist's CURRENT_TIMESTAMP clamp. Fix it in place the first
      // time the job is opened, so appends to it work from here on.
      await updateHiretrackEqlistDates(eqlist.Eql_no, dateOut, dateBack);
    }

    eqlists.push({
      eqlistId: eqlist.Eql_no,
      eqlistName: eqlist.Eql_name ?? null,
      dateOut,
      dateBack,
      clientId: eqlist.Client_no ?? null,
      clientName: eqlist.Client_name ?? null,
      sections: eqlist.sections.map((section) => ({
        sectionId: section.SectionId,
        sectionText: section.SectionText ?? null,
        sortOrder: section.sortOrder ?? null,
      })),
      lines: eqlist.lines.map((line) => ({
        typeId: line.EquipmentTypeId,
        name: line.EquipmentName ?? null,
        qty: line.Quant,
        sectionId: line.SectionId ?? null,
        equipmentType: line.EquipmentType ?? null,
        equipmentClass: line.Class ?? null,
        lineRefId: line.LineRefId,
      })),
    });
  }

  return {
    jobNo: raw.jobNo,
    jobRef: raw.jobRef,
    name: raw.name ?? null,
    eqlists,
  };
}
