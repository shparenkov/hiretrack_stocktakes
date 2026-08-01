import fs from 'fs';
import path from 'path';
import { renderDenseStocktakeHistoryPage } from './stocktake-history-page';

function resolveTicketsAppRoot() {
  const candidates = [
    path.resolve(__dirname, '..', '..', '..'),
    path.resolve(__dirname, '..', '..', '..', '..'),
  ];

  const matched = candidates.find((candidate) =>
    fs.existsSync(path.join(candidate, 'frontend'))
  );

  return matched || candidates[candidates.length - 1];
}

export function resolveTicketsFrontendDistPath() {
  return path.join(resolveTicketsAppRoot(), 'frontend', 'dist');
}

export function resolveTicketsFrontendIndexPath() {
  return path.join(resolveTicketsFrontendDistPath(), 'index.html');
}

export function renderBitrixTicketsAppShell(options: {
  uiPath: string;
  title?: string;
}) {
  const title = options.title || 'HireTrack Service Tickets';

  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #f3f2ee;
      font-family: Segoe UI, Arial, sans-serif;
    }
    .app-frame {
      border: 0;
      width: 100%;
      height: 100%;
      display: block;
      background: #f3f2ee;
    }
  </style>
  <script src="//api.bitrix24.com/api/v1/"></script>
</head>
<body>
  <iframe
    class="app-frame"
    src="${options.uiPath}"
    title="${title}"
    allow="camera *; microphone *; clipboard-read *; clipboard-write *"
  ></iframe>

  <script>
    (function () {
      if (!window.BX24 || typeof BX24.init !== 'function') {
        return;
      }

      BX24.init(function () {
        if (typeof BX24.installFinish === 'function') {
          BX24.installFinish();
        }
      });
    }());
  </script>
</body>
</html>`;
}

export function renderFrontendBuildMissingPage() {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tickets Frontend Build Missing</title>
  <style>
    body {
      margin: 0;
      padding: 24px;
      font-family: Segoe UI, Arial, sans-serif;
      background: #f6f4ec;
      color: #141414;
    }
    code {
      background: #ece7da;
      padding: 2px 6px;
      border-radius: 6px;
    }
  </style>
</head>
<body>
  <h1>Tickets frontend build is missing</h1>
  <p>Build the frontend before opening the Bitrix tickets app:</p>
  <p><code>npm.cmd run tickets:frontend:build</code></p>
</body>
</html>`;
}

export function renderStocktakeHistoryPage() {
  return renderDenseStocktakeHistoryPage();
}

function renderLegacyStocktakeHistoryPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>HireTrack Stock-Take History</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f3f1e8;
      --panel: #fffdf7;
      --line: #d8d1c0;
      --text: #1a1a16;
      --muted: #6d685d;
      --accent: #1f5f4a;
      --accent-soft: #ddebe3;
      --good: #1d6b3d;
      --good-soft: #dcefdc;
      --bad: #9a2b2b;
      --bad-soft: #f4dddd;
      --neutral: #6d685d;
      --neutral-soft: #ece6d7;
      --warn: #9b5a12;
      --warn-soft: #f7ead8;
      --info: #185b94;
      --info-soft: #dbe8f8;
      --error: #8f2d2d;
      --error-soft: #f3dddd;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px;
      background: linear-gradient(180deg, #efe9d8 0%, var(--bg) 100%);
      color: var(--text);
      font: 14px/1.4 Segoe UI, Arial, sans-serif;
    }
    .shell {
      max-width: 1400px;
      margin: 0 auto;
      display: grid;
      gap: 16px;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 16px;
      box-shadow: 0 10px 30px rgba(40, 34, 21, 0.06);
    }
    .hero {
      padding: 20px 22px;
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: end;
    }
    h1 {
      margin: 0 0 6px;
      font-size: 28px;
      line-height: 1.1;
    }
    p {
      margin: 0;
      color: var(--muted);
    }
    .controls {
      padding: 16px 22px 20px;
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      align-items: center;
    }
    label {
      display: grid;
      gap: 6px;
      color: var(--muted);
      font-size: 12px;
      letter-spacing: 0.03em;
      text-transform: uppercase;
    }
    select, input, button {
      font: inherit;
    }
    select, input {
      min-width: 160px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #fff;
      padding: 10px 12px;
      color: var(--text);
    }
    button {
      border: 0;
      border-radius: 999px;
      background: var(--accent);
      color: #fff;
      padding: 11px 16px;
      cursor: pointer;
    }
    button:disabled {
      opacity: 0.6;
      cursor: default;
    }
    .status {
      padding: 0 22px 18px;
      color: var(--muted);
    }
    .status.error {
      color: var(--error);
    }
    .summary {
      padding: 0 22px 18px;
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .pill {
      background: var(--neutral-soft);
      color: var(--neutral);
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 12px;
      font-weight: 600;
    }
    .pill.accent {
      background: var(--accent-soft);
      color: var(--accent);
    }
    .pill.good {
      background: var(--good-soft);
      color: var(--good);
    }
    .pill.bad {
      background: var(--bad-soft);
      color: var(--bad);
    }
    .pill.error {
      background: var(--error-soft);
      color: var(--error);
    }
    .summary-blocks {
      padding: 0 22px 18px;
      display: grid;
      grid-template-columns: repeat(7, minmax(160px, 1fr));
      gap: 12px;
    }
    .stat-card {
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 14px;
      background: #fff;
    }
    .stat-card.good {
      background: #f6fbf6;
      border-color: #cfe5cf;
    }
    .stat-card.bad {
      background: #fff6f6;
      border-color: #ebcaca;
    }
    .stat-card.warn {
      background: #fffaf3;
      border-color: #eddcc4;
    }
    .stat-card.info {
      background: #f4f8ff;
      border-color: #c9daf2;
    }
    .stat-card h3 {
      margin: 0 0 6px;
      font-size: 13px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .stat-card .value {
      font-size: 28px;
      font-weight: 700;
      line-height: 1;
      margin-bottom: 6px;
    }
    .stat-card .hint {
      color: var(--muted);
      font-size: 12px;
    }
    .table-wrap {
      overflow: auto;
      border-top: 1px solid var(--line);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 1260px;
    }
    th, td {
      padding: 10px 12px;
      border-bottom: 1px solid #ece6d7;
      text-align: left;
      vertical-align: top;
    }
    th {
      position: sticky;
      top: 0;
      background: #faf6ea;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    td small {
      color: var(--muted);
      display: block;
    }
    .mono {
      font-family: Consolas, Menlo, monospace;
      font-size: 12px;
    }
    .row-seen {
      background: #f7fcf8;
    }
    .row-unseen {
      background: #fff7f7;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 4px 8px;
      font-size: 12px;
      font-weight: 700;
      line-height: 1;
    }
    .badge.good {
      background: var(--good-soft);
      color: var(--good);
    }
    .badge.bad {
      background: var(--bad-soft);
      color: var(--bad);
    }
    .badge.neutral {
      background: var(--neutral-soft);
      color: var(--neutral);
    }
    .badge.warn {
      background: var(--warn-soft);
      color: var(--warn);
    }
    .badge.accent {
      background: var(--accent-soft);
      color: var(--accent);
    }
    .badge.info {
      background: var(--info-soft);
      color: var(--info);
    }
    .chip-list {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 8px;
      max-width: 700px;
    }
    .chip {
      display: grid;
      gap: 5px;
      align-content: start;
      border-radius: 12px;
      padding: 8px 10px;
      font-size: 12px;
      line-height: 1.3;
      border: 1px solid var(--line);
      background: #fff;
      min-height: 86px;
    }
    .chip.good {
      background: var(--good-soft);
      color: var(--good);
      border-color: #cae4ca;
    }
    .chip.bad {
      background: var(--bad-soft);
      color: var(--bad);
      border-color: #e8c9c9;
    }
    .chip.warn {
      background: var(--warn-soft);
      color: var(--warn);
      border-color: #ead3b4;
    }
    .chip.info {
      background: var(--info-soft);
      color: var(--info);
      border-color: #c9daf2;
    }
    .chip.accent {
      background: var(--accent-soft);
      color: var(--accent);
      border-color: #cce1d7;
    }
    .chip-head {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
    }
    .chip-status {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 2px 8px;
      background: rgba(255, 255, 255, 0.7);
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-size: 10px;
    }
    .chip-title {
      font-family: Consolas, Menlo, monospace;
      font-size: 12px;
      color: var(--text);
      word-break: break-word;
    }
    .chip-meta,
    .chip-trail {
      color: var(--muted);
      font-size: 11px;
    }
    .session-hint {
      padding: 0 22px 18px;
      color: var(--muted);
      font-size: 12px;
    }
    .muted-block {
      color: var(--muted);
      font-size: 12px;
    }
    .empty {
      padding: 28px 22px;
      color: var(--muted);
    }
    @media (max-width: 720px) {
      body { padding: 14px; }
      .hero { align-items: start; flex-direction: column; }
      .controls { padding-top: 0; }
      .summary-blocks { grid-template-columns: repeat(2, minmax(140px, 1fr)); }
    }
  </style>
</head>
<body>
  <div class="shell">
    <section class="panel">
      <div class="hero">
        <div>
          <h1>HireTrack Stock-Take History</h1>
          <p>Compare two stock-take sessions, exclude Sochi, and surface missing / written off / sold items.</p>
        </div>
      </div>
      <div class="controls">
        <label>
          Session State
          <select id="sessionState">
            <option value="all">All</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
        </label>
        <label>
          Exclude Warehouse
          <input id="warehouseExclude" type="text" value="Sochi" placeholder="Sochi">
        </label>
        <label>
          Latest Session
          <select id="latestSession"></select>
        </label>
        <label>
          Previous Session
          <select id="previousSession"></select>
        </label>
        <label>
          Type Filter
          <input id="typeFilter" type="text" placeholder="speaker, amp, etc">
        </label>
        <label>
          Item Filter
          <input id="itemFilter" type="text" placeholder="serial / barcode">
        </label>
        <label>
          Change Filter
          <select id="changeFilter">
            <option value="changes">Changes only</option>
            <option value="all">All</option>
            <option value="missing">Missing only</option>
            <option value="written_off">Written off only</option>
            <option value="sold">Sold only</option>
            <option value="found">Found in latest</option>
            <option value="new">New only</option>
          </select>
        </label>
        <label>
          Latest Seen
          <select id="seenFilter">
            <option value="all">All</option>
            <option value="seen">Seen in latest</option>
            <option value="unseen">Not seen in latest</option>
          </select>
        </label>
        <label>
          Item State
          <select id="itemStateFilter">
            <option value="all">All</option>
            <option value="active">Active only</option>
            <option value="inactive">Decommissioned only</option>
          </select>
        </label>
        <button id="refreshBtn" type="button">Load</button>
      </div>
      <div id="status" class="status">Ready.</div>
      <div id="summary" class="summary"></div>
      <div id="summaryBlocks" class="summary-blocks"></div>
      <div id="sessionHint" class="session-hint"></div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Warehouse</th>
              <th>Item</th>
              <th>Previous</th>
              <th>Latest</th>
              <th>Delta</th>
              <th>State</th>
              <th>Barcodes / Serials</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody id="rows"></tbody>
        </table>
      </div>
      <div id="empty" class="empty" hidden>No rows returned.</div>
    </section>
  </div>

  <script>
    const rowsEl = document.getElementById('rows');
    const emptyEl = document.getElementById('empty');
    const statusEl = document.getElementById('status');
    const summaryEl = document.getElementById('summary');
    const summaryBlocksEl = document.getElementById('summaryBlocks');
    const sessionHintEl = document.getElementById('sessionHint');
    const sessionStateEl = document.getElementById('sessionState');
    const warehouseExcludeEl = document.getElementById('warehouseExclude');
    const latestSessionEl = document.getElementById('latestSession');
    const previousSessionEl = document.getElementById('previousSession');
    const typeFilterEl = document.getElementById('typeFilter');
    const itemFilterEl = document.getElementById('itemFilter');
    const changeFilterEl = document.getElementById('changeFilter');
    const seenFilterEl = document.getElementById('seenFilter');
    const itemStateFilterEl = document.getElementById('itemStateFilter');
    const refreshBtn = document.getElementById('refreshBtn');
    let rawItems = [];

    function esc(value) {
      return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }

    function formatDate(value) {
      if (!value) return '';
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
    }

    function normalizeText(value) {
      return String(value ?? '').trim().toLowerCase();
    }

    function itemKey(item) {
      if (item.itemRef != null) {
        return 'itemref:' + item.itemRef;
      }
      const serial = normalizeText(item.serialNumber);
      const barcode = normalizeText(item.barcode);
      if (serial || barcode) {
        return 'code:' + serial + '|' + barcode;
      }
      return 'row:' + [item.stockTakeId, item.equipmentTypeId, item.serialNumber, item.barcode].join('|');
    }

    function formatSessionLabel(session) {
      if (!session) return '';
      const name = session.stockTakeTitle || ('StockTake #' + session.stockTakeId);
      const warehouse = session.warehouseName || 'n/a';
      return name + ' [' + warehouse + ']';
    }

    function sortSessions(items) {
      const sessions = new Map();
      for (const item of items) {
        if (item.stockTakeId == null) {
          continue;
        }
        if (!sessions.has(item.stockTakeId)) {
          sessions.set(item.stockTakeId, {
            stockTakeId: item.stockTakeId,
            stockTakeTitle: item.stockTakeTitle,
            stockTakeActive: item.stockTakeActive,
            startDate: item.startDate,
            inActiveDate: item.inActiveDate,
            warehouseName: item.warehouseName,
          });
        }
      }
      return Array.from(sessions.values()).sort((a, b) => {
        const aMoment = new Date(a.startDate || 0).getTime();
        const bMoment = new Date(b.startDate || 0).getTime();
        if (aMoment !== bMoment) {
          return bMoment - aMoment;
        }
        return Number(b.stockTakeId || 0) - Number(a.stockTakeId || 0);
      });
    }

    function getSelectedSessionId(selectEl) {
      const raw = String(selectEl.value || '').trim();
      return raw ? Number(raw) : null;
    }

    function populateSessionSelectors(items) {
      const sessions = sortSessions(items);
      const currentLatest = latestSessionEl.value;
      const currentPrevious = previousSessionEl.value;
      const options = sessions.map((session) => {
        return '<option value="' + esc(session.stockTakeId) + '">' + esc(formatSessionLabel(session)) + '</option>';
      }).join('');

      latestSessionEl.innerHTML = options;
      previousSessionEl.innerHTML = options;

      if (sessions.length > 0) {
        latestSessionEl.value = sessions.some((session) => String(session.stockTakeId) === currentLatest)
          ? currentLatest
          : String(sessions[0].stockTakeId);
      }

      if (sessions.length > 1) {
        const fallbackPrevious = sessions.find((session) => String(session.stockTakeId) !== latestSessionEl.value) || sessions[1];
        previousSessionEl.value = sessions.some((session) => String(session.stockTakeId) === currentPrevious && String(session.stockTakeId) !== latestSessionEl.value)
          ? currentPrevious
          : String(fallbackPrevious.stockTakeId);
      } else {
        previousSessionEl.value = '';
      }

      return sessions;
    }

    function matchesItemStateFilter(item, filterValue) {
      if (filterValue === 'active') {
        return item && item.currentItemState === 'active';
      }
      if (filterValue === 'inactive') {
        return item && item.currentItemState === 'inactive';
      }
      return true;
    }

    function classifyEntry(entry) {
      const base = entry.latest || entry.previous;
      const reason = base && base.disposalReason != null ? Number(base.disposalReason) : null;
      const droppedFromCoverage = !!entry.previous && !!entry.previousSeen && !entry.latestSeen;
      const leftLatest = !!entry.previous && !entry.latest;
      const changedDown = droppedFromCoverage || leftLatest;
      const foundAgain = !!entry.previous && !entry.previousSeen && !!entry.latestSeen;

      const sold = changedDown && reason === 6;
      const writtenOff = changedDown && !sold && (reason === 2 || reason === 3 || base.currentItemState === 'inactive');
      const missing = changedDown && !sold && !writtenOff;
      const isNew = !entry.previous && !!entry.latest;
      const stableSeen = !!entry.previousSeen && !!entry.latestSeen;
      const stableUnseen = !!entry.previous && !!entry.latest && !entry.previousSeen && !entry.latestSeen;

      if (sold) return 'sold';
      if (writtenOff) return 'written_off';
      if (missing) return 'missing';
      if (foundAgain) return 'found';
      if (isNew) return 'new';
      if (stableSeen) return 'stable_seen';
      if (stableUnseen) return 'stable_unseen';
      return 'stable';
    }

    function buildComparisonItems(items) {
      const latestId = getSelectedSessionId(latestSessionEl);
      const previousId = getSelectedSessionId(previousSessionEl);

      if (!latestId || !previousId || latestId === previousId) {
        return { sessions: sortSessions(items), latest: null, previous: null, entries: [] };
      }

      const sessions = sortSessions(items);
      const latestSession = sessions.find((session) => session.stockTakeId === latestId) || null;
      const previousSession = sessions.find((session) => session.stockTakeId === previousId) || null;
      const latestItems = items.filter((item) => item.stockTakeId === latestId);
      const previousItems = items.filter((item) => item.stockTakeId === previousId);
      const latestMap = new Map();
      const previousMap = new Map();

      latestItems.forEach((item) => latestMap.set(itemKey(item), item));
      previousItems.forEach((item) => previousMap.set(itemKey(item), item));

      const keys = Array.from(new Set([].concat(Array.from(latestMap.keys()), Array.from(previousMap.keys()))));
      const entries = keys.map((key) => {
        const latest = latestMap.get(key) || null;
        const previous = previousMap.get(key) || null;
        const base = latest || previous;
        return {
          key,
          latest,
          previous,
          latestSeen: !!(latest && latest.seenDate),
          previousSeen: !!(previous && previous.seenDate),
          currentItemState: base ? base.currentItemState : 'unknown',
          status: 'stable',
          itemRef: base ? base.itemRef : null,
          warehouseName: base ? base.warehouseName : null,
          equipmentTypeId: base ? base.equipmentTypeId : null,
          equipmentType: base ? base.equipmentType : null,
          serialNumber: base ? base.serialNumber : null,
          barcode: base ? base.barcode : null,
          notes: [base ? base.actionNotes : null, base ? base.actionedNotes : null, base ? base.disposalNotes : null].filter(Boolean),
          disposalReasonLabel: base ? base.disposalReasonLabel : null,
          latestSeenDate: latest ? latest.seenDate : null,
          previousSeenDate: previous ? previous.seenDate : null,
          latestSessionLabel: latestSession ? formatSessionLabel(latestSession) : '',
          previousSessionLabel: previousSession ? formatSessionLabel(previousSession) : '',
        };
      }).map((entry) => {
        entry.status = classifyEntry(entry);
        return entry;
      });

      return { sessions, latest: latestSession, previous: previousSession, entries };
    }

    function applyClientFilters(items) {
      const warehouseExclude = normalizeText(warehouseExcludeEl.value);
      const typeNeedle = (typeFilterEl.value || '').trim().toLowerCase();
      const itemNeedle = (itemFilterEl.value || '').trim().toLowerCase();
      const changeFilter = changeFilterEl.value || 'changes';
      const seenFilter = seenFilterEl.value || 'all';
      const itemStateFilter = itemStateFilterEl.value || 'all';

      return items.filter((item) => {
        const base = item.latest || item.previous;
        if (!base) {
          return false;
        }
        if (warehouseExclude && normalizeText(base.warehouseName) === warehouseExclude) {
          return false;
        }
        const hayType = (base.equipmentType || '').toLowerCase();
        const hayItem = [base.serialNumber, base.barcode, base.itemRef].filter(Boolean).join(' ').toLowerCase();
        const isSeen = !!item.latestSeen;

        if (typeNeedle && !hayType.includes(typeNeedle)) {
          return false;
        }
        if (itemNeedle && !hayItem.includes(itemNeedle)) {
          return false;
        }
        if (changeFilter === 'changes' && item.status === 'stable') {
          return false;
        }
        if (changeFilter !== 'all' && changeFilter !== 'changes' && item.status !== changeFilter) {
          return false;
        }
        if (seenFilter === 'seen' && !isSeen) {
          return false;
        }
        if (seenFilter === 'unseen' && isSeen) {
          return false;
        }
        if (!matchesItemStateFilter(base, itemStateFilter)) {
          return false;
        }
        return true;
      });
    }

    function summarizeEntries(entries) {
      return entries.reduce((acc, entry) => {
        acc.total += 1;
        if (entry.latestSeen) acc.latestSeen += 1;
        else acc.latestUnseen += 1;
        if (entry.currentItemState === 'active') acc.active += 1;
        if (entry.currentItemState === 'inactive') acc.inactive += 1;
        if (entry.status === 'missing') acc.missing += 1;
        if (entry.status === 'written_off') acc.writtenOff += 1;
        if (entry.status === 'sold') acc.sold += 1;
        if (entry.status === 'found') acc.found += 1;
        if (entry.status === 'new') acc.newItems += 1;
        return acc;
      }, {
        total: 0,
        latestSeen: 0,
        latestUnseen: 0,
        active: 0,
        inactive: 0,
        missing: 0,
        writtenOff: 0,
        sold: 0,
        found: 0,
        newItems: 0,
      });
    }

    function renderSummary(comparison, filteredEntries, sessionState) {
      const counts = summarizeEntries(filteredEntries);
      summaryEl.innerHTML = [
        '<span class="pill accent">mode: ' + esc(sessionState) + '</span>',
        comparison.latest ? '<span class="pill accent">latest: ' + esc(formatSessionLabel(comparison.latest)) + '</span>' : '',
        comparison.previous ? '<span class="pill accent">previous: ' + esc(formatSessionLabel(comparison.previous)) + '</span>' : '',
        '<span class="pill">compared items: ' + esc(counts.total) + '</span>',
        '<span class="pill good">seen in latest: ' + esc(counts.latestSeen) + '</span>',
        '<span class="pill bad">not seen in latest: ' + esc(counts.latestUnseen) + '</span>',
        '<span class="pill good">active items: ' + esc(counts.active) + '</span>',
        '<span class="pill bad">decommissioned: ' + esc(counts.inactive) + '</span>',
      ].filter(Boolean).join('');

      summaryBlocksEl.innerHTML = [
        '<div class="stat-card bad"><h3>Missing</h3><div class="value">' + esc(counts.missing) + '</div><div class="hint">seen before, not seen now, no sale / write-off signal</div></div>',
        '<div class="stat-card warn"><h3>Written Off</h3><div class="value">' + esc(counts.writtenOff) + '</div><div class="hint">dropped from coverage and now inactive / disposed</div></div>',
        '<div class="stat-card"><h3>Sold</h3><div class="value">' + esc(counts.sold) + '</div><div class="hint">disposal reason is sold</div></div>',
        '<div class="stat-card info"><h3>Found Again</h3><div class="value">' + esc(counts.found) + '</div><div class="hint">not seen before, but seen in latest stock-take</div></div>',
        '<div class="stat-card good"><h3>Seen Latest</h3><div class="value">' + esc(counts.latestSeen) + '</div><div class="hint">green chips in selected latest stock-take</div></div>',
        '<div class="stat-card bad"><h3>Not Seen Latest</h3><div class="value">' + esc(counts.latestUnseen) + '</div><div class="hint">red chips in selected latest stock-take</div></div>',
        '<div class="stat-card"><h3>New vs Previous</h3><div class="value">' + esc(counts.newItems) + '</div><div class="hint">exists in latest but not previous</div></div>',
      ].join('');
    }

    function entryBadgeClass(status) {
      if (status === 'missing') return 'bad';
      if (status === 'written_off') return 'warn';
      if (status === 'sold') return 'accent';
      if (status === 'found') return 'info';
      if (status === 'new') return 'good';
      if (status === 'stable_seen') return 'good';
      if (status === 'stable_unseen') return 'neutral';
      return 'neutral';
    }

    function entryStatusLabel(entry) {
      if (entry.status === 'missing') return 'Missing';
      if (entry.status === 'written_off') return 'Written Off';
      if (entry.status === 'sold') return 'Sold';
      if (entry.status === 'found') return 'Found Again';
      if (entry.status === 'new') return 'New';
      if (entry.status === 'stable_seen') return 'Seen Both';
      if (entry.status === 'stable_unseen') return 'Unseen Both';
      return 'Stable';
    }

    function entryChangeInventoryLabel(entry) {
      if (entry.status === 'stable' || entry.status === 'stable_seen' || entry.status === 'stable_unseen') {
        return 'No status change between selected inventories';
      }
      return 'Change captured in: ' + (entry.latestSessionLabel || 'latest inventory');
    }

    function entryTrailText(entry) {
      const previousLabel = entry.previousSessionLabel || 'previous inventory';
      const latestLabel = entry.latestSessionLabel || 'latest inventory';
      const reasonText = entry.disposalReasonLabel ? ' Reason: ' + entry.disposalReasonLabel + '.' : '';

      if (entry.status === 'missing') {
        return 'Seen in ' + previousLabel + ', then not seen in ' + latestLabel + '.' + reasonText;
      }
      if (entry.status === 'written_off') {
        return 'Present in ' + previousLabel + ', then became inactive by ' + latestLabel + '.' + reasonText;
      }
      if (entry.status === 'sold') {
        return 'Present in ' + previousLabel + ', then marked as sold by ' + latestLabel + '.' + reasonText;
      }
      if (entry.status === 'found') {
        return 'Not seen in ' + previousLabel + ', then seen again in ' + latestLabel + '.';
      }
      if (entry.status === 'new') {
        return 'Absent in ' + previousLabel + ', first appears in ' + latestLabel + '.';
      }
      if (entry.status === 'stable_seen') {
        return 'Seen in both ' + previousLabel + ' and ' + latestLabel + '.';
      }
      if (entry.status === 'stable_unseen') {
        return 'Not seen in either ' + previousLabel + ' or ' + latestLabel + '.';
      }
      return 'Tracked across ' + previousLabel + ' and ' + latestLabel + ' without a classified movement.';
    }

    function entryStateLabel(entry) {
      if (entry.currentItemState === 'active') {
        return 'Current item state: active';
      }
      if (entry.currentItemState === 'inactive') {
        return 'Current item state: inactive';
      }
      return 'Current item state: unknown';
    }

    function renderEntryChip(entry) {
      const label = [entry.serialNumber, entry.barcode].filter(Boolean).join(' / ') || ('Item ' + (entry.itemRef ?? ''));
      const meta = [entryChangeInventoryLabel(entry), entryStateLabel(entry)].filter(Boolean).join(' • ');
      return '<div class="chip ' + entryBadgeClass(entry.status) + '">' +
        '<div class="chip-head">' +
          '<span class="chip-status">' + esc(entryStatusLabel(entry)) + '</span>' +
          (entry.disposalReasonLabel ? '<span class="badge neutral">' + esc(entry.disposalReasonLabel) + '</span>' : '') +
        '</div>' +
        '<div class="chip-title">' + esc(label) + '</div>' +
        '<div class="chip-meta">' + esc([entryChangeInventoryLabel(entry), entryStateLabel(entry)].filter(Boolean).join(' | ')) + '</div>' +
        '<div class="chip-trail">' + esc(entryTrailText(entry)) + '</div>' +
      '</div>';
    }

    function groupComparisonEntries(entries) {
      const groups = new Map();
      for (const entry of entries) {
        const key = [entry.warehouseName || '', entry.equipmentTypeId || 'na'].join('|');
        if (!groups.has(key)) {
          groups.set(key, {
            warehouseName: entry.warehouseName,
            equipmentType: entry.equipmentType,
            equipmentTypeId: entry.equipmentTypeId,
            previousSeen: 0,
            previousTotal: 0,
            latestSeen: 0,
            latestTotal: 0,
            activeCount: 0,
            inactiveCount: 0,
            missingCount: 0,
            writtenOffCount: 0,
            soldCount: 0,
            foundCount: 0,
            newCount: 0,
            entries: [],
            notes: [],
          });
        }

        const group = groups.get(key);
        group.entries.push(entry);
        if (entry.previous) group.previousTotal += 1;
        if (entry.latest) group.latestTotal += 1;
        if (entry.previousSeen) group.previousSeen += 1;
        if (entry.latestSeen) group.latestSeen += 1;
        if (entry.currentItemState === 'active') group.activeCount += 1;
        if (entry.currentItemState === 'inactive') group.inactiveCount += 1;
        if (entry.status === 'missing') group.missingCount += 1;
        if (entry.status === 'written_off') group.writtenOffCount += 1;
        if (entry.status === 'sold') group.soldCount += 1;
        if (entry.status === 'found') group.foundCount += 1;
        if (entry.status === 'new') group.newCount += 1;
        entry.notes.forEach((note) => {
          if (!group.notes.includes(note)) {
            group.notes.push(note);
          }
        });
      }

      return Array.from(groups.values()).sort((a, b) => {
        const deltaA = a.missingCount + a.writtenOffCount + a.soldCount + a.foundCount + a.newCount;
        const deltaB = b.missingCount + b.writtenOffCount + b.soldCount + b.foundCount + b.newCount;
        if (deltaA !== deltaB) {
          return deltaB - deltaA;
        }
        return String(a.equipmentType || '').localeCompare(String(b.equipmentType || ''));
      });
    }

    function renderRows(groups) {
      rowsEl.innerHTML = groups.map((group) => {
        const rowClass = group.missingCount > 0 ? 'row-unseen' : 'row-seen';
        const notesText = group.notes.slice(0, 4).map((note) => '<small>' + esc(note) + '</small>').join('');
        return '<tr class="' + rowClass + '">' +
          '<td>' + esc(group.warehouseName || '') + '</td>' +
          '<td><strong>' + esc(group.equipmentType || '') + '</strong><small>type ' + esc(group.equipmentTypeId) + '</small><small>' + esc(group.entries.length) + ' compared item(s)</small></td>' +
          '<td><span class="badge neutral">Seen ' + esc(group.previousSeen) + '</span> <span class="badge neutral">Total ' + esc(group.previousTotal) + '</span></td>' +
          '<td><span class="badge good">Seen ' + esc(group.latestSeen) + '</span> <span class="badge bad">Total ' + esc(group.latestTotal) + '</span></td>' +
          '<td>' +
            '<span class="badge bad">Missing ' + esc(group.missingCount) + '</span> ' +
            '<span class="badge warn">Written off ' + esc(group.writtenOffCount) + '</span> ' +
            '<span class="badge accent">Sold ' + esc(group.soldCount) + '</span> ' +
            '<span class="badge info">Found ' + esc(group.foundCount) + '</span> ' +
            '<span class="badge good">New ' + esc(group.newCount) + '</span>' +
          '</td>' +
          '<td>' +
            '<span class="badge good">Active ' + esc(group.activeCount) + '</span> ' +
            '<span class="badge bad">Inactive ' + esc(group.inactiveCount) + '</span>' +
          '</td>' +
          '<td><div class="chip-list">' + group.entries.map(renderEntryChip).join('') + '</div></td>' +
          '<td><div class="muted-block">' + notesText + '</div></td>' +
        '</tr>';
      }).join('');
    }

    function renderFilteredView() {
      const warehouseExclude = normalizeText(warehouseExcludeEl.value);
      const baseItems = rawItems.filter((item) => {
        return !warehouseExclude || normalizeText(item.warehouseName) !== warehouseExclude;
      });
      const sessions = populateSessionSelectors(baseItems);

      if (sessions.length < 2) {
        summaryEl.innerHTML = '<span class="pill error">Need at least two stock-take sessions after warehouse filter.</span>';
        summaryBlocksEl.innerHTML = '';
        sessionHintEl.textContent = sessions.length === 1
          ? 'Only one session is available after excluding the selected warehouse.'
          : 'No stock-take sessions are available after excluding the selected warehouse.';
        rowsEl.innerHTML = '';
        emptyEl.hidden = false;
        statusEl.textContent = 'Loaded ' + rawItems.length + ' raw row(s); waiting for two comparable sessions.';
        return;
      }

      const comparison = buildComparisonItems(baseItems);
      const filteredEntries = applyClientFilters(comparison.entries);
      const groupedEntries = groupComparisonEntries(filteredEntries);

      renderSummary(comparison, filteredEntries, sessionStateEl.value || 'all');
      renderRows(groupedEntries);
      emptyEl.hidden = groupedEntries.length > 0;
      sessionHintEl.textContent =
        'Comparing ' + formatSessionLabel(comparison.latest) +
        ' against ' + formatSessionLabel(comparison.previous) +
        '. Warehouse filter excludes: ' + (warehouseExcludeEl.value || 'none') + '.';
      statusEl.textContent =
        'Loaded ' + rawItems.length + ' raw row(s), ' +
        baseItems.length + ' remain after warehouse filter, ' +
        filteredEntries.length + ' compared item(s), ' +
        groupedEntries.length + ' compact row(s) after filters.';
    }

    async function loadRows() {
      const sessionState = sessionStateEl.value || 'all';
        refreshBtn.disabled = true;
        statusEl.className = 'status';
        statusEl.textContent = 'Loading...';
      summaryEl.innerHTML = '';
      summaryBlocksEl.innerHTML = '';
      emptyEl.hidden = true;
      rowsEl.innerHTML = '';

      try {
        const search = new URLSearchParams({
          sessionState,
        });
        const response = await fetch('/api/tickets/lookups/stocktake-history?' + search.toString());
        const payload = await response.json();
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || ('HTTP ' + response.status));
        }

        rawItems = payload.items || [];
        renderFilteredView();
      } catch (error) {
        summaryEl.innerHTML = '<span class="pill error">service error</span>';
        summaryBlocksEl.innerHTML = '';
        sessionHintEl.textContent = '';
        statusEl.className = 'status error';
        statusEl.textContent = error instanceof Error ? error.message : String(error);
      } finally {
        refreshBtn.disabled = false;
      }
    }

    refreshBtn.addEventListener('click', loadRows);
    warehouseExcludeEl.addEventListener('input', renderFilteredView);
    latestSessionEl.addEventListener('change', renderFilteredView);
    previousSessionEl.addEventListener('change', renderFilteredView);
    typeFilterEl.addEventListener('input', renderFilteredView);
    itemFilterEl.addEventListener('input', renderFilteredView);
    changeFilterEl.addEventListener('change', renderFilteredView);
    seenFilterEl.addEventListener('change', renderFilteredView);
    itemStateFilterEl.addEventListener('change', renderFilteredView);
    loadRows();
  </script>
</body>
</html>`;
}
