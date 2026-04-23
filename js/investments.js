/* ── investments.js ── Investments tab ─────────────────────────
 *
 * Editable, filterable, sortable, paginated grid of daily
 * portfolio snapshots. Column definitions loaded from IndexedDB.
 * ─────────────────────────────────────────────────────────────── */

let invPage     = 1;
let invPageSize = 100;
let invSortFld  = 'date';
let invSortDir  = 'desc';
let _invCols    = [];
let _invTruePnL = null; // { portField, firstPortVal, netInvested } — set each render

let _invListenerReady = false;

// ─────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────

async function initInvestmentsView() {
  // Attach click→edit delegation once (survives tbody re-renders)
  if (!_invListenerReady) {
    document.getElementById('inv-month').innerHTML = MONTH_OPTIONS;

    document.getElementById('inv-body').addEventListener('click', e => {
      const td = e.target.closest('td[data-field]');
      if (td) startCellEdit(td);
    });
    _invListenerReady = true;
  }

  await _invPopulateYears();
  await renderInvestmentsGrid();
}

async function _invPopulateYears() {
  const records = await getInvestments();
  const years   = [...new Set(records.map(r => r.date?.slice(0, 4)).filter(Boolean))].sort().reverse();
  const sel     = document.getElementById('inv-year');
  const cur     = sel.value;
  sel.innerHTML = '<option value="">All years</option>' +
    years.map(y => `<option value="${y}"${y === cur ? ' selected' : ''}>${y}</option>`).join('');
}

// ─────────────────────────────────────────────────────────────────
// RENDER
// ─────────────────────────────────────────────────────────────────

async function renderInvestmentsGrid() {
  if (_activeTd) return; // don't clobber an active inline edit
  let records = await getInvestments();

  // — Filters —
  const search = document.getElementById('inv-search').value.trim().toLowerCase();
  const year   = document.getElementById('inv-year').value;
  const month  = document.getElementById('inv-month').value;

  const activeClientId = getActiveClientId();
  if (activeClientId) records = records.filter(r => r.clientId === activeClientId || !r.clientId);

  if (year)   records = records.filter(r => r.date?.startsWith(year));
  if (month)  records = records.filter(r => r.date?.slice(5, 7) === month);
  if (search) records = records.filter(r =>
    (r.date || '').includes(search) ||
    gFmtDate(r.date || '')?.toLowerCase().includes(search)
  );

  // — Detect column format from data (family vs standard) —
  const _stdInvFields = new Set(getColsForFormat('investments').map(c => c.field));
  const _familyInvExclusive = getColsForFormat('investments_family').map(c => c.field).filter(f => !_stdInvFields.has(f));
  const _fmt = records.find(r => r.format)?.format
    || (_familyInvExclusive.length && records.some(r => _familyInvExclusive.some(f => r[f] != null)) ? 'investments_family' : 'investments');
  const _rawCols = getColsForFormat(_fmt === 'investments_family' ? 'investments_family' : 'investments')
    .filter(col => col.field !== 'weeklyDate')
    .filter(col => { const a = getAccountByField(col.field, 'investments'); return !a || !a.hidden; });
  _invCols = typeof getOrderedColsForTab === 'function'
    ? getOrderedColsForTab(_rawCols, 'investments')
    : _rawCols.concat(typeof getComputedColsForTab === 'function' ? getComputedColsForTab('investments') : []);

  // — True P&L context (cumulative accounting entries per row date) —
  _invTruePnL = null;
  if (typeof getAccountingEntries === 'function') {
    const allEntries    = await getAccountingEntries();
    const acktgEntries  = allEntries
      .filter(e => !activeClientId || e.clientId === activeClientId)
      .sort((a, b) => a.date < b.date ? -1 : 1);
    if (acktgEntries.length) {
      const _portFields  = ['totalPortfolio', 'investmentTotal', 'fidelityTotal', 'fidelityTotalKids', 'totalRetirement'];
      const portField    = _portFields.find(f => records.some(r => typeof r[f] === 'number')) || null;
      if (portField) {
        const ascRecs      = [...records].sort((a, b) => a.date < b.date ? -1 : 1);
        const firstPortVal = ascRecs.find(r => typeof r[portField] === 'number')?.[portField] ?? null;
        _invTruePnL = { portField, firstPortVal, entries: acktgEntries };
      }
    }
  }

  // — Sort —
  records = sortRecords(records, invSortFld, invSortDir);

  const total      = records.length;
  const totalPages = Math.max(1, Math.ceil(total / invPageSize));
  if (invPage > totalPages) invPage = totalPages;

  // Count badge
  document.getElementById('inv-count').innerHTML =
    `<strong>${total.toLocaleString()}</strong> record${total !== 1 ? 's' : ''}`;

  // Pagination
  const pgHTML = buildGridPagination(invPage, invPageSize, total, totalPages, 'inv');
  document.getElementById('inv-pg-top').innerHTML = pgHTML;
  document.getElementById('inv-pg-bot').innerHTML = pgHTML;

  // Page slice
  const offset = (invPage - 1) * invPageSize;
  const paged  = records.slice(offset, offset + invPageSize);

  // Render header
  document.getElementById('inv-thead').innerHTML = _invHeader();

  // Render body
  const tbody = document.getElementById('inv-body');
  if (!total) {
    const span = _invCols.length + 2 + (_invTruePnL ? 1 : 0); // +rn +actions
    tbody.innerHTML = `<tr class="grid-empty-row"><td colspan="${span}">No investment records yet. Use the <strong>Import</strong> tab to load your Google Sheets CSV.</td></tr>`;
    return;
  }

  tbody.innerHTML = paged.map((rec, i) => _invRow(rec, offset + i)).join('');
}

// ─────────────────────────────────────────────────────────────────
// HEADER
// ─────────────────────────────────────────────────────────────────

function _invHeader() {
  const sortCls = (f) => {
    if (invSortFld !== f) return '';
    return invSortDir === 'asc' ? ' sort-asc' : ' sort-desc';
  };

  let html = `<tr>
    <th class="col-rn no-sort">#</th>`;

  _invCols.forEach((col, i) => {
    const isDateSticky = (i === 1); // Date column (index 1 = 'date' field)
    const stickyClass  = isDateSticky ? ' col-date-sticky' : '';
    const numClass     = (col.type === 'currency' || col.type === 'pct') ? ' col-num' : '';
    const compCls = col.isComputed ? ' col-computed' : '';
    const thLabel = col.isComputed ? _cmpEscHtml(col.header) : getColumnHeader(col.field, 'investments', col.header);
    html += `<th class="${sortCls(col.field)}${stickyClass}${numClass}${compCls}" onclick="invSortBy('${col.field}')">${thLabel}</th>`;
  });

  if (_invTruePnL) {
    html += `<th class="col-num no-sort" title="Portfolio Value − Starting Value − Net Invested">True P&amp;L</th>`;
  }

  html += `<th class="col-actions no-sort"></th></tr>`;
  return html;
}

// ─────────────────────────────────────────────────────────────────
// ROW
// ─────────────────────────────────────────────────────────────────

function _invRow(rec, globalIdx) {
  let html = `<tr data-id="${rec.id}">`;
  html += `<td class="col-rn">${globalIdx + 1}</td>`;

  _invCols.forEach((col, i) => {
    const isDateSticky = (i === 1);
    const stickyClass  = isDateSticky ? ' col-date-sticky' : '';

    if (col.isComputed) {
      const sum = col.sourceFields.reduce((s, f) => s + (typeof rec[f] === 'number' ? rec[f] : 0), 0);
      html += `<td class="col-num val-computed${stickyClass}">${gFmtCurrency(sum)}</td>`;
      return;
    }

    const val     = rec[col.field];
    const rawAttr = `data-field="${col.field}" data-type="${col.type}" data-raw="${val ?? 'null'}"`;

    let cellCls = '';
    let display = '';

    if (val === null || val === undefined) {
      display = '—';
      cellCls = 'val-null';
    } else if (col.type === 'date') {
      display = gFmtDate(val) || '—';
      cellCls = 'td-date';
    } else if (col.type === 'currency') {
      display = gFmtCurrency(val) || '—';
      cellCls = 'col-num';
      if (col.gainLoss)                       cellCls += val > 0 ? ' val-pos' : val < 0 ? ' val-neg' : '';
      else if (col.field === 'totalPortfolio') cellCls += ' val-big';
    } else if (col.type === 'pct') {
      display = gFmtPct(val) || '—';
      cellCls = 'col-num' + (val > 0 ? ' val-pos' : val < 0 ? ' val-neg' : '');
    } else {
      display = String(val);
    }

    html += `<td class="${(cellCls + stickyClass).trim()}" ${rawAttr}>${display}</td>`;
  });

  if (_invTruePnL) {
    const rowPortVal = typeof rec[_invTruePnL.portField] === 'number' ? rec[_invTruePnL.portField] : null;
    let truePnL = null;
    if (rowPortVal !== null && _invTruePnL.firstPortVal !== null) {
      const upTo = _invTruePnL.entries.filter(e => e.date <= rec.date);
      const cumDeposits    = upTo.filter(e => e.type === 'deposit').reduce((s, e) => s + e.amount, 0);
      const cumRmds        = upTo.filter(e => e.type === 'rmd').reduce((s, e) => s + e.amount, 0);
      const cumWithdrawals = upTo.filter(e => e.type === 'withdrawal').reduce((s, e) => s + e.amount, 0);
      truePnL = rowPortVal - _invTruePnL.firstPortVal - (cumDeposits - cumRmds - cumWithdrawals);
    }
    const pnlCls = truePnL === null ? 'val-null' : truePnL > 0 ? 'val-pos' : truePnL < 0 ? 'val-neg' : '';
    html += `<td class="col-num ${pnlCls}">${truePnL !== null ? gFmtCurrency(truePnL) : '—'}</td>`;
  }

  html += `<td class="col-actions">
    <button class="del-row-btn" onclick="deleteInvestment('${_esc(rec.id)}')" title="Delete row">✕</button>
  </td></tr>`;

  return html;
}

// ─────────────────────────────────────────────────────────────────
// SORT / PAGE callbacks (called by buildGridPagination HTML)
// ─────────────────────────────────────────────────────────────────

function invSortBy(field) {
  invSortDir = (invSortFld === field && invSortDir === 'desc') ? 'asc' : 'desc';
  invSortFld = field;
  invPage    = 1;
  renderInvestmentsGrid();
}

function invGoToPage(p)   { invPage = p; renderInvestmentsGrid(); }
function invSetPageSize(n) { invPageSize = n; invPage = 1; renderInvestmentsGrid(); }

// ─────────────────────────────────────────────────────────────────
// ADD ROW
// ─────────────────────────────────────────────────────────────────

async function addInvestmentRow() {
  // Use a temp id so it doesn't clash with imported date-keyed records
  const id = 'inv_new_' + uid();
  const today = new Date().toLocaleDateString('en-CA');
  await dbPut('investments', { id, clientId: getActiveClientId(), date: today });

  invSortFld = 'date';
  invSortDir = 'desc';
  invPage    = 1;

  await _invPopulateYears();
  await renderInvestmentsGrid();
}

// ─────────────────────────────────────────────────────────────────
// DELETE ROW
// ─────────────────────────────────────────────────────────────────

async function deleteInvestment(id) {
  if (!confirm('Delete this row? This cannot be undone.')) return;
  await dbDelete('investments', id);
  await renderInvestmentsGrid();
}

// ─────────────────────────────────────────────────────────────────
// AUTO GAIN/LOSS
// ─────────────────────────────────────────────────────────────────

async function _autoComputeGainLoss(record, savedField) {
  const totalField = typeof getDashTotalField === 'function' ? getDashTotalField() : null;
  if (!totalField) return;

  const glField      = typeof getGainLossField === 'function' ? getGainLossField('investments') : 'gainLoss';
  if (savedField === glField) return; // don't re-trigger when gain/loss itself was saved

  const currentTotal = record[totalField];
  if (currentTotal == null) return;

  const all      = await dbGetAll('investments');
  const clientId = record.clientId || '';
  const sorted   = all
    .filter(r => r.date && (r.clientId === clientId || !r.clientId) && r[totalField] != null)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const idx  = sorted.findIndex(r => r.id === record.id);
  const prev = idx > 0 ? sorted[idx - 1] : null;
  const next = idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1] : null;

  // Update current record's gain/loss
  if (prev) {
    record[glField] = currentTotal - prev[totalField];
    await dbPut('investments', record);
  }

  // Update next record's gain/loss (its baseline just changed)
  if (next) {
    next[glField] = next[totalField] - currentTotal;
    await dbPut('investments', next);
  }
}

// ─────────────────────────────────────────────────────────────────
// HELPER
// ─────────────────────────────────────────────────────────────────

function _esc(s) {
  return String(s).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
