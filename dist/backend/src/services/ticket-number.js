"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildTicketNumber = buildTicketNumber;
function buildTicketNumber(sequence, now = new Date()) {
    const year = now.getUTCFullYear();
    const padded = String(sequence).padStart(4, '0');
    return `SC-${year}-${padded}`;
}
