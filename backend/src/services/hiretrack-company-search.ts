import { runHiretrackOdbcRead } from './hiretrack-odbc-read';

// Client picker for the "create-job" page - api_v2's initialise_new_booking
// needs a real hiretrack_client_id (Company.CompanyCounter), which must come
// from the user, not be guessed/defaulted like warehouse/pricelist/user are.

export interface HiretrackCompanySearchResult {
  companyId: number;
  companyName: string;
  town: string | null;
}

interface RawCompanyRow {
  CompanyId: number;
  CompanyName: string;
  Town: string | null;
}

export async function searchHiretrackCompanies(query: string): Promise<HiretrackCompanySearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return [];
  }

  const rows = await runHiretrackOdbcRead<RawCompanyRow[]>({
    operation: 'company-search',
    query: trimmed,
  });

  return rows.map((row) => ({
    companyId: row.CompanyId,
    companyName: row.CompanyName,
    town: row.Town ?? null,
  }));
}
