"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderDenseStocktakeHistoryPage = renderDenseStocktakeHistoryPage;
function renderDenseStocktakeHistoryPage() {
    return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Stock Check</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #18212b;
      --muted: #687485;
      --line: #cfd7e1;
      --line-strong: #aeb9c6;
      --paper: #ffffff;
      --canvas: #eef2f5;
      --navy: #173f72;
      --navy-2: #245c9b;
      --blue-row: #d9eef7;
      --yellow-row: #fff2bd;
      --sand-row: #f6e3bd;
      --peach-row: #f7d0b8;
      --red-row: #efb6a5;
      --grey-row: #e3e8ee;
      --selected: #0d78c8;
      --good: #24733f;
      --bad: #a12e25;
      --warn: #9a5b00;
    }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; }
    body {
      margin: 0;
      color: var(--ink);
      background: var(--canvas);
      font: 13px/1.3 "Arial Narrow", "Segoe UI", Arial, sans-serif;
    }
    button, input, select { font: inherit; }
    .app { width: 100%; height: 100vh; display: grid; grid-template-rows: auto auto minmax(0, 1fr); }
    .topbar {
      min-height: 48px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 8px 14px;
      color: #fff;
      background: var(--navy);
      border-bottom: 3px solid #0e2c51;
    }
    .topbar h1 { margin: 0; font-size: 18px; font-weight: 650; letter-spacing: .01em; }
    .topbar .sub { margin-left: 10px; color: #c9d8e9; font-size: 12px; font-weight: 400; }
    .top-actions { display: flex; align-items: center; gap: 10px; }
    .status { color: #d7e3f1; font-size: 12px; white-space: nowrap; }
    .status.error { color: #ffd0ca; }
    .refresh {
      border: 1px solid #7ea3c9;
      border-radius: 3px;
      padding: 6px 12px;
      color: #fff;
      background: #285e98;
      cursor: pointer;
    }
    .refresh:disabled { opacity: .55; cursor: default; }
    .report-panel { position: fixed; inset: 0; z-index: 20; display: grid; grid-template-rows: auto auto minmax(0, 1fr); color: var(--ink); background: #fff; }
    .report-panel[hidden] { display: none; }
    .report-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 14px; color: #fff; background: var(--navy); }
    .report-toolbar h2 { margin: 0; font-size: 17px; }
    .report-actions { display: flex; gap: 8px; }
    .report-summary { padding: 8px 14px; color: #4f5d6d; border-bottom: 1px solid var(--line); background: #f6f8fa; }
    .report-scroll { min-height: 0; overflow: auto; }
    .report-table { table-layout: fixed; }
    .report-table th { position: sticky; }
    .report-table td { height: auto; min-height: 25px; white-space: normal; vertical-align: top; }
    .report-table tr.problem-repair td { background: #fff2bd; }
    .report-table tr.problem-missing td { background: #f7d0b8; }
    .report-table tr.problem-inactive td { background: #e3e8ee; }
    .filters {
      display: flex;
      align-items: end;
      flex-wrap: wrap;
      gap: 8px 14px;
      padding: 9px 14px 10px;
      background: #f8fafc;
      border-bottom: 1px solid var(--line-strong);
    }
    .field { display: grid; gap: 3px; min-width: 150px; }
    .field.category { min-width: 330px; flex: 1; max-width: 560px; }
    .field label { color: #536172; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .035em; }
    select, input[type="search"] {
      height: 30px;
      border: 1px solid var(--line-strong);
      border-radius: 2px;
      padding: 4px 8px;
      color: var(--ink);
      background: #fff;
      outline: none;
    }
    select:focus, input:focus { border-color: var(--selected); box-shadow: 0 0 0 1px var(--selected); }
    .check { display: flex; align-items: center; gap: 6px; height: 30px; color: #485566; white-space: nowrap; }
    .workspace { min-height: 0; overflow: hidden; display: grid; grid-template-columns: minmax(640px, 1.75fr) minmax(430px, 1fr); gap: 1px; background: var(--line-strong); }
    .pane { min-width: 0; min-height: 0; background: var(--paper); overflow: hidden; display: grid; grid-template-rows: auto minmax(0, 1fr); }
    .section-head {
      min-height: 33px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 6px 10px;
      color: #fff;
      background: var(--navy-2);
      border-bottom: 1px solid #143f70;
    }
    .section-title { font-weight: 700; }
    .section-meta { font-size: 11px; color: #d9e7f5; }
    .scroll { min-height: 0; overflow: auto; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border-right: 1px solid #b9c3ce; border-bottom: 1px solid #b9c3ce; padding: 4px 6px; overflow: hidden; text-overflow: ellipsis; }
    th {
      position: sticky;
      top: 0;
      z-index: 2;
      color: #fff;
      background: var(--navy-2);
      font-size: 11px;
      font-weight: 600;
      line-height: 1.15;
      text-align: center;
      white-space: normal;
    }
    th[data-sort-section] { position: sticky; padding-right: 18px; cursor: pointer; user-select: none; }
    th[data-sort-section]::after { content: '↕'; position: absolute; right: 5px; top: 50%; transform: translateY(-50%); color: #a9c5e2; font-size: 10px; }
    th[data-sort-section].sort-asc::after { content: '▲'; color: #fff; }
    th[data-sort-section].sort-desc::after { content: '▼'; color: #fff; }
    th[data-sort-section]:hover { background: #3472b2; }
    td { white-space: nowrap; height: 26px; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; }
    td.code { font-family: Consolas, "Courier New", monospace; font-size: 12px; }
    .inventory-table th:first-child { text-align: left; }
    .inventory-table tbody tr { cursor: pointer; }
    .inventory-table tbody tr:hover td { box-shadow: inset 0 0 0 999px rgba(255,255,255,.24); }
    .inventory-table tr.level-ok td { background: var(--blue-row); }
    .inventory-table tr.level-minor td { background: var(--yellow-row); }
    .inventory-table tr.level-zero td { background: var(--sand-row); }
    .inventory-table tr.level-low td { background: var(--peach-row); }
    .inventory-table tr.level-critical td { background: var(--red-row); }
    .inventory-table tr.level-excess td { background: var(--grey-row); }
    .inventory-table tr.selected td { color: #fff; background: var(--selected); }
    .inventory-table tr.selected td .mark { border-color: rgba(255,255,255,.8); color: #fff; background: rgba(255,255,255,.14); }
    .desc { font-weight: 600; }
    .type-id { margin-left: 6px; color: #667384; font-size: 10px; font-weight: 400; }
    tr.selected .type-id { color: #dcecff; }
    .mark { display: inline-block; min-width: 19px; padding: 1px 4px; border: 1px solid rgba(65,75,85,.27); border-radius: 2px; text-align: center; font-weight: 700; }
    .mark.bad { color: var(--bad); background: rgba(255,255,255,.45); }
    .mark.good { color: var(--good); background: rgba(255,255,255,.45); }
    .mark.warn { color: var(--warn); background: rgba(255,255,255,.45); }
    .empty { padding: 24px; color: var(--muted); text-align: center; }
    .detail-pane { grid-template-rows: auto minmax(220px, 1.15fr) auto minmax(170px, .85fr); }
    .units-scroll, .events-scroll { min-height: 0; overflow: auto; }
    .units-table tbody tr { cursor: pointer; }
    .units-table tbody tr:hover td { background: #edf6fd; }
    .units-table tr.selected td { color: #fff; background: var(--selected); }
    .units-table tbody tr.selected:hover td { color: #fff; background: var(--selected); }
    .units-table tr.on-job-unseen td { background: #fff0c2; }
    .units-table tr.on-job-unseen td:first-child { box-shadow: inset 4px 0 #d17a00; }
    .units-table tr.on-job-unseen:hover td { background: #ffe5a0; }
    .units-table tr.on-job-unseen.selected td,
    .units-table tbody tr.on-job-unseen.selected:hover td { color: #fff; background: #8a5700; }
    .state-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 5px; vertical-align: 1px; background: #7b8794; }
    .state-dot.good { background: #2d8b4e; }
    .state-dot.bad { background: #c03a2b; }
    .state-dot.warn { background: #d18a12; }
    .state-dot.info { background: #2c7fbd; }
    .event-table td { height: auto; min-height: 28px; white-space: normal; vertical-align: top; }
    .event-kind { font-weight: 700; color: var(--navy); }
    .event-ref { font-family: Consolas, "Courier New", monospace; }
    .event-note { display: block; margin-top: 2px; color: var(--muted); font-size: 11px; }
    .status-note { display: block; margin-top: 3px; color: var(--muted); font-size: 10px; line-height: 1.2; }
    .units-table .status-note { white-space: normal; }
    .status-note.alert { color: #8c4300; font-weight: 800; letter-spacing: .02em; text-transform: uppercase; }
    .units-table tr.selected .status-note { color: #dbeaff; }
    .units-table tr.on-job-unseen.selected .status-note.alert { color: #fff1ad; }
    .legend {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 12px;
      padding: 6px 10px;
      border-top: 1px solid var(--line);
      background: #f8fafc;
      color: #536172;
      font-size: 11px;
    }
    .swatch { display: inline-block; width: 13px; height: 11px; margin-right: 4px; border: 1px solid #9aa7b4; vertical-align: -1px; }
    .w-ok { background: var(--blue-row); } .w-minor { background: var(--yellow-row); } .w-zero { background: var(--sand-row); }
    .w-low { background: var(--peach-row); } .w-critical { background: var(--red-row); }
    @media (max-width: 1050px) {
      html, body { height: auto; min-height: 100%; overflow: auto; }
      .app { height: auto; min-height: 100vh; }
      .workspace { grid-template-columns: 1fr; grid-template-rows: minmax(430px, 58vh) minmax(520px, auto); }
      .detail-pane { min-height: 520px; }
    }
    @media (max-width: 640px) {
      .topbar { align-items: flex-start; }
      .topbar .sub { display: none; }
      .status { display: none; }
      .field, .field.category { min-width: 100%; max-width: none; }
      .workspace { display: block; }
      .pane { min-height: 520px; margin-bottom: 1px; }
      .inventory-table { min-width: 900px; }
      .detail-pane { min-height: 650px; }
    }
    @media print {
      @page { size: A4 landscape; margin: 9mm; }
      html, body { width: auto; height: auto; overflow: visible; background: #fff; font-size: 9pt; }
      .app { display: none !important; }
      .report-panel { position: static; display: block !important; }
      .report-toolbar { padding: 0 0 6mm; color: #000; background: transparent; border-bottom: 1px solid #000; }
      .report-toolbar h2 { font-size: 15pt; }
      .report-actions { display: none; }
      .report-summary { padding: 3mm 0; color: #000; background: transparent; }
      .report-scroll { overflow: visible; }
      .report-table { table-layout: fixed; }
      .report-table th { position: static; color: #fff; background: #173f72 !important; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      .report-table tr { break-inside: avoid; }
      .report-table tr.problem-repair td, .report-table tr.problem-missing td, .report-table tr.problem-inactive td { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <main class="app">
    <header class="topbar">
      <h1>Stock Check <span class="sub">история и расхождения по инвентаризациям</span></h1>
      <div class="top-actions"><span id="status" class="status">Загрузка...</span><button id="problemReportOpen" class="refresh" type="button" disabled>Проблемы / PDF</button><button id="refresh" class="refresh" type="button">Обновить</button></div>
    </header>
    <section class="filters" aria-label="Фильтры">
      <div class="field category"><label for="category">MasterCat / Category</label><select id="category"></select></div>
      <div class="field"><label for="latest">Текущая инвентаризация</label><select id="latest"></select></div>
      <div class="field"><label for="previous">Предыдущая</label><select id="previous"></select></div>
      <div class="field"><label for="search">Поиск</label><input id="search" type="search" placeholder="описание / barcode / serial"></div>
      <label class="check"><input id="hideZero" type="checkbox"> скрыть строки без штрихкодов</label>
    </section>
    <section class="workspace">
      <section class="pane">
        <div class="section-head"><span class="section-title">Состав категории</span><span id="inventoryMeta" class="section-meta"></span></div>
        <div class="scroll">
          <table class="inventory-table">
            <colgroup><col style="width:34%"><col style="width:7%"><col style="width:7%"><col style="width:7%"><col style="width:7%"><col style="width:8%"><col style="width:8%"><col style="width:8%"><col style="width:7%"><col style="width:7%"></colgroup>
            <thead><tr><th data-sort-section="inventory" data-sort-key="equipmentType">Описание</th><th data-sort-section="inventory" data-sort-key="total">Всего</th><th data-sort-section="inventory" data-sort-key="barcoded">Barcode</th><th data-sort-section="inventory" data-sort-key="active">Активно</th><th data-sort-section="inventory" data-sort-key="repair">Ремонт</th><th data-sort-section="inventory" data-sort-key="previousSeen">Видели<br>ранее</th><th data-sort-section="inventory" data-sort-key="latestSeen">Видели<br>сейчас</th><th data-sort-section="inventory" data-sort-key="notSeen">Не видели</th><th data-sort-section="inventory" data-sort-key="writtenOff">Списано</th><th data-sort-section="inventory" data-sort-key="sold">Продано</th></tr></thead>
            <tbody id="inventoryRows"></tbody>
          </table>
          <div id="inventoryEmpty" class="empty" hidden>В выбранной категории нет строк.</div>
        </div>
        <div class="legend">
          <span><i class="swatch w-ok"></i>все активные найдены</span>
          <span><i class="swatch w-minor"></i>не найдено 1–2</span>
          <span><i class="swatch w-zero"></i>нет активного остатка</span>
          <span><i class="swatch w-low"></i>не найдено менее 10%</span>
          <span><i class="swatch w-critical"></i>не найдено 10% и более</span>
        </div>
      </section>
      <aside class="pane detail-pane">
        <div class="section-head"><span id="unitsTitle" class="section-title">Единицы оборудования</span><span id="unitsMeta" class="section-meta">выберите строку слева</span></div>
        <div class="units-scroll">
          <table class="units-table">
            <colgroup><col style="width:17%"><col style="width:21%"><col style="width:18%"><col style="width:24%"><col style="width:20%"></colgroup>
            <thead><tr><th data-sort-section="units" data-sort-key="barcode">Barcode</th><th data-sort-section="units" data-sort-key="serial">Serial</th><th data-sort-section="units" data-sort-key="inventoryStatus">Инвентаризация</th><th data-sort-section="units" data-sort-key="currentLocation">Текущее положение</th><th data-sort-section="units" data-sort-key="lastSeen">Последнее наблюдение</th></tr></thead>
            <tbody id="unitRows"></tbody>
          </table>
          <div id="unitsEmpty" class="empty">Выберите тип оборудования.</div>
        </div>
        <div class="section-head"><span id="eventsTitle" class="section-title">История перемещений HireTrack</span><span id="eventsMeta" class="section-meta"></span></div>
        <div class="events-scroll">
          <table class="event-table">
            <colgroup><col style="width:23%"><col style="width:22%"><col style="width:25%"><col style="width:30%"></colgroup>
            <thead><tr><th data-sort-section="events" data-sort-key="date">Дата</th><th data-sort-section="events" data-sort-key="kind">Источник</th><th data-sort-section="events" data-sort-key="ref">Документ / операция</th><th data-sort-section="events" data-sort-key="detail">Детали</th></tr></thead>
            <tbody id="eventRows"></tbody>
          </table>
          <div id="eventsEmpty" class="empty">Выберите barcode или serial выше.</div>
        </div>
      </aside>
    </section>
  </main>
  <section id="problemReport" class="report-panel" hidden>
    <header class="report-toolbar">
      <h2>Проблемные позиции Stock Check</h2>
      <div class="report-actions"><button id="problemReportClose" class="refresh" type="button">Закрыть</button><button id="problemReportPrint" class="refresh" type="button" disabled>Печать / PDF</button></div>
    </header>
    <div id="problemReportSummary" class="report-summary"></div>
    <div class="report-scroll">
      <table class="report-table">
        <colgroup><col style="width:24%"><col style="width:11%"><col style="width:12%"><col style="width:13%"><col style="width:22%"><col style="width:18%"></colgroup>
        <thead><tr><th>Описание</th><th>Barcode</th><th>Serial</th><th>Инвентаризация</th><th>Текущий статус</th><th>Последнее наблюдение</th></tr></thead>
        <tbody id="problemReportRows"></tbody>
      </table>
    </div>
  </section>
  <script>
    const els = {
      status: document.getElementById('status'), refresh: document.getElementById('refresh'),
      category: document.getElementById('category'), latest: document.getElementById('latest'), previous: document.getElementById('previous'),
      search: document.getElementById('search'), hideZero: document.getElementById('hideZero'),
      inventoryRows: document.getElementById('inventoryRows'), inventoryEmpty: document.getElementById('inventoryEmpty'), inventoryMeta: document.getElementById('inventoryMeta'),
      unitRows: document.getElementById('unitRows'), unitsEmpty: document.getElementById('unitsEmpty'), unitsTitle: document.getElementById('unitsTitle'), unitsMeta: document.getElementById('unitsMeta'),
      eventRows: document.getElementById('eventRows'), eventsEmpty: document.getElementById('eventsEmpty'), eventsTitle: document.getElementById('eventsTitle'), eventsMeta: document.getElementById('eventsMeta'),
      reportOpen: document.getElementById('problemReportOpen'), report: document.getElementById('problemReport'), reportClose: document.getElementById('problemReportClose'),
      reportPrint: document.getElementById('problemReportPrint'), reportSummary: document.getElementById('problemReportSummary'), reportRows: document.getElementById('problemReportRows')
    };
    let rawItems = [];
    let comparisonEntries = [];
    let typeGroups = [];
    let selectedTypeKey = '';
    let selectedItemKey = '';
    let historyRequest = 0;
    let assignmentCache = new Map();
    let preloadToken = 0;
    let preloadProgress = { key: '', loaded: 0, total: 0, running: false };
    let reportToken = 0;
    let currentEvents = [];
    const sortState = {
      inventory: { key: 'equipmentType', direction: 'asc' },
      units: { key: 'barcode', direction: 'asc' },
      events: { key: 'date', direction: 'desc' }
    };

    function esc(value) {
      return String(value == null ? '' : value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
    }
    function norm(value) { return String(value == null ? '' : value).trim().toLowerCase(); }
    function num(value) { return Number(value || 0); }
    function sortRows(items, section, valueFor) {
      const state = sortState[section];
      return items.slice().sort(function(a, b) {
        const left = valueFor(a, state.key);
        const right = valueFor(b, state.key);
        const leftEmpty = left == null || left === '';
        const rightEmpty = right == null || right === '';
        if (leftEmpty !== rightEmpty) return leftEmpty ? 1 : -1;
        if (leftEmpty && rightEmpty) return 0;
        let result;
        if (typeof left === 'number' && typeof right === 'number') result = left - right;
        else result = String(left).localeCompare(String(right), 'ru', { numeric: true, sensitivity: 'base' });
        return state.direction === 'asc' ? result : -result;
      });
    }
    function updateSortHeaders(section) {
      document.querySelectorAll('th[data-sort-section="' + section + '"]').forEach(function(header) {
        const active = header.getAttribute('data-sort-key') === sortState[section].key;
        header.classList.toggle('sort-asc', active && sortState[section].direction === 'asc');
        header.classList.toggle('sort-desc', active && sortState[section].direction === 'desc');
        header.setAttribute('aria-sort', active ? (sortState[section].direction === 'asc' ? 'ascending' : 'descending') : 'none');
      });
    }
    function fmtDate(value) {
      if (!value) return '';
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
    }
    function itemKey(item) {
      if (item && item.itemRef != null) return 'ref:' + item.itemRef;
      return 'code:' + norm(item && item.barcode) + '|' + norm(item && item.serialNumber);
    }
    function categoryKey(item) {
      if (item.categoryId != null) return 'id:' + item.categoryId;
      return 'name:' + norm(item.categoryName || 'Без категории');
    }
    function typeKey(item) {
      if (item.equipmentTypeId != null) return 'id:' + item.equipmentTypeId;
      return 'name:' + norm(item.equipmentType || 'Без описания');
    }
    function sessionLabel(session) {
      if (!session) return '—';
      const title = session.stockTakeTitle || ('Stock Take #' + session.stockTakeId);
      return title + (session.startDate ? ' · ' + fmtDate(session.startDate) : '');
    }
    function sessionsFrom(items) {
      const map = new Map();
      items.forEach(function(item) {
        if (item.stockTakeId == null || map.has(item.stockTakeId)) return;
        map.set(item.stockTakeId, { stockTakeId: item.stockTakeId, stockTakeTitle: item.stockTakeTitle, startDate: item.startDate, warehouseName: item.warehouseName });
      });
      return Array.from(map.values()).sort(function(a, b) {
        const dateDelta = new Date(b.startDate || 0).getTime() - new Date(a.startDate || 0).getTime();
        return dateDelta || num(b.stockTakeId) - num(a.stockTakeId);
      });
    }
    function selectedId(select) { return select.value ? Number(select.value) : null; }
    function populateSessions(items) {
      const sessions = sessionsFrom(items);
      const latestCurrent = els.latest.value;
      const previousCurrent = els.previous.value;
      els.latest.innerHTML = sessions.map(function(s) { return '<option value="' + esc(s.stockTakeId) + '">' + esc(sessionLabel(s)) + '</option>'; }).join('');
      els.previous.innerHTML = '<option value="">Нет сравнения</option>' + sessions.map(function(s) { return '<option value="' + esc(s.stockTakeId) + '">' + esc(sessionLabel(s)) + '</option>'; }).join('');
      els.latest.value = sessions.some(function(s) { return String(s.stockTakeId) === latestCurrent; }) ? latestCurrent : (sessions[0] ? String(sessions[0].stockTakeId) : '');
      const fallback = sessions.find(function(s) { return String(s.stockTakeId) !== els.latest.value; });
      els.previous.value = sessions.some(function(s) { return String(s.stockTakeId) === previousCurrent && previousCurrent !== els.latest.value; }) ? previousCurrent : (fallback ? String(fallback.stockTakeId) : '');
      return sessions;
    }
    function populateCategories(items) {
      const current = els.category.value;
      const masters = new Map();
      items.forEach(function(item) {
        const masterName = item.masterCategoryName || 'Без мастер-категории';
        const masterKey = item.masterCategoryId != null ? 'id:' + item.masterCategoryId : 'name:' + norm(masterName);
        if (!masters.has(masterKey)) masters.set(masterKey, { name: masterName, categories: new Map() });
        const key = categoryKey(item);
        if (!masters.get(masterKey).categories.has(key)) masters.get(masterKey).categories.set(key, item.categoryName || 'Без категории');
      });
      const html = ['<option value="all">Все категории</option>'];
      Array.from(masters.values()).sort(function(a,b) { return a.name.localeCompare(b.name, 'ru'); }).forEach(function(master) {
        html.push('<optgroup label="' + esc(master.name) + '">');
        Array.from(master.categories.entries()).sort(function(a,b) { return a[1].localeCompare(b[1], 'ru'); }).forEach(function(pair) {
          html.push('<option value="' + esc(pair[0]) + '">' + esc(pair[1]) + '</option>');
        });
        html.push('</optgroup>');
      });
      els.category.innerHTML = html.join('');
      els.category.value = Array.from(els.category.options).some(function(o) { return o.value === current; }) ? current : 'all';
    }
    function classify(entry) {
      const base = entry.latest || entry.previous;
      const reason = base && base.disposalReason != null ? Number(base.disposalReason) : null;
      const dropped = !!entry.previous && !!entry.previousSeen && !entry.latestSeen;
      if (dropped && reason === 6) return 'sold';
      if (dropped && (reason === 2 || reason === 3 || (base && base.currentItemState === 'inactive'))) return 'written_off';
      if (dropped) return 'missing';
      if (!entry.previous && entry.latest) return 'new';
      if (entry.previous && !entry.previousSeen && entry.latestSeen) return 'found';
      if (entry.latestSeen) return 'seen';
      return 'not_seen';
    }
    function buildComparison(items) {
      const latestId = selectedId(els.latest);
      const previousId = selectedId(els.previous);
      const latestMap = new Map();
      const previousMap = new Map();
      items.forEach(function(item) {
        if (item.stockTakeId === latestId) latestMap.set(itemKey(item), item);
        if (previousId && item.stockTakeId === previousId) previousMap.set(itemKey(item), item);
      });
      const keys = Array.from(new Set(Array.from(latestMap.keys()).concat(Array.from(previousMap.keys()))));
      return keys.map(function(key) {
        const latest = latestMap.get(key) || null;
        const previous = previousMap.get(key) || null;
        const base = latest || previous;
        const entry = { key: key, latest: latest, previous: previous, base: base, latestSeen: !!(latest && latest.seenDate), previousSeen: !!(previous && previous.seenDate) };
        entry.status = classify(entry);
        const cachedAssignment = assignmentCache.get(key);
        if (cachedAssignment) {
          entry.assignmentLoaded = true;
          entry.currentAssignment = cachedAssignment.currentAssignment;
          entry.eqlists = cachedAssignment.eqlists;
        } else if (base && base.currentEqlistId != null) {
          const currentAssignment = Number(base.currentEqlistId) > 1 ? {
            eqlistId: Number(base.currentEqlistId), eqlistName: base.currentEqlistName || null,
            jobNo: base.currentJobNo || null, jobRef: base.currentJobRef || null, clientName: base.currentClientName || null,
            lastSeenAt: null, operationType: 0, isCurrent: true
          } : null;
          const seeded = { eqlists: currentAssignment ? [currentAssignment] : [], currentAssignment: currentAssignment, historyLoaded: false };
          assignmentCache.set(key, seeded);
          entry.assignmentLoaded = true;
          entry.currentAssignment = currentAssignment;
          entry.eqlists = seeded.eqlists;
        }
        return entry;
      });
    }
    function groupTypes(entries) {
      const category = els.category.value;
      const needle = norm(els.search.value);
      const map = new Map();
      entries.forEach(function(entry) {
        const item = entry.base;
        if (!item || (category !== 'all' && categoryKey(item) !== category)) return;
        const searchable = norm([item.equipmentType, item.barcode, item.serialNumber, item.itemRef].join(' '));
        if (needle && !searchable.includes(needle)) return;
        const key = typeKey(item);
        if (!map.has(key)) map.set(key, { key: key, equipmentType: item.equipmentType || 'Без описания', equipmentTypeId: item.equipmentTypeId, entries: [], total: 0, barcoded: 0, active: 0, repair: 0, previousSeen: 0, latestSeen: 0, notSeen: 0, writtenOff: 0, sold: 0 });
        const g = map.get(key);
        g.entries.push(entry);
        g.total += 1;
        if ((entry.latest || entry.previous).barcode) g.barcoded += 1;
        if ((entry.latest || entry.previous).currentItemState === 'active') g.active += 1;
        if (Number((entry.latest || entry.previous).commissionStatus) === 2) g.repair += 1;
        if (entry.previousSeen) g.previousSeen += 1;
        if (entry.latestSeen) g.latestSeen += 1;
        if (!entry.latestSeen && (entry.base.currentItemState === 'active' || entry.base.currentItemState === 'unknown') && entry.status !== 'written_off' && entry.status !== 'sold') g.notSeen += 1;
        if (entry.status === 'written_off') g.writtenOff += 1;
        if (entry.status === 'sold') g.sold += 1;
      });
      let groups = Array.from(map.values());
      if (els.hideZero.checked) groups = groups.filter(function(g) { return g.barcoded > 0; });
      return sortRows(groups, 'inventory', function(group, key) { return group[key]; });
    }
    function levelClass(group) {
      if (group.active === 0) return 'level-zero';
      if (group.notSeen === 0) return 'level-ok';
      if (group.notSeen <= 2) return 'level-minor';
      if ((group.notSeen / Math.max(group.active, 1)) >= .1) return 'level-critical';
      return 'level-low';
    }
    function renderInventory() {
      typeGroups = groupTypes(comparisonEntries);
      if (!typeGroups.some(function(g) { return g.key === selectedTypeKey; })) selectedTypeKey = typeGroups[0] ? typeGroups[0].key : '';
      els.inventoryRows.innerHTML = typeGroups.map(function(g) {
        return '<tr data-type-key="' + esc(g.key) + '" class="' + levelClass(g) + (g.key === selectedTypeKey ? ' selected' : '') + '">' +
          '<td class="desc" title="' + esc(g.equipmentType) + '">' + esc(g.equipmentType) + '<span class="type-id">#' + esc(g.equipmentTypeId) + '</span></td>' +
          '<td class="num">' + g.total + '</td><td class="num">' + g.barcoded + '</td><td class="num">' + g.active + '</td><td class="num">' + g.repair + '</td>' +
          '<td class="num">' + g.previousSeen + '</td><td class="num"><span class="mark good">' + g.latestSeen + '</span></td>' +
          '<td class="num"><span class="mark ' + (g.notSeen ? 'bad' : 'good') + '">' + g.notSeen + '</span></td>' +
          '<td class="num"><span class="mark ' + (g.writtenOff ? 'warn' : '') + '">' + g.writtenOff + '</span></td>' +
          '<td class="num"><span class="mark ' + (g.sold ? 'warn' : '') + '">' + g.sold + '</span></td></tr>';
      }).join('');
      els.inventoryEmpty.hidden = typeGroups.length > 0;
      const totals = typeGroups.reduce(function(a,g) { a.types += 1; a.items += g.total; a.seen += g.latestSeen; a.unseen += g.notSeen; return a; }, {types:0, items:0, seen:0, unseen:0});
      els.inventoryMeta.textContent = totals.types + ' типов · ' + totals.items + ' единиц · найдено ' + totals.seen + ' · не найдено ' + totals.unseen;
      updateSortHeaders('inventory');
      bindTypeRows();
      renderUnits();
    }
    function bindTypeRows() {
      Array.from(els.inventoryRows.querySelectorAll('tr[data-type-key]')).forEach(function(row) {
        row.addEventListener('click', function() { selectedTypeKey = row.getAttribute('data-type-key') || ''; selectedItemKey = ''; renderInventory(); });
      });
    }
    function statusLabel(status) {
      return { sold: 'Продано', written_off: 'Списано', missing: 'Не прошёл', found: 'Найдено', new: 'Новое', seen: 'Видели', not_seen: 'Не видели' }[status] || status;
    }
    function statusTone(status) {
      if (status === 'seen' || status === 'found') return 'good';
      if (status === 'missing' || status === 'written_off' || status === 'sold') return 'bad';
      if (status === 'new') return 'info';
      return 'warn';
    }
    function inventoryStatus(entry) {
      if (entry.latestSeen) return { label: 'Прошёл', tone: 'good' };
      return { label: 'Не прошёл', tone: 'bad' };
    }
    function assignmentReference(assignment) {
      if (!assignment) return '';
      const jobReference = String(assignment.jobRef || '');
      const readableJobNumber = jobReference.match(/[0-9]+/);
      return readableJobNumber ? readableJobNumber[0] : (assignment.jobRef || assignment.jobNo || assignment.eqlistName || assignment.eqlistId || '');
    }
    function currentLocation(entry) {
      const cached = assignmentCache.get(entry.key);
      if (cached && !entry.assignmentLoaded) {
        entry.assignmentLoaded = true;
        entry.currentAssignment = cached.currentAssignment;
        entry.eqlists = cached.eqlists;
      }
      const commissionStatus = Number(entry.base.commissionStatus);
      const assignment = entry.currentAssignment;
      const reference = assignmentReference(assignment);
      const lastJobNote = [reference ? 'Последняя работа ' + reference : '', assignment && assignment.eqlistName].filter(Boolean).join(' · ');
      if (entry.status === 'sold') return { label: 'Продано', note: '', tone: 'bad', alert: false };
      if (entry.status === 'written_off') return { label: 'Списано', note: '', tone: 'bad', alert: false };
      if (commissionStatus === 1) return { label: 'Местонахождение неизвестно', note: lastJobNote, tone: 'bad', alert: false };
      if (commissionStatus === 2) return { label: 'В ремонте', note: lastJobNote, tone: 'warn', alert: false };
      if (commissionStatus === 3) return { label: 'Выведено из эксплуатации', note: lastJobNote, tone: 'bad', alert: false };
      if (commissionStatus === 4) return { label: 'Списано / выбыло', note: lastJobNote, tone: 'bad', alert: false };
      if (entry.currentAssignment) {
        return { label: 'На работе' + (reference ? ' ' + reference : ''), note: assignment.eqlistName || '', tone: 'info', alert: !entry.latestSeen };
      }
      if (entry.assignmentFailed) return { label: 'Не удалось определить', note: '', tone: 'bad', alert: false };
      if (!entry.assignmentLoaded) return { label: 'Определяется...', note: '', tone: '', alert: false };
      if (entry.base.currentItemState === 'inactive') return { label: 'Неактивно', note: '', tone: 'bad', alert: false };
      return { label: 'На складе', note: '', tone: 'good', alert: false };
    }
    function isProblemEntry(entry) {
      const commissionStatus = Number(entry.base && entry.base.commissionStatus);
      return !entry.latestSeen || (Number.isFinite(commissionStatus) && commissionStatus !== 0);
    }
    function reportRowClass(entry) {
      const commissionStatus = Number(entry.base.commissionStatus);
      if (commissionStatus === 2) return 'problem-repair';
      if (commissionStatus >= 3 || entry.status === 'sold' || entry.status === 'written_off') return 'problem-inactive';
      return 'problem-missing';
    }
    function renderProblemReport(entries, loaded, total) {
      els.reportRows.innerHTML = entries.map(function(entry) {
        const item = entry.base;
        const inventory = inventoryStatus(entry);
        const location = currentLocation(entry);
        const last = lastObservation(entry);
        return '<tr class="' + reportRowClass(entry) + '"><td>' + esc(item.equipmentType || '—') + '</td>' +
          '<td class="code">' + esc(item.barcode || item.itemRef || '—') + '</td><td class="code">' + esc(item.serialNumber || '—') + '</td>' +
          '<td>' + esc(inventory.label) + '</td><td><strong>' + esc(location.label) + '</strong>' +
          (location.note ? '<span class="event-note">' + esc(location.note) + '</span>' : '') + '</td>' +
          '<td>' + esc(last.date ? fmtDate(last.date) : last.label) + (last.date ? '<span class="event-note">' + esc(last.label) + '</span>' : '') + '</td></tr>';
      }).join('');
      const latestSession = sessionsFrom(rawItems).find(function(session) { return session.stockTakeId === selectedId(els.latest); });
      els.reportSummary.textContent = sessionLabel(latestSession) + ' · ' + entries.length + ' проблемных позиций' +
        (total > 0 ? ' · статусы ' + loaded + '/' + total : '');
    }
    async function openProblemReport() {
      const token = ++reportToken;
      const entries = comparisonEntries.filter(isProblemEntry).sort(function(a, b) {
        const typeResult = String(a.base.equipmentType || '').localeCompare(String(b.base.equipmentType || ''), 'ru', { numeric: true, sensitivity: 'base' });
        return typeResult || String(a.base.barcode || a.base.itemRef || '').localeCompare(String(b.base.barcode || b.base.itemRef || ''), 'ru', { numeric: true, sensitivity: 'base' });
      });
      els.report.hidden = false;
      els.reportPrint.disabled = true;
      const pending = entries.filter(function(entry) {
        const commissionStatus = Number(entry.base.commissionStatus);
        const statusKnownWithoutAssignment = commissionStatus !== 0 || entry.status === 'sold' || entry.status === 'written_off';
        return !statusKnownWithoutAssignment && !assignmentCache.has(entry.key);
      });
      let loaded = entries.length - pending.length;
      renderProblemReport(entries, loaded, entries.length);

      for (let offset = 0; offset < pending.length; offset += 8) {
        if (token !== reportToken) return;
        const batch = pending.slice(offset, offset + 8);
        await Promise.all(batch.map(function(entry) {
          return loadEntryEqlists(entry).catch(function() { entry.assignmentFailed = true; return []; });
        }));
        if (token !== reportToken) return;
        loaded = Math.min(entries.length, loaded + batch.length);
        renderProblemReport(entries, loaded, entries.length);
      }

      if (token === reportToken) {
        els.reportPrint.disabled = entries.length === 0;
        renderProblemReport(entries, entries.length, entries.length);
      }
    }
    function closeProblemReport() {
      reportToken += 1;
      els.report.hidden = true;
    }
    function eqlistParams(entry) {
      const item = entry.base;
      const params = new URLSearchParams();
      if (item.itemRef != null) params.set('itemRef', String(item.itemRef));
      if (item.barcode) params.set('barcodeRaw', item.barcode);
      if (item.serialNumber) params.set('serialNumber', item.serialNumber);
      return params;
    }
    async function loadEntryEqlists(entry) {
      const cached = assignmentCache.get(entry.key);
      if (cached) {
        entry.assignmentLoaded = true;
        entry.currentAssignment = cached.currentAssignment;
        entry.eqlists = cached.eqlists;
        if (cached.historyLoaded !== false) return cached.eqlists;
      }
      if (entry.assignmentPromise) return entry.assignmentPromise;

      entry.assignmentPromise = (async function() {
        const response = await fetch('/api/tickets/lookups/eqlists?' + eqlistParams(entry).toString());
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error || ('HTTP ' + response.status));
        const eqlists = payload.items || [];
        const result = {
          eqlists: eqlists,
          currentAssignment: eqlists.find(function(row) { return row.isCurrent; }) || null,
          historyLoaded: true
        };
        assignmentCache.set(entry.key, result);
        entry.assignmentLoaded = true;
        entry.currentAssignment = result.currentAssignment;
        entry.eqlists = result.eqlists;
        return result.eqlists;
      }());

      try {
        return await entry.assignmentPromise;
      } finally {
        entry.assignmentPromise = null;
      }
    }
    async function preloadGroupStatuses(group) {
      if (preloadProgress.running && preloadProgress.key === group.key) return;
      const pending = group.entries.filter(function(entry) { return !assignmentCache.has(entry.key); });
      const token = ++preloadToken;
      preloadProgress = { key: group.key, loaded: group.entries.length - pending.length, total: group.entries.length, running: pending.length > 0 };
      renderUnits(true);

      for (let offset = 0; offset < pending.length; offset += 6) {
        if (token !== preloadToken || selectedTypeKey !== group.key) return;
        const batch = pending.slice(offset, offset + 6);
        await Promise.all(batch.map(function(entry) { return loadEntryEqlists(entry).catch(function() { return []; }); }));
        if (token !== preloadToken || selectedTypeKey !== group.key) return;
        preloadProgress.loaded = Math.min(preloadProgress.total, preloadProgress.loaded + batch.length);
        renderUnits(true);
      }

      if (token === preloadToken && selectedTypeKey === group.key) {
        preloadProgress.running = false;
        renderUnits(true);
      }
    }
    function lastObservation(entry) {
      if (entry.latestSeen) return { date: entry.latest.seenDate, label: entry.latest.stockTakeTitle || 'Текущая инвентаризация' };
      if (entry.previousSeen) return { date: entry.previous.seenDate, label: entry.previous.stockTakeTitle || 'Предыдущая инвентаризация' };
      return { date: '', label: 'Нет отметки' };
    }
    function renderUnits(skipHistory) {
      const group = typeGroups.find(function(g) { return g.key === selectedTypeKey; });
      if (!group) {
        els.unitRows.innerHTML = ''; els.unitsEmpty.hidden = false; els.unitsTitle.textContent = 'Единицы оборудования'; els.unitsMeta.textContent = 'выберите строку слева'; clearEvents(); return;
      }
      if (!group.entries.some(function(e) { return e.key === selectedItemKey; })) selectedItemKey = group.entries[0] ? group.entries[0].key : '';
      els.unitsTitle.textContent = group.equipmentType;
      const progressVisible = preloadProgress.key === group.key && preloadProgress.total > 0;
      els.unitsMeta.textContent = group.entries.length + ' единиц' +
        (progressVisible ? ' · статусы ' + preloadProgress.loaded + '/' + preloadProgress.total : '');
      const sortedEntries = sortRows(group.entries, 'units', function(entry, key) {
        if (key === 'barcode') return entry.base.barcode || entry.base.itemRef || '';
        if (key === 'serial') return entry.base.serialNumber || '';
        if (key === 'inventoryStatus') return inventoryStatus(entry).label;
        if (key === 'currentLocation') return currentLocation(entry).label;
        if (key === 'lastSeen') {
          const last = lastObservation(entry);
          return last.date ? new Date(last.date).getTime() : null;
        }
        return '';
      });
      els.unitRows.innerHTML = sortedEntries.map(function(entry) {
        const item = entry.base; const last = lastObservation(entry); const inventory = inventoryStatus(entry); const location = currentLocation(entry);
        const rowClasses = [(entry.key === selectedItemKey ? 'selected' : ''), (location.alert ? 'on-job-unseen' : '')].filter(Boolean).join(' ');
        return '<tr data-item-key="' + esc(entry.key) + '" class="' + rowClasses + '">' +
          '<td class="code">' + esc(item.barcode || item.itemRef || '—') + '</td><td class="code">' + esc(item.serialNumber || '—') + '</td>' +
          '<td><i class="state-dot ' + inventory.tone + '"></i>' + esc(inventory.label) + '</td>' +
          '<td><i class="state-dot ' + location.tone + '"></i>' + esc(location.label) +
            (location.note ? '<span class="status-note">' + esc(location.note) + '</span>' : '') + '</td>' +
          '<td>' + esc(last.date ? fmtDate(last.date) : last.label) + (last.date ? '<span class="event-note">' + esc(last.label) + '</span>' : '') + '</td></tr>';
      }).join('');
      els.unitsEmpty.hidden = group.entries.length > 0;
      updateSortHeaders('units');
      Array.from(els.unitRows.querySelectorAll('tr[data-item-key]')).forEach(function(row) {
        row.addEventListener('click', function() { selectedItemKey = row.getAttribute('data-item-key') || ''; renderUnits(); });
      });
      if (!skipHistory) {
        renderSelectedHistory();
        preloadGroupStatuses(group);
      }
    }
    function clearEvents() {
      historyRequest += 1; els.eventRows.innerHTML = ''; els.eventsEmpty.hidden = false; els.eventsTitle.textContent = 'История перемещений HireTrack'; els.eventsMeta.textContent = '';
    }
    function eventTime(event) { const value = event.date ? new Date(event.date).getTime() : 0; return Number.isNaN(value) ? 0 : value; }
    function eqlistOperation(row) {
      const operation = Number(row.operationType);
      return operation === 5 ? 'Отправка' : operation === 6 ? 'Возврат' : operation === 7 ? 'Приём' :
        ([2, 3, 4].includes(operation) ? 'Подготовка' : (row.isCurrent ? 'Текущий статус' : 'Операция'));
    }
    function renderEvents(events) {
      currentEvents = events.slice();
      const sortedEvents = sortRows(currentEvents, 'events', function(event, key) {
        if (key === 'date') return event.date ? eventTime(event) : null;
        return event[key] || '';
      });
      els.eventRows.innerHTML = sortedEvents.map(function(event) {
        return '<tr><td>' + esc(fmtDate(event.date) || '—') + '</td><td><span class="event-kind">' + esc(event.kind) + '</span></td>' +
          '<td class="event-ref">' + esc(event.ref || '—') + '</td><td>' + esc(event.detail || '') + (event.note ? '<span class="event-note">' + esc(event.note) + '</span>' : '') + '</td></tr>';
      }).join('');
      els.eventsEmpty.hidden = events.length > 0;
      els.eventsMeta.textContent = events.length + ' событий';
      updateSortHeaders('events');
    }
    async function renderSelectedHistory() {
      const entry = comparisonEntries.find(function(e) { return e.key === selectedItemKey; });
      if (!entry) { clearEvents(); return; }
      const item = entry.base;
      els.eventsTitle.textContent = (item.barcode || item.serialNumber || ('Item ' + item.itemRef));
      const events = [];
      [entry.latest, entry.previous].filter(Boolean).forEach(function(row) {
        events.push({ date: row.seenDate || row.actionedDate || row.processedDate || row.startDate, kind: 'Stock Check', ref: row.stockTakeTitle || ('#' + row.stockTakeId), detail: row.seenDate ? 'Отмечено в инвентаризации' : 'Не отмечено', note: [row.warehouseName, row.actionNotes, row.actionedNotes].filter(Boolean).join(' · ') });
      });
      renderEvents(events);
      const requestId = ++historyRequest;
      try {
        const results = await Promise.all([loadEntryEqlists(entry), fetch('/api/tickets')]);
        const eqlists = results[0];
        const ticketPayload = await results[1].json();
        if (requestId !== historyRequest) return;
        renderUnits(true);
        eqlists.forEach(function(row) {
          events.push({ date: row.lastSeenAt, kind: row.eqlistName || ('EQL ' + row.eqlistId), ref: eqlistOperation(row), detail: [row.jobRef, row.clientName].filter(Boolean).join(' · ') || 'Equipment List', note: row.isCurrent ? 'Текущее местонахождение' : '' });
        });
        (ticketPayload.items || []).filter(function(ticket) {
          if (item.itemRef != null && Number(ticket.hiretrackItemRef) === Number(item.itemRef)) return true;
          if (item.serialNumber && norm(ticket.serialNumber) === norm(item.serialNumber)) return true;
          return !!item.barcode && norm(ticket.barcodeRaw) === norm(item.barcode);
        }).forEach(function(ticket) {
          events.push({ date: ticket.receivedAt || ticket.createdAt, kind: 'Service Ticket', ref: ticket.ticketNumber, detail: [ticket.status, ticket.clientName || ticket.clientCompany].filter(Boolean).join(' · '), note: [ticket.hiretrackEqlistName, ticket.hiretrackJobRef, ticket.faultDescription].filter(Boolean).join(' · ') });
        });
        renderEvents(events);
      } catch (error) {
        if (requestId !== historyRequest) return;
        events.push({ date: '', kind: 'Ошибка', ref: '', detail: 'Не удалось загрузить Equipment List или тикеты', note: error instanceof Error ? error.message : String(error) });
        renderEvents(events);
      }
    }
    function rebuild() {
      comparisonEntries = buildComparison(rawItems);
      renderInventory();
    }
    async function load() {
      closeProblemReport();
      els.refresh.disabled = true; els.reportOpen.disabled = true; els.status.className = 'status'; els.status.textContent = 'Загрузка данных...';
      try {
        const response = await fetch('/api/tickets/lookups/stocktake-history?sessionState=all');
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.error || ('HTTP ' + response.status));
        rawItems = (payload.items || []).filter(function(item) { return norm(item.warehouseName) !== 'sochi'; });
        assignmentCache = new Map();
        preloadToken += 1;
        preloadProgress = { key: '', loaded: 0, total: 0, running: false };
        const sessions = populateSessions(rawItems);
        populateCategories(rawItems);
        selectedTypeKey = ''; selectedItemKey = '';
        rebuild();
        els.status.textContent = rawItems.length + ' строк · ' + sessions.length + ' инвентаризаций · Sochi исключён';
      } catch (error) {
        els.status.className = 'status error'; els.status.textContent = error instanceof Error ? error.message : String(error);
        rawItems = []; comparisonEntries = []; renderInventory();
      } finally { els.refresh.disabled = false; els.reportOpen.disabled = comparisonEntries.length === 0; }
    }
    els.refresh.addEventListener('click', load);
    els.reportOpen.addEventListener('click', openProblemReport);
    els.reportClose.addEventListener('click', closeProblemReport);
    els.reportPrint.addEventListener('click', function() { window.print(); });
    els.category.addEventListener('change', function() { selectedTypeKey = ''; selectedItemKey = ''; rebuild(); });
    els.latest.addEventListener('change', function() { if (els.previous.value === els.latest.value) els.previous.value = ''; selectedTypeKey = ''; selectedItemKey = ''; rebuild(); });
    els.previous.addEventListener('change', function() { if (els.previous.value === els.latest.value) els.previous.value = ''; selectedTypeKey = ''; selectedItemKey = ''; rebuild(); });
    els.search.addEventListener('input', function() { selectedTypeKey = ''; selectedItemKey = ''; renderInventory(); });
    els.hideZero.addEventListener('change', renderInventory);
    document.querySelectorAll('th[data-sort-section]').forEach(function(header) {
      header.addEventListener('click', function() {
        const section = header.getAttribute('data-sort-section');
        const key = header.getAttribute('data-sort-key');
        const state = sortState[section];
        if (state.key === key) state.direction = state.direction === 'asc' ? 'desc' : 'asc';
        else {
          state.key = key;
          state.direction = section === 'events' && key === 'date' ? 'desc' : 'asc';
        }
        if (section === 'inventory') renderInventory();
        if (section === 'units') renderUnits(true);
        if (section === 'events') renderEvents(currentEvents);
      });
    });
    updateSortHeaders('inventory');
    updateSortHeaders('units');
    updateSortHeaders('events');
    load();
  </script>
</body>
</html>`;
}
