/* ── grid.js ── Shared grid helpers ─────────────────────────────
 *
 * Provides:
 *   buildGridPagination()  — pagination bar HTML
 *   startCellEdit()        — inline cell editing
 *   sortRecords()          — generic sort
 *   gFmt*                  — display formatters shared by both tabs
 * ─────────────────────────────────────────────────────────────── */

// ─────────────────────────────────────────────────────────────────
// PAGINATION
// prefix: function name prefix used by the tab (e.g. 'inv', 'p529')
// ─────────────────────────────────────────────────────────────────

function buildGridPagination(page, pageSize, total, totalPages, prefix) {
  if (total === 0) return '';

  const start = (page - 1) * pageSize + 1;
  const end   = Math.min(page * pageSize, total);

  // Windowed page list: first, last, current ±2, ellipsis
  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - 2 && i <= page + 2)) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== '…') {
      pages.push('…');
    }
  }

  const pageButtons = pages.map(p =>
    p === '…'
      ? `<span class="gpg-ellipsis">…</span>`
      : `<button class="gpg-page${p === page ? ' active' : ''}" onclick="${prefix}GoToPage(${p})">${p}</button>`
  ).join('');

  const sizeButtons = [50, 100, 200, 250].map(n =>
    `<button class="gpg-size${n === pageSize ? ' active' : ''}" onclick="${prefix}SetPageSize(${n})">${n}</button>`
  ).join('');

  return `<div class="grid-pagination">
    <div class="gpg-left">
      <button class="gpg-nav" onclick="${prefix}GoToPage(${page - 1})" ${page === 1 ? 'disabled' : ''}>&#8592; Prev</button>
      <div class="gpg-pages">${pageButtons}</div>
      <button class="gpg-nav" onclick="${prefix}GoToPage(${page + 1})" ${page === totalPages ? 'disabled' : ''}>Next &#8594;</button>
    </div>
    <div class="gpg-right">
      <span class="gpg-info">Showing <strong>${start}–${end}</strong> of <strong>${total.toLocaleString()}</strong></span>
      <div class="gpg-sizes">
        <span class="gpg-size-label">Per page:</span>
        ${sizeButtons}
      </div>
    </div>
  </div>`;
}

// ─────────────────────────────────────────────────────────────────
// INLINE CELL EDIT
// ─────────────────────────────────────────────────────────────────

let _activeTd   = null;
let _cancelFlag = false; // set true on Escape before blur fires

function startCellEdit(td) {
  if (_activeTd) _commitOrCancel();   // flush any open edit first
  _cancelFlag = false;

  const type   = td.dataset.type;
  const rawVal = td.dataset.raw;

  _activeTd         = td;
  td._savedHTML     = td.innerHTML;
  td.classList.add('editing');

  // Build the right input type
  const input = document.createElement('input');
  input.className = (type === 'date') ? 'cell-input text-input' : 'cell-input';

  if (type === 'date') {
    input.type  = 'date';
    input.value = (rawVal && rawVal !== 'null') ? rawVal : '';
  } else {
    input.type  = 'number';
    input.step  = 'any';
    input.value = (rawVal && rawVal !== 'null') ? rawVal : '';
  }

  if (type !== 'date') {
    const tdInnerWidth = Math.max(td.clientWidth - 8, 125);
    input.style.width = tdInnerWidth + 'px';
    input.style.boxSizing = 'border-box';
    input.style.minWidth = '0';
  }

  td.innerHTML = '';
  td.appendChild(input);

  requestAnimationFrame(() => { input.focus(); input.select(); });

  // Prevent calendar icon click from bubbling to td and re-triggering startCellEdit
  input.addEventListener('click', e => e.stopPropagation());
  input.addEventListener('wheel', e => e.preventDefault(), { passive: false });

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { _cancelFlag = true; input.blur(); }
  });

  input.addEventListener('blur', () => _commitOrCancel());
}

function _commitOrCancel() {
  if (!_activeTd) return;
  const td = _activeTd;
  _activeTd = null;
  td.classList.remove('editing');

  if (_cancelFlag) {
    _cancelFlag = false;
    td.innerHTML = td._savedHTML;
    return;
  }

  const input     = td.querySelector('input');
  if (!input) { td.innerHTML = td._savedHTML; return; }

  const rawInput  = input.value.trim();
  const type      = td.dataset.type;
  const field     = td.dataset.field;
  const recId     = td.closest('tr').dataset.id;
  const storeName = td.querySelector ? (td.closest('[data-store]')?.dataset.store) : null;

  // Parse typed value
  let newVal;
  if (type === 'date') {
    newVal = rawInput || null;
  } else {
    const n = parseFloat(rawInput);
    newVal = isNaN(n) ? null : n;
  }

  // Optimistic render with new value so cell doesn't flash old content
  td.dataset.raw = newVal ?? 'null';
  if (type === 'date') {
    td.innerHTML = newVal ? gFmtDate(newVal) : '';
  } else {
    td.innerHTML = td._savedHTML; // number cells re-render fast via _saveCellChange
  }

  _saveCellChange(storeName, recId, field, newVal, type).catch(err => {
    console.error('Cell save error:', err);
  });
}

async function _saveCellChange(storeName, recId, field, newVal, type) {
  const record = await dbGet(storeName, recId);
  if (!record) return;

  if (field === 'date' && type === 'date' && newVal && newVal !== record.date) {
    // Date field changed: ID must change too
    const prefix = storeName === 'investments' ? 'inv_' : '529_';
    const baseId = prefix + newVal;
    if (baseId !== record.id) {
      const clash = await dbGet(storeName, baseId);
      if (clash && clash.clientId === record.clientId) {
        alert(`A record for ${newVal} already exists.`); return;
      }
      await dbDelete(storeName, record.id);
      // If a different client owns baseId, append clientId to keep IDs unique
      record.id = clash ? baseId + '_' + record.clientId : baseId;
    }
    record.date = newVal;
  } else {
    record[field] = newVal;
  }

  await dbPut(storeName, record);

  // Auto-compute gain/loss when total field changes (investments only)
  if (storeName === 'investments' && typeof _autoComputeGainLoss === 'function') {
    await _autoComputeGainLoss(record, field).catch(() => {});
  }

  // Re-render the relevant tab(s)
  if (storeName === 'investments') {
    renderInvestmentsGrid();
    if (typeof renderKidsGrid === 'function') renderKidsGrid();
  } else {
    renderPlans529Grid();
  }
}

// ─────────────────────────────────────────────────────────────────
// SORT
// ─────────────────────────────────────────────────────────────────

function sortRecords(records, field, dir) {
  return [...records].sort((a, b) => {
    const va = a[field] ?? '';
    const vb = b[field] ?? '';
    let cmp = 0;
    if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
    else if (va < vb) cmp = -1;
    else if (va > vb) cmp =  1;
    return dir === 'asc' ? cmp : -cmp;
  });
}

// ─────────────────────────────────────────────────────────────────
// DISPLAY FORMATTERS  (grid-specific, short format)
// ─────────────────────────────────────────────────────────────────

function gFmtCurrency(n) {
  if (n === null || n === undefined) return null;
  // Compact: no cents, just $1,234 or -$1,234
  return n.toLocaleString('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  });
}

function gFmtPct(n) {
  if (n === null || n === undefined) return null;
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

function gFmtDate(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return `${m}/${d}/${y}`;
}

// ─────────────────────────────────────────────────────────────────
// MONTH OPTIONS HTML  (shared by both toolbar selects)
// ─────────────────────────────────────────────────────────────────

const MONTH_OPTIONS = `<option value="">All months</option>
  <option value="01">January</option><option value="02">February</option>
  <option value="03">March</option><option value="04">April</option>
  <option value="05">May</option><option value="06">June</option>
  <option value="07">July</option><option value="08">August</option>
  <option value="09">September</option><option value="10">October</option>
  <option value="11">November</option><option value="12">December</option>`;
