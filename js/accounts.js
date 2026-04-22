/* ── accounts.js ── Account + Computed management ───────────────
 *
 * Accounts and computed fields are scoped per client.
 * Both appear in the unified Accounts tab, filterable by tab
 * (Investments / 529 Plans) and visibility (Shown / Hidden / All).
 * Row order is user-controlled and drives grid column order.
 *
 * Exposes: initAccounts(), initAccountsView(),
 *          getColumnHeader(field, tab, defaultHeader),
 *          getShownAccountsForTab(tab),
 *          getAccountByField(field, tab),
 *          getOrderedColsForTab(rawCols, tab),
 *          openAccountModal(id), closeAccountModal(), saveAccountModal(),
 *          toggleAccountHidden(id), reorderItem(id, type, direction)
 * ─────────────────────────────────────────────────────────────── */

let _accounts   = [];      // filtered to active client
let _acctTabFilter  = 'investments'; // 'investments' | '529'
let _acctVisFilter  = 'shown';       // 'shown' | 'hidden' | 'all'

let _dragSrcId  = null;
let _dragOverId = null;

function _prepopKey(clientId) { return `dw-accts-prepop-${clientId}`; }

// ─────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────

async function initAccounts() {
  const clientId = typeof getActiveClientId === 'function' ? getActiveClientId() : '';

  // Clean up legacy global (no clientId) accounts from before per-client scoping
  const all    = await getAccounts();
  const legacy = all.filter(a => !a.clientId);
  for (const a of legacy) await deleteAccount(a.id);
  localStorage.removeItem('dw-accounts-prepopulated');

  const fresh  = legacy.length ? await getAccounts() : all;
  _accounts    = fresh.filter(a => a.clientId === clientId);

  if (clientId && !localStorage.getItem(_prepopKey(clientId))) {
    await _prepopulateAccounts(clientId);
    const all2 = await getAccounts();
    _accounts  = all2.filter(a => a.clientId === clientId);
  }

  // Migrate: assign order to any accounts that don't have it yet
  await _ensureOrders(clientId);
}

async function _prepopulateAccounts(clientId) {
  const seed     = _generateAccountSeed(clientId);
  const existing = new Set(_accounts.map(a => a.id));
  for (const s of seed) {
    if (!existing.has(s.id)) {
      await saveAccount({
        ...s, clientId,
        type: '', brokerageName: '', accountNumber: '',
        hidden: false, createdAt: Date.now(),
      });
    }
  }
  localStorage.setItem(_prepopKey(clientId), '1');
}

function _generateAccountSeed(clientId) {
  const seenInv = new Set();
  const seen529 = new Set();
  const skip    = new Set(['date', 'weeklyDate']);
  const counters = { investments: 0, '529': 0 };
  const seed    = [];

  const addCols = (cols, tab) => {
    const seen = tab === 'investments' ? seenInv : seen529;
    for (const col of cols) {
      if (skip.has(col.field) || seen.has(col.field)) continue;
      seen.add(col.field);
      seed.push({
        id: `acct_${clientId}_${tab}_${col.field}`,
        field: col.field, tab, name: col.header,
        order: counters[tab]++,
      });
    }
  };

  addCols(getColsForFormat('investments'),        'investments');
  addCols(getColsForFormat('investments_family'), 'investments');
  addCols(getColsForFormat('529'),               '529');
  addCols(getColsForFormat('529_family'),        '529');
  addCols(getColsForFormat('kids'),              'kids');
  addCols(getColsForFormat('kids_family'),       'kids');
  return seed;
}

async function _ensureOrders(clientId) {
  const needsOrder = _accounts.filter(a => a.order == null);
  if (!needsOrder.length) return;

  const maxByTab = {};
  for (const a of _accounts.filter(a => a.order != null)) {
    maxByTab[a.tab] = Math.max(maxByTab[a.tab] ?? -1, a.order);
  }
  const counters = { investments: (maxByTab['investments'] ?? -1) + 1, '529': (maxByTab['529'] ?? -1) + 1 };

  for (const a of needsOrder) {
    await saveAccount({ ...a, order: counters[a.tab]++ });
  }

  const all2 = await getAccounts();
  _accounts  = all2.filter(a => a.clientId === clientId);
}

// ─────────────────────────────────────────────────────────────────
// LOOKUP — used by grids and computed modal
// ─────────────────────────────────────────────────────────────────

function getAccountByField(field, tab) {
  return _accounts.find(a => a.field === field && a.tab === tab) || null;
}

function getShownAccountsForTab(tab) {
  return _accounts
    .filter(a => a.tab === tab && !a.hidden && a.field)
    .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));
}

function getColumnHeader(field, tab, defaultHeader) {
  const acc = getAccountByField(field, tab);
  return acc ? _aEscHtml(acc.name) : defaultHeader;
}

// Returns rawCols reordered by account.order with computed appended in their order.
// Date columns are always kept first.
function getOrderedColsForTab(rawCols, tab) {
  const dateCols    = rawCols.filter(c => c.type === 'date');
  const nonDateCols = rawCols.filter(c => c.type !== 'date');

  // Only include columns where this client has a matching account — prevents
  // columns added for one client from leaking into another client's grid.
  const withOrder = nonDateCols
    .map(col => {
      const acc = getAccountByField(col.field, tab);
      return { col, order: acc?.order ?? 9999, hasAccount: !!acc };
    })
    .filter(x => x.hasAccount);

  const compCols = (typeof getComputedColsForTab === 'function' ? getComputedColsForTab(tab) : [])
    .map(col => ({ col, order: col.computedOrder ?? 9999 }));

  const combined = [...withOrder, ...compCols].sort((a, b) => a.order - b.order);
  return [...dateCols, ...combined.map(x => x.col)];
}

// ─────────────────────────────────────────────────────────────────
// VIEW
// ─────────────────────────────────────────────────────────────────

async function initAccountsView() {
  await Promise.all([initAccounts(), initComputeds()]);
  _renderAccountsGrid();
  _attachDragHandlers();
}

function setAcctTabFilter(tab) {
  _acctTabFilter = tab;
  document.querySelectorAll('.acct-tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab)
  );
  _renderAccountsGrid();
}

function setAcctFilter(f) {
  _acctVisFilter = f;
  document.querySelectorAll('.acct-vis-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.filter === f)
  );
  _renderAccountsGrid();
}

function _buildCombinedList() {
  let visAccts = _accounts.filter(a => a.tab === _acctTabFilter);
  if (_acctVisFilter === 'shown')  visAccts = visAccts.filter(a => !a.hidden);
  if (_acctVisFilter === 'hidden') visAccts = visAccts.filter(a =>  a.hidden);
  const tabComps = _acctVisFilter === 'hidden'
    ? []
    : (typeof _computeds !== 'undefined' ? _computeds.filter(c => c.tab === _acctTabFilter) : []);
  return [
    ...visAccts.map(a => ({ ...a, _kind: 'account' })),
    ...tabComps.map(c => ({ ...c, _kind: 'computed' })),
  ].sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));
}

function _renderAccountsGrid() {
  const tbody   = document.getElementById('acct-body');
  const countEl = document.getElementById('acct-count');
  if (!tbody) return;

  const tabAccts = _accounts.filter(a => a.tab === _acctTabFilter);
  const hiddenN  = tabAccts.filter(a => a.hidden).length;
  if (countEl) {
    countEl.innerHTML =
      `<strong>${tabAccts.length.toLocaleString()}</strong> account${tabAccts.length !== 1 ? 's' : ''}`
      + (hiddenN ? ` &middot; <span class="acct-count-hidden">${hiddenN} hidden</span>` : '');
  }

  const combined = _buildCombinedList();
  if (!combined.length) {
    tbody.innerHTML = `<tr class="grid-empty-row"><td colspan="7">No items match the current filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = combined.map(item => {
    const handle = `<td class="acct-drag-handle" draggable="true" title="Drag to reorder"><span>⠿</span></td>`;

    if (item._kind === 'computed') {
      const pills = (item.fields || []).map(f => {
        const acc = getAccountByField(f, item.tab);
        return `<span class="comp-field-pill">${_aEscHtml(acc ? acc.name : f)}</span>`;
      }).join('');
      return `
        <tr data-drag-id="${_aEscAttr(item.id)}" data-drag-type="computed">
          ${handle}
          <td class="acct-name-cell">${_aEscHtml(item.name || '—')}</td>
          <td><span class="acct-kind-computed">Σ Computed</span></td>
          <td class="acct-type-cell">—</td>
          <td class="acct-brokerage-cell acct-pills-cell">${pills}</td>
          <td class="acct-number-cell">—</td>
          <td class="col-actions">
            <button class="itype-edit-btn" onclick="openComputedModal('${_aEscAttr(item.id)}')">Edit</button>
            <button class="itype-del-btn"  onclick="deleteComputedById('${_aEscAttr(item.id)}')">Delete</button>
          </td>
        </tr>`;
    }

    const rowCls      = item.hidden ? ' acct-row-hidden' : '';
    const toggleLabel = item.hidden ? 'Show' : 'Hide';
    const toggleCls   = item.hidden ? 'acct-show-btn' : 'acct-hide-btn';
    return `
      <tr class="${rowCls}" data-drag-id="${_aEscAttr(item.id)}" data-drag-type="account">
        ${handle}
        <td class="acct-name-cell">${_aEscHtml(item.name || '—')}</td>
        <td><span class="acct-kind-account">Account</span></td>
        <td class="acct-type-cell">${_aEscHtml(item.type || '—')}</td>
        <td class="acct-brokerage-cell">${_aEscHtml(item.brokerageName || '—')}</td>
        <td class="acct-number-cell">${_aEscHtml(item.accountNumber || '—')}</td>
        <td class="col-actions">
          <button class="itype-edit-btn" onclick="openAccountModal('${_aEscAttr(item.id)}')">Edit</button>
          <button class="${toggleCls}"   onclick="toggleAccountHidden('${_aEscAttr(item.id)}')">${toggleLabel}</button>
        </td>
      </tr>`;
  }).join('');
}

// ─────────────────────────────────────────────────────────────────
// DRAG-AND-DROP REORDER
// ─────────────────────────────────────────────────────────────────

function _attachDragHandlers() {
  const tbody = document.getElementById('acct-body');
  if (!tbody || tbody._dndBound) return;
  tbody._dndBound = true;

  tbody.addEventListener('dragstart', e => {
    const handle = e.target.closest('.acct-drag-handle');
    if (!handle) return;
    const tr = handle.closest('tr[data-drag-id]');
    if (!tr) return;
    _dragSrcId = tr.dataset.dragId;
    tr.classList.add('acct-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', _dragSrcId);
  });

  tbody.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const tr = e.target.closest('tr[data-drag-id]');
    tbody.querySelectorAll('tr.acct-drag-over').forEach(r => r.classList.remove('acct-drag-over'));
    if (tr && tr.dataset.dragId !== _dragSrcId) {
      tr.classList.add('acct-drag-over');
      _dragOverId = tr.dataset.dragId;
    }
  });

  tbody.addEventListener('dragleave', e => {
    if (!tbody.contains(e.relatedTarget)) {
      tbody.querySelectorAll('tr.acct-drag-over').forEach(r => r.classList.remove('acct-drag-over'));
      _dragOverId = null;
    }
  });

  tbody.addEventListener('dragend', () => {
    tbody.querySelectorAll('tr').forEach(r =>
      r.classList.remove('acct-dragging', 'acct-drag-over')
    );
    _dragSrcId = _dragOverId = null;
  });

  tbody.addEventListener('drop', async e => {
    e.preventDefault();
    const tr = e.target.closest('tr[data-drag-id]');
    tbody.querySelectorAll('tr').forEach(r =>
      r.classList.remove('acct-dragging', 'acct-drag-over')
    );
    const srcId = _dragSrcId;
    const tgtId = tr?.dataset.dragId;
    _dragSrcId = _dragOverId = null;
    if (!srcId || !tgtId || srcId === tgtId) return;
    await _doReorder(srcId, tgtId);
  });
}

async function _doReorder(srcId, tgtId) {
  const combined = _buildCombinedList();
  const srcIdx   = combined.findIndex(x => x.id === srcId);
  const tgtIdx   = combined.findIndex(x => x.id === tgtId);
  if (srcIdx < 0 || tgtIdx < 0) return;

  // Move src to tgt's position
  const reordered = [...combined];
  const [moved]   = reordered.splice(srcIdx, 1);
  reordered.splice(tgtIdx, 0, moved);

  // Write sequential order values for changed items only
  for (let i = 0; i < reordered.length; i++) {
    const item = reordered[i];
    if (item._kind === 'account') {
      const orig = _accounts.find(a => a.id === item.id);
      if (orig && orig.order !== i) await saveAccount({ ...orig, order: i });
    } else {
      const orig = _computeds.find(c => c.id === item.id);
      if (orig && orig.order !== i) await saveComputedField({ ...orig, order: i });
    }
  }

  const clientId = typeof getActiveClientId === 'function' ? getActiveClientId() : '';
  const all      = await getAccounts();
  _accounts      = all.filter(a => a.clientId === clientId);
  if (typeof initComputeds === 'function') await initComputeds();

  _renderAccountsGrid();
  if (typeof renderInvestmentsGrid === 'function') renderInvestmentsGrid();
  if (typeof renderPlans529Grid    === 'function') renderPlans529Grid();
}

// ─────────────────────────────────────────────────────────────────
// ACCOUNT MODAL
// ─────────────────────────────────────────────────────────────────

function openAccountModal(id) {
  const a = id ? _accounts.find(x => x.id === id) : null;

  document.getElementById('acct-modal-title').textContent = a ? 'Edit Account' : 'New Account';
  document.getElementById('acct-modal-id').value          = a?.id            || '';
  document.getElementById('acct-modal-name').value        = a?.name          || '';
  document.getElementById('acct-modal-tab').value         = a?.tab           || _acctTabFilter;
  document.getElementById('acct-modal-tab').disabled      = false;
  document.getElementById('acct-modal-type').value        = a?.type          || '';
  document.getElementById('acct-modal-brokerage').value   = a?.brokerageName || '';
  document.getElementById('acct-modal-number').value      = a?.accountNumber || '';

  const fieldRow   = document.getElementById('acct-modal-field-row');
  const fieldInput = document.getElementById('acct-modal-field-input');
  const fieldTag   = document.getElementById('acct-modal-field');

  if (a) {
    // Existing account — show read-only field tag
    fieldTag.textContent    = a.field || '(none)';
    fieldTag.style.display  = '';
    fieldInput.style.display = 'none';
    fieldRow.style.display  = 'flex';
    document.getElementById('acct-modal-field-label').textContent = 'Column Key';
  } else {
    // New account — show editable field key input
    fieldInput.value        = '';
    fieldInput.style.display = '';
    fieldTag.style.display  = 'none';
    fieldRow.style.display  = 'flex';
    document.getElementById('acct-modal-field-label').textContent = 'Field Key';
    // Auto-populate field key as user types name
    const nameEl = document.getElementById('acct-modal-name');
    nameEl.oninput = () => {
      if (!fieldInput._userEdited) fieldInput.value = _toFieldKey(nameEl.value);
    };
    fieldInput.oninput = () => { fieldInput._userEdited = fieldInput.value !== ''; };
    fieldInput._userEdited = false;
  }

  document.getElementById('acct-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('acct-modal-name').focus(), 40);
}

function closeAccountModal() {
  document.getElementById('acct-modal').style.display = 'none';
}

async function saveAccountModal() {
  const existingId = document.getElementById('acct-modal-id').value;
  const name       = document.getElementById('acct-modal-name').value.trim();
  if (!name) { document.getElementById('acct-modal-name').focus(); return; }

  const clientId = typeof getActiveClientId === 'function' ? getActiveClientId() : '';
  const existing = existingId ? _accounts.find(a => a.id === existingId) : null;
  const tab      = document.getElementById('acct-modal-tab').value || existing?.tab;
  const id       = existingId   || `acct_${clientId}_${tab}_${uid()}`;

  // New account gets order after all existing items in the tab
  let order = existing?.order;
  if (order == null) {
    const tabItems = [
      ..._accounts.filter(a => a.tab === tab).map(a => a.order ?? -1),
      ...(typeof _computeds !== 'undefined' ? _computeds.filter(c => c.tab === tab).map(c => c.order ?? -1) : []),
    ];
    order = (tabItems.length ? Math.max(...tabItems) : -1) + 1;
  }

  const field = existing?.field || document.getElementById('acct-modal-field-input').value.trim() || _toFieldKey(name);

  await saveAccount({
    id, clientId: existing?.clientId || clientId,
    field, tab, name,
    type:          document.getElementById('acct-modal-type').value,
    brokerageName: document.getElementById('acct-modal-brokerage').value.trim(),
    accountNumber: document.getElementById('acct-modal-number').value.trim(),
    hidden:   existing?.hidden   || false,
    order,
    createdAt: existing?.createdAt || Date.now(),
  });

  // For new accounts or tab changes: add field to every matching importType format
  const tabChanged = existing && existing.tab !== tab;
  if ((!existing || tabChanged) && field) {
    const formats = tab === 'investments' ? ['investments', 'investments_family']
                  : tab === 'kids'        ? ['kids', 'kids_family']
                  : ['529', '529_family'];
    const allImportTypes = await getImportTypes();
    for (const it of allImportTypes) {
      if (formats.includes(it.format) && Array.isArray(it.cols)) {
        if (!it.cols.find(c => c.field === field)) {
          await saveImportType({ ...it, cols: [...it.cols, { field, header: name, type: 'currency' }] });
        }
      }
    }
    if (typeof initColDefs === 'function') await initColDefs();
  }

  const all2 = await getAccounts();
  _accounts  = all2.filter(a => a.clientId === clientId);
  _renderAccountsGrid();
  closeAccountModal();

  if (typeof renderInvestmentsGrid === 'function') renderInvestmentsGrid();
  if (typeof renderPlans529Grid    === 'function') renderPlans529Grid();
}

async function toggleAccountHidden(id) {
  const a = _accounts.find(x => x.id === id);
  if (!a) return;
  await saveAccount({ ...a, hidden: !a.hidden });
  const clientId = typeof getActiveClientId === 'function' ? getActiveClientId() : '';
  const all = await getAccounts();
  _accounts = all.filter(a => a.clientId === clientId);
  _renderAccountsGrid();
  if (typeof renderInvestmentsGrid === 'function') renderInvestmentsGrid();
  if (typeof renderPlans529Grid    === 'function') renderPlans529Grid();
}

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────

function _aEscAttr(s) {
  return String(s).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
function _aEscHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Returns ALL non-hidden accounts for a tab, regardless of whether they have a field key.
// Used by accounting dropdowns (vs getShownAccountsForTab which requires a.field).
function getAllShownAccounts(tab) {
  return _accounts
    .filter(a => a.tab === tab && !a.hidden)
    .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));
}

function getAccountById(id) {
  return _accounts.find(a => a.id === id) || null;
}

function _toFieldKey(name) {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}
