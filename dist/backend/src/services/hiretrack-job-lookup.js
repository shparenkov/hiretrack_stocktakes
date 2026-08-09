"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchHiretrackJobs = searchHiretrackJobs;
exports.lookupHiretrackJob = lookupHiretrackJob;
const hiretrack_odbc_read_1 = require("./hiretrack-odbc-read");
const hiretrack_booking_api_1 = require("./hiretrack-booking-api");
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
// Drops any fractional-second component and normalizes to a bare space
// separator ("YYYY-MM-DD HH:MM:SS") - the ODBC bridge serializes datetimes
// via Python's .isoformat(), which is "T"-separated and includes
// microseconds when present. String-only on purpose (no Date parsing) to
// avoid any timezone reinterpretation - this machine and the DB share one
// timezone, so the wall-clock digits themselves are exactly what's needed.
function normalizeHiretrackDateTime(raw) {
    return raw.split('.')[0].replace('T', ' ');
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
    const eqlists = [];
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
            await (0, hiretrack_booking_api_1.updateHiretrackEqlistDates)(eqlist.Eql_no, dateOut, dateBack);
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
