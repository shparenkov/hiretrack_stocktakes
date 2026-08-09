(() => {
  const state = {
    catalog: [],
    catalogLoaded: false,
    selectedClient: null,
    lines: [], // { typeId, name, categoryName, qty, availability: null | { availableQty, stocklevelForWarehouse, status: 'pending'|'ok'|'low'|'none'|'error' } }
  };

  const jobNameInput = document.getElementById('job-name');
  const dateFromInput = document.getElementById('date-from');
  const dateToInput = document.getElementById('date-to');
  const dateFromReadbackEl = document.getElementById('date-from-readback');
  const dateToReadbackEl = document.getElementById('date-to-readback');
  const dateRangeErrorEl = document.getElementById('date-range-error');

  const clientSearchInput = document.getElementById('client-search');
  const clientResultsEl = document.getElementById('client-results');
  const clientSelectedEl = document.getElementById('client-selected');
  const clientSelectedNameEl = document.getElementById('client-selected-name');
  const clientClearBtn = document.getElementById('client-clear');

  const equipmentSearchInput = document.getElementById('equipment-search');
  const equipmentResultsEl = document.getElementById('equipment-results');
  const loadStatusEl = document.getElementById('load-status');

  const linesBodyEl = document.getElementById('lines-body');
  const linesEmptyEl = document.getElementById('lines-empty');

  const submitBtn = document.getElementById('submit-btn');
  const resultEl = document.getElementById('result');

  function debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  function toHiretrackDateTime(localValue) {
    if (!localValue) return null;
    // "YYYY-MM-DDTHH:MM" -> "YYYY-MM-DD HH:MM:SS"
    return localValue.replace('T', ' ') + ':00';
  }

  function getDateRange() {
    return { dateFrom: toHiretrackDateTime(dateFromInput.value), dateTo: toHiretrackDateTime(dateToInput.value) };
  }

  const READBACK_FORMATTER = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  // Live human-readable readback of each date field, so a value the browser
  // silently defaulted/reset (native datetime-local inputs are unreliable if
  // a segment - date, hour, AM/PM - isn't explicitly committed) is visible
  // immediately instead of only surfacing after HireTrack gets the wrong
  // dates. Also flags "range error" is dateTo <= dateFrom.
  function updateDateReadbacks() {
    for (const [input, el] of [[dateFromInput, dateFromReadbackEl], [dateToInput, dateToReadbackEl]]) {
      if (!input.value) {
        el.textContent = 'не указано';
        el.classList.add('empty');
        continue;
      }
      const parsed = new Date(input.value);
      el.textContent = Number.isNaN(parsed.getTime()) ? 'некорректная дата' : READBACK_FORMATTER.format(parsed);
      el.classList.remove('empty');
    }

    const { dateFrom, dateTo } = getDateRange();
    const rangeInvalid = Boolean(dateFrom && dateTo && dateFrom >= dateTo);
    dateRangeErrorEl.classList.toggle('hidden', !rangeInvalid);
    return !rangeInvalid;
  }

  // --- Catalog load (once) ---
  async function loadCatalog() {
    loadStatusEl.textContent = 'Загрузка каталога оборудования…';
    try {
      const res = await fetch('/api/create-job/catalog');
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Не удалось загрузить каталог');
      state.catalog = data.items || [];
      state.catalogLoaded = true;
      loadStatusEl.textContent = `Каталог загружен: ${state.catalog.length} позиций.`;
    } catch (err) {
      loadStatusEl.textContent = `Ошибка загрузки каталога: ${err.message}`;
    }
  }

  // --- Client search ---
  const searchClients = debounce(async (query) => {
    if (query.trim().length < 2) {
      clientResultsEl.classList.add('hidden');
      clientResultsEl.innerHTML = '';
      return;
    }
    try {
      const res = await fetch(`/api/create-job/companies?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Ошибка поиска клиента');
      renderClientResults(data.companies || []);
    } catch (err) {
      clientResultsEl.innerHTML = `<div class="result-row">Ошибка: ${err.message}</div>`;
      clientResultsEl.classList.remove('hidden');
    }
  }, 300);

  function renderClientResults(companies) {
    if (companies.length === 0) {
      clientResultsEl.innerHTML = '<div class="result-row">Ничего не найдено</div>';
      clientResultsEl.classList.remove('hidden');
      return;
    }
    clientResultsEl.innerHTML = '';
    for (const company of companies) {
      const row = document.createElement('div');
      row.className = 'result-row';
      row.innerHTML = `<div class="name">${escapeHtml(company.companyName)}</div><div class="meta">#${company.companyId}${company.town ? ' · ' + escapeHtml(company.town) : ''}</div>`;
      row.addEventListener('click', () => selectClient(company));
      clientResultsEl.appendChild(row);
    }
    clientResultsEl.classList.remove('hidden');
  }

  function selectClient(company) {
    state.selectedClient = company;
    clientSelectedNameEl.textContent = `${company.companyName} (#${company.companyId})`;
    clientSelectedEl.classList.remove('hidden');
    clientSearchInput.value = '';
    clientSearchInput.classList.add('hidden');
    clientResultsEl.classList.add('hidden');
    clientResultsEl.innerHTML = '';
    updateSubmitState();
  }

  clientClearBtn.addEventListener('click', () => {
    state.selectedClient = null;
    clientSelectedEl.classList.add('hidden');
    clientSearchInput.classList.remove('hidden');
    clientSearchInput.focus();
    updateSubmitState();
  });

  clientSearchInput.addEventListener('input', () => searchClients(clientSearchInput.value));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.client-picker')) {
      clientResultsEl.classList.add('hidden');
    }
  });

  // --- Equipment search (client-side over cached catalog) ---
  function searchEquipment(query) {
    const q = query.trim().toLowerCase();
    if (q.length < 2 || !state.catalogLoaded) {
      equipmentResultsEl.classList.add('hidden');
      equipmentResultsEl.innerHTML = '';
      return;
    }
    const matches = state.catalog
      .filter((item) => {
        const haystack = `${item.name || ''} ${item.categoryName || ''} ${item.shortcode || ''} ${item.similarGroupName || ''}`.toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 20);
    renderEquipmentResults(matches);
  }

  function renderEquipmentResults(items) {
    if (items.length === 0) {
      equipmentResultsEl.innerHTML = '<div class="result-row">Ничего не найдено</div>';
      equipmentResultsEl.classList.remove('hidden');
      return;
    }
    equipmentResultsEl.innerHTML = '';
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'result-row';
      row.innerHTML = `<div class="name">${escapeHtml(item.name || '')}</div><div class="meta">#${item.typeId} · ${escapeHtml(item.categoryName || '')}</div>`;
      row.addEventListener('click', () => addLine(item));
      equipmentResultsEl.appendChild(row);
    }
    equipmentResultsEl.classList.remove('hidden');
  }

  equipmentSearchInput.addEventListener('input', () => searchEquipment(equipmentSearchInput.value));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.equipment-picker')) {
      equipmentResultsEl.classList.add('hidden');
    }
  });

  // --- Lines ---
  function addLine(item) {
    const existing = state.lines.find((line) => line.typeId === item.typeId);
    if (existing) {
      existing.qty += 1;
    } else {
      state.lines.push({
        typeId: item.typeId,
        name: item.name,
        categoryName: item.categoryName,
        qty: 1,
        availability: null,
      });
    }
    equipmentSearchInput.value = '';
    equipmentResultsEl.classList.add('hidden');
    renderLines();
    const line = state.lines.find((l) => l.typeId === item.typeId);
    refreshAvailability(line);
  }

  function removeLine(typeId) {
    state.lines = state.lines.filter((line) => line.typeId !== typeId);
    renderLines();
    updateSubmitState();
  }

  function renderLines() {
    linesBodyEl.innerHTML = '';
    linesEmptyEl.classList.toggle('hidden', state.lines.length > 0);
    for (const line of state.lines) {
      const tr = document.createElement('tr');

      const nameTd = document.createElement('td');
      nameTd.innerHTML = `<strong>${escapeHtml(line.name || '')}</strong><br><span class="meta">#${line.typeId} · ${escapeHtml(line.categoryName || '')}</span>`;

      const qtyTd = document.createElement('td');
      const qtyInput = document.createElement('input');
      qtyInput.type = 'number';
      qtyInput.min = '1';
      qtyInput.step = '1';
      qtyInput.value = String(line.qty);
      qtyInput.addEventListener('change', () => {
        const value = Math.max(1, Math.round(Number(qtyInput.value) || 1));
        line.qty = value;
        qtyInput.value = String(value);
        refreshAvailability(line);
        updateSubmitState();
      });
      qtyTd.appendChild(qtyInput);

      const availTd = document.createElement('td');
      availTd.appendChild(renderAvailabilityBadge(line));

      const actionTd = document.createElement('td');
      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-line';
      removeBtn.textContent = 'Убрать';
      removeBtn.addEventListener('click', () => removeLine(line.typeId));
      actionTd.appendChild(removeBtn);

      tr.append(nameTd, qtyTd, availTd, actionTd);
      linesBodyEl.appendChild(tr);
    }
    updateSubmitState();
  }

  function renderAvailabilityBadge(line) {
    const span = document.createElement('span');
    const availability = line.availability;
    if (!availability) {
      span.className = 'availability-badge pending';
      span.textContent = getDateRange().dateFrom && getDateRange().dateTo ? '…' : 'укажите даты';
      return span;
    }
    if (availability.status === 'error') {
      span.className = 'availability-badge none';
      span.textContent = 'ошибка проверки';
      return span;
    }
    const { availableQty, stocklevelForWarehouse } = availability;
    span.textContent = `${availableQty} свободно из ${stocklevelForWarehouse}`;
    if (availableQty <= 0) {
      span.className = 'availability-badge none';
    } else if (availableQty < line.qty) {
      span.className = 'availability-badge low';
    } else {
      span.className = 'availability-badge ok';
    }
    return span;
  }

  async function refreshAvailability(line) {
    const { dateFrom, dateTo } = getDateRange();
    if (!dateFrom || !dateTo) {
      line.availability = null;
      renderLines();
      return;
    }
    try {
      const params = new URLSearchParams({
        typeId: String(line.typeId),
        quantity: String(line.qty),
        dateFrom,
        dateTo,
      });
      const res = await fetch(`/api/create-job/availability?${params.toString()}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Ошибка проверки доступности');
      line.availability = {
        availableQty: data.availableQty ?? 0,
        stocklevelForWarehouse: data.stocklevelForWarehouse ?? 0,
        status: 'ok',
      };
    } catch (err) {
      line.availability = { status: 'error' };
    }
    renderLines();
  }

  function refreshAllAvailability() {
    for (const line of state.lines) {
      refreshAvailability(line);
    }
  }

  dateFromInput.addEventListener('change', refreshAllAvailability);
  dateToInput.addEventListener('change', refreshAllAvailability);

  // --- Submit ---
  function updateSubmitState() {
    const rangeValid = updateDateReadbacks();
    const { dateFrom, dateTo } = getDateRange();
    const ready =
      jobNameInput.value.trim().length > 0 &&
      state.selectedClient &&
      dateFrom &&
      dateTo &&
      rangeValid &&
      state.lines.length > 0;
    submitBtn.disabled = !ready;
  }

  jobNameInput.addEventListener('input', updateSubmitState);
  dateFromInput.addEventListener('input', updateSubmitState);
  dateFromInput.addEventListener('change', updateSubmitState);
  dateToInput.addEventListener('input', updateSubmitState);
  dateToInput.addEventListener('change', updateSubmitState);

  submitBtn.addEventListener('click', async () => {
    const { dateFrom, dateTo } = getDateRange();
    const payload = {
      jobName: jobNameInput.value.trim(),
      clientId: state.selectedClient.companyId,
      dateFrom,
      dateTo,
      lines: state.lines.map((line) => ({ typeId: line.typeId, quantity: line.qty })),
    };

    submitBtn.disabled = true;
    submitBtn.textContent = 'Создаём…';
    resultEl.classList.add('hidden');

    try {
      const res = await fetch('/api/create-job/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Не удалось создать работу');

      const allFailed = data.linesWritten === 0;
      const someFailed = data.failedLines && data.failedLines.length > 0;
      let html = `Работа создана: <strong>${escapeHtml(data.jobRef || String(data.jobId))}</strong>, Eqlist <strong>${escapeHtml(data.eqRef || String(data.eqlistId))}</strong>. Записано позиций: <strong>${data.linesWritten} из ${state.lines.length}</strong>.`;
      if (someFailed) {
        html += '<br>Не удалось записать: ' + data.failedLines.map((f) => `#${f.typeId} — ${escapeHtml(f.error)}`).join('; ');
      }
      resultEl.className = allFailed ? 'result error' : someFailed ? 'result warning' : 'result success';
      resultEl.innerHTML = html;
      resultEl.classList.remove('hidden');
    } catch (err) {
      resultEl.className = 'result error';
      resultEl.textContent = `Ошибка: ${err.message}`;
      resultEl.classList.remove('hidden');
    } finally {
      submitBtn.textContent = 'Создать работу в HireTrack';
      updateSubmitState();
    }
  });

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  updateDateReadbacks();
  loadCatalog();
})();
