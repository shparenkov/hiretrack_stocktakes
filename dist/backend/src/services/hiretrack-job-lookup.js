"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lookupHiretrackJob = lookupHiretrackJob;
const hiretrack_odbc_read_1 = require("./hiretrack-odbc-read");
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
