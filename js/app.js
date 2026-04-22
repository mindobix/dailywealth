/* ── app.js ── Application entry point ─────────────────────────
 *
 * Handles: version display, view routing, app initialisation.
 * Loaded last so all other scripts are already defined.
 * ─────────────────────────────────────────────────────────────── */

const APP_VERSION = '1.1.0';

const state = { view: 'dashboard' };

// ── Column definitions cache (loaded from IndexedDB by initColDefs) ──
let _colDefs = {};

function getColsForFormat(format) {
  return _colDefs[format] || [];
}

// ── View switching ────────────────────────────────────────────────

function switchView(v) {
  state.view = v;

  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('nav-' + v)?.classList.add('active');

  document.querySelectorAll('.view').forEach(el => el.style.display = 'none');
  const viewEl = document.getElementById('view-' + v);
  if (viewEl) viewEl.style.display = 'block';

  if (v === 'dashboard')   initDashboardView();
  if (v === 'investments') initInvestmentsView();
  if (v === '529')         initPlans529View();
  if (v === 'kids')        initKidsView();
  if (v === 'accounting')  initAccountingView();
  if (v === 'clients')     initClientsView();
  if (v === 'accounts')    initAccountsView();
  if (v === 'importcsv')   initCsvImportView();
}

// ── Init ──────────────────────────────────────────────────────────

async function init() {
  document.getElementById('app-version').textContent = 'v' + APP_VERSION;

  await _openDwDb();
  await initColDefs();
  await initClients();
  await initAccounts();
  await initComputeds();
  switchView('dashboard');
}

// ── Column definitions: read from IndexedDB ──────────────────────

async function initColDefs() {
  const all      = await dbGetAll('importTypes');
  const byFormat = {};
  for (const r of all) if (r.format && r.cols) byFormat[r.format] = r.cols;

  _colDefs = byFormat;
}

document.addEventListener('DOMContentLoaded', init);

// ── Data dropdown ─────────────────────────────────────────────────

function toggleDataDropdown(e) {
  e.stopPropagation();
  const menu = document.getElementById('data-dropdown-menu');
  const btn  = document.getElementById('data-dropdown-toggle');
  const open = menu.classList.toggle('open');
  btn.classList.toggle('active', open);
}

function closeDataDropdown() {
  document.getElementById('data-dropdown-menu').classList.remove('open');
  document.getElementById('data-dropdown-toggle').classList.remove('active');
}

document.addEventListener('click', e => {
  const dd = document.getElementById('data-dropdown');
  if (dd && !dd.contains(e.target)) closeDataDropdown();
});

// ── Backup ────────────────────────────────────────────────────────

async function backupData() {
  const [investments, plans529, kids, importHistory, clients, importTypes,
         accounts, computedFields, csvImportTypes, csvRecords, accountingEntries] = await Promise.all([
    dbGetAll('investments'),
    dbGetAll('plans529'),
    dbGetAll('kids'),
    dbGetAll('importHistory'),
    dbGetAll('clients'),
    dbGetAll('importTypes'),
    dbGetAll('accounts'),
    dbGetAll('computedFields'),
    dbGetAll('csvImportTypes'),
    dbGetAll('csvRecords'),
    dbGetAll('accountingEntries'),
  ]);

  const backup = {
    version:    1,
    exportedAt: new Date().toISOString(),
    investments,
    plans529,
    kids,
    importHistory,
    clients,
    importTypes,
    accounts,
    computedFields,
    csvImportTypes,
    csvRecords,
    accountingEntries,
  };

  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `dailywealth-backup-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Restore ───────────────────────────────────────────────────────

async function restoreData(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async e => {
    let backup;
    try {
      backup = JSON.parse(e.target.result);
    } catch {
      alert('Restore failed: file is not valid JSON.');
      event.target.value = '';
      return;
    }

    const stores = ['investments', 'plans529', 'kids', 'importHistory', 'clients',
                    'importTypes', 'accounts', 'computedFields', 'csvImportTypes', 'csvRecords', 'accountingEntries'];

    const hasAny = stores.some(s => Array.isArray(backup[s]) && backup[s].length > 0);
    if (!hasAny) {
      alert('Restore failed: unrecognised backup format.');
      event.target.value = '';
      return;
    }

    const inv = await dbGetAll('investments');
    if (inv.length || (await dbGetAll('clients')).length > 1) {
      if (!confirm('Restore will merge this backup into your current data. Backup entries win on any conflicts. Continue?')) {
        event.target.value = '';
        return;
      }
    }

    for (const store of stores) {
      const records = backup[store];
      if (Array.isArray(records) && records.length) {
        await dbPutBatch(store, records);
      }
    }

    // Clear prepopulation flags so accounts re-check after restore
    Object.keys(localStorage)
      .filter(k => k.startsWith('dw-accounts-prepopulated'))
      .forEach(k => localStorage.removeItem(k));

    alert('Restore complete. The app will now reload.');
    location.reload();
  };
  reader.readAsText(file);
}
