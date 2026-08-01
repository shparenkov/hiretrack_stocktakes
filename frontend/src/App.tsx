import { useEffect, useState } from 'react';
import { createTicket, getTicketActivity, getTickets } from './api';
import { TicketActivityPanel } from './components/TicketActivityPanel';
import { TicketForm } from './components/TicketForm';
import { TicketList } from './components/TicketList';
import { TicketActivityRecord, TicketRecord } from './types';

export default function App() {
  const [tickets, setTickets] = useState<TicketRecord[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [activity, setActivity] = useState<TicketActivityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void reloadTickets();
  }, []);

  useEffect(() => {
    if (!selectedTicketId) {
      setActivity([]);
      return;
    }

    void getTicketActivity(selectedTicketId)
      .then(setActivity)
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : 'Failed to load activity.');
      });
  }, [selectedTicketId]);

  async function reloadTickets() {
    setLoading(true);
    setError(null);
    try {
      const items = await getTickets();
      setTickets(items);
      setSelectedTicketId((current) => current || items[0]?.id || null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to load tickets.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(payload: Parameters<typeof createTicket>[0]) {
    const created = await createTicket(payload);
    await reloadTickets();
    setSelectedTicketId(created.id);
    return created;
  }

  const selectedTicket = tickets.find((ticket) => ticket.id === selectedTicketId) || null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>HireTrack Service Tickets</h1>
          <p>MVP scaffold: create, list, and inspect local tickets.</p>
        </div>
        <button onClick={() => void reloadTickets()} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <main className="layout">
        <section className="panel">
          <TicketForm onCreate={handleCreate} />
        </section>

        <section className="panel panel-wide">
          <div className="panel-title">Tickets</div>
          <TicketList items={tickets} selectedTicketId={selectedTicketId} onSelect={setSelectedTicketId} />
        </section>

        <section className="panel">
          <TicketActivityPanel ticket={selectedTicket} items={activity} />
        </section>
      </main>
    </div>
  );
}
