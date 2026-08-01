export function buildTicketNumber(sequence: number, now = new Date()): string {
  const year = now.getUTCFullYear();
  const padded = String(sequence).padStart(4, '0');
  return `SC-${year}-${padded}`;
}
