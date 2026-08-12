const DOW_FULL = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"];
const DAY_W = 42; // keep in sync with --day-w in styles.css

let OCCUPANCY = null; // { start, end, types, lines }
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
  if (state.activeTab === "shortages") {
    document.getElementById("shortages-panel").innerHTML = `<p class="placeholder">Скоро.</p>`;
  }
  if (state.activeTab === "jobs") {
    document.getElementById("jobs-panel").innerHTML = `<p class="placeholder">Скоро.</p>`;
  }
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
    state.activeTab = btn.dataset.tab;
    render();
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
    await loadOccupancy({ forceRefresh: true });
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
