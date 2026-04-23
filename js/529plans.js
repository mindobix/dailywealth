/* ── plans529view.js ── 529 Plans tab ──────────────────────────
 *
 * Editable, filterable, sortable, paginated grid of daily 529
 * plan snapshots. Column definitions loaded from IndexedDB.
 * ─────────────────────────────────────────────────────────────── */

let p529Page     = 1;
let p529PageSize = 100;
let p529SortFld  = 'date';
let p529SortDir  = 'desc';
let _p529Cols    = [];

let _p529ListenerReady = false;

// ─────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────

async function initPlans529View() {
  if (!_p529ListenerReady) {
    document.getElementById('p529-month').innerHTML = MONTH_OPTIONS;

    document.getElementById('p529-body').addEventListener('click', e => {
      const td = e.target.closest('td[data-field]');
      if (td) startCellEdit(td);
    });
    _p529ListenerReady = true;
  }

  await _p529PopulateYears();
  await renderPlans529Grid();
}

async function _p529PopulateYears() {
  const records = await getPlans529();
  const years   = [...new Set(records.map(r => r.date?.slice(0, 4)).filter(Boolean))].sort().reverse();
  const sel     = document.getElementById('p529-year');
  const cur     = sel.value;
  sel.innerHTML = '<option value="">All years</option>' +
    years.map(y => `<option value="${y}"${y === cur ? ' selected' : ''}>${y}</option>`).join('');
}

// ─────────────────────────────────────────────────────────────────
// RENDER
// ─────────────────────────────────────────────────────────────────

async function renderPlans529Grid() {
  if (_activeTd) return; // don't clobber an active inline edit
  let records = await getPlans529();

  // — Filters —
  const search = document.getElementById('p529-search').value.trim().toLowerCase();
  const year   = document.getElementById('p529-year').value;
  const month  = document.getElementById('p529-month').value;

  const activeClientId = getActiveClientId();
  if (activeClientId) records = records.filter(r => r.clientId === activeClientId || (!isMultiClient() && !r.clientId));

  if (year)   records = records.filter(r => r.date?.startsWith(year));
  if (month)  records = records.filter(r => r.date?.slice(5, 7) === month);
  if (search) records = records.filter(r =>
    (r.date || '').includes(search) ||
    gFmtDate(r.date || '')?.toLowerCase().includes(search)
  );

  // — Detect column format from data (family vs standard) —
  const _std529Fields = new Set(getColsForFormat('529').map(c => c.field));
  const _family529Exclusive = getColsForFormat('529_family').map(c => c.field).filter(f => !_std529Fields.has(f));
  const _fmt529 = records.find(r => r.format)?.format
    || (_family529Exclusive.length && records.some(r => _family529Exclusive.some(f => r[f] != null)) ? '529_family' : '529');
  const _rawCols529 = getColsForFormat(_fmt529 === '529_family' ? '529_family' : '529')
    .filter(col => { const a = getAccountByField(col.field, '529'); return !a || !a.hidden; });
  _p529Cols = typeof getOrderedColsForTab === 'function'
    ? getOrderedColsForTab(_rawCols529, '529')
    : _rawCols529.concat(typeof getComputedColsForTab === 'function' ? getComputedColsForTab('529') : []);

  // — Sort —
  records = sortRecords(records, p529SortFld, p529SortDir);

  const total      = records.length;
  const totalPages = Math.max(1, Math.ceil(total / p529PageSize));
  if (p529Page > totalPages) p529Page = totalPages;

  // Count badge
  document.getElementById('p529-count').innerHTML =
    `<strong>${total.toLocaleString()}</strong> record${total !== 1 ? 's' : ''}`;

  // Pagination
  const pgHTML = buildGridPagination(p529Page, p529PageSize, total, totalPages, 'p529');
  document.getElementById('p529-pg-top').innerHTML = pgHTML;
  document.getElementById('p529-pg-bot').innerHTML = pgHTML;

  // Page slice
  const offset = (p529Page - 1) * p529PageSize;
  const paged  = records.slice(offset, offset + p529PageSize);

  // Header
  document.getElementById('p529-thead').innerHTML = _p529Header();

  // Body
  const tbody = document.getElementById('p529-body');
  if (!total) {
    const span = _p529Cols.length + 2;
    tbody.innerHTML = `<tr class="grid-empty-row"><td colspan="${span}">No 529 plan records yet. Use the <strong>Import</strong> tab to load your Google Sheets CSV.</td></tr>`;
    return;
  }

  tbody.innerHTML = paged.map((rec, i) => _p529Row(rec, offset + i)).join('');
}

// ─────────────────────────────────────────────────────────────────
// HEADER
// ─────────────────────────────────────────────────────────────────

function _p529Header() {
  const sortCls = (f) => {
    if (p529SortFld !== f) return '';
    return p529SortDir === 'asc' ? ' sort-asc' : ' sort-desc';
  };

  let html = `<tr><th class="col-rn no-sort">#</th>`;

  _p529Cols.forEach((col, i) => {
    const isDateSticky = (i === 0); // Date is col 0 in 529
    const stickyClass  = isDateSticky ? ' col-date-sticky' : '';
    const numClass     = (col.type === 'currency' || col.type === 'pct') ? ' col-num' : '';
    const compCls = col.isComputed ? ' col-computed' : '';
    const thLabel = col.isComputed ? _cmpEscHtml(col.header) : getColumnHeader(col.field, '529', col.header);
    html += `<th class="${sortCls(col.field)}${stickyClass}${numClass}${compCls}" onclick="p529SortBy('${col.field}')">${thLabel}</th>`;
  });

  html += `<th class="col-actions no-sort"></th></tr>`;
  return html;
}

// ─────────────────────────────────────────────────────────────────
// ROW
// ─────────────────────────────────────────────────────────────────

function _p529Row(rec, globalIdx) {
  let html = `<tr data-id="${rec.id}">`;
  html += `<td class="col-rn">${globalIdx + 1}</td>`;

  _p529Cols.forEach((col, i) => {
    const isDateSticky = (i === 0);
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
      if (col.gainLoss)                  cellCls += val > 0 ? ' val-pos' : val < 0 ? ' val-neg' : '';
      else if (col.field === 'total529') cellCls += ' val-big';
    } else if (col.type === 'pct') {
      display = gFmtPct(val) || '—';
      cellCls = 'col-num' + (val > 0 ? ' val-pos' : val < 0 ? ' val-neg' : '');
    } else {
      display = String(val);
    }

    html += `<td class="${(cellCls + stickyClass).trim()}" ${rawAttr}>${display}</td>`;
  });

  html += `<td class="col-actions">
    <button class="del-row-btn" onclick="deletePlan529('${_esc529(rec.id)}')" title="Delete row">✕</button>
  </td></tr>`;

  return html;
}

// ─────────────────────────────────────────────────────────────────
// SORT / PAGE callbacks
// ─────────────────────────────────────────────────────────────────

function p529SortBy(field) {
  p529SortDir = (p529SortFld === field && p529SortDir === 'desc') ? 'asc' : 'desc';
  p529SortFld = field;
  p529Page    = 1;
  renderPlans529Grid();
}

function p529GoToPage(p)    { p529Page = p; renderPlans529Grid(); }
function p529SetPageSize(n)  { p529PageSize = n; p529Page = 1; renderPlans529Grid(); }

// ─────────────────────────────────────────────────────────────────
// ADD / DELETE
// ─────────────────────────────────────────────────────────────────

async function addPlan529Row() {
  const clientId = getActiveClientId();
  const today    = new Date().toLocaleDateString('en-CA');
  const id       = '529_new_' + uid();

  const allRecs = await dbGetAll('plans529');
  const last    = allRecs
    .filter(r => r.clientId === clientId && r.date)
    .sort((a, b) => (a.date > b.date ? -1 : 1))[0];

  const SKIP = new Set(['id', 'date', 'importRunId', 'importTypeId', 'format', 'weeklyDate', 'pct']);
  const base = last
    ? Object.fromEntries(Object.entries(last).filter(([k]) => !SKIP.has(k)))
    : {};

  await dbPut('plans529', { ...base, id, clientId, date: today });

  p529SortFld = 'date';
  p529SortDir = 'desc';
  p529Page    = 1;

  await _p529PopulateYears();
  await renderPlans529Grid();
}

async function deletePlan529(id) {
  if (!confirm('Delete this row? This cannot be undone.')) return;
  await dbDelete('plans529', id);
  await renderPlans529Grid();
}

function _esc529(s) {
  return String(s).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
