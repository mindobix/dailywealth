/* ── importcsv.js ── Generic CSV Import ──────────────────────────────
 *
 * Completely standalone CSV importer with named import types.
 * Stores: csvImportTypes, csvRecords
 * ─────────────────────────────────────────────────────────────────── */

// ── State ─────────────────────────────────────────────────────────────
let _icTypes      = [];
let _icActiveType = null;
let _icRecords    = [];
let _icPage       = 1;
let _icSortField  = 'date';
let _icSortDir    = 'desc';
const _IC_PAGE_SIZE = 100;

// type-modal state
let _icModalHeaders = [];

// import-modal state
let _icImportTypeId = null;
let _icImportRows   = [];

// ── Helpers ──────────────────────────────────────────────────────────
function _icEsc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function _icEscAttr(s) {
  return String(s ?? '').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
function _icUid() { return Math.random().toString(36).slice(2, 10); }

function _icFmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${+m}/${+d}/${y}`;
}
function _icFmtCur(v) {
  if (v === null || v === undefined) return '';
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// ── DB wrappers ──────────────────────────────────────────────────────
async function _icLoadTypes() {
  const all = await dbGetAll('csvImportTypes');
  return all
    .filter(t => t.clientId === getActiveClientId())
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}
async function _icSaveType(t)    { return dbPut('csvImportTypes', t); }
async function _icDeleteType(id) { return dbDelete('csvImportTypes', id); }

async function _icLoadRecords(typeId) {
  const all = await dbGetAll('csvRecords');
  return all.filter(r => r.typeId === typeId && r.clientId === getActiveClientId());
}
async function _icSaveRecord(r)    { return dbPut('csvRecords', r); }
async function _icDeleteByType(typeId) {
  const all  = await dbGetAll('csvRecords');
  const hits = all.filter(r => r.typeId === typeId && r.clientId === getActiveClientId());
  for (const r of hits) await dbDelete('csvRecords', r.id);
}

// ── CSV Parser ───────────────────────────────────────────────────────
function _icParseCsv(text) {
  const rows  = [];
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (c === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    cols.push(cur.trim());
    rows.push(cols);
  }
  return rows;
}

// ── Tab accounts ─────────────────────────────────────────────────────
async function _icTabAccounts(tab) {
  const all = await getAccounts();
  return all
    .filter(a => a.clientId === getActiveClientId() && a.tab === tab)
    .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));
}

// ── Entry point ──────────────────────────────────────────────────────
async function initCsvImportView() {
  _icTypes      = await _icLoadTypes();
  _icActiveType = null;
  _icRecords    = [];
  _renderIcBody();
}

function _renderIcBody() {
  if (_icActiveType) _renderIcRecordsView();
  else               _renderIcTypesView();
}

// ── Types list ───────────────────────────────────────────────────────
function _renderIcTypesView() {
  const body = document.getElementById('ic-body');
  if (!body) return;
  const n = _icTypes.length;

  body.innerHTML = `
    <div class="ic-toolbar">
      <button class="ic-new-btn" onclick="openIcTypeModal(null)">+ New Import Type</button>
      <span class="ic-count"><strong>${n}</strong> import type${n !== 1 ? 's' : ''}</span>
    </div>
    ${n === 0
      ? `<div class="ic-empty">No import types yet — create one to get started.</div>`
      : `<div class="ic-table-wrap">
          <table class="ic-types-table">
            <thead><tr>
              <th>Name</th><th>Tab</th><th>Date Column</th><th>Columns Mapped</th><th></th>
            </tr></thead>
            <tbody>
              ${_icTypes.map(t => `
                <tr>
                  <td class="ic-type-name">${_icEsc(t.name)}</td>
                  <td>${t.tab === '529' ? '529 Plans' : t.tab === 'kids' ? 'Kids' : 'Investments'}</td>
                  <td class="ic-mono">${_icEsc(t.dateColumn)}</td>
                  <td>${t.mappings.filter(m => m.accountField).length}</td>
                  <td class="ic-type-actions">
                    <button class="ic-btn ic-btn-import" onclick="openIcImportModal('${_icEscAttr(t.id)}')">Import</button>
                    <button class="ic-btn ic-btn-view"   onclick="icViewRecords('${_icEscAttr(t.id)}')">View</button>
                    <button class="ic-btn ic-btn-edit"   onclick="openIcTypeModal('${_icEscAttr(t.id)}')">Edit</button>
                    <button class="ic-btn ic-btn-del"    onclick="deleteIcType('${_icEscAttr(t.id)}')">Delete</button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`}`;
}

// ── Records view ──────────────────────────────────────────────────────
async function icViewRecords(typeId) {
  _icActiveType = _icTypes.find(t => t.id === typeId) || null;
  if (!_icActiveType) return;
  _icRecords   = await _icLoadRecords(typeId);
  _icPage      = 1;
  _icSortField = 'date';
  _icSortDir   = 'desc';
  _renderIcRecordsView();
}

function _renderIcRecordsView() {
  const body = document.getElementById('ic-body');
  if (!body || !_icActiveType) return;
  const t = _icActiveType;
  const mappedCols = t.mappings.filter(m => m.accountField && m.csvHeader !== t.dateColumn);

  const sorted = [..._icRecords].sort((a, b) => {
    const va = a[_icSortField] ?? '';
    const vb = b[_icSortField] ?? '';
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return _icSortDir === 'asc' ? cmp : -cmp;
  });

  const total      = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / _IC_PAGE_SIZE));
  _icPage = Math.min(_icPage, totalPages);
  const paged = sorted.slice((_icPage - 1) * _IC_PAGE_SIZE, _icPage * _IC_PAGE_SIZE);

  const th = (field, label) => {
    const active = _icSortField === field;
    const arrow  = active ? (_icSortDir === 'asc' ? ' ↑' : ' ↓') : '';
    return `<th class="ic-th-sort${active ? ' ic-th-active' : ''}" onclick="icSortBy('${field}')">${_icEsc(label)}${arrow}</th>`;
  };

  body.innerHTML = `
    <div class="ic-toolbar">
      <button class="ic-back-btn" onclick="icBackToTypes()">← Back</button>
      <span class="ic-view-title">${_icEsc(t.name)}</span>
      <span class="ic-count"><strong>${total}</strong> record${total !== 1 ? 's' : ''}</span>
      <button class="ic-new-btn" onclick="openIcImportModal('${_icEscAttr(t.id)}')">Import More</button>
    </div>
    ${total === 0
      ? `<div class="ic-empty">No records yet — click "Import More" to upload a CSV.</div>`
      : `<div class="ic-table-wrap">
          <table class="ic-data-table">
            <thead><tr>
              <th class="ic-rn">#</th>
              ${th('date', 'Date')}
              ${mappedCols.map(m => th(m.accountField, m.label || m.csvHeader)).join('')}
              <th></th>
            </tr></thead>
            <tbody>
              ${paged.map((r, i) => `
                <tr>
                  <td class="ic-rn">${(_icPage - 1) * _IC_PAGE_SIZE + i + 1}</td>
                  <td class="ic-date">${_icEsc(_icFmtDate(r.date))}</td>
                  ${mappedCols.map(m => `<td class="ic-num">${_icEsc(_icFmtCur(r[m.accountField]))}</td>`).join('')}
                  <td><button class="ic-row-del" onclick="deleteIcRecord('${_icEscAttr(r.id)}')">✕</button></td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        ${_icBuildPagination(total, totalPages)}`}`;
}

function _icBuildPagination(total, totalPages) {
  if (totalPages <= 1) return '';
  const page  = _icPage;
  const start = (page - 1) * _IC_PAGE_SIZE + 1;
  const end   = Math.min(page * _IC_PAGE_SIZE, total);
  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - 2 && i <= page + 2)) pages.push(i);
    else if (pages[pages.length - 1] !== '…') pages.push('…');
  }
  return `<div class="ic-pagination">
    <button class="ic-pg-nav" onclick="icGoToPage(${page - 1})" ${page === 1 ? 'disabled' : ''}>← Prev</button>
    <div class="ic-pg-pages">${pages.map(p =>
      p === '…'
        ? `<span class="ic-pg-ellipsis">…</span>`
        : `<button class="ic-pg-btn${p === page ? ' active' : ''}" onclick="icGoToPage(${p})">${p}</button>`
    ).join('')}</div>
    <button class="ic-pg-nav" onclick="icGoToPage(${page + 1})" ${page === totalPages ? 'disabled' : ''}>Next →</button>
    <span class="ic-pg-info">Showing ${start}–${end} of ${total.toLocaleString()}</span>
  </div>`;
}

function icGoToPage(p) {
  const tp = Math.max(1, Math.ceil(_icRecords.length / _IC_PAGE_SIZE));
  if (p < 1 || p > tp) return;
  _icPage = p;
  _renderIcRecordsView();
}

function icSortBy(field) {
  if (_icSortField === field) _icSortDir = _icSortDir === 'asc' ? 'desc' : 'asc';
  else { _icSortField = field; _icSortDir = 'desc'; }
  _icPage = 1;
  _renderIcRecordsView();
}

function icBackToTypes() {
  _icActiveType = null;
  _icRecords    = [];
  _renderIcTypesView();
}

async function deleteIcRecord(id) {
  if (!confirm('Delete this record?')) return;
  await dbDelete('csvRecords', id);
  _icRecords = _icRecords.filter(r => r.id !== id);
  _renderIcRecordsView();
}

// ── Type modal ────────────────────────────────────────────────────────
function openIcTypeModal(id) {
  const t = id ? _icTypes.find(x => x.id === id) : null;
  document.getElementById('ic-tmodal-title').textContent = t ? 'Edit Import Type' : 'New Import Type';
  document.getElementById('ic-tmodal-id').value   = t?.id   || '';
  document.getElementById('ic-tmodal-name').value = t?.name || '';
  document.getElementById('ic-tmodal-tab').value  = t?.tab  || 'investments';
  document.getElementById('ic-tmodal-file').value = '';
  _icModalHeaders = [];

  const section = document.getElementById('ic-tmodal-mapping');
  if (t?.mappings?.length) {
    _icModalHeaders = t.mappings.map(m => m.csvHeader);
    _renderIcMappingRows(t.tab, t.mappings, t.dateColumn);
  } else {
    section.innerHTML = '<p class="ic-map-hint">Upload a sample CSV to configure column mappings.</p>';
  }

  document.getElementById('ic-type-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('ic-tmodal-name').focus(), 40);
}

function closeIcTypeModal() {
  document.getElementById('ic-type-modal').style.display = 'none';
  _icModalHeaders = [];
}

function onIcTypeFileChange(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    const rows = _icParseCsv(e.target.result);
    if (!rows.length) return;
    _icModalHeaders = rows[0];
    const tab = document.getElementById('ic-tmodal-tab').value;
    await _renderIcMappingRows(tab, null, null);
  };
  reader.readAsText(file);
}

async function onIcTabChange() {
  if (_icModalHeaders.length) {
    const tab = document.getElementById('ic-tmodal-tab').value;
    await _renderIcMappingRows(tab, null, null);
  }
}

async function _renderIcMappingRows(tab, existingMappings, existingDateCol) {
  const section = document.getElementById('ic-tmodal-mapping');
  if (!_icModalHeaders.length) {
    section.innerHTML = '<p class="ic-map-hint">Upload a sample CSV to configure column mappings.</p>';
    return;
  }

  const tabAccounts = await _icTabAccounts(tab);

  const rows = _icModalHeaders.map((h, i) => {
    const existing = existingMappings?.find(m => m.csvHeader === h);
    const isDate   = existingDateCol === h ||
                     (!existingMappings && (h.toLowerCase().includes('date') || i === 0));
    const acctOpts = tabAccounts.map(a =>
      `<option value="${_icEscAttr(a.field)}"${existing?.accountField === a.field ? ' selected' : ''}>${_icEsc(a.name || a.field)}</option>`
    ).join('');
    return `
      <tr>
        <td class="ic-map-col">${_icEsc(h)}</td>
        <td>
          <select class="ic-map-sel" data-header="${_icEscAttr(h)}">
            <option value=""${!existing?.accountField && !isDate ? ' selected' : ''}>— Skip —</option>
            <option value="__date__"${isDate ? ' selected' : ''}>Date (required)</option>
            ${acctOpts}
          </select>
        </td>
        <td>
          <input class="ic-map-label" type="text" placeholder="Display label (optional)"
                 value="${_icEsc(existing?.label || '')}" data-header="${_icEscAttr(h)}">
        </td>
      </tr>`;
  }).join('');

  section.innerHTML = `
    <table class="ic-map-table">
      <thead><tr><th>CSV Column</th><th>Maps to Account</th><th>Display Label</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function saveIcTypeModal() {
  const existingId = document.getElementById('ic-tmodal-id').value;
  const id   = existingId || ('ictype_' + _icUid());
  const name = document.getElementById('ic-tmodal-name').value.trim();
  const tab  = document.getElementById('ic-tmodal-tab').value;

  if (!name) { document.getElementById('ic-tmodal-name').focus(); return; }
  if (!_icModalHeaders.length) { alert('Upload a CSV file first to configure column mappings.'); return; }

  const selects = [...document.querySelectorAll('#ic-tmodal-mapping .ic-map-sel')];
  const labels  = [...document.querySelectorAll('#ic-tmodal-mapping .ic-map-label')];

  let dateColumn = null;
  const mappings = selects.map((sel, i) => {
    const csvHeader = sel.dataset.header;
    const val       = sel.value;
    const label     = labels[i]?.value.trim() || '';
    if (val === '__date__') { dateColumn = csvHeader; return { csvHeader, accountField: null, label }; }
    return { csvHeader, accountField: val || null, label };
  });

  if (!dateColumn)                              { alert('Please designate one column as "Date (required)".'); return; }
  if (!mappings.some(m => m.accountField))      { alert('Please map at least one column to an account.'); return; }

  const existing = _icTypes.find(t => t.id === id);
  await _icSaveType({
    id, name, tab, dateColumn, mappings,
    clientId:  getActiveClientId(),
    createdAt: existing?.createdAt || Date.now(),
  });

  _icTypes = await _icLoadTypes();
  closeIcTypeModal();
  _renderIcTypesView();
}

async function deleteIcType(id) {
  if (!confirm('Delete this import type and all its records?')) return;
  await _icDeleteType(id);
  await _icDeleteByType(id);
  _icTypes = _icTypes.filter(t => t.id !== id);
  if (_icActiveType?.id === id) { _icActiveType = null; _icRecords = []; }
  _renderIcTypesView();
}

// ── Import modal ──────────────────────────────────────────────────────
function openIcImportModal(typeId) {
  const t = _icTypes.find(x => x.id === typeId);
  if (!t) return;
  _icImportTypeId = typeId;
  _icImportRows   = [];
  document.getElementById('ic-imodal-title').textContent = `Import — ${t.name}`;
  document.getElementById('ic-imodal-file').value        = '';
  document.getElementById('ic-imodal-preview').innerHTML = '';
  document.getElementById('ic-imodal-status').textContent = '';
  const btn = document.getElementById('ic-imodal-run-btn');
  if (btn) { btn.disabled = true; }
  document.getElementById('ic-import-modal').style.display = 'flex';
}

function closeIcImportModal() {
  document.getElementById('ic-import-modal').style.display = 'none';
  _icImportTypeId = null;
  _icImportRows   = [];
}

function onIcImportFileChange(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const rows = _icParseCsv(e.target.result);
    if (rows.length < 2) {
      document.getElementById('ic-imodal-status').textContent = 'File appears empty.';
      return;
    }
    _icImportRows = rows;
    _renderIcImportPreview(rows);
    const btn = document.getElementById('ic-imodal-run-btn');
    if (btn) btn.disabled = false;
  };
  reader.readAsText(file);
}

function _renderIcImportPreview(rows) {
  const headers  = rows[0];
  const dataRows = rows.slice(1).filter(r => r.some(c => c.trim()));
  document.getElementById('ic-imodal-status').textContent = `${dataRows.length} data rows found.`;
  const preview = dataRows.slice(0, 5);
  document.getElementById('ic-imodal-preview').innerHTML = `
    <div class="ic-preview-wrap">
      <table class="ic-preview-table">
        <thead><tr>${headers.map(h => `<th>${_icEsc(h)}</th>`).join('')}</tr></thead>
        <tbody>
          ${preview.map(r => `<tr>${r.map(c => `<td>${_icEsc(c)}</td>`).join('')}</tr>`).join('')}
          ${dataRows.length > 5
            ? `<tr><td colspan="${headers.length}" class="ic-preview-more">… and ${dataRows.length - 5} more rows</td></tr>`
            : ''}
        </tbody>
      </table>
    </div>`;
}

async function runIcImport() {
  if (!_icImportRows.length || !_icImportTypeId) return;
  const t = _icTypes.find(x => x.id === _icImportTypeId);
  if (!t) return;

  const btn = document.getElementById('ic-imodal-run-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Importing…'; }

  const headers  = _icImportRows[0];
  const dataRows = _icImportRows.slice(1).filter(r => r.some(c => c.trim()));
  const hIdx     = {};
  headers.forEach((h, i) => hIdx[h] = i);

  const clientId    = getActiveClientId();
  const importRunId = 'icrun_' + _icUid();
  let imported = 0;

  for (const row of dataRows) {
    const dateRaw = row[hIdx[t.dateColumn]];
    if (!dateRaw?.trim()) continue;

    let dateIso = null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateRaw.trim())) {
      dateIso = dateRaw.trim();
    } else {
      const parts = dateRaw.trim().split('/');
      if (parts.length === 3) {
        const [m, d, y] = parts;
        dateIso = `${y.padStart(4, '0')}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
      }
    }
    if (!dateIso) continue;

    const record = { id: `icr_${t.id}_${dateIso}`, typeId: t.id, clientId, importRunId, date: dateIso };
    for (const mapping of t.mappings) {
      if (!mapping.accountField || mapping.csvHeader === t.dateColumn) continue;
      const idx = hIdx[mapping.csvHeader];
      if (idx === undefined) continue;
      const raw = row[idx]?.replace(/[$,\s]/g, '').trim();
      const n   = parseFloat(raw);
      record[mapping.accountField] = isNaN(n) ? null : n;
    }
    await _icSaveRecord(record);
    imported++;
  }

  document.getElementById('ic-imodal-status').textContent = `✓ Imported ${imported} records.`;
  if (btn) { btn.disabled = false; btn.textContent = 'Import'; }

  if (_icActiveType?.id === t.id) {
    _icRecords = await _icLoadRecords(t.id);
    _renderIcRecordsView();
  }

  setTimeout(() => closeIcImportModal(), 1400);
}
