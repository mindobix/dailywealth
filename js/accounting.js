/* ── accounting.js ── Accounting entries tab ──────────────────────
 *
 * Three sections per client: Deposits, RMDs, Withdrawals.
 * Exposes getAcktgTotals(clientId) for use in investments + dashboard.
 * ─────────────────────────────────────────────────────────────────── */

let _acktgEntries = [];

// ─────────────────────────────────────────────────────────────────
// PUBLIC — used by investments.js and dashboard.js
// ─────────────────────────────────────────────────────────────────

async function getAcktgTotals(clientId) {
  const entries  = await getAccountingEntries();
  const filtered = clientId ? entries.filter(e => e.clientId === clientId) : entries;
  return {
    totalDeposits:    filtered.filter(e => e.type === 'deposit').reduce((s, e) => s + e.amount, 0),
    totalRmds:        filtered.filter(e => e.type === 'rmd').reduce((s, e) => s + e.amount, 0),
    totalWithdrawals: filtered.filter(e => e.type === 'withdrawal').reduce((s, e) => s + e.amount, 0),
    totalCash:        filtered.filter(e => e.type === 'cash').reduce((s, e) => s + e.amount, 0),
  };
}

// ─────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────

async function initAccountingView() {
  _acktgEntries = await getAccountingEntries();
  _renderAccountingView();
}

// ─────────────────────────────────────────────────────────────────
// RENDER
// ─────────────────────────────────────────────────────────────────

function _renderAccountingView() {
  const clientId = getActiveClientId();
  const entries  = _acktgEntries.filter(e => !clientId || e.clientId === clientId);

  const deposits       = entries.filter(e => e.type === 'deposit').sort((a, b) => a.date < b.date ? -1 : 1);
  const rmds           = entries.filter(e => e.type === 'rmd').sort((a, b) => a.date < b.date ? -1 : 1);
  const withdrawals    = entries.filter(e => e.type === 'withdrawal').sort((a, b) => a.date < b.date ? -1 : 1);
  const cashEntries    = entries.filter(e => e.type === 'cash').sort((a, b) => a.updatedAt > b.updatedAt ? -1 : 1);
  const borrowedEntries = entries.filter(e => e.type === 'borrowed').sort((a, b) => a.date < b.date ? -1 : 1);

  const totalDeposits    = deposits.reduce((s, e) => s + e.amount, 0);
  const totalRmds        = rmds.reduce((s, e) => s + e.amount, 0);
  const totalWithdrawals = withdrawals.reduce((s, e) => s + e.amount, 0);
  const totalCash        = cashEntries.reduce((s, e) => s + e.amount, 0);
  const totalBorrowed    = borrowedEntries.reduce((s, e) => s + e.amount, 0);

  const body = document.getElementById('acktg-body');
  if (!body) return;

  body.innerHTML = `
    <div class="acktg-sections">
      ${_acktgSection('deposit',    'Deposits',    deposits,    totalDeposits)}
      ${_acktgSection('rmd',        'RMDs',        rmds,        totalRmds)}
      ${_acktgSection('withdrawal', 'Withdrawals', withdrawals, totalWithdrawals)}
      ${_acktgCashSection(cashEntries, totalCash)}
      ${_acktgBorrowedSection(borrowedEntries, totalBorrowed)}
    </div>
    <div class="acktg-summary">
      <div class="acktg-summary-title">Net Summary</div>
      <div class="acktg-summary-row">
        <span class="acktg-summary-label">Total Deposits</span>
        <span class="acktg-summary-val val-neg">${gFmtCurrency(totalDeposits)}</span>
      </div>
      <div class="acktg-summary-row">
        <span class="acktg-summary-label">Total RMDs</span>
        <span class="acktg-summary-val val-pos">${gFmtCurrency(totalRmds)}</span>
      </div>
      <div class="acktg-summary-row">
        <span class="acktg-summary-label">Total Withdrawals</span>
        <span class="acktg-summary-val val-pos">${gFmtCurrency(totalWithdrawals)}</span>
      </div>
      <div class="acktg-summary-divider"></div>
      <div class="acktg-summary-row acktg-summary-net">
        <span class="acktg-summary-label">Total Cash</span>
        <span class="acktg-summary-val">${gFmtCurrency(totalCash)}</span>
      </div>
      <div class="acktg-summary-row">
        <span class="acktg-summary-label">Total Borrowed</span>
        <span class="acktg-summary-val">${gFmtCurrency(totalBorrowed)}</span>
      </div>
    </div>
  `;
}

function _acktgSection(type, label, entries, total) {
  const singulars = { deposit: 'deposit', rmd: 'RMD', withdrawal: 'withdrawal' };
  const isEmpty = entries.length === 0;
  return `
    <div class="acktg-section${isEmpty ? ' acktg-section--collapsed' : ''}">
      <div class="acktg-section-hd">
        <span class="acktg-section-title">${label}</span>
        <button class="acktg-add-btn" onclick="acktgStartAdd('${type}')">+ Add ${singulars[type]}</button>
      </div>
      ${isEmpty ? `
        <div class="acktg-collapsed-bar">
          <span class="acktg-collapsed-empty">No entries</span>
          <span class="acktg-collapsed-total">Total: ${gFmtCurrency(total)}</span>
        </div>` : `
      <div class="acktg-table-wrap">
        <table class="acktg-table">
          <thead>
            <tr>
              <th>Date</th>
              <th class="acktg-th-amt">Amount</th>
              <th>From</th>
              <th>To</th>
              <th>Notes</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="acktg-tbody-${type}">
            ${entries.map(e => _acktgRow(e)).join('')}
          </tbody>
          <tfoot>
            <tr class="acktg-total-row">
              <td>Total</td>
              <td class="acktg-td-amt">${gFmtCurrency(total)}</td>
              <td></td><td></td><td></td><td></td>
            </tr>
          </tfoot>
        </table>
      </div>`}
    </div>`;
}

function _acktgRow(e) {
  return `<tr id="acktg-row-${_aEscAttr(e.id)}">
    <td class="acktg-td-date">${gFmtDate(e.date) || e.date}</td>
    <td class="acktg-td-amt">${gFmtCurrency(e.amount)}</td>
    <td class="acktg-td-account">${_aEsc(_acktgAccountName(e.fromAccount))}</td>
    <td class="acktg-td-account">${_aEsc(_acktgAccountName(e.toAccount))}</td>
    <td class="acktg-td-notes">${_aEsc(e.notes || '')}</td>
    <td class="acktg-td-actions">
      <button class="acktg-edit-btn" onclick="acktgStartEdit('${_aEscAttr(e.id)}')">Edit</button>
      <button class="acktg-del-btn"  onclick="deleteAcktgEntry('${_aEscAttr(e.id)}')">Delete</button>
    </td>
  </tr>`;
}

// ─────────────────────────────────────────────────────────────────
// CASH SECTION
// ─────────────────────────────────────────────────────────────────

function _acktgCashSection(entries, total) {
  const isEmpty = entries.length === 0;
  return `
    <div class="acktg-cash-section acktg-section${isEmpty ? ' acktg-section--collapsed' : ''}">
      <div class="acktg-section-hd">
        <span class="acktg-section-title">Cash</span>
        <button class="acktg-add-btn" onclick="acktgStartAddCash()">+ Add cash</button>
      </div>
      ${isEmpty ? `
        <div class="acktg-collapsed-bar">
          <span class="acktg-collapsed-empty">No entries</span>
          <span class="acktg-collapsed-total">Total: ${gFmtCurrency(total)}</span>
        </div>` : `
      <div class="acktg-table-wrap">
        <table class="acktg-table acktg-cash-table">
          <thead>
            <tr>
              <th>Account</th>
              <th class="acktg-th-amt">Cash Amount</th>
              <th>Last Updated</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="acktg-tbody-cash">
            ${entries.map(e => _acktgCashRow(e)).join('')}
          </tbody>
          <tfoot>
            <tr class="acktg-total-row">
              <td>Total</td>
              <td class="acktg-td-amt">${gFmtCurrency(total)}</td>
              <td></td><td></td>
            </tr>
          </tfoot>
        </table>
      </div>`}
    </div>`;
}

function _acktgCashRow(e) {
  const updatedLabel = e.updatedAt ? _fmtDateTime(e.updatedAt) : '';
  return `<tr id="acktg-cash-row-${_aEscAttr(e.id)}">
    <td class="acktg-td-account">${_aEsc(_acktgAccountName(e.accountId))}</td>
    <td class="acktg-td-amt">${gFmtCurrency(e.amount)}</td>
    <td class="acktg-td-date" style="font-weight:400;color:var(--ink-muted);font-size:11.5px">${_aEsc(updatedLabel)}</td>
    <td class="acktg-td-actions">
      <button class="acktg-edit-btn" onclick="acktgStartEditCash('${_aEscAttr(e.id)}')">Edit</button>
      <button class="acktg-del-btn"  onclick="deleteAcktgCashEntry('${_aEscAttr(e.id)}')">Delete</button>
    </td>
  </tr>`;
}

function _fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function acktgStartAddCash() {
  let tbody = document.getElementById('acktg-tbody-cash');

  if (!tbody) {
    const btn = document.querySelector('[onclick="acktgStartAddCash()"]');
    const section = btn?.closest('.acktg-section');
    if (!section) return;
    section.classList.remove('acktg-section--collapsed');
    section.querySelector('.acktg-collapsed-bar')?.remove();
    const tableWrap = document.createElement('div');
    tableWrap.className = 'acktg-table-wrap';
    tableWrap.innerHTML = `<table class="acktg-table acktg-cash-table">
      <thead><tr>
        <th>Account</th><th class="acktg-th-amt">Cash Amount</th>
        <th>Last Updated</th><th></th>
      </tr></thead>
      <tbody id="acktg-tbody-cash"></tbody>
      <tfoot><tr class="acktg-total-row">
        <td>Total</td><td class="acktg-td-amt">${gFmtCurrency(0)}</td>
        <td></td><td></td>
      </tr></tfoot>
    </table>`;
    section.appendChild(tableWrap);
    tbody = document.getElementById('acktg-tbody-cash');
  }

  if (tbody.querySelector('.acktg-new-row')) {
    tbody.querySelector('.acktg-new-row input, .acktg-new-row select')?.focus();
    return;
  }

  const opts = _acktgAccountOptions();

  const tr = document.createElement('tr');
  tr.className = 'acktg-new-row';
  tr.innerHTML = `
    <td><select class="acktg-inline-sel" id="aie-acct-new-cash">${opts}</select></td>
    <td><input class="acktg-inline-input acktg-inline-amt" type="text" id="aie-amt-new-cash" placeholder="0.00" inputmode="decimal"></td>
    <td style="font-size:11.5px;color:var(--ink-muted)">auto on save</td>
    <td class="acktg-td-actions">
      <button class="acktg-save-btn"   onclick="acktgSaveAddCash()">Save</button>
      <button class="acktg-cancel-btn" onclick="_renderAccountingView()">Cancel</button>
    </td>`;

  tbody.insertBefore(tr, tbody.firstChild);
  document.getElementById('aie-amt-new-cash').focus();
}

async function acktgSaveAddCash() {
  const accountId = document.getElementById('aie-acct-new-cash')?.value  || '';
  const amountRaw = document.getElementById('aie-amt-new-cash')?.value   || '';

  if (!accountId) { document.getElementById('aie-acct-new-cash')?.focus(); return; }
  const amount = parseFloat(String(amountRaw).replace(/[$,]/g, ''));
  if (isNaN(amount)) { document.getElementById('aie-amt-new-cash')?.focus(); return; }

  const id       = 'acktg_' + uid();
  const clientId = getActiveClientId();
  const updatedAt = new Date().toISOString();

  await saveAccountingEntry({ id, clientId, type: 'cash', accountId, amount, updatedAt });
  _acktgEntries = await getAccountingEntries();
  _renderAccountingView();
}

function acktgStartEditCash(id) {
  const e = _acktgEntries.find(x => x.id === id);
  if (!e) return;
  const tr = document.getElementById('acktg-cash-row-' + id);
  if (!tr) return;

  const opts   = _acktgAccountOptions();
  const safeId = _aEscAttr(id);

  tr.innerHTML = `
    <td><select class="acktg-inline-sel" id="aie-acct-${safeId}">${opts}</select></td>
    <td><input class="acktg-inline-input acktg-inline-amt" type="text" id="aie-amt-${safeId}" value="${e.amount}" inputmode="decimal"></td>
    <td style="font-size:11.5px;color:var(--ink-muted)">auto on save</td>
    <td class="acktg-td-actions">
      <button class="acktg-save-btn"   onclick="acktgSaveEditCash('${safeId}')">Save</button>
      <button class="acktg-cancel-btn" onclick="_renderAccountingView()">Cancel</button>
    </td>`;

  document.getElementById(`aie-acct-${id}`).value = e.accountId || '';
  document.getElementById(`aie-amt-${id}`).focus();
}

async function acktgSaveEditCash(id) {
  const e = _acktgEntries.find(x => x.id === id);
  if (!e) return;

  const accountId = document.getElementById(`aie-acct-${id}`)?.value || '';
  const amountRaw = document.getElementById(`aie-amt-${id}`)?.value  || '';

  if (!accountId) { document.getElementById(`aie-acct-${id}`)?.focus(); return; }
  const amount = parseFloat(String(amountRaw).replace(/[$,]/g, ''));
  if (isNaN(amount)) { document.getElementById(`aie-amt-${id}`)?.focus(); return; }

  const updatedAt = new Date().toISOString();
  await saveAccountingEntry({ ...e, accountId, amount, updatedAt });
  _acktgEntries = await getAccountingEntries();
  _renderAccountingView();
}

async function deleteAcktgCashEntry(id) {
  if (!confirm('Delete this cash entry? This cannot be undone.')) return;
  await deleteAccountingEntry(id);
  _acktgEntries = _acktgEntries.filter(e => e.id !== id);
  _renderAccountingView();
}

// ─────────────────────────────────────────────────────────────────
// INLINE EDIT
// ─────────────────────────────────────────────────────────────────

function acktgStartEdit(id) {
  const e = _acktgEntries.find(x => x.id === id);
  if (!e) return;
  const tr = document.getElementById('acktg-row-' + id);
  if (!tr) return;

  const opts = _acktgAccountOptions();
  const safeId = _aEscAttr(id);

  tr.innerHTML = `
    <td><input class="acktg-inline-input" type="date" id="aie-date-${safeId}" value="${_aVal(e.date)}"></td>
    <td><input class="acktg-inline-input acktg-inline-amt" type="text" id="aie-amt-${safeId}" value="${e.amount}" inputmode="decimal" placeholder="0.00"></td>
    <td><select class="acktg-inline-sel" id="aie-from-${safeId}">${opts}</select></td>
    <td><select class="acktg-inline-sel" id="aie-to-${safeId}">${opts}</select></td>
    <td><input class="acktg-inline-input acktg-inline-notes" type="text" id="aie-notes-${safeId}" value="${_aVal(e.notes || '')}" maxlength="120"></td>
    <td class="acktg-td-actions">
      <button class="acktg-save-btn" onclick="acktgSaveEdit('${safeId}')">Save</button>
      <button class="acktg-cancel-btn" onclick="_renderAccountingView()">Cancel</button>
    </td>`;

  document.getElementById(`aie-from-${id}`).value = e.fromAccount || '';
  document.getElementById(`aie-to-${id}`).value   = e.toAccount   || '';
  document.getElementById(`aie-amt-${id}`).focus();
}

async function acktgSaveEdit(id) {
  const e = _acktgEntries.find(x => x.id === id);
  if (!e) return;

  const date        = document.getElementById(`aie-date-${id}`)?.value  || '';
  const amountRaw   = document.getElementById(`aie-amt-${id}`)?.value   || '';
  const fromAccount = document.getElementById(`aie-from-${id}`)?.value  || '';
  const toAccount   = document.getElementById(`aie-to-${id}`)?.value    || '';
  const notes       = document.getElementById(`aie-notes-${id}`)?.value.trim() || '';

  if (!date)                                { document.getElementById(`aie-date-${id}`)?.focus(); return; }
  const amount = parseFloat(amountRaw);
  if (isNaN(amount) || amount <= 0)         { document.getElementById(`aie-amt-${id}`)?.focus();  return; }
  if (!fromAccount)                         { document.getElementById(`aie-from-${id}`)?.focus(); return; }
  if (!toAccount)                           { document.getElementById(`aie-to-${id}`)?.focus();   return; }

  await saveAccountingEntry({ ...e, date, amount, notes, fromAccount, toAccount });
  _acktgEntries = await getAccountingEntries();
  _renderAccountingView();
}

// ─────────────────────────────────────────────────────────────────
// INLINE ADD
// ─────────────────────────────────────────────────────────────────

function acktgStartAdd(type) {
  let tbody = document.getElementById(`acktg-tbody-${type}`);

  // Section is collapsed (no data) — expand it inline before inserting the new row
  if (!tbody) {
    const btn = document.querySelector(`[onclick="acktgStartAdd('${type}')"]`);
    const section = btn?.closest('.acktg-section');
    if (!section) return;
    section.classList.remove('acktg-section--collapsed');
    const collapsedBar = section.querySelector('.acktg-collapsed-bar');
    if (collapsedBar) collapsedBar.remove();
    const opts = _acktgAccountOptions();
    const tableWrap = document.createElement('div');
    tableWrap.className = 'acktg-table-wrap';
    tableWrap.innerHTML = `<table class="acktg-table">
      <thead><tr>
        <th>Date</th><th class="acktg-th-amt">Amount</th>
        <th>From</th><th>To</th><th>Notes</th><th></th>
      </tr></thead>
      <tbody id="acktg-tbody-${type}"></tbody>
      <tfoot><tr class="acktg-total-row">
        <td>Total</td><td class="acktg-td-amt">${gFmtCurrency(0)}</td>
        <td></td><td></td><td></td><td></td>
      </tr></tfoot>
    </table>`;
    section.appendChild(tableWrap);
    tbody = document.getElementById(`acktg-tbody-${type}`);
  }

  // Only one new row at a time per section
  if (tbody.querySelector('.acktg-new-row')) {
    tbody.querySelector('.acktg-new-row input, .acktg-new-row select')?.focus();
    return;
  }

  const today = new Date().toLocaleDateString('en-CA');
  const opts  = _acktgAccountOptions();
  const tempId = `new-${type}`;

  const tr = document.createElement('tr');
  tr.className = 'acktg-new-row';
  tr.innerHTML = `
    <td><input class="acktg-inline-input" type="date" id="aie-date-${tempId}" value="${today}"></td>
    <td><input class="acktg-inline-input acktg-inline-amt" type="text" id="aie-amt-${tempId}" placeholder="0.00" inputmode="decimal"></td>
    <td><select class="acktg-inline-sel" id="aie-from-${tempId}">${opts}</select></td>
    <td><select class="acktg-inline-sel" id="aie-to-${tempId}">${opts}</select></td>
    <td><input class="acktg-inline-input acktg-inline-notes" type="text" id="aie-notes-${tempId}" placeholder="Notes…" maxlength="120"></td>
    <td class="acktg-td-actions">
      <button class="acktg-save-btn"   onclick="acktgSaveAdd('${type}')">Save</button>
      <button class="acktg-cancel-btn" onclick="_renderAccountingView()">Cancel</button>
    </td>`;

  tbody.insertBefore(tr, tbody.firstChild);
  document.getElementById(`aie-amt-${tempId}`).focus();
}

async function acktgSaveAdd(type) {
  const tempId      = `new-${type}`;
  const date        = document.getElementById(`aie-date-${tempId}`)?.value  || '';
  const amountRaw   = document.getElementById(`aie-amt-${tempId}`)?.value   || '';
  const fromAccount = document.getElementById(`aie-from-${tempId}`)?.value  || '';
  const toAccount   = document.getElementById(`aie-to-${tempId}`)?.value    || '';
  const notes       = document.getElementById(`aie-notes-${tempId}`)?.value.trim() || '';

  if (!date)                               { document.getElementById(`aie-date-${tempId}`)?.focus(); return; }
  const amount = parseFloat(String(amountRaw).replace(/[$,]/g, ''));
  if (isNaN(amount) || amount <= 0)        { document.getElementById(`aie-amt-${tempId}`)?.focus();  return; }
  if (!fromAccount)                        { document.getElementById(`aie-from-${tempId}`)?.focus(); return; }
  if (!toAccount)                          { document.getElementById(`aie-to-${tempId}`)?.focus();   return; }

  const id       = 'acktg_' + uid();
  const clientId = getActiveClientId();

  await saveAccountingEntry({ id, clientId, type, date, amount, notes, fromAccount, toAccount });
  _acktgEntries = await getAccountingEntries();
  _renderAccountingView();
}

async function deleteAcktgEntry(id) {
  if (!confirm('Delete this entry? This cannot be undone.')) return;
  await deleteAccountingEntry(id);
  _acktgEntries = _acktgEntries.filter(e => e.id !== id);
  _renderAccountingView();
}

// ─────────────────────────────────────────────────────────────────
// BORROWED SECTION
// ─────────────────────────────────────────────────────────────────

function _acktgBorrowedSection(entries, total) {
  const isEmpty = entries.length === 0;
  return `
    <div class="acktg-section${isEmpty ? ' acktg-section--collapsed' : ''}">
      <div class="acktg-section-hd">
        <span class="acktg-section-title">Borrowed</span>
        <button class="acktg-add-btn" onclick="acktgStartAddBorrowed()">+ Add borrowed</button>
      </div>
      ${isEmpty ? `
        <div class="acktg-collapsed-bar">
          <span class="acktg-collapsed-empty">No entries</span>
          <span class="acktg-collapsed-total">Total: ${gFmtCurrency(total)}</span>
        </div>` : `
      <div class="acktg-table-wrap">
        <table class="acktg-table">
          <thead>
            <tr>
              <th>Date</th>
              <th class="acktg-th-amt">Amount</th>
              <th>From</th>
              <th>To</th>
              <th>Notes</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="acktg-tbody-borrowed">
            ${entries.map(e => _acktgBorrowedRow(e)).join('')}
          </tbody>
          <tfoot>
            <tr class="acktg-total-row">
              <td>Total</td>
              <td class="acktg-td-amt">${gFmtCurrency(total)}</td>
              <td></td><td></td><td></td><td></td>
            </tr>
          </tfoot>
        </table>
      </div>`}
    </div>`;
}

function _acktgBorrowedRow(e) {
  return `<tr id="acktg-borrow-row-${_aEscAttr(e.id)}">
    <td class="acktg-td-date">${gFmtDate(e.date) || e.date}</td>
    <td class="acktg-td-amt">${gFmtCurrency(e.amount)}</td>
    <td class="acktg-td-account">${_aEsc(e.from || '')}</td>
    <td class="acktg-td-account">${_aEsc(e.to || '')}</td>
    <td class="acktg-td-notes">${_aEsc(e.notes || '')}</td>
    <td class="acktg-td-actions">
      <button class="acktg-edit-btn" onclick="acktgStartEditBorrowed('${_aEscAttr(e.id)}')">Edit</button>
      <button class="acktg-del-btn"  onclick="deleteBorrowedEntry('${_aEscAttr(e.id)}')">Delete</button>
    </td>
  </tr>`;
}

function acktgStartAddBorrowed() {
  let tbody = document.getElementById('acktg-tbody-borrowed');

  if (!tbody) {
    const btn = document.querySelector('[onclick="acktgStartAddBorrowed()"]');
    const section = btn?.closest('.acktg-section');
    if (!section) return;
    section.classList.remove('acktg-section--collapsed');
    section.querySelector('.acktg-collapsed-bar')?.remove();
    const tableWrap = document.createElement('div');
    tableWrap.className = 'acktg-table-wrap';
    tableWrap.innerHTML = `<table class="acktg-table">
      <thead><tr>
        <th>Date</th><th class="acktg-th-amt">Amount</th>
        <th>From</th><th>To</th><th>Notes</th><th></th>
      </tr></thead>
      <tbody id="acktg-tbody-borrowed"></tbody>
      <tfoot><tr class="acktg-total-row">
        <td>Total</td><td class="acktg-td-amt">${gFmtCurrency(0)}</td>
        <td></td><td></td><td></td><td></td>
      </tr></tfoot>
    </table>`;
    section.appendChild(tableWrap);
    tbody = document.getElementById('acktg-tbody-borrowed');
  }

  if (tbody.querySelector('.acktg-new-row')) {
    tbody.querySelector('.acktg-new-row input')?.focus();
    return;
  }

  const today  = new Date().toLocaleDateString('en-CA');
  const tempId = 'new-borrowed';

  const tr = document.createElement('tr');
  tr.className = 'acktg-new-row';
  tr.innerHTML = `
    <td><input class="acktg-inline-input" type="date" id="aie-date-${tempId}" value="${today}"></td>
    <td><input class="acktg-inline-input acktg-inline-amt" type="text" id="aie-amt-${tempId}" placeholder="0.00" inputmode="decimal"></td>
    <td><input class="acktg-inline-input" type="text" id="aie-from-${tempId}" placeholder="From…" maxlength="120"></td>
    <td><input class="acktg-inline-input" type="text" id="aie-to-${tempId}" placeholder="To…" maxlength="120"></td>
    <td><input class="acktg-inline-input acktg-inline-notes" type="text" id="aie-notes-${tempId}" placeholder="Notes…" maxlength="200"></td>
    <td class="acktg-td-actions">
      <button class="acktg-save-btn"   onclick="acktgSaveAddBorrowed()">Save</button>
      <button class="acktg-cancel-btn" onclick="_renderAccountingView()">Cancel</button>
    </td>`;

  tbody.insertBefore(tr, tbody.firstChild);
  document.getElementById(`aie-amt-${tempId}`).focus();
}

async function acktgSaveAddBorrowed() {
  const tempId    = 'new-borrowed';
  const date      = document.getElementById(`aie-date-${tempId}`)?.value  || '';
  const amountRaw = document.getElementById(`aie-amt-${tempId}`)?.value   || '';
  const from      = document.getElementById(`aie-from-${tempId}`)?.value.trim() || '';
  const to        = document.getElementById(`aie-to-${tempId}`)?.value.trim()   || '';
  const notes     = document.getElementById(`aie-notes-${tempId}`)?.value.trim() || '';

  if (!date)                                { document.getElementById(`aie-date-${tempId}`)?.focus(); return; }
  const amount = parseFloat(String(amountRaw).replace(/[$,]/g, ''));
  if (isNaN(amount) || amount <= 0)         { document.getElementById(`aie-amt-${tempId}`)?.focus();  return; }

  const id       = 'acktg_' + uid();
  const clientId = getActiveClientId();

  await saveAccountingEntry({ id, clientId, type: 'borrowed', date, amount, from, to, notes });
  _acktgEntries = await getAccountingEntries();
  _renderAccountingView();
}

function acktgStartEditBorrowed(id) {
  const e = _acktgEntries.find(x => x.id === id);
  if (!e) return;
  const tr = document.getElementById('acktg-borrow-row-' + id);
  if (!tr) return;

  const safeId = _aEscAttr(id);

  tr.innerHTML = `
    <td><input class="acktg-inline-input" type="date" id="aie-date-${safeId}" value="${_aVal(e.date)}"></td>
    <td><input class="acktg-inline-input acktg-inline-amt" type="text" id="aie-amt-${safeId}" value="${e.amount}" inputmode="decimal"></td>
    <td><input class="acktg-inline-input" type="text" id="aie-from-${safeId}" value="${_aVal(e.from || '')}" maxlength="120"></td>
    <td><input class="acktg-inline-input" type="text" id="aie-to-${safeId}" value="${_aVal(e.to || '')}" maxlength="120"></td>
    <td><input class="acktg-inline-input acktg-inline-notes" type="text" id="aie-notes-${safeId}" value="${_aVal(e.notes || '')}" maxlength="200"></td>
    <td class="acktg-td-actions">
      <button class="acktg-save-btn"   onclick="acktgSaveEditBorrowed('${safeId}')">Save</button>
      <button class="acktg-cancel-btn" onclick="_renderAccountingView()">Cancel</button>
    </td>`;

  document.getElementById(`aie-amt-${id}`).focus();
}

async function acktgSaveEditBorrowed(id) {
  const e = _acktgEntries.find(x => x.id === id);
  if (!e) return;

  const date      = document.getElementById(`aie-date-${id}`)?.value  || '';
  const amountRaw = document.getElementById(`aie-amt-${id}`)?.value   || '';
  const from      = document.getElementById(`aie-from-${id}`)?.value.trim() || '';
  const to        = document.getElementById(`aie-to-${id}`)?.value.trim()   || '';
  const notes     = document.getElementById(`aie-notes-${id}`)?.value.trim() || '';

  if (!date)                                { document.getElementById(`aie-date-${id}`)?.focus(); return; }
  const amount = parseFloat(String(amountRaw).replace(/[$,]/g, ''));
  if (isNaN(amount) || amount <= 0)         { document.getElementById(`aie-amt-${id}`)?.focus();  return; }

  await saveAccountingEntry({ ...e, date, amount, from, to, notes });
  _acktgEntries = await getAccountingEntries();
  _renderAccountingView();
}

async function deleteBorrowedEntry(id) {
  if (!confirm('Delete this borrowed entry? This cannot be undone.')) return;
  await deleteAccountingEntry(id);
  _acktgEntries = _acktgEntries.filter(e => e.id !== id);
  _renderAccountingView();
}

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────

function _aEsc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function _aEscAttr(s) {
  return String(s).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
function _aVal(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function _acktgAccountName(id) {
  if (!id) return '';
  const a = typeof getAccountById === 'function' ? getAccountById(id) : null;
  return a ? a.name : id;
}

function _acktgAccountOptions() {
  const inv  = typeof getAllShownAccounts === 'function' ? getAllShownAccounts('investments') : [];
  const p529 = typeof getAllShownAccounts === 'function' ? getAllShownAccounts('529') : [];
  const groups = [];
  if (inv.length)  groups.push(`<optgroup label="Investments">${inv.map(a  => `<option value="${_aEscAttr(a.id)}">${_aEsc(a.name)}</option>`).join('')}</optgroup>`);
  if (p529.length) groups.push(`<optgroup label="529 Plans">${p529.map(a => `<option value="${_aEscAttr(a.id)}">${_aEsc(a.name)}</option>`).join('')}</optgroup>`);
  return '<option value="">— select account —</option>' + groups.join('');
}
