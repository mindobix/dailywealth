/* ── storage.js ── Domain-level storage functions ──────────────
 *
 * Thin wrappers over the raw IndexedDB helpers in db.js.
 * All public functions are async and return Promises.
 * ─────────────────────────────────────────────────────────────── */

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Investments ───────────────────────────────────────────────────

function getInvestments()              { return dbGetAll('investments'); }
function getInvestment(id)             { return dbGet('investments', id); }
function saveInvestmentBatch(records)  { return dbPutBatch('investments', records); }
function countInvestments()            { return dbCount('investments'); }

// ── 529 Plans ─────────────────────────────────────────────────────

function getPlans529()                 { return dbGetAll('plans529'); }
function getPlan529(id)                { return dbGet('plans529', id); }
function savePlan529Batch(records)     { return dbPutBatch('plans529', records); }
function countPlans529()               { return dbCount('plans529'); }

// ── Import History ────────────────────────────────────────────────

function getImportHistory()            { return dbGetAll('importHistory'); }
function saveImportRun(record)         { return dbPut('importHistory', record); }
function clearImportHistory()          { return dbClear('importHistory'); }

// ── Clients ───────────────────────────────────────────────────────

function getClients()                  { return dbGetAll('clients'); }
function saveClient(c)                 { return dbPut('clients', c); }
function deleteClient(id)              { return dbDelete('clients', id); }

// ── Import Types ──────────────────────────────────────────────────

function getImportTypes()              { return dbGetAll('importTypes'); }
function saveImportType(t)             { return dbPut('importTypes', t); }
function deleteImportType(id)          { return dbDelete('importTypes', id); }

// ── Accounts ──────────────────────────────────────────────────────

function getAccounts()                 { return dbGetAll('accounts'); }
function saveAccount(a)                { return dbPut('accounts', a); }
function deleteAccount(id)             { return dbDelete('accounts', id); }

// ── Computed Fields ───────────────────────────────────────────────

function getComputedFields()           { return dbGetAll('computedFields'); }
function saveComputedField(c)          { return dbPut('computedFields', c); }
function deleteComputedField(id)       { return dbDelete('computedFields', id); }

// ── Accounting Entries ────────────────────────────────────────────

function getAccountingEntries()        { return dbGetAll('accountingEntries'); }
function saveAccountingEntry(e)        { return dbPut('accountingEntries', e); }
function deleteAccountingEntry(id)     { return dbDelete('accountingEntries', id); }
