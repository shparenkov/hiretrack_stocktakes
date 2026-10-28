'use strict';

// Sandbox for matching HireTrack companies (client / venue / payer of a job)
// with the Bitrix24 "Заказчики" synced from 1C. Every click saves straight to
// the server's staging file; nothing is written to HireTrack or Bitrix here.

const state = {
  companies: [],
  bitrix: [],
  links: {},
  bitrixById: new Map(),
  usedBy: new Map(),
  selectedId: null,
  search: '',
  status: 'open',
  role: 'any',
  pickQuery: '',
  includeGeneral: false,
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const HELP = [
  ['Зачем эта страница', 'Здесь каждому клиенту из HireTrack ставится в соответствие заказчик из Битрикса (список из 1С). Когда по работе создаётся сделка, система берёт эту связь и подставляет компанию в поля «Клиент», «Площадка» и «Плательщик». Без связи сделка создаётся без компании.'],
  ['Список слева', 'Все компании HireTrack, которые стоят хотя бы в одной работе клиентом, площадкой или плательщиком. Самые частые сверху. Фильтр «Не сопоставлены» оставляет только те, по которым решения ещё нет. Сопоставлять достаточно один раз: связь работает для всех трёх ролей.'],
  ['Подсказки', 'Для выбранной компании показываются похожие заказчики. Названия сравниваются с учётом транслитерации (например, «Base club» и «БЭЙС-КЛАБ»). Подсказка только предлагает вариант, связь ставится кнопкой «Добавить».'],
  ['Поиск заказчика', 'Ищет по названию, ИНН и названиям из реквизитов (в том числе ФИО предпринимателя). Для клиентов-физлиц, которые работают через ИП или компанию, подсказки по названию не помогают, находите нужное юрлицо поиском.'],
  ['Несколько юрлиц', 'К одной компании HireTrack можно добавить несколько юрлиц. Отметка «по умолчанию» выбирает то, которое попадёт в сделку. Разные компании HireTrack могут вести на одного и того же заказчика.'],
  ['Без компании', 'Для клиентов без юрлица: сделка создаётся без компании. Решение можно отменить кнопкой «Сбросить».'],
  ['Что сохраняется', 'Все решения хранятся на сервере в отдельном файле. В Битрикс и в HireTrack эта страница ничего не пишет.'],
];

// ---------- text normalisation / similarity ----------

const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya' };
const LEGAL = /(^|\s)(ооо|оао|зао|пао|ао|ип|нко|ано|фонд|llc|ltd|inc|gmbh|llp|the)(?=\s|$)/g;

function plain(s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"'`.,()_/&+\-]/g, ' ').replace(LEGAL, ' ').replace(/\s+/g, ' ').trim();
}

// Latin skeleton: Cyrillic transliterated, then phonetic folding so that
// "base club" and "бэйс клаб" land on the same string.
function skeleton(s) {
  let t = plain(s).split('').map((ch) => (TR[ch] !== undefined ? TR[ch] : ch)).join('');
  t = t.replace(/ph/g, 'f').replace(/w/g, 'v').replace(/ck|q/g, 'k').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k')
    .replace(/ay|ey|ei|ai/g, 'e').replace(/y/g, 'i').replace(/x/g, 'ks').replace(/(.)\1+/g, '$1');
  return t.replace(/[^a-z0-9]/g, '');
}

function bigrams(s) {
  const out = new Map();
  for (let i = 0; i < s.length - 1; i += 1) out.set(s.slice(i, i + 2), (out.get(s.slice(i, i + 2)) || 0) + 1);
  return out;
}

function dice(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  let hit = 0;
  for (const [k, n] of A) hit += Math.min(n, B.get(k) || 0);
  return (2 * hit) / (Math.max(1, a.length - 1) + Math.max(1, b.length - 1));
}

// Consonant skeleton: English and Russian spellings of the same name differ
// mostly in vowels ("base club" -> baseklub, "бэйс-клаб" -> besklab), so
// comparing consonants only catches those pairs. Penalised a little and
// ignored for very short strings, where it would match almost anything.
function consonants(skel) {
  return skel.replace(/[aeiou]/g, '');
}

function consonantScore(a, b) {
  return a.length >= 4 && b.length >= 4 ? dice(a, b) * 0.95 : 0;
}

function scoreAgainst(skel, company) {
  const cons = consonants(skel);
  let best = Math.max(dice(skel, company.skel), consonantScore(cons, company.cons));
  company.altSkels.forEach((alt, i) => {
    best = Math.max(best, dice(skel, alt), consonantScore(cons, company.altCons[i]));
  });
  return best;
}

function looksLikePerson(name) {
  const n = String(name || '').trim();
  if (/["«»]/.test(n) || /(^|\s)(ооо|ао|зао|пао|ип|нко|ано|фонд|llc|ltd|inc|gmbh)(\s|$)/i.test(n)) return false;
  const words = n.split(/\s+/);
  // Cyrillic only: Latin two-word names are as often brands ("Live Sound
  // Agency", "Base club") as people, so flagging them would mostly be noise.
  return words.length >= 2 && words.length <= 3 && words.every((w) => /^[А-ЯЁ][а-яё\-]+$/.test(w));
}

// ---------- data ----------

async function api(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (response.status === 401) {
    window.location.href = '/crew-bookings/pin?next=/client-links/';
    throw new Error('pin_required');
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
  return json;
}

function indexData() {
  state.bitrixById = new Map(state.bitrix.map((b) => [b.id, b]));
  for (const b of state.bitrix) {
    b.skel = skeleton(b.title);
    b.cons = consonants(b.skel);
    b.altSkels = b.requisiteNames.map(skeleton).filter(Boolean);
    b.altCons = b.altSkels.map(consonants);
    b.haystack = [b.title, ...b.requisiteNames, b.inn].join(' ').toLowerCase().replace(/ё/g, 'е');
    b.haySkel = [b.title, ...b.requisiteNames].map(skeleton).join('|');
    b.hayCons = [b.cons, ...b.altCons].join('|');
  }
  for (const c of state.companies) {
    c.skel = skeleton(c.name);
    c.total = c.jobs.client + c.jobs.venue + c.jobs.payer;
  }
  recountUsage();
}

function recountUsage() {
  state.usedBy = new Map();
  for (const [htId, link] of Object.entries(state.links)) {
    for (const e of link.entities || []) {
      state.usedBy.set(e.bitrixId, (state.usedBy.get(e.bitrixId) || 0) + (Number(htId) ? 1 : 0));
    }
  }
}

async function load(refresh) {
  $('summary').textContent = 'Загрузка…';
  const data = await api('GET', `/api/client-links/state${refresh ? '?refresh=1' : ''}`);
  state.companies = data.companies;
  state.bitrix = data.bitrix;
  state.links = data.links || {};
  indexData();
  const banner = $('banner');
  banner.hidden = !data.bitrixError;
  banner.textContent = data.bitrixError ? `Не удалось загрузить заказчиков из Битрикса: ${data.bitrixError}. Список HireTrack доступен, поиск заказчиков пока нет.` : '';
  if (state.selectedId === null && state.companies.length) state.selectedId = visibleCompanies()[0]?.id ?? state.companies[0].id;
  render();
}

// ---------- rendering ----------

function statusOf(c) {
  const l = state.links[c.id];
  return l ? l.status : 'open';
}

function visibleCompanies() {
  const q = state.search.trim().toLowerCase().replace(/ё/g, 'е');
  const qs = q ? skeleton(q) : '';
  return state.companies.filter((c) => {
    if (state.status !== 'all' && statusOf(c) !== state.status) return false;
    if (state.role !== 'any' && !c.jobs[state.role]) return false;
    if (!q) return true;
    return c.name.toLowerCase().replace(/ё/g, 'е').includes(q) || (qs.length > 2 && c.skel.includes(qs));
  });
}

function renderSummary() {
  const total = state.companies.length;
  const linked = state.companies.filter((c) => statusOf(c) === 'linked').length;
  const none = state.companies.filter((c) => statusOf(c) === 'none').length;
  const jobsTotal = state.companies.reduce((s, c) => s + c.jobs.client, 0);
  const jobsDone = state.companies.filter((c) => statusOf(c) !== 'open').reduce((s, c) => s + c.jobs.client, 0);
  $('summary').textContent = `Решено ${linked + none} из ${total} (связаны ${linked}, без компании ${none}). Покрыто работ: ${jobsDone} из ${jobsTotal}. Заказчиков в Битриксе: ${state.bitrix.filter((b) => b.categoryId === 16).length}.`;
}

function renderList() {
  const items = visibleCompanies();
  const list = $('list');
  if (!items.length) {
    list.innerHTML = '<div class="empty">Ничего не найдено</div>';
    return;
  }
  list.innerHTML = items.slice(0, 400).map((c) => {
    const s = statusOf(c);
    const link = state.links[c.id];
    const label = s === 'linked' ? (link.entities.length > 1 ? `${link.entities.length} юрлица` : 'Связан') : s === 'none' ? 'Без компании' : 'Не сопоставлен';
    const cls = s === 'linked' ? 'ok' : s === 'none' ? 'none' : 'open';
    const roles = [c.jobs.client && `клиент ${c.jobs.client}`, c.jobs.venue && `площадка ${c.jobs.venue}`, c.jobs.payer && `плательщик ${c.jobs.payer}`].filter(Boolean).join(' · ');
    return `<div class="item${c.id === state.selectedId ? ' sel' : ''}" data-id="${c.id}" role="option"><div class="nm"><b>${esc(c.name)}${looksLikePerson(c.name) ? '<span class="tag">имя человека</span>' : ''}</b><span class="sub">${esc(roles)}</span></div><span class="pill ${cls}">${label}</span></div>`;
  }).join('') + (items.length > 400 ? `<div class="empty">Показаны первые 400 из ${items.length}. Уточните поиск.</div>` : '');
}

function entityCard(bitrixId, link) {
  const b = state.bitrixById.get(bitrixId);
  const e = link.entities.find((x) => x.bitrixId === bitrixId);
  const title = b ? esc(b.title) : `Заказчик №${bitrixId} (нет в выгрузке)`;
  const meta = b ? `№${b.id}${b.inn ? ` · ИНН ${esc(b.inn)}` : ''}${b.categoryId === 0 ? ' · Общая воронка (не из 1С)' : ''}` : '';
  return `<div class="card on"><div class="nm"><b>${title}</b><div class="sub">${meta}</div></div><div class="act"><label><input type="radio" name="def" data-def="${bitrixId}"${e.isDefault ? ' checked' : ''}> по умолчанию</label><button type="button" data-rm="${bitrixId}" aria-label="Убрать связь">✕</button></div></div>`;
}

function candidateCard(b, extra) {
  const used = state.usedBy.get(b.id);
  return `<div class="card"><div class="nm"><b>${esc(b.title)}</b><div class="sub">№${b.id}${b.inn ? ` · ИНН ${esc(b.inn)}` : ''}${b.categoryId === 0 ? ' · Общая воронка' : ''}${extra ? ` · ${extra}` : ''}${used ? ` · уже связан с ${used} кл. HT` : ''}</div></div><button type="button" data-add="${b.id}">Добавить</button></div>`;
}

function suggestionsFor(c, excludeIds) {
  const pool = state.bitrix.filter((b) => (state.includeGeneral || b.categoryId === 16) && !excludeIds.has(b.id));
  return pool.map((b) => ({ b, score: scoreAgainst(c.skel, b) })).filter((x) => x.score >= 0.4).sort((x, y) => y.score - x.score).slice(0, 5);
}

function searchResults(query, excludeIds) {
  const q = query.trim().toLowerCase().replace(/ё/g, 'е');
  if (q.length < 2) return [];
  const qs = skeleton(q);
  const qc = consonants(qs);
  return state.bitrix
    .filter((b) => (state.includeGeneral || b.categoryId === 16) && !excludeIds.has(b.id))
    .filter((b) => b.haystack.includes(q) || (qs.length > 2 && b.haySkel.includes(qs)) || (qc.length > 3 && b.hayCons.includes(qc)))
    .slice(0, 30);
}

function previewText(c, link) {
  if (!link) return 'Решения пока нет: сделка по этой компании создаётся без компании, а сама компания остаётся в списке «Не сопоставлены».';
  if (link.status === 'none') return 'Помечено «без компании»: в поле сделки ничего не подставляется.';
  const names = link.entities.map((e) => state.bitrixById.get(e.bitrixId)?.title || `№${e.bitrixId}`);
  const def = link.entities.findIndex((e) => e.isDefault);
  if (link.entities.length === 1) return `В поле сделки попадёт: ${esc(names[0])}.`;
  return `В поле сделки попадёт: ${esc(names[def])} (по умолчанию). Остальные юрлица (${link.entities.length - 1}) сохранены как альтернативы и в сделку автоматически не идут.`;
}

function renderDetail() {
  const c = state.companies.find((x) => x.id === state.selectedId);
  const pane = $('detail');
  if (!c) {
    pane.innerHTML = '<div class="empty">Выберите компанию слева</div>';
    return;
  }
  const link = state.links[c.id] || null;
  const ids = new Set((link?.entities || []).map((e) => e.bitrixId));
  let h = `<h2>${esc(c.name)}</h2><div class="sub">Компания HireTrack №${c.id}${c.town ? ` · ${esc(c.town)}` : ''}${c.archived ? ' · в архиве' : ''} · работ: клиент ${c.jobs.client}, площадка ${c.jobs.venue}, плательщик ${c.jobs.payer}</div>`;
  if (looksLikePerson(c.name) && !link) h += '<div class="preview"><b>Похоже на имя человека</b>Такой клиент часто работает через ИП или компанию, и по названию её не найти. Попробуйте поиск по фамилии или ИНН.</div>';

  if (link && link.status === 'linked') {
    h += `<div class="sec">Связанные юрлица в 1С</div>${link.entities.map((e) => entityCard(e.bitrixId, link)).join('')}`;
  } else if (link && link.status === 'none') {
    h += '<div class="sec">Статус</div><div class="card on"><div class="nm"><b>Без компании</b><div class="sub">Сделки по этому клиенту создаются без компании.</div></div></div>';
  }

  if (!link || link.status === 'linked') {
    const sugg = suggestionsFor(c, ids);
    h += `<div class="sec">Подсказки по названию</div>${sugg.length ? sugg.map((x) => candidateCard(x.b, `совпадение ${Math.round(x.score * 100)}%`)).join('') : '<div class="sub">Похожих заказчиков не нашлось.</div>'}`;
    h += `<div class="sec">Найти заказчика</div><div class="searchrow"><input id="pick" type="text" placeholder="Название, ФИО, ИНН" value="${esc(state.pickQuery)}" autocomplete="off"><label><input type="checkbox" id="gen"${state.includeGeneral ? ' checked' : ''}> и «Общая воронка»</label></div><div class="results" id="results"></div>`;
  }
  h += `<div class="sec">Заметка</div><textarea id="note" placeholder="Например: работает через ИП Данилов">${esc(link?.note || '')}</textarea>`;
  h += `<div class="preview"><b>Что попадёт в новую сделку</b>${previewText(c, link)}</div>`;
  h += '<div class="btns">';
  if (!link || link.status !== 'none') h += '<button type="button" id="btnNone">Без компании</button>';
  if (link) h += '<button type="button" id="btnReset">Сбросить решение</button>';
  h += '</div>';
  pane.innerHTML = h;
  renderResults();
}

function renderResults() {
  const box = $('results');
  if (!box) return;
  const c = state.companies.find((x) => x.id === state.selectedId);
  const ids = new Set((state.links[c.id]?.entities || []).map((e) => e.bitrixId));
  const found = searchResults(state.pickQuery, ids);
  if (state.pickQuery.trim().length < 2) box.innerHTML = '';
  else box.innerHTML = found.length ? found.map((b) => candidateCard(b, '')).join('') : '<div class="sub">Ничего не найдено.</div>';
}

function render() {
  renderSummary();
  renderList();
  renderDetail();
}

// ---------- actions ----------

function toast(text) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

async function persist(htId, link) {
  try {
    if (link === null) {
      await api('DELETE', `/api/client-links/${htId}`);
      delete state.links[htId];
    } else {
      const res = await api('PUT', `/api/client-links/${htId}`, link);
      state.links[htId] = res.link;
    }
    recountUsage();
    render();
    toast('Сохранено');
  } catch (error) {
    toast(`Не сохранено: ${error.message}`);
    await load(false);
  }
}

function currentEntities(htId) {
  return (state.links[htId]?.entities || []).map((e) => ({ ...e }));
}

function noteValue() {
  const el = $('note');
  return el ? el.value.trim() : '';
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('button, .item, input[data-def]');
  if (!target) return;
  const htId = state.selectedId;
  if (target.classList.contains('item')) {
    state.selectedId = Number(target.dataset.id);
    state.pickQuery = '';
    render();
    return;
  }
  if (target.dataset.add) {
    const entities = currentEntities(htId);
    const id = Number(target.dataset.add);
    if (!entities.some((e) => e.bitrixId === id)) entities.push({ bitrixId: id, isDefault: entities.length === 0 });
    persist(htId, { status: 'linked', entities, note: noteValue() });
  } else if (target.dataset.rm) {
    const id = Number(target.dataset.rm);
    const entities = currentEntities(htId).filter((e) => e.bitrixId !== id);
    persist(htId, entities.length ? { status: 'linked', entities, note: noteValue() } : null);
  } else if (target.id === 'btnNone') {
    persist(htId, { status: 'none', entities: [], note: noteValue() });
  } else if (target.id === 'btnReset') {
    persist(htId, null);
  }
});

document.addEventListener('change', (event) => {
  const t = event.target;
  if (t.dataset && t.dataset.def) {
    const id = Number(t.dataset.def);
    const entities = currentEntities(state.selectedId).map((e) => ({ ...e, isDefault: e.bitrixId === id }));
    persist(state.selectedId, { status: 'linked', entities, note: noteValue() });
  } else if (t.id === 'gen') {
    state.includeGeneral = t.checked;
    renderDetail();
  } else if (t.id === 'note') {
    const link = state.links[state.selectedId];
    if (link) persist(state.selectedId, { status: link.status, entities: link.entities, note: noteValue() });
  }
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'pick') {
    state.pickQuery = event.target.value;
    renderResults();
  }
});

$('search').addEventListener('input', (e) => { state.search = e.target.value; renderList(); });
$('statusFilter').addEventListener('change', (e) => { state.status = e.target.value; renderList(); });
$('roleFilter').addEventListener('change', (e) => { state.role = e.target.value; renderList(); });
$('refreshBtn').addEventListener('click', () => load(true).catch((e) => toast(e.message)));
$('helpBtn').addEventListener('click', () => {
  $('helpBody').innerHTML = HELP.map(([t, p]) => `<h3>${esc(t)}</h3><p>${esc(p)}</p>`).join('');
  $('helpModal').hidden = false;
});
$('helpClose').addEventListener('click', () => { $('helpModal').hidden = true; });
$('helpModal').addEventListener('click', (e) => { if (e.target === $('helpModal')) $('helpModal').hidden = true; });

load(false).catch((error) => {
  $('summary').textContent = `Ошибка загрузки: ${error.message}`;
});
