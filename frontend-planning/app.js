const DOW_FULL = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const DAY_W = 42; // keep in sync with --day-w in styles.css

let OCCUPANCY = null; // { start, end, types, lines }
let SHORTAGES = null; // { generatedAt, jobs }
let JOBS_GANTT = null; // { generatedAt, jobs }
let start = new Date();
let DAY_COUNT = 7;

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}
// Local calendar date, NOT toISOString().slice(0,10) - see frontend-crew-bookings/app.js
// for the UTC-shift bug this avoids.
function fmt(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function todayStr() {
  return fmt(new Date());
}

const state = {
  activeTab: "occupancy",
  categoryFilter: "",
  shortageOnly: false,
  shortagesLoading: false,
  shortagesError: null,
  expandedShortageJobs: new Set(),
  // Rank 3/2/1 match jobStatusRank's own bucketing (hiretrack_planning_read.py's
  // read_defcon) - all three on by default, toggled off to hide that stage
  // entirely. Приоритет: Подтверждено (3) высокий, Бронь (2) средний,
  // Запрос (1) низкий - per explicit user request.
  shortageStatusVisible: { 3: true, 2: true, 1: true },
  ganttLoading: false,
  ganttError: null,
  expandedGanttJobs: new Set(),
  expandedOccupancyTypes: new Set(),
  // Same convention as /crew-bookings/'s own toolbar ("как в персонале" per
  // explicit user request): statusFilter is a >= threshold (1/2/3, not
  // independent per-stage toggles like Нехватки uses), groupBy inserts
  // group-header rows.
  ganttStatusFilter: 1,
  ganttGroupBy: "none",
};

// rank -> CSS class for coloring a job-level Gantt bar - same green/yellow/
// gray semantics as SHORTAGE_STATUS_BUCKETS' group colors, for visual
// consistency between Nехватки and Работы.
const GANTT_STATUS_CLASS = { 3: "status-confirmed", 2: "status-hold", 1: "status-request" };

// Group-by field accessors for Работы, keyed to match <select id="gantt-group-by">'s
// values - same shape as frontend-crew-bookings/app.js's own GROUP_FIELDS.
const GANTT_GROUP_FIELDS = {
  status: (j) => j.status,
  jobRef: (j) => j.jobRef,
  start: (j) => j.start,
};

function setWindow(startStr, length) {
  start = new Date(startStr + "T00:00:00");
  DAY_COUNT = Math.max(1, length);
  document.documentElement.style.setProperty("--day-count", DAY_COUNT);
}

// OCCUPANCY.types[].dayTotals is indexed from OCCUPANCY.start, which the
// server now computes to exactly match the requested window (see
// loadOccupancy/windowQuery) - this is normally a 0 offset, kept as a
// defensive re-index rather than assuming array position === visible day
// in case a render ever runs against not-yet-refreshed data.
function occupancyDayIndex(iso) {
  return daysBetween(OCCUPANCY.start + "T00:00:00", iso + "T00:00:00");
}

function renderDayHeaderCells() {
  const cells = [];
  const today = todayStr();
  for (let i = 0; i < DAY_COUNT; i++) {
    const d = addDays(start, i);
    const iso = fmt(d);
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const isToday = iso === today;
    const dateStr = `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
    cells.push(
      `<div class="cell day${isWeekend ? " weekend" : ""}${isToday ? " today" : ""}">
         <span class="date">${dateStr}</span>
       </div>`
    );
  }
  return cells.join("");
}

function occupancyHeaderRow() {
  return `<div class="row header">
    <div class="cell col-category">Категория</div>
    <div class="cell col-name">Оборудование</div>
    <div class="cell col-owned">В наличии</div>
    ${renderDayHeaderCells()}
  </div>`;
}

function qtyClass(qty, owned) {
  if (!qty) return "q-none";
  if (owned == null) return "q-unknown";
  if (qty > owned) return "q-short";
  if (qty === owned) return "q-tight";
  return "q-ok";
}

function occupancyTypeRow(type) {
  const expanded = state.expandedOccupancyTypes.has(type.typeId);
  const cells = [];
  for (let i = 0; i < DAY_COUNT; i++) {
    const iso = fmt(addDays(start, i));
    const dayIdx = occupancyDayIndex(iso);
    const qty = dayIdx >= 0 && dayIdx < type.dayTotals.length ? type.dayTotals[dayIdx] : null;
    if (qty === null) {
      cells.push(`<div class="day-qty"></div>`);
    } else {
      cells.push(`<div class="day-qty ${qtyClass(qty, type.siteOwns)}">${qty || ""}</div>`);
    }
  }
  return `<div class="row occupancy-row${expanded ? " expanded" : ""}" data-occupancy-type="${type.typeId}">
    <div class="cell col-category">
      <button type="button" class="occupancy-toggle" data-action="toggle-occupancy-type" data-type="${type.typeId}" title="Показать работы, использующие это оборудование">${expanded ? "−" : "+"}</button>
      ${type.categoryName || "—"}
    </div>
    <div class="cell col-name">${type.name}</div>
    <div class="cell col-owned">${type.siteOwns == null ? "?" : type.siteOwns}</div>
    <div class="day-cells">${cells.join("")}</div>
  </div>`;
}

// Sub-row shown when a type is expanded - one Gantt-style bar per
// contributing job line (OCCUPANCY.lines already carries jobRef/jobTitle/
// start/end/qty per type, no extra fetch needed), reusing ganttBarStyle so
// it lines up with the same day columns crew Bookings/Работы already use.
// Deliberately reuses the OCCUPANCY row's own grid-template (--left-category/
// --left-name/--left-owned), not the Gantt tab's (--gantt-left-*), so the
// bar-track starts exactly under the same day header the type row above it
// uses.
function occupancyJobBarRow(line) {
  const barStart = new Date(line.start + "T00:00:00");
  const barEnd = new Date(line.end + "T00:00:00");
  const colStart = daysBetween(start, barStart) + 1;
  const colEnd = daysBetween(start, barEnd) + 2;
  const clampedStart = Math.max(colStart, 1);
  const clampedEnd = Math.min(colEnd, DAY_COUNT + 1);
  const truncStart = colStart < 1;
  const truncEnd = colEnd > DAY_COUNT + 1;
  const overlaps = clampedStart < clampedEnd;
  const barHtml = overlaps
    ? `<div class="gantt-bar occ-job-bar${truncStart ? " trunc-start" : ""}${truncEnd ? " trunc-end" : ""}" style="${ganttBarStyle(clampedStart, clampedEnd, DAY_W)}" title="${line.jobRef}: ${line.start} → ${line.end}, ${line.qty} шт.">
        ${truncStart ? `<span class="trunc-marker left">&laquo;</span>` : ""}
        ${truncEnd ? `<span class="trunc-marker right">&raquo;</span>` : ""}
      </div>`
    : "";
  return `<div class="row occupancy-job-row">
    <div class="cell col-category"></div>
    <div class="cell col-name occupancy-job-name">
      <a class="occupancy-job-link" href="/create-job/?job=${encodeURIComponent(line.jobRef)}" target="_blank" rel="noopener">${line.jobRef}</a>
      <span class="occupancy-job-title">${line.jobTitle}</span>
    </div>
    <div class="cell col-owned">${line.qty}</div>
    <div class="gantt-bar-track" style="grid-column: 4 / -1;">${barHtml}</div>
  </div>`;
}

function typeHasShortageInWindow(type) {
  if (type.siteOwns == null) return false;
  for (let i = 0; i < DAY_COUNT; i++) {
    const iso = fmt(addDays(start, i));
    const dayIdx = occupancyDayIndex(iso);
    const qty = dayIdx >= 0 && dayIdx < type.dayTotals.length ? type.dayTotals[dayIdx] : 0;
    if (qty > type.siteOwns) return true;
  }
  return false;
}

function renderOccupancy() {
  const panel = document.getElementById("occupancy-panel");
  if (!OCCUPANCY) {
    panel.innerHTML = "";
    return;
  }
  const query = state.categoryFilter.trim().toLowerCase();
  let types = OCCUPANCY.types;
  if (query) {
    types = types.filter(
      (t) => t.name.toLowerCase().includes(query) || (t.categoryName || "").toLowerCase().includes(query)
    );
  }
  if (state.shortageOnly) {
    types = types.filter(typeHasShortageInWindow);
  }

  const rows = [occupancyHeaderRow()];
  for (const type of types) {
    rows.push(occupancyTypeRow(type));
    if (state.expandedOccupancyTypes.has(type.typeId)) {
      const lines = OCCUPANCY.lines.filter((l) => l.typeId === type.typeId).sort((a, b) => a.start.localeCompare(b.start));
      if (lines.length === 0) {
        rows.push(`<div class="occupancy-job-row-empty">Нет работ, использующих это оборудование в текущем периоде.</div>`);
      } else {
        rows.push(...lines.map(occupancyJobBarRow));
      }
    }
  }
  panel.innerHTML = rows.join("");
}

document.getElementById("occupancy-panel").addEventListener("click", (ev) => {
  const link = ev.target.closest(".occupancy-job-link");
  if (link) return; // let the link navigate normally
  const btn = ev.target.closest("button[data-action='toggle-occupancy-type']");
  if (!btn) return;
  const typeId = Number(btn.dataset.type);
  if (state.expandedOccupancyTypes.has(typeId)) state.expandedOccupancyTypes.delete(typeId);
  else state.expandedOccupancyTypes.add(typeId);
  renderOccupancy();
});

function render() {
  document.getElementById("occupancy-panel").classList.toggle("hidden", state.activeTab !== "occupancy");
  document.getElementById("shortages-panel").classList.toggle("hidden", state.activeTab !== "shortages");
  document.getElementById("jobs-panel").classList.toggle("hidden", state.activeTab !== "jobs");
  // The date-window toolbar itself (#window-toolbar) stays visible on every
  // tab - it's one shared filter driving all three modules. The occupancy-
  // and jobs-specific sub-controls are tab-conditional.
  document.getElementById("occupancy-only-filters").classList.toggle("hidden", state.activeTab !== "occupancy");
  document.getElementById("gantt-only-filters").classList.toggle("hidden", state.activeTab !== "jobs");

  if (state.activeTab === "occupancy") renderOccupancy();
  if (state.activeTab === "shortages") renderShortages();
  if (state.activeTab === "jobs") renderJobsGantt();
}

// Jobs Gantt uses the SAME shared date-window as Занятость/Nехватки (the
// #window-toolbar's start/DAY_COUNT) rather than auto-fitting to whatever
// jobs happen to be loaded - per explicit user request, the date filter is
// one unified control across all three tabs. JOBS_GANTT itself still comes
// from an unbounded fetch (the full future pipeline, not just the visible
// window - see hiretrack_planning_read.py's read_jobs_gantt), so shifting
// the window here is a pure re-render, no re-fetch needed.
function ganttWindow() {
  return { winStart: start, count: DAY_COUNT };
}

function ganttBarStyle(colStart, colEnd, dayW) {
  const left = (colStart - 1) * dayW;
  const width = Math.max(1, colEnd - colStart) * dayW;
  return `left:${left}px; width:${width}px;`;
}

function ganttGridTemplateColumns(count) {
  return `grid-template-columns: var(--gantt-left-toggle) var(--gantt-left-open) var(--gantt-left-ref) var(--gantt-left-title) repeat(${count}, var(--day-w));`;
}

function renderGanttHeader(winStart, count) {
  const cells = [
    `<div class="gantt-cell toggle"></div>`,
    `<div class="gantt-cell open"></div>`,
    `<div class="gantt-cell col-ref">Job</div>`,
    `<div class="gantt-cell col-title">Название</div>`,
  ];
  const today = todayStr();
  for (let i = 0; i < count; i++) {
    const d = addDays(winStart, i);
    const iso = fmt(d);
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const isToday = iso === today;
    const dateStr = `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
    cells.push(`<div class="gantt-cell day${isWeekend ? " weekend" : ""}${isToday ? " today" : ""}"><span class="date">${dateStr}</span></div>`);
  }
  return `<div class="gantt-row header" style="${ganttGridTemplateColumns(count)}">${cells.join("")}</div>`;
}

// statusClassName colors the bar by job stage (same green/yellow/gray
// scheme as Нехватки's status groups - see GANTT_STATUS_CLASS) - null for
// nested Eqlist/phase rows, which keep the neutral "phase" look instead.
// badgeText/openHref are both optional: badgeText renders as a labeled
// pill (never a bare number - see the "confusing numbers" fix below),
// openHref renders a small "open in create-job" link in its own column,
// left of Job/Название, only on job-level rows.
function renderGanttBarRow(id, refLabel, titleLabel, barStart, barEnd, winStart, count, extraRowClass, extraBarClass, badgeText, statusClassName, openHref) {
  const colStart = daysBetween(winStart, barStart) + 1;
  const colEnd = daysBetween(winStart, barEnd) + 2;
  const clampedStart = Math.max(colStart, 1);
  const clampedEnd = Math.min(colEnd, count + 1);
  const truncStart = colStart < 1;
  const truncEnd = colEnd > count + 1;
  const barHtml = clampedStart < clampedEnd
    ? `<div class="gantt-bar${extraBarClass ? " " + extraBarClass : ""}${statusClassName ? " " + statusClassName : ""}${truncStart ? " trunc-start" : ""}${truncEnd ? " trunc-end" : ""}" style="${ganttBarStyle(clampedStart, clampedEnd, DAY_W)}" title="${refLabel}: ${fmt(barStart)} → ${fmt(barEnd)}">
        ${truncStart ? `<span class="trunc-marker left">&laquo;</span>` : ""}
        ${truncEnd ? `<span class="trunc-marker right">&raquo;</span>` : ""}
      </div>`
    : "";
  const openCell = openHref
    ? `<a class="gantt-open-link" href="${openHref}" target="_blank" rel="noopener" title="Открыть работу">&#8599;</a>`
    : "";
  return `<div class="gantt-row${extraRowClass ? " " + extraRowClass : ""}" style="${ganttGridTemplateColumns(count)}" data-gantt-job="${id}">
    <div class="gantt-cell toggle"></div>
    <div class="gantt-cell open">${openCell}</div>
    <div class="gantt-cell col-ref">${refLabel}</div>
    <div class="gantt-cell col-title">${titleLabel}${badgeText ? ` <span class="gantt-badge">${badgeText}</span>` : ""}</div>
    <div class="gantt-bar-track" style="grid-column: 5 / -1;">${barHtml}</div>
  </div>`;
}

function renderGanttGroupHeaderRow(label, count) {
  return `<div class="gantt-row group-header" style="${ganttGridTemplateColumns(count)}">
    <div class="gantt-cell toggle"></div>
    <div class="gantt-cell open"></div>
    <div class="gantt-cell col-ref group-label" style="grid-column: 3 / 5;">${label}</div>
    <div class="gantt-bar-track" style="grid-column: 5 / -1;"></div>
  </div>`;
}

function renderJobsGantt() {
  const panel = document.getElementById("jobs-panel");

  if (state.ganttLoading && !JOBS_GANTT) {
    panel.innerHTML = `<p class="placeholder">Загрузка работ…</p>`;
    return;
  }
  if (state.ganttError && !JOBS_GANTT) {
    panel.innerHTML = `<p class="placeholder error">Не удалось получить работы: ${state.ganttError}</p>`;
    return;
  }
  const win = ganttWindow();
  if (!JOBS_GANTT) {
    panel.innerHTML = `<p class="placeholder">Нет данных.</p>`;
    return;
  }

  // Only render jobs whose own [start, end] overlaps the current shared
  // window - JOBS_GANTT itself holds the full future pipeline (unbounded
  // fetch), so without this a 7-day window would still list all 72+ jobs
  // with empty bars.
  const winEnd = addDays(win.winStart, win.count - 1);
  let visibleJobs = JOBS_GANTT.jobs.filter((job) => {
    const jobStart = new Date(job.start + "T00:00:00");
    const jobEnd = new Date(job.end + "T00:00:00");
    return jobStart <= winEnd && jobEnd >= win.winStart;
  });

  // Same >= threshold convention as /crew-bookings/'s own status filter.
  visibleJobs = visibleJobs.filter((job) => (job.statusRank ?? 0) >= state.ganttStatusFilter);

  if (visibleJobs.length === 0) {
    panel.innerHTML = `<p class="placeholder">Нет работ в текущем периоде.</p>`;
    return;
  }

  const groupKey = GANTT_GROUP_FIELDS[state.ganttGroupBy];
  if (groupKey) {
    visibleJobs = [...visibleJobs].sort((a, b) => String(groupKey(a)).localeCompare(String(groupKey(b)), "ru"));
  }

  const rows = [renderGanttHeader(win.winStart, win.count)];
  let lastGroup;
  for (const job of visibleJobs) {
    if (groupKey) {
      const key = groupKey(job);
      if (key !== lastGroup) {
        rows.push(renderGanttGroupHeaderRow(key, win.count));
        lastGroup = key;
      }
    }

    const expanded = state.expandedGanttJobs.has(job.jobId);
    const jobStart = new Date(job.start + "T00:00:00");
    const jobEnd = new Date(job.end + "T00:00:00");
    // Never a bare number after the title - see the "confusing digits" fix:
    // always spelled out, e.g. "6 списков", only shown when there's more
    // than one Eqlist to distinguish.
    const jobBadge = job.eqlists.length > 1 ? `${job.eqlists.length} списков` : null;
    const openHref = `/create-job/?job=${encodeURIComponent(job.jobRef)}`;
    rows.push(
      `<div class="gantt-toggle-wrap" data-gantt-job="${job.jobId}">
        ${renderGanttBarRow(job.jobId, job.jobRef, job.jobTitle, jobStart, jobEnd, win.winStart, win.count, "gantt-job", "", jobBadge, GANTT_STATUS_CLASS[job.statusRank], openHref)}
      </div>`
    );
    if (expanded) {
      for (const eq of job.eqlists) {
        const eqStart = new Date(eq.dateOut + "T00:00:00");
        const eqEnd = new Date(eq.dateBack + "T00:00:00");
        rows.push(
          renderGanttBarRow(
            job.jobId,
            "",
            eq.eqlTitle || eq.eqlName,
            eqStart,
            eqEnd,
            win.winStart,
            win.count,
            "gantt-eqlist",
            "phase",
            `${eq.lineCount} поз.`,
            null,
            null
          )
        );
      }
    }
  }
  panel.innerHTML = `<div class="gantt-toolbar-row"><button type="button" id="gantt-expand-all">Развернуть всё</button><button type="button" id="gantt-collapse-all">Свернуть всё</button></div>${rows.join("")}`;

  document.getElementById("gantt-expand-all")?.addEventListener("click", () => {
    JOBS_GANTT.jobs.forEach((j) => state.expandedGanttJobs.add(j.jobId));
    renderJobsGantt();
  });
  document.getElementById("gantt-collapse-all")?.addEventListener("click", () => {
    state.expandedGanttJobs.clear();
    renderJobsGantt();
  });
}

document.getElementById("jobs-panel").addEventListener("click", (ev) => {
  if (ev.target.closest(".gantt-open-link")) return; // let the link navigate normally
  const row = ev.target.closest(".gantt-row.gantt-job");
  if (!row) return;
  const jobId = Number(row.dataset.ganttJob);
  if (state.expandedGanttJobs.has(jobId)) state.expandedGanttJobs.delete(jobId);
  else state.expandedGanttJobs.add(jobId);
  renderJobsGantt();
});

async function loadJobsGantt(options) {
  const forceRefresh = options && options.forceRefresh;
  const url = forceRefresh ? "/api/planning/jobs-gantt?refresh=1" : "/api/planning/jobs-gantt";
  state.ganttLoading = true;
  state.ganttError = null;
  renderJobsGantt();
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(text || `HTTP ${resp.status}`);
    }
    JOBS_GANTT = await resp.json();
  } catch (e) {
    state.ganttError = e.message;
  } finally {
    state.ganttLoading = false;
    renderJobsGantt();
  }
}

function shortageDayLabel(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

// rank 3/2/1 match jobStatusRank's own bucketing - see read_defcon's
// comment in hiretrack_planning_read.py. Listed high to low priority per
// explicit user request (Подтверждено first, Запрос last).
const SHORTAGE_STATUS_BUCKETS = [
  { rank: 3, label: "Подтверждено", className: "confirmed" },
  { rank: 2, label: "Бронь", className: "hold" },
  { rank: 1, label: "Запрос", className: "request" },
];

function renderShortageStatusToggles() {
  return `<div class="shortage-status-toggles">
    ${SHORTAGE_STATUS_BUCKETS.map(
      (b) => `<label class="shortage-status-toggle status-${b.className}">
        <input type="checkbox" data-status-rank="${b.rank}" ${state.shortageStatusVisible[b.rank] ? "checked" : ""}>
        ${b.label}
      </label>`
    ).join("")}
  </div>`;
}

function renderShortageJobRow(job) {
  const expanded = state.expandedShortageJobs.has(job.jobId);
  const detailRows = job.shortages
    .map((s) => {
      const range = s.dayStart === s.dayEnd ? shortageDayLabel(s.dayStart) : `${shortageDayLabel(s.dayStart)} – ${shortageDayLabel(s.dayEnd)}`;
      return `<div class="shortage-detail-row">
        <span class="shortage-detail-day">${range}</span>
        <span class="shortage-detail-name">${s.typeName}</span>
        <span class="shortage-detail-nums">нужно ${s.booked}, в наличии ${s.owned}${s.availableQty != null ? `, доступно ${s.availableQty}` : ""}</span>
      </div>`;
    })
    .join("");
  return `<div class="shortage-job${expanded ? " expanded" : ""}">
    <button type="button" class="shortage-job-header" data-action="toggle-shortage-job" data-job="${job.jobId}">
      <span class="toggle-icon">${expanded ? "−" : "+"}</span>
      <span class="shortage-job-ref">${job.jobRef}</span>
      <span class="shortage-job-title">${job.jobTitle}</span>
      <span class="shortage-count-badge">${job.shortages.length}</span>
      <a class="shortage-open-link" href="/create-job/?job=${encodeURIComponent(job.jobRef)}" target="_blank" rel="noopener">Открыть →</a>
    </button>
    ${expanded ? `<div class="shortage-job-details">${detailRows}</div>` : ""}
  </div>`;
}

function renderShortages() {
  const panel = document.getElementById("shortages-panel");

  if (state.shortagesLoading && !SHORTAGES) {
    panel.innerHTML = `${renderShortageStatusToggles()}<p class="placeholder">Проверяю нехватки через HireTrack — см. прогресс выше.</p>`;
    return;
  }
  if (state.shortagesError && !SHORTAGES) {
    panel.innerHTML = `${renderShortageStatusToggles()}<p class="placeholder error">Не удалось получить нехватки: ${state.shortagesError}</p>`;
    return;
  }
  if (!SHORTAGES) {
    panel.innerHTML = `${renderShortageStatusToggles()}<p class="placeholder">Нет данных.</p>`;
    return;
  }

  const visibleJobs = SHORTAGES.jobs.filter((job) => state.shortageStatusVisible[job.jobStatusRank] !== false);
  if (visibleJobs.length === 0) {
    const message =
      SHORTAGES.jobs.length > 0
        ? "Нет видимых нехваток — все стадии со статусом скрыты переключателями выше."
        : `Нехваток не найдено (${OCCUPANCY ? `${shortageDayLabel(OCCUPANCY.start)} — ${shortageDayLabel(OCCUPANCY.end)}` : "текущий горизонт"}).`;
    panel.innerHTML = `${renderShortageStatusToggles()}<p class="placeholder">${message}</p>`;
    return;
  }

  const groups = SHORTAGE_STATUS_BUCKETS.map((bucket) => ({
    bucket,
    jobs: visibleJobs.filter((j) => j.jobStatusRank === bucket.rank).sort((a, b) => a.jobRef.localeCompare(b.jobRef, "ru")),
  })).filter((g) => g.jobs.length > 0);

  const sections = groups
    .map(
      (g) => `<div class="shortage-status-group status-${g.bucket.className}">
        <div class="shortage-status-group-header">${g.bucket.label} <span class="shortage-count-badge">${g.jobs.length}</span></div>
        ${g.jobs.map(renderShortageJobRow).join("")}
      </div>`
    )
    .join("");

  panel.innerHTML = `${renderShortageStatusToggles()}<div class="shortage-meta">Обновлено: ${new Date(SHORTAGES.generatedAt).toLocaleString("ru-RU")}</div>${sections}`;
}

document.getElementById("shortages-panel").addEventListener("change", (ev) => {
  const checkbox = ev.target.closest("input[data-status-rank]");
  if (!checkbox) return;
  state.shortageStatusVisible[Number(checkbox.dataset.statusRank)] = checkbox.checked;
  renderShortages();
});

document.getElementById("shortages-panel").addEventListener("click", (ev) => {
  const link = ev.target.closest(".shortage-open-link");
  if (link) return; // let the link navigate normally
  const btn = ev.target.closest("button[data-action='toggle-shortage-job']");
  if (!btn) return;
  const jobId = Number(btn.dataset.job);
  if (state.expandedShortageJobs.has(jobId)) state.expandedShortageJobs.delete(jobId);
  else state.expandedShortageJobs.add(jobId);
  renderShortages();
});

const shortagesProgressEl = document.getElementById("shortages-progress");
const shortagesProgressFillEl = document.getElementById("shortages-progress-fill");
const shortagesProgressTextEl = document.getElementById("shortages-progress-text");
let shortagesProgressTimer = null;

async function pollShortagesProgress() {
  try {
    const resp = await fetch("/api/planning/shortages/progress");
    if (!resp.ok) return;
    const { total, done } = await resp.json();
    if (total === 0) {
      shortagesProgressEl.classList.remove("hidden");
      shortagesProgressFillEl.style.width = "0%";
      shortagesProgressTextEl.textContent = "Подготовка проверки нехваток…";
      return;
    }
    shortagesProgressEl.classList.remove("hidden");
    shortagesProgressFillEl.style.width = `${Math.round((done / total) * 100)}%`;
    shortagesProgressTextEl.textContent = `Проверка нехваток через HireTrack: ${done} / ${total}`;
  } catch (e) {
    // A failed poll tick just skips this update - the next tick retries.
  }
}

function startShortagesProgressPolling() {
  stopShortagesProgressPolling();
  pollShortagesProgress();
  shortagesProgressTimer = setInterval(pollShortagesProgress, 1000);
}

function stopShortagesProgressPolling() {
  if (shortagesProgressTimer) {
    clearInterval(shortagesProgressTimer);
    shortagesProgressTimer = null;
  }
  shortagesProgressEl.classList.add("hidden");
}

// Builds the shared-window query string every planning endpoint accepts
// (start/days) - defaults to the CURRENT shared window (module-level
// start/DAY_COUNT) when the caller doesn't override it, so most call sites
// don't need to pass start/days explicitly at all.
function windowQuery(options) {
  const opts = options || {};
  const params = new URLSearchParams({
    start: opts.start || fmt(start),
    days: String(opts.days != null ? opts.days : DAY_COUNT),
  });
  if (opts.forceRefresh) params.set("refresh", "1");
  return params.toString();
}

async function loadShortages(options) {
  const url = `/api/planning/shortages?${windowQuery(options)}`;
  state.shortagesLoading = true;
  state.shortagesError = null;
  renderShortages();
  startShortagesProgressPolling();
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(text || `HTTP ${resp.status}`);
    }
    SHORTAGES = await resp.json();
  } catch (e) {
    state.shortagesError = e.message;
  } finally {
    state.shortagesLoading = false;
    stopShortagesProgressPolling();
    renderShortages();
  }
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
    state.activeTab = btn.dataset.tab;
    render();
    if (state.activeTab === "shortages" && !SHORTAGES && !state.shortagesLoading) {
      loadShortages();
    }
    if (state.activeTab === "jobs" && !JOBS_GANTT && !state.ganttLoading) {
      loadJobsGantt();
    }
  });
});

async function loadOccupancy(options) {
  const url = `/api/planning/occupancy?${windowQuery(options)}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(text || `HTTP ${resp.status}`);
  }
  OCCUPANCY = await resp.json();
}

document.getElementById("refresh-data").addEventListener("click", async () => {
  const btn = document.getElementById("refresh-data");
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Обновляю...";
  try {
    if (state.activeTab === "shortages") {
      // Shortages/jobs do their own real-time loading/error rendering -
      // avoid racing them with a second render() call from here.
      await loadShortages({ forceRefresh: true });
    } else if (state.activeTab === "jobs") {
      await loadJobsGantt({ forceRefresh: true });
    } else {
      await loadOccupancy({ forceRefresh: true });
      render();
    }
    btn.textContent = "Обновлено!";
  } catch (e) {
    console.error(e);
    alert("Не удалось получить свежие данные из HireTrack: " + e.message);
    btn.textContent = "Ошибка";
  } finally {
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = originalText;
    }, 1500);
  }
});

const windowStartInput = document.getElementById("window-start");
const windowStartDisplay = document.getElementById("window-start-display");
const presetButtons = Array.from(document.querySelectorAll(".preset-btn"));

function updateStartDisplay(iso) {
  const [y, m, d] = iso.split("-");
  windowStartDisplay.textContent = `${d}-${m}-${y}`;
}

function markActivePreset() {
  presetButtons.forEach((b) => b.classList.toggle("active", Number(b.dataset.days) === DAY_COUNT));
}

// Shifting the shared window (back/forward day/week, a preset, or typing a
// date) now refetches occupancy - and shortages too, if that tab has
// already been opened at least once - since both are server-side windowed
// (see hiretrack_planning_read.py), not just re-sliced from a wider
// pre-fetched range. Jobs Gantt needs no re-fetch (its own data is an
// unbounded fetch already) - render() alone picks up the new window there.
async function applyWindow(startStr, length) {
  setWindow(startStr, length);
  windowStartInput.value = startStr;
  updateStartDisplay(startStr);
  markActivePreset();

  const loadStatus = document.getElementById("load-status");
  loadStatus.textContent = "Обновляю данные для выбранного периода…";
  loadStatus.classList.remove("error");
  loadStatus.style.display = "";
  try {
    const tasks = [loadOccupancy()];
    if (SHORTAGES !== null) tasks.push(loadShortages());
    await Promise.all(tasks);
    loadStatus.style.display = "none";
  } catch (e) {
    console.error(e);
    loadStatus.textContent = "Не удалось обновить данные: " + e.message;
    loadStatus.classList.add("error");
  }
  render();
}

windowStartInput.addEventListener("change", () => {
  applyWindow(windowStartInput.value || fmt(start), DAY_COUNT);
});
document.getElementById("window-today").addEventListener("click", () => {
  applyWindow(todayStr(), DAY_COUNT);
});
document.getElementById("window-back-week").addEventListener("click", () => {
  applyWindow(fmt(addDays(start, -7)), DAY_COUNT);
});
document.getElementById("window-back-day").addEventListener("click", () => {
  applyWindow(fmt(addDays(start, -1)), DAY_COUNT);
});
document.getElementById("window-fwd-day").addEventListener("click", () => {
  applyWindow(fmt(addDays(start, 1)), DAY_COUNT);
});
document.getElementById("window-fwd-week").addEventListener("click", () => {
  applyWindow(fmt(addDays(start, 7)), DAY_COUNT);
});
presetButtons.forEach((btn) => {
  btn.addEventListener("click", () => applyWindow(windowStartInput.value || fmt(start), Number(btn.dataset.days)));
});

document.getElementById("category-filter").addEventListener("input", (ev) => {
  state.categoryFilter = ev.target.value;
  render();
});
document.getElementById("shortage-only").addEventListener("change", (ev) => {
  state.shortageOnly = ev.target.checked;
  render();
});

document.getElementById("gantt-status-filter").addEventListener("change", (ev) => {
  state.ganttStatusFilter = Number(ev.target.value);
  renderJobsGantt();
});
document.getElementById("gantt-group-by").addEventListener("change", (ev) => {
  state.ganttGroupBy = ev.target.value;
  renderJobsGantt();
});

async function boot() {
  await applyWindow(todayStr(), DAY_COUNT);
}

boot();
