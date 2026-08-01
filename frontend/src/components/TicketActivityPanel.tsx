import { TicketActivityRecord, TicketRecord } from '../types';

interface TicketActivityPanelProps {
  ticket: TicketRecord | null;
  items: TicketActivityRecord[];
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

export function TicketActivityPanel({ ticket, items }: TicketActivityPanelProps) {
  if (!ticket) {
    return <div className="empty-panel">Select a ticket to view activity.</div>;
  }

  return (
    <div className="activity-panel">
      <div className="activity-header">
        <h2>{ticket.ticketNumber}</h2>
        <div className="activity-subtitle">
          {ticket.equipmentName} · {ticket.serialNumber}
        </div>
      </div>

      <div className="ticket-summary">
        <div>
          <strong>Status:</strong> {ticket.status}
        </div>
        <div>
          <strong>HireTrack:</strong>{' '}
          {ticket.syncHiretrackState === 'ok' && ticket.hiretrackTicketId
            ? `Logged Fault #${ticket.hiretrackTicketId}`
            : ticket.syncHiretrackState}
        </div>
        <div>
          <strong>Client:</strong> {ticket.clientName || '-'}
        </div>
        <div>
          <strong>Fault:</strong> {ticket.faultDescription}
        </div>
      </div>

      {ticket.syncHiretrackError ? (
        <div className="detail-warning">
          <strong>HireTrack error:</strong> {ticket.syncHiretrackError}
        </div>
      ) : null}

      <div className="activity-list">
        {items.length === 0 ? (
          <div className="empty-panel">No activity yet.</div>
        ) : (
          items.map((item) => (
            <div key={item.id} className="activity-item">
              <div className="activity-meta">
                <span>{item.type}</span>
                <span>{formatDate(item.createdAt)}</span>
              </div>
              <div>{item.message}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
