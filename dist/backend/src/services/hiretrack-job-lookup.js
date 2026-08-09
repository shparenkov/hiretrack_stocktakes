"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchHiretrackJobs = searchHiretrackJobs;
exports.lookupHiretrackJob = lookupHiretrackJob;
const hiretrack_odbc_read_1 = require("./hiretrack-odbc-read");
// Interactive job search - users search by name (client or job title), not
// the job number, so this matches Job_Title/Name/Job_Ref and returns the
// job numbers (Job_Ref) to pick from, for lookupHiretrackJob above.
async function searchHiretrackJobs(query) {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
        return [];
    }
    const rows = await (0, hiretrack_odbc_read_1.runHiretrackOdbcRead)({
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
async function lookupHiretrackJob(jobRef) {
    const trimmed = jobRef.trim();
    if (!trimmed) {
        return null;
    }
    const raw = await (0, hiretrack_odbc_read_1.runHiretrackOdbcRead)({
        operation: 'job-lookup',
        jobRef: trimmed,
    });
    if (!raw) {
        return null;
    }
    return {
        jobNo: raw.jobNo,
        jobRef: raw.jobRef,
        name: raw.name ?? null,
        eqlists: raw.eqlists.map((eqlist) => ({
            eqlistId: eqlist.Eql_no,
            eqlistName: eqlist.Eql_name ?? null,
            dateOut: eqlist.DateOut,
            dateBack: eqlist.DateBack,
            clientId: eqlist.Client_no ?? null,
            clientName: eqlist.Client_name ?? null,
            lines: eqlist.lines.map((line) => ({
                typeId: line.EquipmentTypeId,
                name: line.EquipmentName ?? null,
                qty: line.Quant,
            })),
        })),
    };
}
