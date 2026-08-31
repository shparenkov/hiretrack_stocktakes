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
  statusFilter: 1, // defcon.SortOrder to match
  statusAndAbove: true, // false = exact match, true = >= statusFilter
  searchQuery: "",
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

// Does this job's own activity span intersect the currently visible date
// window at all? Moving/resizing the window only ever changed which day
// COLUMNS render - a job whose whole span falls entirely outside it still
// showed up as a row with a blank bar-track, which reads as "nothing here"
// or "already finished" rather than "just not in view right now". Jobs
// that partially overlap still render fine (bar + «/» truncation markers
// in renderJobRow) and stay visible here - only a zero-overlap job is
// filtered out.
function jobOverlapsWindow(job) {
  const barStart = job.activityStart || job.start;
  const barEnd = job.activityEnd || job.end;
  const s = colFor(barStart);
  const e = colFor(barEnd) + 1;
  const sClamped = Math.max(s, 1);
  const eClamped = Math.min(e, DAY_COUNT + 1);
  return sClamped < eClamped;
}

// Total shift count for this job on a given calendar day, summed across ALL
// phases/positions - lets the collapsed job row's purple bar show shift
// density per day without expanding into Phase -> Position rows to see it
// (previously only visible per-phase in the Day N(count) footer row).
function jobDayShiftCount(job, dateStr) {
  let total = 0;
  for (const phase of job.phases) {
    if (dateStr < phase.start || dateStr > phase.end) continue;
    const dayInPhase = daysBetween(new Date(phase.start + "T00:00:00"), new Date(dateStr + "T00:00:00"));
    for (const pos of phase.positions) {
      total += (pos.qtyPerDay || [])[dayInPhase] || 0;
    }
  }
  return total;
}

function renderJobRow(job) {
  const expanded = state.expandedJobs.has(job.id);
  // The bar spans actual crew-activity dates (min/max across all phases),
  // not Due Out/Due Back - a job can run for months while crew is only
  // actually needed on a handful of days within it.
  const barStart = job.activityStart || job.start;
  const barEnd = job.activityEnd || job.end;
  const jobStart = new Date(barStart + "T00:00:00");
  const jobEnd = new Date(barEnd + "T00:00:00");
  const statusClass = STATUS_CLASS[job.status] || "";

  const s = colFor(barStart); // may be < 1 if it started before the window
  const e = colFor(barEnd) + 1; // may be > DAY_COUNT+1 if it ends after the window
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
    ? `<div class="bar${truncStart ? " trunc-start" : ""}${truncEnd ? " trunc-end" : ""}" style="${barStyle(sClamped, eClamped)}" title="${job.name}: ${barStart} → ${barEnd}">
        ${truncStart ? `<span class="trunc-marker left">&laquo;</span>` : ""}
        ${truncEnd ? `<span class="trunc-marker right">&raquo;</span>` : ""}
        ${showStart ? `<span class="bar-label start">Crew Starts</span>` : ""}
        ${showEnd ? `<span class="bar-label end">Crew Ends</span>` : ""}
      </div>`
    : "";

  // Per-day shift-count overlay on the bar itself, so density is visible
  // without expanding Job → Phase → Position. Positioned relative to the
  // day-track's own columns (independent of the bar's clamping/truncation),
  // one number per day that actually has shifts that day.
  const dayCountCells = [];
  for (let i = 0; i < DAY_COUNT; i++) {
    const iso = fmt(addDays(start, i));
    const count = jobDayShiftCount(job, iso);
    dayCountCells.push(
      count > 0 ? `<span class="bar-day-count" style="left:${i * DAY_W}px; width:${DAY_W}px;">${count}</span>` : ""
    );
  }

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
      ${dayCountCells.join("")}
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

// TShiftStatus per individual CrewShifts row - independent of the position's
// own overall status. A shift added after the position was already
// Pencilled/Booked starts at 0 ("Not Allocated" in HT) until explicitly
// synced (see the sync-shifts action below).
function shiftStateClass(shiftStatus) {
  if (shiftStatus === 3) return "booked";
  if (shiftStatus === 2) return "pencilled";
  return "";
}

function renderPositionRow(job, phase, position, phaseIdx, posIdx) {
  const s = colFor(phase.start);
  const isBooked = position.status === "Booked";
  const isPencilled = position.status === "Pencilled";
  const stateClass = isBooked ? "booked" : isPencilled ? "pencilled" : "unprocessed";
  const dayCells = [];
  let needsAllocationCount = 0;
  for (let i = 0; i < DAY_COUNT; i++) {
    const dayInPhase = i - (s - 1);
    const q = dayInPhase >= 0 && dayInPhase < (position.qtyPerDay || []).length ? position.qtyPerDay[dayInPhase] : null;
    if (q === null) {
      dayCells.push(`<div class="day-qty"></div>`);
      continue;
    }
    const shiftId = position.shiftIds ? position.shiftIds[dayInPhase] : null;
    const shiftNote = position.shiftNotes ? position.shiftNotes[dayInPhase] : "";
    const hasShiftNote = !!(shiftNote && shiftNote.trim());
    const noteAttrs =
      shiftId != null
        ? `data-action="edit-shift-note" data-job="${job.id}" data-phase="${phaseIdx}" data-pos="${posIdx}" data-day-index="${dayInPhase}" title="${hasShiftNote ? "Есть заметка по смене — клик для просмотра/редактирования" : "Добавить заметку по смене"}"`
        : "";
    const noteClass = hasShiftNote ? " has-note" : "";
    const shiftStatus = position.shiftStatuses ? position.shiftStatuses[dayInPhase] : null;
    // A shift that's still Status=0 while the POSITION already has an active
    // Pencilled/Booked assignment is a straggler that needs the sync-shifts
    // action - flag it distinctly instead of quietly painting it green/amber
    // (the bug: this used to just follow the position's overall status).
    const needsAllocation = q && shiftStatus === 0 && (isBooked || isPencilled);
    if (needsAllocation) needsAllocationCount += 1;
    if (isBooked || isPencilled) {
      const cellClass = needsAllocation ? "needs-allocation" : q ? shiftStateClass(shiftStatus) : "";
      const title = needsAllocation ? ' title="Смена не аллоцирована (Not Allocated) — нажмите ⟳, чтобы назначить"' : "";
      dayCells.push(`<div class="day-qty ${cellClass}${noteClass}"${title} ${noteAttrs}></div>`);
    } else {
      dayCells.push(`<div class="day-qty ${qtyClass(q)}${noteClass}" ${noteAttrs}>${q}</div>`);
    }
  }
  const key = `${job.id}::${phaseIdx}::${posIdx}`;
  const pending = state.assignPending.has(key);
  const error = state.assignErrors.get(key);
  const placeholder = isBooked ? "Забукано" : isPencilled ? "В резерве" : "Unprocessed — назначить...";
  const hasRoleNote = !!(position.roleNotes && position.roleNotes.trim());
  return `<div class="row position ${stateClass}">
    <div class="cell toggle"></div>
    <div class="cell col-job role-name">
      <span class="role-text">${position.role}</span>
      <button
        type="button"
        class="note-btn${hasRoleNote ? " has-note" : ""}"
        data-action="edit-role-note"
        data-job="${job.id}" data-phase="${phaseIdx}" data-pos="${posIdx}"
        title="${hasRoleNote ? "Есть заметка по роли" : "Добавить заметку по роли"}"
      >&#9998;</button>
    </div>
    <div class="cell col-name assignee-cell">
      <div class="assignee-field">
        <input
          class="assignee-input"
          type="text"
          autocomplete="off"
          placeholder="${placeholder}"
          value="${state.pendingInput.has(key) ? state.pendingInput.get(key) : (position.assignee || "")}"
          data-job="${job.id}" data-phase="${phaseIdx}" data-pos="${posIdx}"
          ${pending ? "disabled" : ""}
        />
        <button
          type="button"
          class="assignee-pencil"
          data-action="confirm-pencilled"
          data-job="${job.id}" data-phase="${phaseIdx}" data-pos="${posIdx}"
          title="Поставить под резерв (Pencilled)"
          ${pending ? "disabled" : ""}
        >${pending ? "…" : "P"}</button>
        <button
          type="button"
          class="assignee-book"
          data-action="confirm-booked"
          data-job="${job.id}" data-phase="${phaseIdx}" data-pos="${posIdx}"
          title="Забукать (Booked)"
          ${pending ? "disabled" : ""}
        >${pending ? "…" : "B"}</button>
        ${
          position.assignee
            ? `<button
                type="button"
                class="assignee-remove"
                data-action="remove-assignee"
                data-job="${job.id}" data-phase="${phaseIdx}" data-pos="${posIdx}"
                title="Снять человека"
                ${pending ? "disabled" : ""}
              >&#10005;</button>`
            : ""
        }
        ${
          needsAllocationCount > 0
            ? `<button
                type="button"
                class="assignee-sync"
                data-action="sync-shifts"
                data-job="${job.id}" data-phase="${phaseIdx}" data-pos="${posIdx}"
                title="Аллоцировать ${position.assignee || "человека"} на новые смены (${needsAllocationCount})"
                ${pending ? "disabled" : ""}
              >${pending ? "…" : "&#10227;"}</button>`
            : ""
        }
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

  let visibleJobs = JOBS.filter((j) =>
    state.statusAndAbove ? (j.statusRank ?? 0) >= state.statusFilter : (j.statusRank ?? 0) === state.statusFilter
  );
  visibleJobs = visibleJobs.filter(jobOverlapsWindow);
  const query = state.searchQuery.trim().toLowerCase();
  if (query) {
    visibleJobs = visibleJobs.filter(
      (j) => j.id.toLowerCase().includes(query) || j.name.toLowerCase().includes(query)
    );
  }
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

// Position/shift detail for a job is fetched on demand rather than bundled
// into the initial list load - see hiretrack_crew_read.py's
// read_crew_list() docstring for why (the bulk query across every
// candidate job's positions/shifts falls off a performance cliff past a
// couple hundred ids; scoped to one job at a time it's ~1s even for the
// largest job in production). `job.phases` starts empty from the list
// endpoint and gets filled in here once a job's row is actually expanded.
const jobDetailTimers = new Map(); // jobId -> intervalId
const JOB_DETAIL_REFRESH_MS = 25000;

async function loadJobDetail(jobId) {
  const job = JOBS.find((j) => j.id === jobId);
  if (!job) return;
  try {
    const resp = await fetch(`/api/crew-bookings/job-detail?jobRef=${encodeURIComponent(jobId)}`);
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(text || `HTTP ${resp.status}`);
    }
    const data = await resp.json();
    job.phases = data.phases;
    render();
  } catch (e) {
    console.error("Не удалось загрузить детали работы " + jobId + ":", e);
  }
}

// Expanding a job fetches its detail immediately, then keeps it fresh with
// a periodic re-fetch for as long as it stays expanded - this is what lets
// the page do without a page-wide manual refresh button (see
// forceRefreshNow) while someone actually has a job open and working in it.
async function expandJob(jobId) {
  state.expandedJobs.add(jobId);
  render();
  await loadJobDetail(jobId);
  const job = JOBS.find((j) => j.id === jobId);
  if (job) job.phases.forEach((_, idx) => state.expandedPhases.add(`${jobId}::${idx}`));
  render();
  if (!jobDetailTimers.has(jobId)) {
    jobDetailTimers.set(jobId, setInterval(() => loadJobDetail(jobId), JOB_DETAIL_REFRESH_MS));
  }
}

function collapseJob(jobId) {
  state.expandedJobs.delete(jobId);
  if (jobDetailTimers.has(jobId)) {
    clearInterval(jobDetailTimers.get(jobId));
    jobDetailTimers.delete(jobId);
  }
  for (const key of Array.from(state.expandedPhases)) {
    if (key.startsWith(`${jobId}::`)) state.expandedPhases.delete(key);
  }
}

document.getElementById("gantt").addEventListener("click", (ev) => {
  const btn = ev.target.closest("[data-action]");
  if (!btn) return;
  if (btn.dataset.action === "toggle-job") {
    const id = btn.dataset.job;
    if (state.expandedJobs.has(id)) {
      collapseJob(id);
      render();
    } else {
      expandJob(id);
    }
  } else if (btn.dataset.action === "toggle-phase") {
    const key = `${btn.dataset.job}::${btn.dataset.phase}`;
    if (state.expandedPhases.has(key)) state.expandedPhases.delete(key);
    else state.expandedPhases.add(key);
    render();
  } else if (btn.dataset.action === "confirm-pencilled" || btn.dataset.action === "confirm-booked") {
    const input = btn.parentElement.querySelector(".assignee-input");
    const offerStatus = btn.dataset.action === "confirm-booked" ? "booked" : "pencilled";
    confirmAssignee(btn.dataset.job, btn.dataset.phase, btn.dataset.pos, input.value, offerStatus);
  } else if (btn.dataset.action === "remove-assignee") {
    removeAssignee(btn.dataset.job, btn.dataset.phase, btn.dataset.pos);
  } else if (btn.dataset.action === "sync-shifts") {
    syncShifts(btn.dataset.job, btn.dataset.phase, btn.dataset.pos);
  } else if (btn.dataset.action === "edit-role-note") {
    openRoleNoteEditor(btn);
  } else if (btn.dataset.action === "edit-shift-note") {
    openShiftNoteEditor(btn);
  }
});

// Highlights the freshness indicator briefly - used when a write is
// rejected as stale, to point at the fix (click it to refresh now) rather
// than just naming the problem.
function flashRefreshButton() {
  const btn = document.getElementById("data-freshness");
  btn.classList.add("flash");
  setTimeout(() => btn.classList.remove("flash"), 2500);
}

// A 409 means the write bridge's optimistic-concurrency check rejected the
// request - the position changed in HireTrack (or another tab) since this
// page last loaded it. Surfaced distinctly from a generic failure so the
// fix (click the freshness indicator to refresh now) is obvious instead of
// looking like a random error.
async function throwForResponse(resp) {
  const body = await resp.json().catch(() => ({}));
  if (resp.status === 409 || body.conflict) {
    flashRefreshButton();
    throw new Error(body.error || "Данные на странице устарели. Нажмите на индикатор обновления.");
  }
  throw new Error(body.error || `HTTP ${resp.status}`);
}

// Picking a name only fills the field — nothing is considered assigned until
// one of the confirm buttons (or Enter, which books) is clicked. Confirming
// POSTs to /api/crew-bookings/assign and only applies the change in the UI
// once HireTrack actually confirms the write - a purely-optimistic update
// here is what caused assignments to silently "stick" in the browser but
// never reach HireTrack.
async function confirmAssignee(jobId, phaseIdx, posIdx, value, offerStatus) {
  const job = JOBS.find((j) => j.id === jobId);
  const phase = job.phases[Number(phaseIdx)];
  const position = phase.positions[Number(posIdx)];
  const key = `${jobId}::${phaseIdx}::${posIdx}`;
  const personName = value.trim();

  if (!personName) {
    state.assignErrors.set(key, "Выберите человека перед подтверждением.");
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
        positionId: position.positionId,
        personName,
        offerStatus,
        expectedStatus: position.status,
        expectedAssignee: position.assignee,
      }),
    });
    if (!resp.ok) await throwForResponse(resp);
    const body = await resp.json();
    position.assignee = body.assignee || personName;
    position.status = offerStatus === "booked" ? "Booked" : "Pencilled";
    state.pendingInput.delete(key);
  } catch (e) {
    state.assignErrors.set(key, "Не удалось назначить: " + e.message);
  } finally {
    state.assignPending.delete(key);
    render();
  }
}

async function removeAssignee(jobId, phaseIdx, posIdx) {
  const job = JOBS.find((j) => j.id === jobId);
  const phase = job.phases[Number(phaseIdx)];
  const position = phase.positions[Number(posIdx)];
  const key = `${jobId}::${phaseIdx}::${posIdx}`;

  state.assignPending.add(key);
  state.assignErrors.delete(key);
  render();

  try {
    const resp = await fetch("/api/crew-bookings/unassign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        positionId: position.positionId,
        expectedStatus: position.status,
        expectedAssignee: position.assignee,
      }),
    });
    if (!resp.ok) await throwForResponse(resp);
    position.assignee = null;
    position.status = "Unprocessed";
    state.pendingInput.delete(key);
  } catch (e) {
    state.assignErrors.set(key, "Не удалось снять: " + e.message);
  } finally {
    state.assignPending.delete(key);
    render();
  }
}

// Allocates the already-assigned person onto shifts that got added to a
// position AFTER it was already Pencilled/Booked (those start at Status=0,
// "Not Allocated" in HT, until synced - see needsAllocation in
// renderPositionRow).
async function syncShifts(jobId, phaseIdx, posIdx) {
  const job = JOBS.find((j) => j.id === jobId);
  const phase = job.phases[Number(phaseIdx)];
  const position = phase.positions[Number(posIdx)];
  const key = `${jobId}::${phaseIdx}::${posIdx}`;

  state.assignPending.add(key);
  state.assignErrors.delete(key);
  render();

  try {
    const resp = await fetch("/api/crew-bookings/sync-shifts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        positionId: position.positionId,
        expectedStatus: position.status,
        expectedAssignee: position.assignee,
      }),
    });
    if (!resp.ok) await throwForResponse(resp);
    const body = await resp.json();
    const syncedStatus = body.status === "booked" ? 3 : 2;
    if (position.shiftStatuses) {
      position.shiftStatuses = position.shiftStatuses.map((st, i) =>
        position.qtyPerDay[i] && st === 0 ? syncedStatus : st
      );
    }
  } catch (e) {
    state.assignErrors.set(key, "Не удалось аллоцировать смены: " + e.message);
  } finally {
    state.assignPending.delete(key);
    render();
  }
}

document.getElementById("gantt").addEventListener("keydown", (ev) => {
  const input = ev.target.closest(".assignee-input");
  if (!input || ev.key !== "Enter") return;
  ev.preventDefault();
  confirmAssignee(input.dataset.job, input.dataset.phase, input.dataset.pos, input.value, "booked");
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

// Shared floating editor for Role.Notes (Crew.Notes) and Shift.Notes
// (CrewShifts.Notes) - same float-above-everything pattern as the assignee
// dropdown, one popover reused for both note types via the onSave callback.
const notesPopover = document.createElement("div");
notesPopover.className = "notes-popover";
notesPopover.style.display = "none";
document.body.appendChild(notesPopover);
let notesPopoverSave = null;

function closeNotesPopover() {
  notesPopover.style.display = "none";
  notesPopoverSave = null;
}

function openNotesPopover(anchorEl, { title, initialText, onSave }) {
  const rect = anchorEl.getBoundingClientRect();
  notesPopover.innerHTML = `
    <div class="notes-popover-title">${title}</div>
    <textarea class="notes-popover-text" rows="4"></textarea>
    <div class="notes-popover-actions">
      <button type="button" class="notes-popover-save">Сохранить</button>
      <button type="button" class="notes-popover-cancel">Отмена</button>
      <span class="notes-popover-status"></span>
    </div>
  `;
  notesPopover.querySelector(".notes-popover-text").value = initialText || "";
  notesPopover.style.left = `${Math.max(4, rect.left)}px`;
  notesPopover.style.top = `${rect.bottom + 4}px`;
  notesPopover.style.display = "block";
  notesPopoverSave = onSave;
  notesPopover.querySelector(".notes-popover-text").focus();
}

notesPopover.addEventListener("mousedown", (ev) => ev.stopPropagation());
notesPopover.addEventListener("click", async (ev) => {
  if (ev.target.classList.contains("notes-popover-cancel")) {
    closeNotesPopover();
    return;
  }
  if (ev.target.classList.contains("notes-popover-save")) {
    if (!notesPopoverSave) return;
    const text = notesPopover.querySelector(".notes-popover-text").value;
    const statusEl = notesPopover.querySelector(".notes-popover-status");
    const save = notesPopoverSave;
    statusEl.textContent = "Сохранение…";
    try {
      await save(text);
      closeNotesPopover();
      render();
    } catch (e) {
      statusEl.textContent = "Ошибка: " + e.message;
    }
  }
});
document.addEventListener("mousedown", (ev) => {
  if (ev.target.closest(".notes-popover") || ev.target.closest("[data-action='edit-role-note']") || ev.target.closest("[data-action='edit-shift-note']")) {
    return;
  }
  closeNotesPopover();
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && notesPopoverSave) closeNotesPopover();
});
document.querySelector(".gantt-scroll").addEventListener("scroll", closeNotesPopover);

function openRoleNoteEditor(btn) {
  const jobId = btn.dataset.job;
  const phaseIdx = Number(btn.dataset.phase);
  const posIdx = Number(btn.dataset.pos);
  const job = JOBS.find((j) => j.id === jobId);
  const phase = job.phases[phaseIdx];
  const position = phase.positions[posIdx];
  openNotesPopover(btn, {
    title: `Заметка по роли: ${position.role}`,
    initialText: position.roleNotes,
    onSave: async (text) => {
      const resp = await fetch("/api/crew-bookings/role-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crewId: position.crewId, notes: text }),
      });
      const body = await resp.json();
      if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
      // A crewId can be shared by several position slots under the same role
      // request (e.g. all 3 of a "3x Rigger") - keep them all in sync.
      phase.positions.forEach((p) => {
        if (p.crewId === position.crewId) p.roleNotes = text;
      });
    },
  });
}

function openShiftNoteEditor(cell) {
  const jobId = cell.dataset.job;
  const phaseIdx = Number(cell.dataset.phase);
  const posIdx = Number(cell.dataset.pos);
  const dayIdx = Number(cell.dataset.dayIndex);
  const job = JOBS.find((j) => j.id === jobId);
  const phase = job.phases[phaseIdx];
  const position = phase.positions[posIdx];
  const shiftId = position.shiftIds[dayIdx];
  openNotesPopover(cell, {
    title: `Заметка по смене: ${position.role}`,
    initialText: position.shiftNotes[dayIdx],
    onSave: async (text) => {
      const resp = await fetch("/api/crew-bookings/shift-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shiftId, notes: text }),
      });
      const body = await resp.json();
      if (!resp.ok) throw new Error(body.error || `HTTP ${resp.status}`);
      position.shiftNotes[dayIdx] = text;
    },
  });
}

// When the data currently on screen was actually pulled from HireTrack -
// from the server's own fetchedAt (when the backend cache was populated),
// NOT "when did my browser get an HTTP response" (a request can be served
// straight from that ~30s cache). Lets someone judge "is this fresh enough
// to trust" - e.g. after being told "I just changed shifts in HT, go ahead
// and assign" - without needing to guess.
let lastFetchedAt = null;

const FRESHNESS_STALE_MS = 2 * 60 * 1000; // 2 min - amber
const FRESHNESS_VERY_STALE_MS = 10 * 60 * 1000; // 10 min - red

function updateFreshnessLabel() {
  const el = document.getElementById("data-freshness");
  if (!el) return;
  if (!lastFetchedAt) {
    el.textContent = "";
    el.className = "freshness";
    return;
  }
  const ageMs = Date.now() - lastFetchedAt.getTime();
  const ageMin = Math.floor(ageMs / 60000);
  const ageSec = Math.floor(ageMs / 1000);
  const label = ageSec < 60 ? "только что" : ageMin < 60 ? `${ageMin} мин назад` : lastFetchedAt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  el.textContent = `Данные из HireTrack: ${label}`;
  el.className = "freshness" + (ageMs >= FRESHNESS_VERY_STALE_MS ? " very-stale" : ageMs >= FRESHNESS_STALE_MS ? " stale" : "");
}
setInterval(updateFreshnessLabel, 15000);

// List-only fetch (job metadata, no phases) - see hiretrack_crew_read.py's
// read_crew_list(). Preserves already-loaded phase detail across refreshes
// instead of wiping it back to empty, so a job that's currently expanded
// doesn't flash back to "collapsed-looking" every time the list re-polls.
async function loadCrewData(options) {
  const forceRefresh = options && options.forceRefresh;
  const url = forceRefresh ? "/api/crew-bookings/data?refresh=1" : "/api/crew-bookings/data";
  const resp = await fetch(url);
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(text || `HTTP ${resp.status}`);
  }
  const data = await resp.json();
  const existingById = new Map(JOBS.map((j) => [j.id, j]));
  JOBS = data.jobs.map((j) => {
    const existing = existingById.get(j.id);
    return {
      ...j,
      crewBoss: j.crewBoss || "Unassigned",
      phases: existing && existing.phases && existing.phases.length ? existing.phases : j.phases,
    };
  });
  CREW = data.crewRoster;
  lastFetchedAt = data.fetchedAt ? new Date(data.fetchedAt) : new Date();
  updateFreshnessLabel();
}

// No page-wide manual refresh button - the job list and every expanded
// job's detail already refresh themselves on their own timers (see
// JOB_DETAIL_REFRESH_MS above and the list interval near boot() below).
// The freshness indicator doubles as an immediate "refresh right now"
// trigger instead, for the one case a timer can't cover: someone telling
// you "I just changed it in HT, go ahead" and wanting to trust the screen
// immediately rather than wait out the next tick.
async function forceRefreshNow() {
  const el = document.getElementById("data-freshness");
  el.disabled = true;
  const originalText = el.textContent;
  el.textContent = "Обновляю...";
  try {
    await loadCrewData({ forceRefresh: true });
    await Promise.all(Array.from(state.expandedJobs).map((id) => loadJobDetail(id)));
    render();
  } catch (e) {
    console.error(e);
    alert("Не удалось получить свежие данные из HireTrack: " + e.message);
  } finally {
    el.disabled = false;
    updateFreshnessLabel();
    if (el.textContent === "Обновляю...") el.textContent = originalText;
  }
}
document.getElementById("data-freshness").addEventListener("click", forceRefreshNow);

// Background refresh for the job list itself (statuses/dates/crew boss/
// roster) - independent of any expanded job's own detail timer.
setInterval(() => {
  loadCrewData().then(render).catch((e) => console.error("Фоновое обновление списка работ не удалось:", e));
}, 60000);

document.getElementById("expand-all").addEventListener("click", async () => {
  for (const job of JOBS) {
    if (!state.expandedJobs.has(job.id)) {
      await expandJob(job.id);
    }
  }
});
document.getElementById("collapse-all").addEventListener("click", () => {
  Array.from(state.expandedJobs).forEach((id) => collapseJob(id));
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
document.getElementById("status-and-above").addEventListener("change", (ev) => {
  state.statusAndAbove = ev.target.checked;
  render();
});
document.getElementById("job-search").addEventListener("input", (ev) => {
  state.searchQuery = ev.target.value;
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
