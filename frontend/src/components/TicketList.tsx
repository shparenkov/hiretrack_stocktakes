import { TicketRecord } from '../types';

interface TicketListProps {
  items: TicketRecord[];
  selectedTicketId: string | null;
  onSelect: (ticketId: string) => void;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function syncClass(state: TicketRecord['syncBitrixState']) {
  if (state === 'ok') {
    return 'sync sync-ok';
  }
  if (state === 'error') {
    return 'sync sync-error';
  }
  return 'sync sync-pending';
}

function renderHiretrackStatus(ticket: TicketRecord) {
  if (ticket.syncHiretrackState === 'ok' && ticket.hiretrackTicketId) {
    return `Logged Fault #${ticket.hiretrackTicketId}`;
  }

  if (ticket.syncHiretrackState === 'error') {
    return 'error';
  }

  return ticket.syncHiretrackState;
}

export function TicketList({ items, selectedTicketId, onSelect }: TicketListProps) {
  if (items.length === 0) {
    return <div className="empty-panel">No tickets yet.</div>;
  }

  return (
    <div className="table-wrap">
      <table className="tickets-table">
        <thead>
          <tr>
            <th>Ticket</th>
            <th>Status</th>
            <th>Equipment</th>
            <th>Serial</th>
            <th>Client</th>
            <th>Received</th>
            <th>Bitrix</th>
            <th>HireTrack</th>
          </tr>
        </thead>
        <tbody>
          {items.map((ticket) => (
            <tr
              key={ticket.id}
              className={ticket.id === selectedTicketId ? 'is-selected' : undefined}
              onClick={() => onSelect(ticket.id)}
            >
              <td>
                <div className="ticket-number">{ticket.ticketNumber}</div>
                <div className="ticket-priority">{ticket.priority}</div>
              </td>
              <td>{ticket.status}</td>
              <td>{ticket.equipmentName}</td>
              <td>{ticket.serialNumber}</td>
              <td>{ticket.clientName || '-'}</td>
              <td>{formatDate(ticket.receivedAt)}</td>
              <td>
                <span className={syncClass(ticket.syncBitrixState)}>{ticket.syncBitrixState}</span>
              </td>
              <td>
                <span className={syncClass(ticket.syncHiretrackState)}>{renderHiretrackStatus(ticket)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
