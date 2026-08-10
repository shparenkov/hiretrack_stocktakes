(() => {
  const state = {
    mode: 'new', // 'new' | 'existing'
    catalog: [],
    catalogById: new Map(),
    catalogLoaded: false,
    selectedClient: null,
    loadedJob: null, // { jobRef, eqlistId, clientId, clientName, dateFrom, dateTo, existingLines }
    lines: [], // { typeId, name, categoryName, qty, availability: null | { availableQty, stocklevelForWarehouse, status: 'pending'|'ok'|'low'|'none'|'error' } }
  };

  const modeNewBtn = document.getElementById('mode-new');
  const modeExistingBtn = document.getElementById('mode-existing');
  const newJobCard = document.getElementById('new-job-card');
  const newJobClientCard = document.getElementById('new-job-client-card');
  const existingJobCard = document.getElementById('existing-job-card');
  const equipmentCardEl = document.getElementById('equipment-card');
  const submitCardEl = document.querySelector('.submit-card');

  const jobRefSearchInput = document.getElementById('job-ref-search');
  const jobRefResultsEl = document.getElementById('job-ref-results');
  const jobRefStatusEl = document.getElementById('job-ref-status');
  const jobLoadedInfoEl = document.getElementById('job-loaded-info');
  const jobLoadedRefEl = document.getElementById('job-loaded-ref');
  const jobLoadedClientEl = document.getElementById('job-loaded-client');
  const jobLoadedDatesEl = document.getElementById('job-loaded-dates');
  const existingLinesTreeEl = document.getElementById('existing-lines-tree');

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
    if (state.mode === 'existing') {
      return state.loadedJob
        ? { dateFrom: state.loadedJob.dateFrom, dateTo: state.loadedJob.dateTo }
        : { dateFrom: null, dateTo: null };
    }
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
    if (state.mode === 'existing') {
      dateRangeErrorEl.classList.add('hidden');
      return true;
    }
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

  // --- Mode toggle (new job vs open an existing one) ---
  function setMode(mode) {
    state.mode = mode;
    modeNewBtn.classList.toggle('active', mode === 'new');
    modeExistingBtn.classList.toggle('active', mode === 'existing');
    newJobCard.classList.toggle('hidden', mode !== 'new');
    newJobClientCard.classList.toggle('hidden', mode !== 'new');
    existingJobCard.classList.toggle('hidden', mode !== 'existing');
    // Existing-job mode adds equipment directly per-section (top of each
    // section in the tree, see buildSectionAddWidget) instead of through
    // this shared staging table + batch submit - hide both entirely.
    equipmentCardEl.classList.toggle('hidden', mode === 'existing');
    submitCardEl.classList.toggle('hidden', mode === 'existing');
    submitBtn.textContent = 'Создать работу в HireTrack';
    resultEl.classList.add('hidden');
    state.lines = [];
    renderLines();
    updateSubmitState();
  }

  modeNewBtn.addEventListener('click', () => setMode('new'));
  modeExistingBtn.addEventListener('click', () => setMode('existing'));

  // Interactive job search: users know the client/job name, not the job
  // number, so typing a name suggests matching job numbers to pick from -
  // same debounced-dropdown pattern as the client search above.
  const searchJobs = debounce(async (query) => {
    if (query.trim().length < 2) {
      jobRefResultsEl.classList.add('hidden');
      jobRefResultsEl.innerHTML = '';
      return;
    }
    try {
      const res = await fetch(`/api/create-job/jobs?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Ошибка поиска работы');
      renderJobResults(data.jobs || []);
    } catch (err) {
      jobRefResultsEl.innerHTML = `<div class="result-row">Ошибка: ${escapeHtml(err.message)}</div>`;
      jobRefResultsEl.classList.remove('hidden');
    }
  }, 300);

  function renderJobResults(jobs) {
    if (jobs.length === 0) {
      jobRefResultsEl.innerHTML = '<div class="result-row">Ничего не найдено</div>';
      jobRefResultsEl.classList.remove('hidden');
      return;
    }
    jobRefResultsEl.innerHTML = '';
    for (const job of jobs) {
      const row = document.createElement('div');
      row.className = 'result-row';
      const title = job.jobTitle || job.clientName || '';
      row.innerHTML = `<div class="name">${escapeHtml(job.jobRef)} ${title ? '· ' + escapeHtml(title) : ''}</div><div class="meta">${escapeHtml(job.clientName || '')}</div>`;
      row.addEventListener('click', () => {
        jobRefSearchInput.value = job.jobRef;
        jobRefResultsEl.classList.add('hidden');
        openExistingJob(job.jobRef);
      });
      jobRefResultsEl.appendChild(row);
    }
    jobRefResultsEl.classList.remove('hidden');
  }

  jobRefSearchInput.addEventListener('input', () => searchJobs(jobRefSearchInput.value));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.job-picker')) {
      jobRefResultsEl.classList.add('hidden');
    }
  });

  // TEquipmentType: 0=etSimple, 1=etCompositeKit, 2=etAliasKit,
  // 3=etPricedAliasKit, 4=etMarkup. Single-letter badges, first letter of
  // the original English name - Composite/Alias/PricedAlias/Markup take
  // priority over the Consumable class check below, since a kit type is
  // essentially never also Class=Consumable in practice.
  const EQUIPMENT_TYPE_BADGES = {
    0: { cls: 'normal', letter: 'N' },
    1: { cls: 'composite', letter: 'C' },
    2: { cls: 'alias', letter: 'A' },
    3: { cls: 'alias', letter: 'A' },
    4: { cls: 'normal', letter: 'M' },
  };

  // Hetype.Class (TEquipmentClass, confirmed live via #Fields.FIELD_DESC:
  // "ecRental, ecConsumable, ecNewSales, ecExRentalSales (0..3)") - a
  // separate axis from EquipmentType. Only Consumable (1) gets its own badge.
  const CONSUMABLE_CLASS = 1;

  function typeBadgeHtml(equipmentType, equipmentClass) {
    if ((equipmentType ?? 0) === 0 && equipmentClass === CONSUMABLE_CLASS) {
      return '<span class="type-badge consumable">C</span>';
    }
    const info = EQUIPMENT_TYPE_BADGES[equipmentType] || EQUIPMENT_TYPE_BADGES[0];
    return `<span class="type-badge ${info.cls}">${info.letter}</span>`;
  }

  // Renders one section's lines (Composite/Alias nested under their own
  // line) into sectionEl. Shared by every section, including the
  // "Без секции" bucket and empty newly-created sections.
  function renderLinesIntoSection(sectionEl, sectionLines, loadedJob) {
    // A Composite/Alias line's declared components (from the catalog's
    // COMPOSIT data) often ALSO exist as their own separate Sort rows in
    // the same section, for stock tracking - without this, they'd render
    // twice: once as a standalone line, once nested under the Composite.
    // Absorb them into the Composite's nested view instead and skip the
    // standalone line, using the real persisted quantity when available
    // (more authoritative than the catalog recipe's default quantity).
    const linesByType = new Map(sectionLines.map((l) => [l.typeId, l]));
    const absorbedTypeIds = new Set();
    for (const line of sectionLines) {
      const catalogItem = state.catalogById.get(line.typeId);
      const equipmentType = line.equipmentType ?? catalogItem?.equipmentType ?? 0;
      if (equipmentType > 0) {
        for (const component of catalogItem?.components || []) {
          if (linesByType.has(component.componentTypeId)) {
            absorbedTypeIds.add(component.componentTypeId);
          }
        }
      }
    }

    for (const line of sectionLines) {
      if (absorbedTypeIds.has(line.typeId)) continue;

      const catalogItem = state.catalogById.get(line.typeId);
      const equipmentType = line.equipmentType ?? catalogItem?.equipmentType ?? 0;
      const components = catalogItem?.components || [];

      const hasComponents = equipmentType > 0 && components.length > 0;

      const lineEl = document.createElement('div');
      lineEl.className = 'tree-line';
      lineEl.dataset.lineRefId = String(line.lineRefId);
      lineEl.innerHTML = `
        ${typeBadgeHtml(equipmentType, line.equipmentClass)}
        <input type="number" class="tree-line-qty-input" min="1" step="1" value="${line.qty}">
        ${hasComponents ? '<button type="button" class="tree-line-toggle" aria-expanded="false">▸</button>' : '<span class="tree-line-toggle-spacer"></span>'}
        <span class="tree-line-name">${escapeHtml(line.name || '')}</span>
        <span class="tree-line-availability pending">…</span>
        <button type="button" class="tree-line-remove" title="Удалить" aria-label="Удалить">×</button>
      `;
      const qtyInput = lineEl.querySelector('.tree-line-qty-input');
      // Debounced so clicking the native number-input stepper arrows
      // (each click commits its own 'change' event immediately) coalesces
      // into one save instead of firing a request - and a full tree
      // rebuild - per click.
      const commitQtyChange = debounce(() => {
        const newQty = Math.max(1, Math.round(Number(qtyInput.value) || 1));
        qtyInput.value = String(newQty);
        if (newQty !== line.qty) changeExistingLineQuantity(loadedJob, line, newQty);
      }, 450);
      qtyInput.addEventListener('change', commitQtyChange);
      lineEl.querySelector('.tree-line-remove').addEventListener('click', () => removeExistingLine(loadedJob, line));
      sectionEl.appendChild(lineEl);
      refreshExistingLineAvailability(loadedJob, line);

      if (hasComponents) {
        const componentsEl = document.createElement('div');
        componentsEl.className = 'tree-components collapsed';
        for (const component of components) {
          const matchedLine = linesByType.get(component.componentTypeId);
          const qty = matchedLine ? matchedLine.qty : component.quantity;
          const compLineEl = document.createElement('div');
          compLineEl.className = 'tree-component-line';
          compLineEl.innerHTML = `<span class="tree-component-qty">${qty} ×</span><span>${escapeHtml(component.componentName || '')}</span>`;
          componentsEl.appendChild(compLineEl);
        }
        sectionEl.appendChild(componentsEl);

        // Composite/Alias contents are collapsed by default (spoiler) -
        // toggle button lives on the parent line, componentsEl is its own
        // sibling node right after it in the DOM.
        const toggleBtn = lineEl.querySelector('.tree-line-toggle');
        toggleBtn.addEventListener('click', () => {
          const isCollapsed = componentsEl.classList.toggle('collapsed');
          toggleBtn.textContent = isCollapsed ? '▸' : '▾';
          toggleBtn.setAttribute('aria-expanded', String(!isCollapsed));
        });
      }
    }
  }

  // Section header with inline rename (pencil -> text input, commits on
  // blur/Enter, Escape cancels) and delete (confirm() before calling the
  // API - a real EqSections row, not just a UI grouping). Rename mutates
  // section.sectionText in place instead of a full reload, matching the
  // same "seamless edit" pattern as changeExistingLineQuantity.
  function buildSectionHeader(loadedJob, section) {
    const header = document.createElement('div');
    header.className = 'tree-section-header';

    const titleEl = document.createElement('span');
    titleEl.className = 'tree-section-title';
    titleEl.textContent = section.sectionText || `Секция #${section.sectionId}`;

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'tree-section-rename';
    renameBtn.title = 'Переименовать секцию';
    renameBtn.setAttribute('aria-label', 'Переименовать секцию');
    renameBtn.textContent = '✎';

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'tree-section-delete';
    deleteBtn.title = 'Удалить секцию';
    deleteBtn.setAttribute('aria-label', 'Удалить секцию');
    deleteBtn.textContent = '×';

    header.append(titleEl, renameBtn, deleteBtn);

    renameBtn.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'tree-section-title-input';
      input.maxLength = 255;
      input.value = section.sectionText || '';
      header.replaceChild(input, titleEl);
      renameBtn.classList.add('hidden');
      deleteBtn.classList.add('hidden');
      input.focus();
      input.select();

      let settled = false;
      const restore = () => {
        header.replaceChild(titleEl, input);
        renameBtn.classList.remove('hidden');
        deleteBtn.classList.remove('hidden');
      };
      const commit = async () => {
        if (settled) return;
        settled = true;
        const newText = input.value.trim();
        if (!newText || newText === section.sectionText) {
          restore();
          return;
        }
        jobRefStatusEl.textContent = 'Переименовываем секцию…';
        try {
          const res = await fetch(`/api/create-job/jobs/${encodeURIComponent(loadedJob.jobRef)}/sections/${section.sectionId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sectionText: newText }),
          });
          const data = await res.json();
          if (!data.ok) throw new Error(data.error || 'Не удалось переименовать секцию');
          section.sectionText = newText;
          titleEl.textContent = newText;
          jobRefStatusEl.textContent = '';
        } catch (err) {
          jobRefStatusEl.textContent = `Ошибка переименования секции: ${err.message}`;
        }
        restore();
      };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') input.blur();
        if (e.key === 'Escape') {
          settled = true;
          restore();
        }
      });
    });

    deleteBtn.addEventListener('click', async () => {
      const title = section.sectionText || `Секция #${section.sectionId}`;
      if (!confirm(`Удалить секцию «${title}»? Оборудование из неё останется на работе без секции.`)) return;
      jobRefStatusEl.textContent = 'Удаляем секцию…';
      try {
        const params = new URLSearchParams({ eqlistId: String(loadedJob.eqlistId) });
        const res = await fetch(`/api/create-job/jobs/${encodeURIComponent(loadedJob.jobRef)}/sections/${section.sectionId}?${params.toString()}`, {
          method: 'DELETE',
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Не удалось удалить секцию');
        jobRefStatusEl.textContent = '';
        await openExistingJob(loadedJob.jobRef);
      } catch (err) {
        jobRefStatusEl.textContent = `Ошибка удаления секции: ${err.message}`;
      }
    });

    return header;
  }

  // "+ Добавить секцию" control, always shown at the bottom of the tree.
  function buildAddSectionControl(loadedJob) {
    const wrap = document.createElement('div');
    wrap.className = 'tree-add-section';
    wrap.innerHTML = `
      <input type="text" class="tree-add-section-input" placeholder="Название новой секции…" maxlength="255">
      <button type="button" class="tree-add-section-btn">+ Добавить секцию</button>
    `;
    const input = wrap.querySelector('.tree-add-section-input');
    const btn = wrap.querySelector('.tree-add-section-btn');

    const submit = async () => {
      const sectionText = input.value.trim();
      if (!sectionText) {
        input.focus();
        return;
      }
      btn.disabled = true;
      jobRefStatusEl.textContent = 'Добавляем секцию…';
      try {
        const res = await fetch(`/api/create-job/jobs/${encodeURIComponent(loadedJob.jobRef)}/sections`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ eqlistId: loadedJob.eqlistId, sectionText }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Не удалось добавить секцию');
        jobRefStatusEl.textContent = '';
        await openExistingJob(loadedJob.jobRef);
      } catch (err) {
        jobRefStatusEl.textContent = `Ошибка добавления секции: ${err.message}`;
        btn.disabled = false;
      }
    };
    btn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });

    return wrap;
  }

  // Appends one line directly to loadedJob's Eqlist, tagged with this
  // section (api_v2's append_to_booking has no section param of its own -
  // the backend moves the new line into place afterward, see
  // setHiretrackLineSection). Reloads the tree and refocuses this same
  // section's search box on success, so entering several items in a row
  // stays a tight loop.
  async function addEquipmentToSection(loadedJob, section, typeId, qty) {
    jobRefStatusEl.textContent = 'Добавляем оборудование…';
    try {
      const res = await fetch(`/api/create-job/jobs/${encodeURIComponent(loadedJob.jobRef)}/lines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eqlistId: loadedJob.eqlistId,
          clientId: loadedJob.clientId,
          dateFrom: loadedJob.dateFrom,
          dateTo: loadedJob.dateTo,
          lines: [{ typeId, quantity: qty, sectionId: section.sectionId }],
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Не удалось добавить оборудование');
      if (data.linesWritten === 0) {
        const failure = data.failedLines && data.failedLines[0];
        throw new Error((failure && failure.error) || 'HireTrack отклонил позицию');
      }
      jobRefStatusEl.textContent = '';
      await openExistingJob(loadedJob.jobRef, section.sectionId);
    } catch (err) {
      jobRefStatusEl.textContent = `Ошибка добавления: ${err.message}`;
    }
  }

  // Per-section "add equipment" widget, rendered at the top of every real
  // section - search + inline qty, arrow-key/Enter selection, and
  // availability shown directly on each result row ("10/10"), all aimed at
  // fast consecutive entry without a separate staging table.
  function buildSectionAddWidget(loadedJob, section) {
    const wrap = document.createElement('div');
    wrap.className = 'section-add';
    wrap.dataset.sectionId = String(section.sectionId);
    wrap.innerHTML = `
      <div class="section-add-row">
        <input type="text" class="section-add-search" placeholder="Добавить оборудование в эту секцию…" autocomplete="off">
        <input type="number" class="section-add-qty" min="1" step="1" value="1">
      </div>
      <div class="section-add-results hidden"></div>
    `;
    const searchInput = wrap.querySelector('.section-add-search');
    const qtyInput = wrap.querySelector('.section-add-qty');
    const resultsEl = wrap.querySelector('.section-add-results');

    let matches = [];
    let highlightedIndex = -1;
    let searchToken = 0;

    const closeResults = () => {
      resultsEl.classList.add('hidden');
      resultsEl.innerHTML = '';
      matches = [];
      highlightedIndex = -1;
    };

    const setHighlighted = (index) => {
      const rows = [...resultsEl.querySelectorAll('.section-add-result-row')];
      rows.forEach((row, i) => row.classList.toggle('highlighted', i === index));
      if (index >= 0 && rows[index]) rows[index].scrollIntoView({ block: 'nearest' });
      highlightedIndex = index;
    };

    const commitAdd = (typeId) => {
      const qty = Math.max(1, Math.round(Number(qtyInput.value) || 1));
      closeResults();
      searchInput.value = '';
      qtyInput.value = '1';
      addEquipmentToSection(loadedJob, section, typeId, qty);
    };

    const runSearch = (query) => {
      const q = query.trim().toLowerCase();
      if (q.length < 2 || !state.catalogLoaded) {
        closeResults();
        return;
      }
      matches = state.catalog
        .filter((item) => {
          const haystack = `${item.name || ''} ${item.categoryName || ''} ${item.shortcode || ''} ${item.similarGroupName || ''}`.toLowerCase();
          return haystack.includes(q);
        })
        .slice(0, 8);

      if (matches.length === 0) {
        resultsEl.innerHTML = '<div class="section-add-empty">Ничего не найдено</div>';
        resultsEl.classList.remove('hidden');
        highlightedIndex = -1;
        return;
      }

      const token = ++searchToken;
      const desiredQty = Math.max(1, Math.round(Number(qtyInput.value) || 1));
      resultsEl.innerHTML = '';
      matches.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'section-add-result-row';
        row.innerHTML = `
          <span class="section-add-result-name">${escapeHtml(item.name || '')}</span>
          <span class="section-add-result-avail pending">…</span>
        `;
        // mousedown, not click - fires before the search input's blur would
        // otherwise close the dropdown first.
        row.addEventListener('mousedown', (e) => {
          e.preventDefault();
          commitAdd(item.typeId);
        });
        resultsEl.appendChild(row);

        const availEl = row.querySelector('.section-add-result-avail');
        const params = new URLSearchParams({
          typeId: String(item.typeId),
          quantity: String(desiredQty),
          dateFrom: loadedJob.dateFrom,
          dateTo: loadedJob.dateTo,
        });
        fetch(`/api/create-job/availability?${params.toString()}`)
          .then((res) => res.json())
          .then((data) => {
            if (token !== searchToken || !data.ok) throw new Error(data && data.error);
            const availableQty = data.availableQty ?? 0;
            const stocklevelForWarehouse = data.stocklevelForWarehouse ?? 0;
            availEl.textContent = `${availableQty}/${stocklevelForWarehouse}`;
            availEl.className = 'section-add-result-avail ' + (availableQty <= 0 ? 'none' : availableQty < desiredQty ? 'low' : 'ok');
          })
          .catch(() => {
            if (token !== searchToken) return;
            availEl.textContent = '?';
            availEl.className = 'section-add-result-avail none';
          });
      });
      resultsEl.classList.remove('hidden');
      highlightedIndex = -1;
    };

    searchInput.addEventListener('input', debounce(() => runSearch(searchInput.value), 200));
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        if (matches.length === 0) return;
        e.preventDefault();
        setHighlighted(Math.min(highlightedIndex + 1, matches.length - 1));
      } else if (e.key === 'ArrowUp') {
        if (matches.length === 0) return;
        e.preventDefault();
        setHighlighted(Math.max(highlightedIndex - 1, 0));
      } else if (e.key === 'Enter') {
        if (matches.length === 0) return;
        e.preventDefault();
        commitAdd(matches[highlightedIndex >= 0 ? highlightedIndex : 0].typeId);
      } else if (e.key === 'Escape') {
        closeResults();
      }
    });

    return wrap;
  }

  // Nested view: Sections -> lines -> (for Composite/Alias lines) their
  // components. Components come straight from the already-loaded catalog
  // cache (state.catalogById), not a separate fetch - equipment-catalog-full
  // already joins COMPOSIT for every item. Every known section renders (even
  // ones with zero lines, e.g. right after creation) so it can be renamed/
  // deleted/populated - sections used to be skipped entirely when empty.
  function renderExistingLinesTree(loadedJob) {
    const sections = loadedJob.existingSections;
    const lines = loadedJob.existingLines;
    existingLinesTreeEl.innerHTML = '';

    const linesBySection = new Map();
    for (const line of lines) {
      const key = line.sectionId ?? 'none';
      const list = linesBySection.get(key) || [];
      list.push(line);
      linesBySection.set(key, list);
    }

    const orderedSections = [...sections].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const knownSectionIds = new Set(orderedSections.map((s) => s.sectionId));

    for (const section of orderedSections) {
      const sectionEl = document.createElement('div');
      sectionEl.className = 'tree-section';
      sectionEl.appendChild(buildSectionHeader(loadedJob, section));
      sectionEl.appendChild(buildSectionAddWidget(loadedJob, section));
      const sectionLines = linesBySection.get(section.sectionId) || [];
      if (sectionLines.length > 0) {
        renderLinesIntoSection(sectionEl, sectionLines, loadedJob);
      } else {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'tree-section-empty';
        emptyEl.textContent = 'В этой секции пока нет оборудования.';
        sectionEl.appendChild(emptyEl);
      }
      existingLinesTreeEl.appendChild(sectionEl);
    }

    // Lines with no sectionId, or one that doesn't match any known section
    // (e.g. a section deleted from outside this app) - not a real
    // EqSections row, so no rename/delete controls, just a plain header.
    const unsectionedLines = lines.filter((l) => l.sectionId == null || !knownSectionIds.has(l.sectionId));
    if (unsectionedLines.length > 0) {
      const sectionEl = document.createElement('div');
      sectionEl.className = 'tree-section';
      const header = document.createElement('div');
      header.className = 'tree-section-header';
      header.innerHTML = '<span class="tree-section-title">Без секции</span>';
      sectionEl.appendChild(header);
      renderLinesIntoSection(sectionEl, unsectionedLines, loadedJob);
      existingLinesTreeEl.appendChild(sectionEl);
    }

    if (orderedSections.length === 0 && unsectionedLines.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'tree-empty';
      emptyEl.textContent = 'На этой работе пока нет оборудования.';
      existingLinesTreeEl.appendChild(emptyEl);
    }

    existingLinesTreeEl.appendChild(buildAddSectionControl(loadedJob));
  }

  // Edit/remove target an already-persisted Sort row (Lineref) - different
  // from the "lines being added" staging list above, which only has local,
  // unsaved state until submit.
  //
  // Deliberately does NOT reopen/rebuild the whole tree on success (unlike
  // removeExistingLine) - the qty input's stepper arrows each fire their own
  // 'change' event, and a full rebuild per click caused visible flicker and
  // lost focus. Instead: mutate the line's qty in place and refresh just
  // this line's own availability badge, so edits feel seamless.
  async function changeExistingLineQuantity(loadedJob, line, newQty) {
    const previousQty = line.qty;
    jobRefStatusEl.textContent = 'Сохраняем количество…';
    try {
      const res = await fetch(`/api/create-job/jobs/${encodeURIComponent(loadedJob.jobRef)}/lines/${line.lineRefId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: newQty, clientId: loadedJob.clientId }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Не удалось изменить количество');
      line.qty = newQty;
      jobRefStatusEl.textContent = '';
      refreshExistingLineAvailability(loadedJob, line);
    } catch (err) {
      jobRefStatusEl.textContent = `Ошибка изменения количества: ${err.message}`;
      const inputEl = existingLinesTreeEl.querySelector(`.tree-line[data-line-ref-id="${line.lineRefId}"] .tree-line-qty-input`);
      if (inputEl) inputEl.value = String(previousQty);
    }
  }

  async function removeExistingLine(loadedJob, line) {
    if (!confirm(`Убрать «${line.name || ''}» из работы?`)) return;
    jobRefStatusEl.textContent = 'Удаляем позицию…';
    try {
      const params = new URLSearchParams({ jobId: String(loadedJob.jobNo), clientId: String(loadedJob.clientId) });
      const res = await fetch(`/api/create-job/jobs/${encodeURIComponent(loadedJob.jobRef)}/lines/${line.lineRefId}?${params.toString()}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Не удалось удалить позицию');
      jobRefStatusEl.textContent = '';
      await openExistingJob(loadedJob.jobRef);
    } catch (err) {
      jobRefStatusEl.textContent = `Ошибка удаления: ${err.message}`;
    }
  }

  // Per-line availability for the existing-job tree: a single remainder
  // number, active stock in the warehouse minus what this job itself has
  // booked for this line's date range. Deliberately simple - not the
  // cross-job "everyone else's overlapping bookings" figure check_availability
  // itself computes, just this line's own balance against total stock.
  // Positive = green, exactly zero = yellow, negative = red with its sign
  // (e.g. "-2") so overbooking a line is visible, not hidden or blocked.
  // Updates the line's own DOM node directly by lineRefId instead of
  // re-rendering the whole tree.
  async function refreshExistingLineAvailability(loadedJob, line) {
    const badgeEl = () => existingLinesTreeEl.querySelector(`.tree-line[data-line-ref-id="${line.lineRefId}"] .tree-line-availability`);
    try {
      const params = new URLSearchParams({
        typeId: String(line.typeId),
        quantity: String(line.qty),
        dateFrom: loadedJob.dateFrom,
        dateTo: loadedJob.dateTo,
      });
      const res = await fetch(`/api/create-job/availability?${params.toString()}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Ошибка проверки доступности');
      const stocklevelForWarehouse = data.stocklevelForWarehouse ?? 0;
      const remainder = stocklevelForWarehouse - line.qty;
      const el = badgeEl();
      if (!el) return;
      el.textContent = String(remainder);
      el.className = 'tree-line-availability ' + (remainder > 0 ? 'ok' : remainder === 0 ? 'zero' : 'none');
    } catch (err) {
      const el = badgeEl();
      if (!el) return;
      el.textContent = '?';
      el.className = 'tree-line-availability none';
    }
  }

  // focusSectionId: after rebuilding the tree, refocus that section's own
  // "add equipment" search box - lets addEquipmentToSection reload+refocus
  // in one call, so entering several items into the same section stays a
  // tight type -> Enter -> type -> Enter loop instead of losing focus.
  async function openExistingJob(jobRef, focusSectionId) {
    if (!jobRef) {
      jobRefStatusEl.textContent = 'Введите номер работы или выберите из списка.';
      return;
    }
    state.loadedJob = null;
    jobLoadedInfoEl.classList.add('hidden');
    jobRefStatusEl.textContent = 'Загрузка…';
    try {
      const res = await fetch(`/api/create-job/jobs/${encodeURIComponent(jobRef)}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Работа не найдена');
      const job = data.job;
      const eqlist = job.eqlists && job.eqlists[0];
      if (!eqlist) throw new Error('У этой работы нет Eqlist — добавление позиций невозможно.');

      state.loadedJob = {
        jobRef: job.jobRef,
        jobNo: job.jobNo,
        eqlistId: eqlist.eqlistId,
        clientId: eqlist.clientId,
        clientName: eqlist.clientName,
        dateFrom: eqlist.dateOut,
        dateTo: eqlist.dateBack,
        existingSections: eqlist.sections || [],
        existingLines: eqlist.lines || [],
      };

      jobRefStatusEl.textContent = '';
      jobLoadedRefEl.textContent = job.jobRef;
      jobLoadedClientEl.textContent = eqlist.clientName || `#${eqlist.clientId}`;
      jobLoadedDatesEl.textContent = `${READBACK_FORMATTER.format(new Date(eqlist.dateOut.replace(' ', 'T')))} — ${READBACK_FORMATTER.format(new Date(eqlist.dateBack.replace(' ', 'T')))}`;
      renderExistingLinesTree(state.loadedJob);
      jobLoadedInfoEl.classList.remove('hidden');
      updateSubmitState();
      if (focusSectionId != null) {
        const input = existingLinesTreeEl.querySelector(`.section-add[data-section-id="${focusSectionId}"] .section-add-search`);
        if (input) input.focus();
      }
    } catch (err) {
      jobRefStatusEl.textContent = `Ошибка: ${err.message}`;
    }
  }

  // --- Catalog load (once) ---
  async function loadCatalog() {
    loadStatusEl.textContent = 'Загрузка каталога оборудования…';
    try {
      const res = await fetch('/api/create-job/catalog');
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Не удалось загрузить каталог');
      state.catalog = data.items || [];
      state.catalogById = new Map(state.catalog.map((item) => [item.typeId, item]));
      state.catalogLoaded = true;
      loadStatusEl.textContent = `Каталог загружен: ${state.catalog.length} позиций.`;
      // Existing-job lines may have rendered before the catalog finished
      // loading (type badges/component nesting need it) - re-render now.
      if (state.loadedJob) {
        renderExistingLinesTree(state.loadedJob);
      }
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

  // Registered once (not per-widget-instance, since the tree - and every
  // section-add widget in it - gets rebuilt on every reload) - closes
  // whichever per-section dropdown is open when clicking outside it.
  document.addEventListener('click', (e) => {
    if (e.target.closest('.section-add')) return;
    document.querySelectorAll('.section-add-results').forEach((el) => el.classList.add('hidden'));
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

  // --- Submit (new-job creation only - existing-job mode adds equipment
  // directly per-section, see buildSectionAddWidget/addEquipmentToSection,
  // and never shows this card at all) ---
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
    const payload = {
      jobName: jobNameInput.value.trim(),
      clientId: state.selectedClient.companyId,
      dateFrom: getDateRange().dateFrom,
      dateTo: getDateRange().dateTo,
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
      if (!data.ok) throw new Error(data.error || 'Не удалось выполнить запрос');

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
