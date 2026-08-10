(() => {
  const state = {
    mode: 'new', // 'new' | 'existing'
    catalog: [],
    catalogById: new Map(),
    catalogLoaded: false,
    selectedClient: null,
    loadedJob: null, // { jobRef, eqlistId, clientId, clientName, dateFrom, dateTo, existingSections, existingLines }
    // typeId -> { availableQty, stocklevelForWarehouse }. Scoped to the
    // currently loaded job's fixed date range - fetched at most once per
    // typeId per job (reused across every search result, tree line, and
    // newly-inserted line that needs it), reset whenever a different job is
    // opened. Avoids re-fetching the same item's availability over and over
    // as search queries get refined/re-typed.
    availabilityCache: new Map(),
  };

  const modeNewBtn = document.getElementById('mode-new');
  const modeExistingBtn = document.getElementById('mode-existing');
  const newJobCard = document.getElementById('new-job-card');
  const newJobClientCard = document.getElementById('new-job-client-card');
  const newJobSubmitCard = document.getElementById('new-job-submit-card');
  const existingJobCard = document.getElementById('existing-job-card');

  const jobRefSearchInput = document.getElementById('job-ref-search');
  const jobRefResultsEl = document.getElementById('job-ref-results');
  const jobRefStatusEl = document.getElementById('job-ref-status');
  const recentJobsEl = document.getElementById('recent-jobs');
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

  const loadStatusEl = document.getElementById('load-status');

  const submitBtn = document.getElementById('submit-btn');
  const resultEl = document.getElementById('result');

  function debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function toHiretrackDateTime(localValue) {
    if (!localValue) return null;
    // "YYYY-MM-DDTHH:MM" -> "YYYY-MM-DD HH:MM:SS"
    return localValue.replace('T', ' ') + ':00';
  }

  // Only relevant to new-job mode - existing-job mode's dates always come
  // from the loaded job itself (fixed, see EQUIPMENT_CATALOG_MATCH_BLUEPRINT.md).
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

  // ============================================================
  // Generic type-ahead dropdown, shared by every "search and pick
  // one" UI in this app (job search, client search, per-section
  // equipment search) - one engine, one keyboard/behavior contract,
  // instead of a subtly different implementation per widget.
  //
  // Behavior: debounced search-as-you-type, ArrowUp/ArrowDown moves a
  // highlighted result (optionally notifying onHighlightChange, e.g. to
  // shift focus into a companion field), Enter picks the highlighted-or-top
  // result, Escape closes, clicking outside closes, and a row is selected
  // on mousedown (not click) so it fires before the input's blur would
  // otherwise close the dropdown first.
  // ============================================================
  function createSearchDropdown({
    inputEl,
    resultsEl,
    companionEl,
    minChars = 2,
    debounceMs = 250,
    getMatches,
    renderRow,
    onSelect,
    onHighlightChange,
    emptyText = 'Ничего не найдено',
  }) {
    let matches = [];
    let highlightedIndex = -1;

    function close() {
      resultsEl.classList.add('hidden');
      resultsEl.innerHTML = '';
      matches = [];
      highlightedIndex = -1;
    }

    function setHighlighted(index) {
      const rows = [...resultsEl.querySelectorAll('.result-row')];
      rows.forEach((row, i) => row.classList.toggle('highlighted', i === index));
      if (index >= 0 && rows[index]) rows[index].scrollIntoView({ block: 'nearest' });
      highlightedIndex = index;
      if (onHighlightChange) onHighlightChange(matches[index], index);
    }

    function select(item) {
      close();
      onSelect(item);
    }

    async function runSearch(query) {
      const q = query.trim();
      if (q.length < minChars) {
        close();
        return;
      }
      let results;
      try {
        results = (await getMatches(q)) || [];
      } catch (err) {
        resultsEl.innerHTML = `<div class="result-row">Ошибка: ${escapeHtml(err.message)}</div>`;
        resultsEl.classList.remove('hidden');
        matches = [];
        highlightedIndex = -1;
        return;
      }
      matches = results;
      if (matches.length === 0) {
        resultsEl.innerHTML = `<div class="result-row">${escapeHtml(emptyText)}</div>`;
        resultsEl.classList.remove('hidden');
        highlightedIndex = -1;
        return;
      }
      resultsEl.innerHTML = '';
      matches.forEach((item) => {
        const row = document.createElement('div');
        row.className = 'result-row';
        renderRow(item, row);
        row.addEventListener('mousedown', (e) => {
          e.preventDefault();
          select(item);
        });
        resultsEl.appendChild(row);
      });
      resultsEl.classList.remove('hidden');
      highlightedIndex = -1;
    }

    function handleKeydown(e) {
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
        select(matches[highlightedIndex >= 0 ? highlightedIndex : 0]);
      } else if (e.key === 'Escape') {
        close();
      }
    }

    const debouncedSearch = debounce(() => runSearch(inputEl.value), debounceMs);
    inputEl.addEventListener('input', debouncedSearch);
    inputEl.addEventListener('keydown', handleKeydown);
    if (companionEl) companionEl.addEventListener('keydown', handleKeydown);

    document.addEventListener('click', (e) => {
      if (e.target === inputEl || (companionEl && e.target === companionEl) || resultsEl.contains(e.target)) return;
      close();
    });

    return { close };
  }

  // --- Mode toggle (new job vs open an existing one) ---
  function setMode(mode) {
    state.mode = mode;
    modeNewBtn.classList.toggle('active', mode === 'new');
    modeExistingBtn.classList.toggle('active', mode === 'existing');
    newJobCard.classList.toggle('hidden', mode !== 'new');
    newJobClientCard.classList.toggle('hidden', mode !== 'new');
    newJobSubmitCard.classList.toggle('hidden', mode !== 'new');
    existingJobCard.classList.toggle('hidden', mode !== 'existing');
    resultEl.classList.add('hidden');
    if (mode === 'existing' && !state.loadedJob) {
      loadRecentJobs();
    }
    updateSubmitState();
  }

  modeNewBtn.addEventListener('click', () => setMode('new'));
  modeExistingBtn.addEventListener('click', () => setMode('existing'));

  function resetNewJobForm() {
    jobNameInput.value = '';
    dateFromInput.value = '';
    dateToInput.value = '';
    updateDateReadbacks();
    state.selectedClient = null;
    clientSelectedEl.classList.add('hidden');
    clientSearchInput.value = '';
    clientSearchInput.classList.remove('hidden');
  }

  // --- Job search + recent jobs (existing-job mode) ---
  createSearchDropdown({
    inputEl: jobRefSearchInput,
    resultsEl: jobRefResultsEl,
    getMatches: async (query) => {
      const res = await fetch(`/api/create-job/jobs?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Ошибка поиска работы');
      return data.jobs || [];
    },
    renderRow: (job, row) => {
      const title = job.jobTitle || job.clientName || '';
      row.innerHTML = `<div class="name">${escapeHtml(job.jobRef)} ${title ? '· ' + escapeHtml(title) : ''}</div><div class="meta">${escapeHtml(job.clientName || '')}</div>`;
    },
    onSelect: (job) => {
      jobRefSearchInput.value = job.jobRef;
      openExistingJob(job.jobRef);
    },
  });

  // Recently-created jobs (Jobs.CreatedDate, -7 days for now) shown as
  // cards below the search box before a job is loaded, so a job someone
  // just created doesn't need to be re-typed to find.
  async function loadRecentJobs() {
    try {
      const res = await fetch('/api/create-job/jobs/recent');
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Ошибка загрузки последних работ');
      renderRecentJobs(data.jobs || []);
    } catch (err) {
      recentJobsEl.innerHTML = '';
    }
  }

  function renderRecentJobs(jobs) {
    recentJobsEl.innerHTML = '';
    if (state.loadedJob || jobs.length === 0) return;
    const label = document.createElement('div');
    label.className = 'recent-jobs-label';
    label.textContent = 'Недавно созданные (7 дней)';
    const grid = document.createElement('div');
    grid.className = 'recent-jobs-grid';
    for (const job of jobs) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'job-card';
      const created = new Date((job.createdDate || '').replace(' ', 'T'));
      const createdText = Number.isNaN(created.getTime()) ? '' : READBACK_FORMATTER.format(created);
      const metaParts = [job.clientName, createdText].filter(Boolean);
      card.innerHTML = `
        <span class="job-card-ref">${escapeHtml(job.jobRef)}</span>
        ${job.jobTitle ? `<span class="job-card-title">${escapeHtml(job.jobTitle)}</span>` : ''}
        <span class="job-card-meta">${escapeHtml(metaParts.join(' · '))}</span>
      `;
      card.addEventListener('click', () => {
        jobRefSearchInput.value = job.jobRef;
        openExistingJob(job.jobRef);
      });
      grid.appendChild(card);
    }
    recentJobsEl.append(label, grid);
  }

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

  // NewSales (2) and ExRentalSales (3) are stock the business sells rather
  // than rents out - excluded from equipment search so it can't be booked
  // onto a job (see buildSectionAddWidget's getMatches).
  const SALES_CLASSES = new Set([2, 3]);

  function typeBadgeHtml(equipmentType, equipmentClass) {
    if ((equipmentType ?? 0) === 0 && equipmentClass === CONSUMABLE_CLASS) {
      return '<span class="type-badge consumable">C</span>';
    }
    const info = EQUIPMENT_TYPE_BADGES[equipmentType] || EQUIPMENT_TYPE_BADGES[0];
    return `<span class="type-badge ${info.cls}">${info.letter}</span>`;
  }

  // For each Composite/Alias line in `sectionLines`, tries to identify which
  // (if any) sibling line in the same section is confidently ITS OWN real
  // component row - HireTrack has no DB-level link between a Composite's own
  // Sort row and its component rows (confirmed against db.sql's Sort schema),
  // so the only usable signal is an exact quantity match: recipe quantity ×
  // this composite's own booked qty. Live-checked against 183 real type-623
  // bookings on production - 175 have exactly one such match per component
  // type (2026-08-11).
  //
  // A section can genuinely contain more than one real Sort row of the same
  // equipment type - e.g. one that's this composite's true component plus an
  // unrelated standalone booking of the same type. The previous version kept
  // a single Map<typeId, line> (last-write-wins) and hid EVERY line of an
  // absorbed type, so with two same-type lines present it would show an
  // arbitrary (often wrong) quantity and silently drop the other line from
  // the tree entirely - reported as both "composite shows the wrong
  // quantity" and "deleting one of two identical lines removes both" (same
  // root cause). Ambiguous cases (no exact match) now deliberately fall back
  // to the catalog recipe's own numbers and leave every real line of that
  // type visible as its own row, rather than guessing wrong and hiding data.
  function computeComponentMatches(sectionLines) {
    const linesByType = new Map();
    for (const line of sectionLines) {
      const list = linesByType.get(line.typeId) || [];
      list.push(line);
      linesByType.set(line.typeId, list);
    }

    const claimedLines = new Set();
    const matchesByLineRefId = new Map();
    for (const line of sectionLines) {
      const catalogItem = state.catalogById.get(line.typeId);
      const equipmentType = line.equipmentType ?? catalogItem?.equipmentType ?? 0;
      if (equipmentType === 0) continue;
      const matches = new Map();
      for (const component of catalogItem?.components || []) {
        const expectedQty = component.quantity * (line.qty || 1);
        const candidates = linesByType.get(component.componentTypeId) || [];
        const exact = candidates.find((c) => !claimedLines.has(c) && c.qty === expectedQty);
        if (exact) claimedLines.add(exact);
        matches.set(component.componentTypeId, exact || null);
      }
      matchesByLineRefId.set(line.lineRefId, matches);
    }

    return { matchesByLineRefId, claimedLines };
  }

  // Builds one line's DOM (its .tree-line, plus a sibling .tree-components
  // if it's a Composite/Alias with catalog-known components) but does not
  // attach it anywhere - callers append it wherever it belongs. Shared by
  // the full-section render, the single-line seamless insert, and the
  // single-section seamless re-render used after removing a line.
  // `componentMatches` is this line's own entry from computeComponentMatches
  // (Map<componentTypeId, matchedLine|null>), or null/undefined if unknown.
  function buildTreeLineNode(loadedJob, line, componentMatches) {
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
    // Debounced so clicking the native number-input stepper arrows (each
    // click commits its own 'change' event immediately) coalesces into one
    // save instead of firing a request - and a full tree rebuild - per click.
    const commitQtyChange = debounce(() => {
      const newQty = Math.max(1, Math.round(Number(qtyInput.value) || 1));
      qtyInput.value = String(newQty);
      if (newQty !== line.qty) changeExistingLineQuantity(loadedJob, line, newQty);
    }, 450);
    qtyInput.addEventListener('change', commitQtyChange);
    lineEl.querySelector('.tree-line-remove').addEventListener('click', () => removeExistingLine(loadedJob, line));
    refreshExistingLineAvailability(loadedJob, line);

    let componentsEl = null;
    if (hasComponents) {
      componentsEl = document.createElement('div');
      componentsEl.className = 'tree-components collapsed';
      for (const component of components) {
        const matchedLine = componentMatches ? componentMatches.get(component.componentTypeId) : null;
        // Fallback multiplies by this line's own qty too - the recipe's
        // quantity is per one unit of the composite, so a composite booked
        // qty>1 needs that scaled up even when no confident real-line match
        // exists (previously this always showed the bare per-unit number).
        const qty = matchedLine ? matchedLine.qty : component.quantity * (line.qty || 1);
        const compLineEl = document.createElement('div');
        compLineEl.className = 'tree-component-line';
        compLineEl.innerHTML = `<span class="tree-component-qty">${qty} ×</span><span>${escapeHtml(component.componentName || '')}</span>`;
        componentsEl.appendChild(compLineEl);
      }

      // Composite/Alias contents are collapsed by default (spoiler) -
      // toggle button lives on the parent line, componentsEl is its own
      // sibling node right after it in the DOM.
      const toggleBtn = lineEl.querySelector('.tree-line-toggle');
      const componentsElRef = componentsEl;
      toggleBtn.addEventListener('click', () => {
        const isCollapsed = componentsElRef.classList.toggle('collapsed');
        toggleBtn.textContent = isCollapsed ? '▸' : '▾';
        toggleBtn.setAttribute('aria-expanded', String(!isCollapsed));
      });
    }

    return { lineEl, componentsEl };
  }

  // Renders one section's lines (Composite/Alias nested under their own
  // line) into sectionEl. Shared by every section, including the
  // "Без секции" bucket and empty newly-created sections.
  function renderLinesIntoSection(sectionEl, sectionLines, loadedJob) {
    // A Composite/Alias line's declared components (from the catalog's
    // COMPOSIT data) often ALSO exist as their own separate Sort rows in
    // the same section, for stock tracking - without this, they'd render
    // twice: once as a standalone line, once nested under the Composite.
    // computeComponentMatches claims at most one real line per component
    // (by exact quantity match) instead of every line of that type, so an
    // unrelated same-type line stays visible on its own - see its comment.
    const { matchesByLineRefId, claimedLines } = computeComponentMatches(sectionLines);

    for (const line of sectionLines) {
      if (claimedLines.has(line)) continue;
      const { lineEl, componentsEl } = buildTreeLineNode(loadedJob, line, matchesByLineRefId.get(line.lineRefId));
      sectionEl.appendChild(lineEl);
      if (componentsEl) sectionEl.appendChild(componentsEl);
    }
  }

  // Rebuilds just one section's line listing (everything after its header
  // and, for real sections, its add-widget) from loadedJob.existingLines -
  // used after removing a line, so a Composite whose absorbed component was
  // just removed re-evaluates correctly, without refetching the job or
  // touching any other section. Real sections carry data-sectionId; the
  // "Без секции" bucket doesn't, and removes itself entirely when empty.
  function rerenderSectionLines(loadedJob, sectionEl) {
    const sectionIdAttr = sectionEl.dataset.sectionId;
    const isRealSection = sectionIdAttr != null;
    const keepCount = isRealSection ? 2 : 1;
    while (sectionEl.children.length > keepCount) sectionEl.lastElementChild.remove();

    const sectionLines = isRealSection
      ? loadedJob.existingLines.filter((l) => String(l.sectionId) === sectionIdAttr)
      : loadedJob.existingLines.filter((l) => l.sectionId == null);

    if (sectionLines.length > 0) {
      renderLinesIntoSection(sectionEl, sectionLines, loadedJob);
    } else if (isRealSection) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'tree-section-empty';
      emptyEl.textContent = 'В этой секции пока нет оборудования.';
      sectionEl.appendChild(emptyEl);
    } else {
      sectionEl.remove();
    }
  }

  // Section header with inline rename (pencil -> text input, commits on
  // blur/Enter, Escape cancels) and delete (confirm() before calling the
  // API - a real EqSections row, not just a UI grouping). Both mutate
  // loadedJob/the DOM directly instead of a full reload - rename edits
  // section.sectionText in place, delete removes just this section's node
  // and refreshes the "Без секции" bucket with its reassigned lines.
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
      const linesToRemove = loadedJob.existingLines.filter((l) => l.sectionId === section.sectionId);
      const confirmMsg = linesToRemove.length
        ? `Удалить секцию «${title}» вместе с оборудованием в ней (${linesToRemove.length} поз.)? Это действие нельзя отменить.`
        : `Удалить секцию «${title}»?`;
      if (!confirm(confirmMsg)) return;
      jobRefStatusEl.textContent = 'Удаляем секцию…';
      const sectionEl = existingLinesTreeEl.querySelector(`.tree-section[data-section-id="${section.sectionId}"]`);
      try {
        // Remove each real line through the same api_v2 remove_from_booking
        // path as the per-line "×" button, not just a raw Sort delete - this
        // also covers a Composite's absorbed component lines, since those
        // are still their own Sort rows in this section (see the earlier
        // "Composite double-displayed" fix). Only after every line is gone
        // do we delete the EqSections row itself.
        for (const line of linesToRemove) {
          const lineParams = new URLSearchParams({ jobId: String(loadedJob.jobNo), clientId: String(loadedJob.clientId) });
          const lineRes = await fetch(`/api/create-job/jobs/${encodeURIComponent(loadedJob.jobRef)}/lines/${line.lineRefId}?${lineParams.toString()}`, {
            method: 'DELETE',
          });
          const lineData = await lineRes.json();
          if (!lineData.ok) throw new Error(lineData.error || `Не удалось удалить «${line.name || ''}»`);
          loadedJob.existingLines = loadedJob.existingLines.filter((l) => l !== line);
        }

        const sectionParams = new URLSearchParams({ eqlistId: String(loadedJob.eqlistId) });
        const res = await fetch(`/api/create-job/jobs/${encodeURIComponent(loadedJob.jobRef)}/sections/${section.sectionId}?${sectionParams.toString()}`, {
          method: 'DELETE',
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || 'Не удалось удалить секцию');
        jobRefStatusEl.textContent = '';

        loadedJob.existingSections = loadedJob.existingSections.filter((s) => s.sectionId !== section.sectionId);
        if (sectionEl) sectionEl.remove();
      } catch (err) {
        jobRefStatusEl.textContent = `Ошибка удаления секции: ${err.message}`;
        // Reflect whatever lines were successfully removed before the
        // failure instead of leaving the DOM out of sync with loadedJob.
        if (sectionEl) rerenderSectionLines(loadedJob, sectionEl);
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
        // Adding/renumbering sections is rare and touches sortOrder for the
        // whole tree - a full reload here is fine (unlike line add/remove).
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

  // Inserts a just-written line directly into the DOM at the end of its
  // section - no refetch/full tree rebuild. catalogById already has this
  // line's name/type (it was just shown as a search result), and its
  // availability is already cached from that same search (see
  // getAvailability), so nothing here needs a network round-trip.
  function insertNewLine(loadedJob, section, written) {
    const catalogItem = state.catalogById.get(written.typeId);
    const line = {
      typeId: written.typeId,
      name: catalogItem ? catalogItem.name : `#${written.typeId}`,
      qty: written.quantity,
      sectionId: section.sectionId,
      equipmentType: catalogItem ? catalogItem.equipmentType : 0,
      equipmentClass: catalogItem ? catalogItem.class : null,
      lineRefId: written.lineRefId,
    };
    loadedJob.existingLines.push(line);

    const sectionEl = existingLinesTreeEl.querySelector(`.tree-section[data-section-id="${section.sectionId}"]`);
    if (sectionEl) {
      const emptyEl = sectionEl.querySelector('.tree-section-empty');
      if (emptyEl) emptyEl.remove();
      const sectionLines = loadedJob.existingLines.filter((l) => l.sectionId === section.sectionId);
      const { matchesByLineRefId } = computeComponentMatches(sectionLines);
      const { lineEl, componentsEl } = buildTreeLineNode(loadedJob, line, matchesByLineRefId.get(line.lineRefId));
      // appendChild always lands at the end of sectionEl's current children
      // (header, add-widget, every prior line) - "after all already-added
      // lines" falls out naturally from DOM append order.
      sectionEl.appendChild(lineEl);
      if (componentsEl) sectionEl.appendChild(componentsEl);
    }

    const searchInput = existingLinesTreeEl.querySelector(`.section-add[data-section-id="${section.sectionId}"] .section-add-search`);
    if (searchInput) searchInput.focus();
  }

  // Appends one line directly to loadedJob's Eqlist, tagged with this
  // section (api_v2's append_to_booking has no section param of its own -
  // the backend moves the new line into place afterward, see
  // setHiretrackLineSection, which also pushes its SortOrder past whatever
  // else is already in the section so it lands last there too on a future
  // reload). Inserts the new line directly (see insertNewLine) instead of
  // reloading/rebuilding the whole tree.
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
      const written = data.writtenLines && data.writtenLines[0];
      if (!written) {
        const failure = data.failedLines && data.failedLines[0];
        throw new Error((failure && failure.error) || 'HireTrack отклонил позицию');
      }
      // written.quantity is the REAL persisted amount (bookingQty), which
      // can be silently lower than requested when stock is insufficient -
      // HireTrack still reports success in that case, so this is the only
      // place the shortfall shows up.
      jobRefStatusEl.textContent =
        written.quantity !== written.requestedQuantity
          ? `HireTrack добавил только ${written.quantity} из ${written.requestedQuantity} — недостаточно оборудования на складе на эти даты.`
          : '';
      insertNewLine(loadedJob, section, written);
    } catch (err) {
      jobRefStatusEl.textContent = `Ошибка добавления: ${err.message}`;
    }
  }

  // Per-section "add equipment" widget, rendered at the top of every real
  // section - search with an inline qty field nested right inside the same
  // box, arrow-key/Enter selection (via createSearchDropdown), and
  // availability shown directly on each result row ("10/10"), all aimed at
  // fast consecutive entry without a separate staging table.
  //
  // Keyboard flow: type to filter -> ArrowUp/ArrowDown highlights a result
  // AND moves focus into the qty field (so the very next keystrokes are the
  // quantity, no extra Tab/click) -> Enter (from either field) adds the
  // highlighted result with whatever qty is currently typed.
  function buildSectionAddWidget(loadedJob, section) {
    const wrap = document.createElement('div');
    wrap.className = 'section-add';
    wrap.dataset.sectionId = String(section.sectionId);
    wrap.innerHTML = `
      <div class="section-add-box">
        <input type="text" class="section-add-search" placeholder="Добавить оборудование в эту секцию…" autocomplete="off">
        <input type="number" class="section-add-qty" min="1" step="1" value="1">
      </div>
      <div class="section-add-results hidden"></div>
    `;
    const searchInput = wrap.querySelector('.section-add-search');
    const qtyInput = wrap.querySelector('.section-add-qty');
    const resultsEl = wrap.querySelector('.section-add-results');

    const commitAdd = (item) => {
      const qty = Math.max(1, Math.round(Number(qtyInput.value) || 1));
      searchInput.value = '';
      qtyInput.value = '1';
      addEquipmentToSection(loadedJob, section, item.typeId, qty);
    };

    createSearchDropdown({
      inputEl: searchInput,
      resultsEl,
      companionEl: qtyInput,
      minChars: 2,
      debounceMs: 200,
      getMatches: (query) => {
        if (!state.catalogLoaded) return [];
        const q = query.toLowerCase();
        return state.catalog
          // Sales stock (Class 2=ecNewSales, 3=ecExRentalSales) isn't rental
          // inventory - exclude it from search so it can never be booked
          // onto a job from here, even though it stays in state.catalogById
          // for badge/component lookups on lines already on the job.
          .filter((item) => !SALES_CLASSES.has(item.class))
          .filter((item) => `${item.name || ''} ${item.categoryName || ''} ${item.shortcode || ''} ${item.similarGroupName || ''}`.toLowerCase().includes(q))
          .slice(0, 8);
      },
      renderRow: (item, row) => {
        row.innerHTML = `
          ${typeBadgeHtml(item.equipmentType, item.class)}
          <span class="section-add-result-name">${escapeHtml(item.name || '')}</span>
          <span class="section-add-result-avail pending">…</span>
        `;
        const availEl = row.querySelector('.section-add-result-avail');
        getAvailability(item.typeId, loadedJob)
          .then(({ availableQty, stocklevelForWarehouse }) => {
            const desiredQty = Math.max(1, Math.round(Number(qtyInput.value) || 1));
            availEl.textContent = `${availableQty}/${stocklevelForWarehouse}`;
            availEl.className = 'section-add-result-avail ' + (availableQty <= 0 ? 'none' : availableQty < desiredQty ? 'low' : 'ok');
          })
          .catch(() => {
            availEl.textContent = '?';
            availEl.className = 'section-add-result-avail none';
          });
      },
      onSelect: commitAdd,
      onHighlightChange: () => {
        qtyInput.focus();
        qtyInput.select();
      },
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
      sectionEl.dataset.sectionId = String(section.sectionId);
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

  // Edit/remove target an already-persisted Sort row (Lineref).
  //
  // Deliberately does NOT reopen/rebuild the whole tree on success - the
  // qty input's stepper arrows each fire their own 'change' event, and a
  // full rebuild per click caused visible flicker and lost focus. Instead:
  // mutate the line's qty in place and refresh just this line's own
  // availability badge, so edits feel seamless.
  async function changeExistingLineQuantity(loadedJob, line, newQty) {
    const previousQty = line.qty;
    jobRefStatusEl.textContent = 'Сохраняем количество…';
    try {
      const res = await fetch(`/api/create-job/jobs/${encodeURIComponent(loadedJob.jobRef)}/lines/${line.lineRefId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: newQty, clientId: loadedJob.clientId, eqlistId: loadedJob.eqlistId }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Не удалось изменить количество');
      // HireTrack can report success (ValidationResult 0) while silently
      // capping the actual quantity below what was requested when stock is
      // insufficient - bookingQty is the only field that reveals this, so
      // it - not newQty - is what actually got persisted. Trusting newQty
      // here was the exact bug: the input looked right until the next
      // reload, when the real (lower) value came back from the server.
      const actualQty = data.bookingQty ?? newQty;
      line.qty = actualQty;
      const inputEl = existingLinesTreeEl.querySelector(`.tree-line[data-line-ref-id="${line.lineRefId}"] .tree-line-qty-input`);
      if (inputEl) inputEl.value = String(actualQty);
      jobRefStatusEl.textContent =
        actualQty !== newQty
          ? `HireTrack применил только ${actualQty} из ${newQty} — недостаточно оборудования на складе на эти даты.`
          : '';
      refreshExistingLineAvailability(loadedJob, line);
    } catch (err) {
      jobRefStatusEl.textContent = `Ошибка изменения количества: ${err.message}`;
      const inputEl = existingLinesTreeEl.querySelector(`.tree-line[data-line-ref-id="${line.lineRefId}"] .tree-line-qty-input`);
      if (inputEl) inputEl.value = String(previousQty);
    }
  }

  // Removes just this line from the DOM/state on success - no full tree
  // reload (which used to also wipe and re-fetch the whole availability
  // cache for every other line on the job, for no reason). Re-renders only
  // the affected section's own line listing (see rerenderSectionLines), so
  // a Composite that was absorbing this line as one of its components (or
  // vice versa) re-evaluates correctly.
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

      loadedJob.existingLines = loadedJob.existingLines.filter((l) => l !== line);
      const lineEl = existingLinesTreeEl.querySelector(`.tree-line[data-line-ref-id="${line.lineRefId}"]`);
      const sectionEl = lineEl ? lineEl.closest('.tree-section') : null;
      if (sectionEl) rerenderSectionLines(loadedJob, sectionEl);
    } catch (err) {
      jobRefStatusEl.textContent = `Ошибка удаления: ${err.message}`;
    }
  }

  // Fetches (and caches) a type's availability for the currently loaded
  // job's fixed date range - shared by tree lines, section-add search
  // results, and newly-inserted lines, so the same typeId is never fetched
  // twice in one job session. Caches the in-flight promise too (not just
  // the resolved value), so concurrent callers for the same typeId (e.g.
  // several search rows resolving at once) share one request instead of
  // each firing their own.
  function getAvailability(typeId, loadedJob) {
    if (state.availabilityCache.has(typeId)) {
      return Promise.resolve(state.availabilityCache.get(typeId));
    }
    const params = new URLSearchParams({
      typeId: String(typeId),
      quantity: '1',
      dateFrom: loadedJob.dateFrom,
      dateTo: loadedJob.dateTo,
    });
    const promise = fetch(`/api/create-job/availability?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (!data.ok) throw new Error(data.error || 'Ошибка проверки доступности');
        const result = { availableQty: data.availableQty ?? 0, stocklevelForWarehouse: data.stocklevelForWarehouse ?? 0 };
        state.availabilityCache.set(typeId, result);
        return result;
      })
      .catch((err) => {
        state.availabilityCache.delete(typeId);
        throw err;
      });
    state.availabilityCache.set(typeId, promise);
    return promise;
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
      const { stocklevelForWarehouse } = await getAvailability(line.typeId, loadedJob);
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

  // Pushes a history entry for the loaded job (?job=REF), so the browser's
  // own Back button returns to the job list/search state instead of
  // leaving the page entirely (there was previously no history entry for
  // "job loaded" at all - opening a job never navigated anywhere, so Back
  // fell straight through to whatever page linked into /create-job/, e.g.
  // the portal). Skipped when re-entering a job via popstate itself
  // (pushHistory: false), and when the URL already points at this job (no
  // point creating a redundant entry, e.g. clicking the same search result
  // twice).
  function pushJobHistory(jobRef) {
    const current = new URLSearchParams(window.location.search).get('job');
    if (current === jobRef) return;
    const url = new URL(window.location.href);
    url.searchParams.set('job', jobRef);
    history.pushState({ jobRef }, '', url);
  }

  // Back to the job list/search state - state only, no history.pushState
  // (this runs *in response to* a popstate, or wouldn't be needed at all).
  function closeLoadedJob() {
    state.loadedJob = null;
    jobLoadedInfoEl.classList.add('hidden');
    jobRefStatusEl.textContent = '';
    jobRefSearchInput.value = '';
    loadRecentJobs();
  }

  window.addEventListener('popstate', () => {
    const jobRef = new URLSearchParams(window.location.search).get('job');
    if (jobRef) {
      setMode('existing');
      jobRefSearchInput.value = jobRef;
      openExistingJob(jobRef, { pushHistory: false });
    } else if (state.loadedJob) {
      closeLoadedJob();
    }
  });

  async function openExistingJob(jobRef, { pushHistory = true } = {}) {
    if (!jobRef) {
      jobRefStatusEl.textContent = 'Введите номер работы или выберите из списка.';
      return;
    }
    state.loadedJob = null;
    state.availabilityCache = new Map();
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
      recentJobsEl.innerHTML = '';
      jobLoadedRefEl.textContent = job.jobRef;
      jobLoadedClientEl.textContent = eqlist.clientName || `#${eqlist.clientId}`;
      jobLoadedDatesEl.textContent = `${READBACK_FORMATTER.format(new Date(eqlist.dateOut.replace(' ', 'T')))} — ${READBACK_FORMATTER.format(new Date(eqlist.dateBack.replace(' ', 'T')))}`;
      renderExistingLinesTree(state.loadedJob);
      jobLoadedInfoEl.classList.remove('hidden');
      if (pushHistory) pushJobHistory(job.jobRef);
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
      // The new-job submit button also depends on the catalog being loaded
      // (it needs a placeholder typeId) - re-check in case the user already
      // filled in name/client/dates before this fetch resolved.
      updateSubmitState();
    } catch (err) {
      loadStatusEl.textContent = `Ошибка загрузки каталога: ${err.message}`;
    }
  }

  // --- Client search (new-job mode) ---
  createSearchDropdown({
    inputEl: clientSearchInput,
    resultsEl: clientResultsEl,
    getMatches: async (query) => {
      const res = await fetch(`/api/create-job/companies?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Ошибка поиска клиента');
      return data.companies || [];
    },
    renderRow: (company, row) => {
      row.innerHTML = `<div class="name">${escapeHtml(company.companyName)}</div><div class="meta">#${company.companyId}${company.town ? ' · ' + escapeHtml(company.town) : ''}</div>`;
    },
    onSelect: (company) => selectClient(company),
  });

  function selectClient(company) {
    state.selectedClient = company;
    clientSelectedNameEl.textContent = `${company.companyName} (#${company.companyId})`;
    clientSelectedEl.classList.remove('hidden');
    clientSearchInput.value = '';
    clientSearchInput.classList.add('hidden');
    updateSubmitState();
  }

  clientClearBtn.addEventListener('click', () => {
    state.selectedClient = null;
    clientSelectedEl.classList.add('hidden');
    clientSearchInput.classList.remove('hidden');
    clientSearchInput.focus();
    updateSubmitState();
  });

  // --- Submit: new-job mode only creates the job's header (name/dates/
  // client) - no equipment lines here at all. On success, transitions
  // straight into the same tree-based editor existing jobs use (see
  // openExistingJob), instead of a separate staging-table flow - "two
  // different entities" for the same underlying task was the thing being
  // fixed here.
  function updateSubmitState() {
    if (state.mode !== 'new') return;
    const rangeValid = updateDateReadbacks();
    const { dateFrom, dateTo } = getDateRange();
    const ready =
      jobNameInput.value.trim().length > 0 &&
      state.selectedClient &&
      dateFrom &&
      dateTo &&
      rangeValid &&
      state.catalogLoaded &&
      state.catalog.length > 0;
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
      // initialise_new_booking requires *some* real typeId/quantity even
      // though it's discarded (see createHiretrackJobShell) - any already-
      // loaded catalog item works.
      placeholderTypeId: state.catalog[0].typeId,
    };

    submitBtn.disabled = true;
    submitBtn.textContent = 'Создаём…';
    resultEl.classList.add('hidden');

    try {
      const res = await fetch('/api/create-job/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Не удалось создать работу');
      if (!data.jobRef) throw new Error('HireTrack не вернул номер новой работы.');

      resetNewJobForm();
      setMode('existing');
      jobRefSearchInput.value = data.jobRef;
      await openExistingJob(data.jobRef);
    } catch (err) {
      resultEl.className = 'result error';
      resultEl.textContent = `Ошибка: ${err.message}`;
      resultEl.classList.remove('hidden');
    } finally {
      submitBtn.textContent = 'Создать работу';
      updateSubmitState();
    }
  });

  updateDateReadbacks();
  loadCatalog();

  // Deep link / page refresh while a job was loaded (?job=REF) - open it
  // directly instead of dropping back to the blank new-job form. Doesn't
  // push a history entry since we're already at this URL.
  const initialJobRef = new URLSearchParams(window.location.search).get('job');
  if (initialJobRef) {
    setMode('existing');
    jobRefSearchInput.value = initialJobRef;
    openExistingJob(initialJobRef, { pushHistory: false });
  }
})();
