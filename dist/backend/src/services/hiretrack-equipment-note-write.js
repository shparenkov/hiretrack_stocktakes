"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEquipmentNoteWithLines = createEquipmentNoteWithLines;
const hiretrack_odbc_write_1 = require("./hiretrack-odbc-write");
async function createEquipmentNoteWithLines(input) {
    const { noteId } = await (0, hiretrack_odbc_write_1.runHiretrackOdbcWrite)({
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
    const failedLines = [];
    // Sequential on purpose: rider line counts are small (tens, not thousands),
    // and this keeps each line's failure isolated and reported rather than
    // aborting the whole note on the first bad line.
    for (const line of input.lines) {
        try {
            await (0, hiretrack_odbc_write_1.runHiretrackOdbcWrite)({
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
        }
        catch (error) {
            failedLines.push({
                eqtype: line.eqtype,
                error: error instanceof Error ? error.message : 'add-note-line failed',
            });
        }
    }
    return { noteId, linesWritten, failedLines };
}
