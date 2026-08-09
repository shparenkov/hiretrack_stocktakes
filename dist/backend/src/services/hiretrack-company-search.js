"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchHiretrackCompanies = searchHiretrackCompanies;
const hiretrack_odbc_read_1 = require("./hiretrack-odbc-read");
async function searchHiretrackCompanies(query) {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
        return [];
    }
    const rows = await (0, hiretrack_odbc_read_1.runHiretrackOdbcRead)({
        operation: 'company-search',
        query: trimmed,
    });
    return rows.map((row) => ({
        companyId: row.CompanyId,
        companyName: row.CompanyName,
        town: row.Town ?? null,
    }));
}
