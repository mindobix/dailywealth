/* ── db.js ── IndexedDB core layer ─────────────────────────────
 *
 * Database: dailywealth-db  (version 7)
 * Object stores (all keyPath: 'id'):
 *   investments       — portfolio snapshots per client
 *   plans529          — 529 plan snapshots per client
 *   importHistory     — one record per import run
 *   clients           — client profiles
 *   importTypes       — CSV column definitions per format
 *   accounts          — account metadata per client
 *   computedFields    — computed column definitions per client
 *   csvImportTypes    — CSV import type configs
 *   csvRecords        — raw CSV import records
 *   kids              — kids portfolio snapshots per client
 *   accountingEntries — deposits, RMDs, withdrawals, cash per client
 * ─────────────────────────────────────────────────────────────── */

const DW_DB_NAME    = 'dailywealth-db';
const DW_DB_VERSION = 9;

let _dwIdb = null;

function _openDwDb() {
  if (_dwIdb) return Promise.resolve(_dwIdb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DW_DB_NAME, DW_DB_VERSION);

    req.onupgradeneeded = e => {
      const db = e.target.result;
      for (const name of ['investments', 'plans529', 'kids', 'importHistory', 'clients', 'importTypes', 'accounts', 'computedFields', 'csvImportTypes', 'csvRecords', 'accountingEntries', 'riskAssets']) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' });
        }
      }
    };

    req.onsuccess = e => { _dwIdb = e.target.result; resolve(_dwIdb); };
    req.onerror   = e => reject(e.target.error);
  });
}

// ── Read ─────────────────────────────────────────────────────────

async function dbGetAll(store) {
  const db = await _openDwDb();
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror   = () => rej(req.error);
  });
}

async function dbGet(store, key) {
  const db = await _openDwDb();
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

// ── Write ─────────────────────────────────────────────────────────

async function dbPut(store, record) {
  const db = await _openDwDb();
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).put(record);
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

async function dbPutBatch(store, records) {
  if (!records.length) return;
  const db = await _openDwDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    let i = 0;

    function next() {
      if (i >= records.length) return;
      const r = os.put(records[i++]);
      r.onsuccess = next;
      r.onerror   = () => rej(r.error);
    }

    tx.oncomplete = () => res();
    tx.onerror    = () => rej(tx.error);
    next();
  });
}

async function dbDelete(store, key) {
  const db = await _openDwDb();
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).delete(key);
    req.onsuccess = () => res();
    req.onerror   = () => rej(req.error);
  });
}

async function dbClear(store) {
  const db = await _openDwDb();
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).clear();
    req.onsuccess = () => res();
    req.onerror   = () => rej(req.error);
  });
}

async function dbCount(store) {
  const db = await _openDwDb();
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readonly').objectStore(store).count();
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}
