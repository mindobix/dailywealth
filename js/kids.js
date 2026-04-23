/* ── kids.js ── Kids tab ────────────────────────────────────────
 *
 * Editable, filterable, sortable, paginated grid of kids portfolio
 * snapshots. Column definitions loaded from IndexedDB (kids format).
 * ─────────────────────────────────────────────────────────────── */

let kidPage     = 1;
let kidPageSize = 100;
let kidSortFld  = 'date';
let kidSortDir  = 'desc';
let _kidCols    = [];

let _kidListenerReady = false;

// ─────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────

async function initKidsView() {
  if (!_kidListenerReady) {
    document.getElementById('kid-month').innerHTML = MONTH_OPTIONS;

    document.getElementById('kid-body').addEventListener('click', e => {
      const td = e.target.closest('td[data-field]');
      if (td) startCellEdit(td);
    });
    _kidListenerReady = true;
  }

  await _kidPopulateYears();
  await renderKidsGrid();
}

async function _kidPopulateYears() {
  const records = await getInvestments();
  const years   = [...new Set(records.map(r => r.date?.slice(0, 4)).filter(Boolean))].sort().reverse();
  const sel     = document.getElementById('kid-year');
  const cur     = sel.value;
  sel.innerHTML = '<option value="">All years</option>' +
    years.map(y => `<option value="${y}"${y === cur ? ' selected' : ''}>${y}</option>`).join('');
}

// ─────────────────────────────────────────────────────────────────
// RENDER
// ─────────────────────────────────────────────────────────────────

async function renderKidsGrid() {
  if (_activeTd) return;
  // Kids data lives in the investments store — Kids is a filtered column view
  let records = await getInvestments();

  const search = document.getElementById('kid-search').value.trim().toLowerCase();
  const year   = document.getElementById('kid-year').value;
  const month  = document.getElementById('kid-month').value;

  const activeClientId = getActiveClientId();
  if (activeClientId) records = records.filter(r => r.clientId === activeClientId || (!isMultiClient() && !r.clientId));

  if (year)   records = records.filter(r => r.date?.startsWith(year));
  if (month)  records = records.filter(r => r.date?.slice(5, 7) === month);
  if (search) records = records.filter(r =>
    (r.date || '').includes(search) ||
    gFmtDate(r.date || '')?.toLowerCase().includes(search)
  );

  // Derive columns from the investments importType, then filter to only kids-tab accounts.
  // Kids account fields are columns in the shared investments importType records.
  const _stdInvFields       = new Set(getColsForFormat('investments').map(c => c.field));
  const _familyInvExclusive = getColsForFormat('investments_family').map(c => c.field).filter(f => !_stdInvFields.has(f));
  const _fmt = records.find(r => r.format)?.format
    || (_familyInvExclusive.length && records.some(r => _familyInvExclusive.some(f => r[f] != null)) ? 'investments_family' : 'investments');
  const _rawCols = getColsForFormat(_fmt === 'investments_family' ? 'investments_family' : 'investments')
    .filter(col => col.field !== 'weeklyDate')
    .filter(col => {
      if (col.type === 'date') return true;           // always keep date column
      const a = getAccountByField(col.field, 'kids');
      return !!a && !a.hidden;
    });
  _kidCols = typeof getOrderedColsForTab === 'function'
    ? getOrderedColsForTab(_rawCols, 'kids')
    : _rawCols.concat(typeof getComputedColsForTab === 'function' ? getComputedColsForTab('kids') : []);

  records = sortRecords(records, kidSortFld, kidSortDir);

  const total      = records.length;
  const totalPages = Math.max(1, Math.ceil(total / kidPageSize));
  if (kidPage > totalPages) kidPage = totalPages;

  document.getElementById('kid-count').innerHTML =
    `<strong>${total.toLocaleString()}</strong> record${total !== 1 ? 's' : ''}`;

  const pgHTML = buildGridPagination(kidPage, kidPageSize, total, totalPages, 'kid');
  document.getElementById('kid-pg-top').innerHTML = pgHTML;
  document.getElementById('kid-pg-bot').innerHTML = pgHTML;

  const offset = (kidPage - 1) * kidPageSize;
  const paged  = records.slice(offset, offset + kidPageSize);

  document.getElementById('kid-thead').innerHTML = _kidHeader();

  const tbody = document.getElementById('kid-body');
  if (!total) {
    tbody.innerHTML = `<tr class="grid-empty-row"><td colspan="${_kidCols.length + 2}">No kids records yet. Use the <strong>Import</strong> tab to load your CSV.</td></tr>`;
    return;
  }

  tbody.innerHTML = paged.map((rec, i) => _kidRow(rec, offset + i)).join('');
}

// ─────────────────────────────────────────────────────────────────
// HEADER
// ─────────────────────────────────────────────────────────────────

function _kidHeader() {
  const sortCls = f => {
    if (kidSortFld !== f) return '';
    return kidSortDir === 'asc' ? ' sort-asc' : ' sort-desc';
  };

  let html = `<tr><th class="col-rn no-sort">#</th>`;

  _kidCols.forEach((col) => {
    const stickyClass = col.type === 'date' ? ' col-date-sticky' : '';
    const numClass    = (col.type === 'currency' || col.type === 'pct') ? ' col-num' : '';
    const compCls     = col.isComputed ? ' col-computed' : '';
    const thLabel     = col.isComputed ? _kidEsc(col.header) : getColumnHeader(col.field, 'kids', col.header);
    html += `<th class="${sortCls(col.field)}${stickyClass}${numClass}${compCls}" onclick="kidSortBy('${col.field}')">${thLabel}</th>`;
  });

  html += `<th class="col-actions no-sort"></th></tr>`;
  return html;
}

// ─────────────────────────────────────────────────────────────────
// ROW
// ─────────────────────────────────────────────────────────────────

function _kidRow(rec, globalIdx) {
  let html = `<tr data-id="${rec.id}">`;
  html += `<td class="col-rn">${globalIdx + 1}</td>`;

  _kidCols.forEach((col) => {
    const stickyClass = col.type === 'date' ? ' col-date-sticky' : '';

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
      if (col.gainLoss) cellCls += val > 0 ? ' val-pos' : val < 0 ? ' val-neg' : '';
    } else if (col.type === 'pct') {
      display = gFmtPct(val) || '—';
      cellCls = 'col-num' + (val > 0 ? ' val-pos' : val < 0 ? ' val-neg' : '');
    } else {
      display = String(val);
    }

    html += `<td class="${(cellCls + stickyClass).trim()}" ${rawAttr}>${display}</td>`;
  });

  html += `<td class="col-actions">
    <button class="del-row-btn" onclick="deleteKidRow('${_kidEsc(rec.id)}')" title="Delete row">✕</button>
  </td></tr>`;

  return html;
}

// ─────────────────────────────────────────────────────────────────
// SORT / PAGE
// ─────────────────────────────────────────────────────────────────

function kidSortBy(field) {
  kidSortDir = (kidSortFld === field && kidSortDir === 'desc') ? 'asc' : 'desc';
  kidSortFld = field;
  kidPage    = 1;
  renderKidsGrid();
}

function kidGoToPage(p)    { kidPage = p; renderKidsGrid(); }
function kidSetPageSize(n) { kidPageSize = n; kidPage = 1; renderKidsGrid(); }

// ─────────────────────────────────────────────────────────────────
// ADD ROW
// ─────────────────────────────────────────────────────────────────

async function addKidsRow() {
  const clientId = getActiveClientId();
  const today    = new Date().toLocaleDateString('en-CA');
  const id       = 'kid_new_' + uid();

  const allRecs = await dbGetAll('investments');
  const last    = allRecs
    .filter(r => r.clientId === clientId && r.date)
    .sort((a, b) => (a.date > b.date ? -1 : 1))[0];

  const SKIP = new Set(['id', 'date', 'importRunId', 'importTypeId', 'format', 'weeklyDate', 'pct']);
  const base = last
    ? Object.fromEntries(Object.entries(last).filter(([k]) => !SKIP.has(k)))
    : {};

  await dbPut('investments', { ...base, id, clientId, date: today });

  kidSortFld = 'date';
  kidSortDir = 'desc';
  kidPage    = 1;

  await _kidPopulateYears();
  await renderKidsGrid();
}

// ─────────────────────────────────────────────────────────────────
// DELETE ROW
// ─────────────────────────────────────────────────────────────────

async function deleteKidRow(id) {
  if (!confirm('Delete this row? This cannot be undone.')) return;
  await dbDelete('investments', id);
  await renderKidsGrid();
}

// ─────────────────────────────────────────────────────────────────
// HELPER
// ─────────────────────────────────────────────────────────────────

function _kidEsc(s) {
  return String(s).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
