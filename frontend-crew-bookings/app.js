const DOW_FULL = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const STATUS_CLASS = {
  "Подтверждено": "status-Подтверждено",
  "Бронь": "status-Бронь",
  "В работе": "status-В-работе",
};
const DAY_W = 100; // keep in sync with --day-w in styles.css

let JOBS = [];
let CREW = [];
let start = new Date();
let end = new Date();
let DAY_COUNT = 14;

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}
// Local calendar date, NOT toISOString().slice(0,10) - toISOString() converts
// to UTC first, which silently shifts every date one day back for anyone
// east of UTC (e.g. Moscow, UTC+3: local midnight is still "yesterday" in
// UTC). That bug showed up as every "Day N" label and the "Сегодня"
// highlight being off by one day, even though the underlying DB data (which
// day actually has coverage) was always correct.
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

// Top-bar window controls: pick the first visible day column and how many
// days to show (3/7/14/30 presets or a custom count) — days scroll, the
// left Job/Название/Crew Boss columns stay put (position:sticky in CSS).
function setWindow(startStr, length) {
  start = new Date(startStr + "T00:00:00");
  DAY_COUNT = Math.max(1, length);
  end = addDays(start, DAY_COUNT - 1);
  document.documentElement.style.setProperty("--day-count", DAY_COUNT);
}

function dayIndex(dateStr) {
  return daysBetween(start, new Date(dateStr + "T00:00:00"));
}
function colFor(dateStr) {
  return dayIndex(dateStr) + 1; // column 1 of the day-track = first day
}

// "Day N" is a real HireTrack field (CrewActivities.Description literally
// says "Day 1"/"Day 2"/etc) - anchored to the PHASE's own start date, not
// the job's "Due Out". They usually match, but not always (confirmed live:
// job.start can be one day after the phase's actual activity range starts),
// and using job.start there produced "Day 0" instead of "Day 1".
function jobDayNumber(phase, dateStr) {
  return daysBetween(new Date(phase.start + "T00:00:00"), new Date(dateStr + "T00:00:00")) + 1;
}

const state = {
  expandedJobs: new Set(),
  expandedPhases: new Set(), // key: `${jobId}::${phaseIdx}`
  statusFilter: 1, // show jobs with statusRank >= this (defcon.SortOrder)
  groupBy: "none",
  assignErrors: new Map(), // key: `${jobId}::${phaseIdx}::${posIdx}` -> message
  assignPending: new Set(), // key: `${jobId}::${phaseIdx}::${posIdx}`
  // Text typed but not yet confirmed, per position. Without this, confirming
  // one row triggers a full re-render (to show its own pending/success
  // state) that wipes whatever you'd started typing into any OTHER
  // not-yet-confirmed row - this is what made "fill in several positions,
  // only one sticks" happen.
  pendingInput: new Map(),
};

// Group-by field accessors, keyed to match the <select id="group-by"> values.
const GROUP_FIELDS = {
  id: (j) => j.id,
  name: (j) => j.name,
  jobType: (j) => j.jobType || "—",
  venue: (j) => j.venue || "—",
  client: (j) => j.client || "—",
  start: (j) => j.start,
};

function renderHeader() {
  const cells = [
    `<div class="cell toggle"></div>`,
    `<div class="cell col-job">Job</div>`,
    `<div class="cell col-name">Название</div>`,
    `<div class="cell col-crew">Crew Boss</div>`,
  ];
  const today = todayStr();
  for (let i = 0; i < DAY_COUNT; i++) {
    const d = addDays(start, i);
    const iso = fmt(d);
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    const isToday = iso === today;
    const dateStr = `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
    cells.push(
      `<div class="cell day${isWeekend ? " weekend" : ""}${isToday ? " today" : ""}">
         <span class="date">${dateStr}</span>
         <span class="dow">${DOW_FULL[d.getDay()]}</span>
       </div>`
    );
  }
  return `<div class="row header">${cells.join("")}</div>`;
}

function barStyle(s, e) {
  const left = (s - 1) * DAY_W;
  const width = Math.max(1, e - s) * DAY_W;
  return `left:${left}px; width:${width}px;`;
}

function renderJobRow(job) {
  const expanded = state.expandedJobs.has(job.id);
  const jobStart = new Date(job.start + "T00:00:00");
  const jobEnd = new Date(job.end + "T00:00:00");
  const statusClass = STATUS_CLASS[job.status] || "";

  const s = colFor(job.start); // may be < 1 if the job started before the window
  const e = colFor(job.end) + 1; // may be > DAY_COUNT+1 if it ends after the window
  const sClamped = Math.max(s, 1);
  const eClamped = Math.min(e, DAY_COUNT + 1);
  const overlapsWindow = sClamped < eClamped;
  const truncStart = s < 1; // job runs off the left edge of the visible window
  const truncEnd = e > DAY_COUNT + 1; // job runs off the right edge

  const showStart = !truncStart && jobStart >= start && jobStart <= end;
  const showEnd = !truncEnd && jobEnd >= start && jobEnd <= end;

  // Start/End labels are children of .bar so "just outside the bar" is relative
  // to the bar itself, not the whole day-track — otherwise their position drifts
  // once the bar gets clamped/truncated by the window filter.
  const barHtml = overlapsWindow
    ? `<div class="bar${truncStart ? " trunc-start" : ""}${truncEnd ? " trunc-end" : ""}" style="${barStyle(sClamped, eClamped)}" title="${job.name}: ${job.start} → ${job.end}">
        ${truncStart ? `<span class="trunc-marker left">&laquo;</span>` : ""}
        ${truncEnd ? `<span class="trunc-marker right">&raquo;</span>` : ""}
        ${showStart ? `<span class="bar-label start">Job Starts</span>` : ""}
        ${showEnd ? `<span class="bar-label end">Job Ends</span>` : ""}
      </div>`
    : "";

  return `<div class="row job${expanded ? " expanded" : ""}" data-job="${job.id}">
    <div class="cell toggle">
      <button class="toggle-btn" data-action="toggle-job" data-job="${job.id}">${expanded ? "−" : "+"}</button>
    </div>
    <div class="cell col-job">
      <span class="job-code">${job.id}</span> <span class="job-status ${statusClass}">[${job.status}]</span>
    </div>
    <div class="cell col-name">${job.name}</div>
    <div class="cell col-crew">${job.crewBoss}</div>
    <div class="bar-track">
      ${barHtml}
    </div>
  </div>`;
}

function renderPhaseRow(job, phase, phaseIdx) {
  const key = `${job.id}::${phaseIdx}`;
  const expanded = state.expandedPhases.has(key);
  const total = phase.positions.reduce((sum, p) => sum + (p.qtyPerDay || []).reduce((a, b) => a + b, 0), 0);
  const dayNumCells = [];
  for (let i = 0; i < DAY_COUNT; i++) {
    const iso = fmt(addDays(start, i));
    const inPhase = iso >= phase.start && iso <= phase.end;
    dayNumCells.push(
      inPhase ? `<div class="cell day-num">Day ${jobDayNumber(phase, iso)}</div>` : `<div class="cell day-num empty"></div>`
    );
  }

  return `<div class="row phase" data-job="${job.id}" data-phase="${phaseIdx}">
    <div class="cell toggle">
      <button class="toggle-btn" data-action="toggle-phase" data-job="${job.id}" data-phase="${phaseIdx}">${expanded ? "−" : "+"}</button>
    </div>
    <div class="cell col-job"></div>
    <div class="cell col-name">${phase.name} <span class="count-badge">${total}</span></div>
    <div class="cell col-crew"></div>
    ${dayNumCells.join("")}
  </div>`;
}

function renderPositionHeaderRow(job, phaseIdx) {
  return `<div class="row position-header" data-job="${job.id}" data-phase="${phaseIdx}">
    <div class="cell toggle"></div>
    <div class="cell col-job">Role</div>
    <div class="cell col-name">Position</div>
    <div class="cell col-crew">Position Description</div>
  </div>`;
}

function renderPhaseFooterRow(job, phase, phaseIdx) {
  const cells = [];
  for (let i = 0; i < DAY_COUNT; i++) {
    const iso = fmt(addDays(start, i));
    const inPhase = iso >= phase.start && iso <= phase.end;
    if (!inPhase) {
      cells.push(`<div class="cell day-num empty"></div>`);
      continue;
    }
    const dayInPhase = daysBetween(new Date(phase.start + "T00:00:00"), new Date(iso + "T00:00:00"));
    const count = phase.positions.reduce((sum, p) => sum + ((p.qtyPerDay || [])[dayInPhase] || 0), 0);
    cells.push(`<div class="cell day-num">Day ${jobDayNumber(phase, iso)}(${count})</div>`);
  }
  return `<div class="row phase-footer" data-job="${job.id}" data-phase="${phaseIdx}">
    <div class="cell toggle"></div>
    <div class="cell col-job"></div>
    <div class="cell col-name">${phase.name}</div>
    <div class="cell col-crew"></div>
    ${cells.join("")}
  </div>`;
}

function qtyClass(q) {
  if (!q) return "q0";
  if (q === 1) return "q1";
  if (q === 2) return "q2";
  if (q === 3) return "q3";
  return "q4";
}

function renderPositionRow(job, phase, position, phaseIdx, posIdx) {
  const s = colFor(phase.start);
  const assigned = !!position.assignee;
  const dayCells = [];
  for (let i = 0; i < DAY_COUNT; i++) {
    const dayInPhase = i - (s - 1);
    const q = dayInPhase >= 0 && dayInPhase < (position.qtyPerDay || []).length ? position.qtyPerDay[dayInPhase] : null;
    if (q === null) {
      dayCells.push(`<div class="day-qty"></div>`);
    } else if (assigned) {
      dayCells.push(`<div class="day-qty ${q ? "assigned" : ""}"></div>`);
    } else {
      dayCells.push(`<div class="day-qty ${qtyClass(q)}">${q}</div>`);
    }
  }
  const key = `${job.id}::${phaseIdx}::${posIdx}`;
  const pending = state.assignPending.has(key);
  const error = state.assignErrors.get(key);
  return `<div class="row position${assigned ? " assigned" : ""}">
    <div class="cell toggle"></div>
    <div class="cell col-job role-name">${position.role}</div>
    <div class="cell col-name assignee-cell">
      <div class="assignee-field">
        <input
          class="assignee-input"
          type="text"
          autocomplete="off"
          placeholder="Unprocessed — назначить..."
          value="${state.pendingInput.has(key) ? state.pendingInput.get(key) : (position.assignee || "")}"
          data-job="${job.id}" data-phase="${phaseIdx}" data-pos="${posIdx}"
          ${pending ? "disabled" : ""}
        />
        <button
          type="button"
          class="assignee-confirm"
          data-action="confirm-assignee"
          data-job="${job.id}" data-phase="${phaseIdx}" data-pos="${posIdx}"
          title="Подтвердить назначение"
          ${pending ? "disabled" : ""}
        >${pending ? "…" : "&#10003;"}</button>
      </div>
      ${error ? `<div class="assignee-error">${error}</div>` : ""}
    </div>
    <div class="cell col-crew position-description">${position.description || ""}</div>
    <div class="day-cells">${dayCells.join("")}</div>
  </div>`;
}

function renderGroupHeaderRow(label) {
  return `<div class="row group-header">
    <div class="cell toggle"></div>
    <div class="cell col-job group-label">${label}</div>
    <div class="bar-track"></div>
  </div>`;
}

function render() {
  // Re-rendering rebuilds the whole #gantt innerHTML, which would otherwise
  // steal focus/cursor position (and orphan an open dropdown) away from
  // whatever row the user is still typing into - restore it afterward.
  const focused = document.activeElement;
  const wasDropdownOpen = typeof activeAssigneeInput !== "undefined" && activeAssigneeInput !== null;
  let focusedKey = null;
  let focusedSelStart = null;
  if (focused && focused.classList && focused.classList.contains("assignee-input")) {
    focusedKey = `${focused.dataset.job}::${focused.dataset.phase}::${focused.dataset.pos}`;
    focusedSelStart = focused.selectionStart;
  }

  const rows = [renderHeader()];

  let visibleJobs = JOBS.filter((j) => (j.statusRank ?? 0) >= state.statusFilter);
  const groupKey = GROUP_FIELDS[state.groupBy];
  if (groupKey) {
    visibleJobs = [...visibleJobs].sort((a, b) => String(groupKey(a)).localeCompare(String(groupKey(b)), "ru"));
  }

  let lastGroup = undefined;
  for (const job of visibleJobs) {
    if (groupKey) {
      const key = groupKey(job);
      if (key !== lastGroup) {
        rows.push(renderGroupHeaderRow(key));
        lastGroup = key;
      }
    }
    rows.push(renderJobRow(job));
    if (state.expandedJobs.has(job.id)) {
      job.phases.forEach((phase, idx) => {
        rows.push(renderPhaseRow(job, phase, idx));
        if (state.expandedPhases.has(`${job.id}::${idx}`)) {
          rows.push(renderPositionHeaderRow(job, idx));
          phase.positions.forEach((pos, posIdx) => rows.push(renderPositionRow(job, phase, pos, idx, posIdx)));
          rows.push(renderPhaseFooterRow(job, phase, idx));
        }
      });
    }
  }
  document.getElementById("gantt").innerHTML = rows.join("");

  if (focusedKey) {
    const [fj, fp, fpos] = focusedKey.split("::");
    const restored = document.querySelector(
      `.assignee-input[data-job="${fj}"][data-phase="${fp}"][data-pos="${fpos}"]`
    );
    if (restored) {
      restored.focus();
      if (focusedSelStart != null) restored.setSelectionRange(focusedSelStart, focusedSelStart);
      if (wasDropdownOpen) openAssigneeDropdown(restored);
    }
  }
}

document.getElementById("gantt").addEventListener("click", (ev) => {
  const btn = ev.target.closest("button[data-action]");
  if (!btn) return;
  if (btn.dataset.action === "toggle-job") {
    const id = btn.dataset.job;
    if (state.expandedJobs.has(id)) {
      state.expandedJobs.delete(id);
    } else {
      state.expandedJobs.add(id);
      const job = JOBS.find((j) => j.id === id);
      job.phases.forEach((_, idx) => state.expandedPhases.add(`${id}::${idx}`));
    }
    render();
  } else if (btn.dataset.action === "toggle-phase") {
    const key = `${btn.dataset.job}::${btn.dataset.phase}`;
    if (state.expandedPhases.has(key)) state.expandedPhases.delete(key);
    else state.expandedPhases.add(key);
    render();
  } else if (btn.dataset.action === "confirm-assignee") {
    const input = btn.parentElement.querySelector(".assignee-input");
    confirmAssignee(btn.dataset.job, btn.dataset.phase, btn.dataset.pos, input.value);
  }
});

// Picking a name only fills the field — nothing is considered assigned until
// "Подтвердить" is clicked (or Enter pressed). Confirming POSTs to
// /api/crew-bookings/assign and only applies the change in the UI once
// HireTrack actually confirms the write - a purely-optimistic update here is
// what caused assignments to silently "stick" in the browser but never reach
// HireTrack.
async function confirmAssignee(jobId, phaseIdx, posIdx, value) {
  const job = JOBS.find((j) => j.id === jobId);
  const phase = job.phases[Number(phaseIdx)];
  const position = phase.positions[Number(posIdx)];
  const key = `${jobId}::${phaseIdx}::${posIdx}`;
  const personName = value.trim();

  if (!personName) {
    position.assignee = null;
    state.assignErrors.delete(key);
    state.pendingInput.delete(key);
    render();
    return;
  }

  state.assignPending.add(key);
  state.assignErrors.delete(key);
  render();

  try {
    const resp = await fetch("/api/crew-bookings/assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobRef: jobId,
        phaseTitle: phase.name,
        positionIndex: Number(posIdx),
        personName,
      }),
    });
    const body = await resp.json();
    if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
    position.assignee = body.assignee || personName;
    state.pendingInput.delete(key);
  } catch (e) {
    state.assignErrors.set(key, "Не удалось назначить: " + e.message);
  } finally {
    state.assignPending.delete(key);
    render();
  }
}

document.getElementById("gantt").addEventListener("keydown", (ev) => {
  const input = ev.target.closest(".assignee-input");
  if (!input || ev.key !== "Enter") return;
  ev.preventDefault();
  confirmAssignee(input.dataset.job, input.dataset.phase, input.dataset.pos, input.value);
});

// Custom searchable dropdown, replacing the native <datalist> (which doesn't
// reliably drop down its full list on click/focus across browsers, and only
// does prefix matching, not substring search). One shared panel, positioned
// via getBoundingClientRect and attached to <body> so it floats above the
// sticky/scrolling grid regardless of any ancestor's overflow:hidden.
const assigneeDropdown = document.createElement("div");
assigneeDropdown.className = "assignee-dropdown";
assigneeDropdown.style.display = "none";
document.body.appendChild(assigneeDropdown);
let activeAssigneeInput = null;

function closeAssigneeDropdown() {
  assigneeDropdown.style.display = "none";
  activeAssigneeInput = null;
}

function positionAssigneeDropdown(input) {
  const rect = input.getBoundingClientRect();
  assigneeDropdown.style.left = `${rect.left}px`;
  assigneeDropdown.style.top = `${rect.bottom}px`;
  assigneeDropdown.style.width = `${rect.width}px`;
}

function openAssigneeDropdown(input) {
  activeAssigneeInput = input;
  const query = input.value.trim().toLowerCase();
  const matches = (query ? CREW.filter((name) => name.toLowerCase().includes(query)) : CREW).slice(0, 50);
  assigneeDropdown.innerHTML = matches.length
    ? matches.map((name) => `<div class="assignee-dropdown-item" data-name="${name}">${name}</div>`).join("")
    : `<div class="assignee-dropdown-empty">Никого не найдено</div>`;
  positionAssigneeDropdown(input);
  assigneeDropdown.style.display = "block";
}

document.getElementById("gantt").addEventListener("focusin", (ev) => {
  const input = ev.target.closest(".assignee-input");
  if (input) openAssigneeDropdown(input);
});
document.getElementById("gantt").addEventListener("input", (ev) => {
  const input = ev.target.closest(".assignee-input");
  if (!input) return;
  const key = `${input.dataset.job}::${input.dataset.phase}::${input.dataset.pos}`;
  state.pendingInput.set(key, input.value);
  openAssigneeDropdown(input);
});
// mousedown (not click) + preventDefault: stops the input from blurring
// before the selection registers, so focus/cursor never has to be restored.
assigneeDropdown.addEventListener("mousedown", (ev) => {
  const item = ev.target.closest(".assignee-dropdown-item");
  if (!item || !activeAssigneeInput) return;
  ev.preventDefault();
  const input = activeAssigneeInput;
  input.value = item.dataset.name;
  const key = `${input.dataset.job}::${input.dataset.phase}::${input.dataset.pos}`;
  state.pendingInput.set(key, input.value);
  closeAssigneeDropdown();
  input.focus();
});
document.addEventListener("mousedown", (ev) => {
  if (ev.target.closest(".assignee-dropdown") || ev.target.closest(".assignee-input")) return;
  closeAssigneeDropdown();
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && activeAssigneeInput) closeAssigneeDropdown();
});
document.querySelector(".gantt-scroll").addEventListener("scroll", closeAssigneeDropdown);

async function loadCrewData(options) {
  const forceRefresh = options && options.forceRefresh;
  const url = forceRefresh ? "/api/crew-bookings/data?refresh=1" : "/api/crew-bookings/data";
  const resp = await fetch(url);
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(text || `HTTP ${resp.status}`);
  }
  const data = await resp.json();
  JOBS = data.jobs.map((j) => ({ ...j, crewBoss: j.crewBoss || "Unassigned" }));
  CREW = data.crewRoster;
}

document.getElementById("refresh-data").addEventListener("click", async () => {
  const btn = document.getElementById("refresh-data");
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Обновляю...";
  try {
    await loadCrewData({ forceRefresh: true });
    render();
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

document.getElementById("expand-all").addEventListener("click", () => {
  JOBS.forEach((job) => {
    state.expandedJobs.add(job.id);
    job.phases.forEach((_, idx) => state.expandedPhases.add(`${job.id}::${idx}`));
  });
  render();
});
document.getElementById("collapse-all").addEventListener("click", () => {
  state.expandedJobs.clear();
  state.expandedPhases.clear();
  render();
});

const windowStartInput = document.getElementById("window-start");
const windowStartDisplay = document.getElementById("window-start-display");
const windowCustomInput = document.getElementById("window-custom");
const presetButtons = Array.from(document.querySelectorAll(".preset-btn"));

// The native date input's own text is locale-dependent (could render
// mm/dd/yyyy on some systems) — this label next to it always shows
// day-month-year explicitly, regardless of OS locale.
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
  windowCustomInput.value = DAY_COUNT;
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
document.getElementById("window-apply-custom").addEventListener("click", () => {
  applyWindow(windowStartInput.value || fmt(start), Number(windowCustomInput.value) || DAY_COUNT);
});

document.getElementById("status-filter").addEventListener("change", (ev) => {
  state.statusFilter = Number(ev.target.value);
  render();
});
document.getElementById("group-by").addEventListener("change", (ev) => {
  state.groupBy = ev.target.value;
  render();
});

async function boot() {
  const loadStatus = document.getElementById("load-status");
  try {
    await loadCrewData();
    loadStatus.style.display = "none";
  } catch (e) {
    console.error(e);
    loadStatus.textContent = "Не удалось загрузить данные из HireTrack: " + e.message;
    loadStatus.classList.add("error");
  }
  applyWindow(todayStr(), DAY_COUNT);
}

boot();
