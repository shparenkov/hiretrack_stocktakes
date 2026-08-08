export function renderHiretrackPortalPage(): string {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>HireTrack NX</title>
  <style>
    :root { color-scheme: light; --navy:#173f72; --blue:#245c9b; --line:#aeb9c6; --canvas:#eef2f5; --muted:#687485; }
    * { box-sizing: border-box; }
    body { margin:0; min-width:320px; min-height:100vh; color:#18212b; background:var(--canvas); font:13px/1.35 "Arial Narrow","Segoe UI",Arial,sans-serif; }
    .topbar { min-height:52px; display:flex; align-items:center; justify-content:space-between; gap:16px; padding:9px 16px; color:#fff; background:var(--navy); border-bottom:3px solid #0e2c51; }
    .brand { font-size:18px; font-weight:700; letter-spacing:.01em; }
    .brand span { margin-left:9px; color:#c9d8e9; font-size:12px; font-weight:400; }
    main { width:min(1220px,calc(100% - 32px)); margin:0 auto; padding:56px 0; }
    .intro { margin-bottom:24px; }
    .intro h1 { margin:0 0 8px; font-size:28px; color:var(--navy); }
    .intro p { margin:0; color:var(--muted); font-size:14px; }
    .sections { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:1px; border:1px solid var(--line); background:var(--line); }
    .section { min-height:260px; display:flex; flex-direction:column; padding:0; color:inherit; background:#fff; text-decoration:none; }
    .section-head { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:11px 14px; color:#fff; background:var(--blue); border-bottom:1px solid #143f70; }
    .section-head strong { font-size:15px; }
    .code { color:#d9e7f5; font:11px Consolas,"Courier New",monospace; }
    .section-body { flex:1; padding:24px; }
    .section-body h2 { margin:0 0 10px; color:var(--navy); font-size:22px; }
    .section-body p { margin:0 0 22px; color:#536172; font-size:14px; }
    .facts { display:grid; gap:7px; color:#3f4c5b; }
    .facts span::before { content:'›'; margin-right:7px; color:var(--blue); font-weight:800; }
    .open { display:block; padding:10px 14px; color:#fff; background:var(--navy); font-weight:700; text-align:right; }
    .section:hover .section-head { background:#3472b2; }
    .section:hover .open { background:#194979; }
    @media (max-width:720px) { main { padding:28px 0; } .sections { grid-template-columns:1fr; } .section { min-height:230px; } .brand span { display:none; } }
  </style>
</head>
<body>
  <header class="topbar"><div class="brand">HireTrack NX <span>рабочие инструменты</span></div><div>Выберите раздел</div></header>
  <main>
    <div class="intro"><h1>Панель управления</h1><p>Инвентаризация оборудования и сервисные обращения в одном интерфейсе.</p></div>
    <div class="sections">
      <a class="section" href="/bitrix/tickets/stocktake-history/">
        <div class="section-head"><strong>Stock Check</strong><span class="code">INVENTORY</span></div>
        <div class="section-body"><h2>Инвентаризация</h2><p>Текущее состояние склада, сравнение проверок и история перемещений.</p><div class="facts"><span>Категории и единицы оборудования</span><span>Проблемные позиции и статусы</span><span>Печатные формы PDF</span></div></div>
        <span class="open">Открыть инвентаризацию →</span>
      </a>
      <a class="section" href="/service-tickets/">
        <div class="section-head"><strong>Service Tickets</strong><span class="code">REPAIR</span></div>
        <div class="section-body"><h2>Сервис и ремонт</h2><p>Приём оборудования по штрихкоду, регистрация неисправностей и контроль тикетов.</p><div class="facts"><span>Сканер barcode с камеры</span><span>Проверка текущей работы HireTrack</span><span>Logged Fault и история действий</span></div></div>
        <span class="open">Открыть сервис →</span>
      </a>
      <a class="section" href="/daybook/">
        <div class="section-head"><strong>Daybook</strong><span class="code">WAREHOUSE</span></div>
        <div class="section-body"><h2>План склада</h2><p>Сборки на сегодня и ближайшие дни напрямую из HireTrack NX.</p><div class="facts"><span>Работы и Equipment Lists</span><span>Готовность каждой позиции</span><span>Автообновление каждые 30 секунд</span></div></div>
        <span class="open">Открыть план склада →</span>
      </a>
      <a class="section" href="/crew-bookings/">
        <div class="section-head"><strong>Crew Bookings</strong><span class="code">CREWING</span></div>
        <div class="section-body"><h2>Назначение персонала</h2><p>Job → Фаза → Позиция с назначением людей прямо из HireTrack NX.</p><div class="facts"><span>Job/фаза/позиция по дням</span><span>Поиск и подтверждение назначения</span><span>Пишет напрямую в HireTrack</span></div></div>
        <span class="open">Открыть Crew Bookings →</span>
      </a>
    </div>
  </main>
</body>
</html>`;
}
