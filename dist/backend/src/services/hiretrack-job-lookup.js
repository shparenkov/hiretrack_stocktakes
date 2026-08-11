"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchHiretrackJobs = searchHiretrackJobs;
exports.listRecentHiretrackJobs = listRecentHiretrackJobs;
exports.getHiretrackJobDefaults = getHiretrackJobDefaults;
exports.listHiretrackUsers = listHiretrackUsers;
exports.listHiretrackClientContacts = listHiretrackClientContacts;
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
// Recently-created jobs (Jobs.CreatedDate, a real TIMESTAMP column) for the
// "open existing job" search page's card list, shown before the user types
// anything - lets a user jump straight to a job they (or a colleague) just
// created instead of re-typing its name/ref.
async function listRecentHiretrackJobs(days = 7) {
    const rows = await (0, hiretrack_odbc_read_1.runHiretrackOdbcRead)({
        operation: 'job-recent',
        days,
    });
    return rows.map((row) => ({
        jobNo: row.JobNo,
        jobRef: row.Job_Ref,
        jobTitle: row.Job_Title ?? null,
        clientName: row.Name ?? null,
        createdDate: row.CreatedDate,
    }));
}
// HireTrack NX's own "Jobs > Defaults" settings (Rules table) - read live
// (not hardcoded) so an admin's later change in HireTrack NX is picked up
// without a redeploy. Falls back to the confirmed-live production values
// (14:00/12:00/2 days) only if the Rules row is somehow missing, so the
// create-job form still has sane defaults rather than breaking.
async function getHiretrackJobDefaults() {
    const raw = await (0, hiretrack_odbc_read_1.runHiretrackOdbcRead)({
        operation: 'job-defaults',
        siteId: 1,
    });
    return {
        startTime: raw?.DefaultJobStartTime ?? '14:00:00',
        endTime: raw?.DefaultJobEndTime ?? '12:00:00',
        periodDays: raw?.DefaultJobPeriod ?? 2,
    };
}
// Active, non-crew Users - for the Sales Person picker.
async function listHiretrackUsers() {
    const rows = await (0, hiretrack_odbc_read_1.runHiretrackOdbcRead)({ operation: 'users-list' });
    return rows.map((row) => {
        const fullName = [row.FirstName, row.LastName].filter(Boolean).join(' ').trim();
        return { uid: row.UID, userName: row.UserName, displayName: fullName || row.UserName };
    });
}
// People (Name2 rows) previously linked to this client Company via any past
// job's CONTACTS row - CONTACTS has no standalone "company address book",
// every job gets its own row even when it's really the same real person
// reused (confirmed live), so this dedupes by Person.
async function listHiretrackClientContacts(clientId) {
    const rows = await (0, hiretrack_odbc_read_1.runHiretrackOdbcRead)({
        operation: 'client-contacts',
        clientId,
    });
    return rows.map((row) => ({
        personId: row.Person,
        fullName: row.FullName ?? null,
        telephone: row.Telephone ?? null,
        mobile: row.Mobile ?? null,
        email: row.EMAIL ?? null,
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
            eqlistTitle: eqlist.Eql_Title ?? null,
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
        dueOut: raw.dueOut ? normalizeHiretrackDateTime(raw.dueOut) : null,
        dueBack: raw.dueBack ? normalizeHiretrackDateTime(raw.dueBack) : null,
        eqlists,
    };
}
