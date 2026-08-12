const DOW_FULL = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const DAY_W = 42; // keep in sync with --day-w in styles.css

let OCCUPANCY = null; // { start, end, types, lines }
let SHORTAGES = null; // { generatedAt, jobs }
let JOBS_GANTT = null; // { generatedAt, jobs }
let start = new Date();
let DAY_COUNT = 30;

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
  ganttLoading: false,
  ganttError: null,
  expandedGanttJobs: new Set(),
};

function setWindow(startStr, length) {
  start = new Date(startStr + "T00:00:00");
  DAY_COUNT = Math.max(1, length);
  document.documentElement.style.setProperty("--day-count", DAY_COUNT);
}

// OCCUPANCY.types[].dayTotals is indexed from OCCUPANCY.start (always today
// at load time), not from the visible window's own `start` - this maps a
// visible-window day index back into that fixed array.
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
  return `<div class="row occupancy-row">
    <div class="cell col-category">${type.categoryName || "—"}</div>
    <div class="cell col-name">${type.name}</div>
    <div class="cell col-owned">${type.siteOwns == null ? "?" : type.siteOwns}</div>
    <div class="day-cells">${cells.join("")}</div>
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
  rows.push(...types.map(occupancyTypeRow));
  panel.innerHTML = rows.join("");
}

function render() {
  document.getElementById("occupancy-panel").classList.toggle("hidden", state.activeTab !== "occupancy");
  document.getElementById("shortages-panel").classList.toggle("hidden", state.activeTab !== "shortages");
  document.getElementById("jobs-panel").classList.toggle("hidden", state.activeTab !== "jobs");
  document.getElementById("occupancy-toolbar").classList.toggle("hidden", state.activeTab !== "occupancy");

  if (state.activeTab === "occupancy") renderOccupancy();
  if (state.activeTab === "shortages") renderShortages();
  if (state.activeTab === "jobs") renderJobsGantt();
}

// Jobs Gantt has no window controls of its own - it auto-fits its day
// range to the loaded jobs' own min(start)/max(end) instead, since (unlike
// occupancy's fixed 60-day horizon) job spans vary wildly and there's no
// single "today-relative" window that makes sense to default to.
function ganttWindow() {
  if (!JOBS_GANTT || JOBS_GANTT.jobs.length === 0) return null;
  const starts = JOBS_GANTT.jobs.map((j) => new Date(j.start + "T00:00:00"));
  const ends = JOBS_GANTT.jobs.map((j) => new Date(j.end + "T00:00:00"));
  const winStart = new Date(Math.min(...starts));
  const winEnd = new Date(Math.max(...ends));
  const count = daysBetween(winStart, winEnd) + 1;
  return { winStart, count: Math.max(1, count) };
}

function ganttBarStyle(colStart, colEnd, dayW) {
  const left = (colStart - 1) * dayW;
  const width = Math.max(1, colEnd - colStart) * dayW;
  return `left:${left}px; width:${width}px;`;
}

function renderGanttHeader(winStart, count) {
  const cells = [`<div class="gantt-cell toggle"></div>`, `<div class="gantt-cell col-ref">Job</div>`, `<div class="gantt-cell col-title">Название</div>`];
  const today = todayStr();
  for (let i = 0; i < count; i++) {
    const d = addDays(winStart, i);
    const iso = fmt(d);
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const isToday = iso === today;
    const dateStr = `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
    cells.push(`<div class="gantt-cell day${isWeekend ? " weekend" : ""}${isToday ? " today" : ""}"><span class="date">${dateStr}</span></div>`);
  }
  return `<div class="gantt-row header" style="grid-template-columns: var(--gantt-left-toggle) var(--gantt-left-ref) var(--gantt-left-title) repeat(${count}, var(--day-w));">${cells.join("")}</div>`;
}

function renderGanttBarRow(id, refLabel, titleLabel, barStart, barEnd, winStart, count, extraRowClass, extraBarClass, badge) {
  const colStart = daysBetween(winStart, barStart) + 1;
  const colEnd = daysBetween(winStart, barEnd) + 2;
  const clampedStart = Math.max(colStart, 1);
  const clampedEnd = Math.min(colEnd, count + 1);
  const barHtml = clampedStart < clampedEnd
    ? `<div class="gantt-bar${extraBarClass ? " " + extraBarClass : ""}" style="${ganttBarStyle(clampedStart, clampedEnd, DAY_W)}" title="${refLabel}: ${fmt(barStart)} → ${fmt(barEnd)}"></div>`
    : "";
  return `<div class="gantt-row${extraRowClass ? " " + extraRowClass : ""}" style="grid-template-columns: var(--gantt-left-toggle) var(--gantt-left-ref) var(--gantt-left-title) repeat(${count}, var(--day-w));" data-gantt-job="${id}">
    <div class="gantt-cell toggle"></div>
    <div class="gantt-cell col-ref">${refLabel}</div>
    <div class="gantt-cell col-title">${titleLabel}${badge != null ? ` <span class="gantt-badge">${badge}</span>` : ""}</div>
    <div class="gantt-bar-track" style="grid-column: 4 / -1;">${barHtml}</div>
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
  if (!JOBS_GANTT || !win) {
    panel.innerHTML = `<p class="placeholder">Нет работ в горизонте планирования.</p>`;
    return;
  }

  const rows = [renderGanttHeader(win.winStart, win.count)];
  for (const job of JOBS_GANTT.jobs) {
    const expanded = state.expandedGanttJobs.has(job.jobId);
    const jobStart = new Date(job.start + "T00:00:00");
    const jobEnd = new Date(job.end + "T00:00:00");
    rows.push(
      `<div class="gantt-toggle-wrap" data-gantt-job="${job.jobId}">
        ${renderGanttBarRow(job.jobId, job.jobRef, job.jobTitle, jobStart, jobEnd, win.winStart, win.count, "gantt-job", "", job.eqlists.length > 1 ? job.eqlists.length : null)}
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
            eq.lineCount
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

function renderShortages() {
  const panel = document.getElementById("shortages-panel");

  if (state.shortagesLoading && !SHORTAGES) {
    panel.innerHTML = `<p class="placeholder">Проверяю нехватки через HireTrack — см. прогресс выше.</p>`;
    return;
  }
  if (state.shortagesError && !SHORTAGES) {
    panel.innerHTML = `<p class="placeholder error">Не удалось получить нехватки: ${state.shortagesError}</p>`;
    return;
  }
  if (!SHORTAGES) {
    panel.innerHTML = `<p class="placeholder">Нет данных.</p>`;
    return;
  }
  if (SHORTAGES.jobs.length === 0) {
    const horizon = OCCUPANCY ? `${shortageDayLabel(OCCUPANCY.start)} — ${shortageDayLabel(OCCUPANCY.end)}` : "текущий горизонт";
    panel.innerHTML = `<p class="placeholder">Нехваток не найдено (${horizon}).</p>`;
    return;
  }

  const rows = SHORTAGES.jobs.map((job) => {
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
  });

  panel.innerHTML = `<div class="shortage-meta">Обновлено: ${new Date(SHORTAGES.generatedAt).toLocaleString("ru-RU")}</div>${rows.join("")}`;
}

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

async function loadShortages(options) {
  const forceRefresh = options && options.forceRefresh;
  const url = forceRefresh ? "/api/planning/shortages?refresh=1" : "/api/planning/shortages";
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
  const forceRefresh = options && options.forceRefresh;
  const url = forceRefresh ? "/api/planning/occupancy?refresh=1" : "/api/planning/occupancy";
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

function applyWindow(startStr, length) {
  setWindow(startStr, length);
  windowStartInput.value = startStr;
  updateStartDisplay(startStr);
  markActivePreset();
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

async function boot() {
  const loadStatus = document.getElementById("load-status");
  try {
    await loadOccupancy();
    loadStatus.style.display = "none";
  } catch (e) {
    console.error(e);
    loadStatus.textContent = "Не удалось загрузить данные из HireTrack: " + e.message;
    loadStatus.classList.add("error");
  }
  applyWindow(todayStr(), DAY_COUNT);
}

boot();
