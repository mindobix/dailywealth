/* ── risk-assets.js ── Risk Assets: Master Table + Collapsible Legs ──
 *
 * Fidelity-style master table where each row is a trade.
 * Click a row to expand/collapse its legs.
 * Summary (avg cost, P&L, etc.) appears above the legs table.
 * Options: qty × 100 × price for all $ calculations.
 * ─────────────────────────────────────────────────────────────────── */

let _raTrades  = [];
let _raExpanded = new Set();   // trade IDs currently expanded

const _RA_COLS = 11;  // colspan for full-width rows

// ── Public ───────────────────────────────────────────────────────────

async function raInit() {
  _raTrades = await dbGetAll('riskAssets');
}

function _renderRiskAssetsSection() {
  const clientId = getActiveClientId();
  const trades   = _raTrades
    .filter(t => t.clientId === clientId)
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));

  const allCalcs       = trades.map(t => _raCalc(t));
  const totalPnl       = allCalcs.reduce((s, c) => s + (c.realizedPnl   ?? 0), 0);
  const totalUnreal    = allCalcs.reduce((s, c) => s + (c.unrealizedPnl ?? 0), 0);
  const totalCurVal    = allCalcs.reduce((s, c) => s + (c.currentValue  ?? 0), 0);
  const totalGL        = allCalcs.reduce((s, c) => s + (c.totalGainLoss ?? 0), 0);
  const anyLastPrice   = allCalcs.some(c => c.lastPrice !== null);
  const isEmpty        = trades.length === 0;

  return `
    <div class="acktg-section acktg-full-width${isEmpty ? ' acktg-section--collapsed' : ''}" id="ra-section">
      <div class="acktg-section-hd">
        <span class="acktg-section-title">Risk Assets</span>
        <button class="acktg-add-btn" onclick="raNewTrade()">+ New Trade</button>
      </div>
      ${isEmpty ? `
        <div class="acktg-collapsed-bar">
          <span class="acktg-collapsed-empty">No positions</span>
          <span class="acktg-collapsed-total">P&amp;L: —</span>
        </div>` : `
      <div class="ra-master-wrap">
        <table class="ra-master-table">
          <thead>
            <tr>
              <th class="ra-th-name">Name</th>
              <th class="ra-th-acct">Account</th>
              <th class="ra-th-r">Last Price</th>
              <th class="ra-th-r">Open Qty</th>
              <th class="ra-th-r">Avg Cost</th>
              <th class="ra-th-r">Current Value</th>
              <th class="ra-th-r">Unrealized G/L</th>
              <th class="ra-th-r">Realized P&amp;L</th>
              <th class="ra-th-r">Total G/L</th>
              <th class="ra-th-acts"></th>
              <th class="ra-th-chevron"></th>
            </tr>
          </thead>
          <tbody id="ra-tbody">
            ${trades.map(t => _raTradeRows(t)).join('')}
          </tbody>
          <tfoot>
            <tr class="ra-tfoot-row">
              <td colspan="5" class="ra-tfoot-label">Totals</td>
              <td class="ra-tfoot-val">${anyLastPrice ? _raFmtMoney(totalCurVal) : '—'}</td>
              <td class="ra-tfoot-val${totalUnreal < 0 ? ' num-neg' : totalUnreal > 0 ? ' num-pos' : ''}">${anyLastPrice ? _raFmtPnl(totalUnreal) : '—'}</td>
              <td class="ra-tfoot-val${totalPnl < 0 ? ' num-neg' : totalPnl > 0 ? ' num-pos' : ''}">${_raFmtPnl(totalPnl)}</td>
              <td class="ra-tfoot-val${totalGL < 0 ? ' num-neg' : totalGL > 0 ? ' num-pos' : ''}">${anyLastPrice ? _raFmtPnl(totalGL) : _raFmtPnl(totalPnl)}</td>
              <td colspan="2"></td>
            </tr>
          </tfoot>
        </table>
      </div>`}
    </div>`;
}

// ── Trade row pair (summary + legs) ──────────────────────────────────

function _raTradeRows(t) {
  const calc     = _raCalc(t);
  const expanded = _raExpanded.has(t.id);
  const name     = _raDisplayName(t);
  const sub      = _raDisplaySub(t);
  const acctName = _acktgAccountName(t.accountId);
  const pnlCls   = calc.realizedPnl   === null ? '' : calc.realizedPnl   >= 0 ? ' num-pos' : ' num-neg';
  const urCls    = calc.unrealizedPnl === null ? '' : calc.unrealizedPnl  >= 0 ? ' num-pos' : ' num-neg';
  const glCls    = calc.totalGainLoss === null ? '' : calc.totalGainLoss  >= 0 ? ' num-pos' : ' num-neg';

  return `
    <tr class="ra-trade-row${expanded ? ' ra-trade-expanded' : ''}" id="ra-trade-row-${_raA(t.id)}"
        onclick="raToggleTrade('${_raA(t.id)}')">
      <td class="ra-td-name">
        <div class="ra-name-main">${_raE(name)}</div>
        ${sub ? `<div class="ra-name-sub">${_raE(sub)}</div>` : ''}
      </td>
      <td>${acctName ? `<span class="ra-acct-pill">${_raE(acctName)}</span>` : '<span class="ra-muted">—</span>'}</td>
      <td class="ra-td-r">
        ${calc.lastPrice !== null ? `<div>${_raFmtMoney(calc.lastPrice)}</div>` : '<span class="ra-muted">—</span>'}
        ${t.type === 'option' ? '<div class="ra-name-sub">per contract</div>' : ''}
      </td>
      <td class="ra-td-r">${calc.openQty > 0 ? calc.openQty.toLocaleString() : '—'}</td>
      <td class="ra-td-r">
        <div>${calc.avgCost !== null ? _raFmtMoney(calc.avgCost) : '—'}</div>
        ${t.type === 'option' ? '<div class="ra-name-sub">per contract</div>' : ''}
      </td>
      <td class="ra-td-r">${calc.currentValue  !== null ? _raFmtMoney(calc.currentValue)  : '—'}</td>
      <td class="ra-td-r${urCls}">${calc.unrealizedPnl !== null ? _raFmtPnl(calc.unrealizedPnl) : '—'}</td>
      <td class="ra-td-r${pnlCls}">${_raFmtPnl(calc.realizedPnl)}</td>
      <td class="ra-td-r${glCls}">${calc.totalGainLoss !== null ? _raFmtPnl(calc.totalGainLoss) : _raFmtPnl(calc.realizedPnl)}</td>
      <td class="ra-td-acts" onclick="event.stopPropagation()">
        <button class="acktg-edit-btn ra-act-sm" onclick="raEditTrade('${_raA(t.id)}')">Edit</button>
        <button class="acktg-del-btn  ra-act-sm" onclick="raDeleteTrade('${_raA(t.id)}')">Del</button>
      </td>
      <td class="ra-td-chevron">
        <span class="ra-chevron${expanded ? ' open' : ''}">&#9660;</span>
      </td>
    </tr>
    <tr class="ra-legs-row" id="ra-legs-row-${_raA(t.id)}"${expanded ? '' : ' style="display:none"'}>
      <td colspan="${_RA_COLS}" class="ra-legs-td">
        ${_raLegsPanel(t, calc)}
      </td>
    </tr>`;
}

// ── Expanded legs panel ───────────────────────────────────────────────

function _raLegsPanel(t, calc) {
  return `
    <div class="ra-legs-panel">
      ${_raSummaryStrip(t, calc)}
      ${_raLegsTable(t)}
      <div class="ra-add-leg-bar">
        <button class="acktg-add-btn" onclick="raAddLeg('${_raA(t.id)}'); event.stopPropagation()">+ Add Leg</button>
      </div>
    </div>`;
}

function _raSummaryStrip(t, c) {
  const mult   = t.type === 'option' ? 100 : 1;
  const lpLbl  = t.type === 'option' ? 'Last Price (contract)' : 'Last Price';
  const items = [
    { lbl: 'Buy Qty',      val: c.buyQty  ? c.buyQty.toLocaleString()  : '—' },
    { lbl: 'Sell Qty',     val: c.sellQty ? c.sellQty.toLocaleString() : '—' },
    { lbl: 'Open Qty',     val: c.openQty ? c.openQty.toLocaleString() : '—' },
    { lbl: 'Avg Cost',     val: c.avgCost  !== null ? _raFmtMoney(c.avgCost)  : '—' },
    { lbl: 'Avg Sell',     val: c.avgSell  !== null ? _raFmtMoney(c.avgSell)  : '—' },
    { lbl: 'Cost Basis',   val: c.openCostBasis !== null ? _raFmtMoney(c.openCostBasis) : '—' },
    { lbl: 'Proceeds',     val: c.sellQty ? _raFmtMoney(c.avgSell * c.sellQty * mult) : '—' },
    { lbl: 'Commission',   val: c.totalComm ? _raFmtMoney(c.totalComm) : '—' },
    { lbl: 'Fees',         val: c.totalFees ? _raFmtMoney(c.totalFees) : '—' },
  ];
  const pnlCls = c.realizedPnl   === null ? '' : c.realizedPnl   >= 0 ? ' num-pos' : ' num-neg';
  const urCls  = c.unrealizedPnl === null ? '' : c.unrealizedPnl  >= 0 ? ' num-pos' : ' num-neg';
  const glCls  = c.totalGainLoss === null ? '' : c.totalGainLoss  >= 0 ? ' num-pos' : ' num-neg';

  return `<div class="ra-summary-strip">
    ${items.map(i => `
      <span class="ra-ss-item">
        <span class="ra-ss-lbl">${i.lbl}</span>
        <span class="ra-ss-val">${i.val}</span>
      </span>`).join('')}
    <span class="ra-ss-item ra-ss-pnl">
      <span class="ra-ss-lbl">Realized P&amp;L</span>
      <span class="ra-ss-val${pnlCls}">${_raFmtPnl(c.realizedPnl)}</span>
    </span>
    ${c.lastPrice !== null ? `
    <span class="ra-ss-item">
      <span class="ra-ss-lbl">${_raE(lpLbl)}</span>
      <span class="ra-ss-val">${_raFmtMoney(c.lastPrice)}</span>
    </span>
    <span class="ra-ss-item">
      <span class="ra-ss-lbl">Current Value</span>
      <span class="ra-ss-val">${c.currentValue !== null ? _raFmtMoney(c.currentValue) : '—'}</span>
    </span>
    <span class="ra-ss-item ra-ss-pnl">
      <span class="ra-ss-lbl">Unrealized G/L</span>
      <span class="ra-ss-val${urCls}">${_raFmtPnl(c.unrealizedPnl)}</span>
    </span>
    <span class="ra-ss-item ra-ss-pnl">
      <span class="ra-ss-lbl">Total G/L</span>
      <span class="ra-ss-val${glCls}">${_raFmtPnl(c.totalGainLoss)}</span>
    </span>` : ''}
  </div>`;
}

function _raLegsTable(t) {
  if (!t.legs || !t.legs.length) {
    return `<div class="ra-no-legs">No legs yet — click <strong>+ Add Leg</strong> to record a buy or sell.</div>`;
  }
  const mult = t.type === 'option' ? 100 : 1;
  const rows = t.legs
    .slice()
    .sort((a, b) => (a.date > b.date ? -1 : 1))
    .map(l => _raLegRow(t.id, l, mult))
    .join('');

  return `
    <div class="ra-legs-table-wrap">
      <table class="ra-legs-table">
        <thead>
          <tr>
            <th class="ra-lh-date">Acquired</th>
            <th class="ra-lh-act">Action</th>
            <th class="ra-lh-term">Term</th>
            <th class="ra-lh-r">Price</th>
            <th class="ra-lh-r">Qty${t.type === 'option' ? ' (contracts)' : ''}</th>
            <th class="ra-lh-r">Total Value${t.type === 'option' ? ' ×100' : ''}</th>
            <th class="ra-lh-r">Comm</th>
            <th class="ra-lh-r">Fees</th>
            <th class="ra-lh-acts"></th>
          </tr>
        </thead>
        <tbody id="ra-legs-tbody-${_raA(t.id)}">
          ${rows}
        </tbody>
      </table>
    </div>`;
}

function _raLegRow(tradeId, l, mult) {
  const total  = (l.price || 0) * (l.qty || 0) * mult;
  const isBuy  = l.action === 'buy';
  return `<tr id="ra-leg-row-${_raA(l.id)}">
    <td class="ra-ld-date">${_raFmtDate(l.date)}</td>
    <td><span class="ra-act-badge ra-act-${l.action}">${l.action.toUpperCase()}</span></td>
    <td class="ra-ld-term">${_raTerm(l.date)}</td>
    <td class="ra-ld-r">${_raFmtMoney(l.price)}</td>
    <td class="ra-ld-r">${l.qty != null ? l.qty.toLocaleString() : '—'}</td>
    <td class="ra-ld-r${!isBuy ? '' : ''}">${_raFmtMoney(total)}</td>
    <td class="ra-ld-r">${l.commission ? _raFmtMoney(l.commission) : '—'}</td>
    <td class="ra-ld-r">${l.fees ? _raFmtMoney(l.fees) : '—'}</td>
    <td class="ra-ld-acts">
      <button class="acktg-edit-btn ra-act-sm" onclick="raEditLeg('${_raA(tradeId)}','${_raA(l.id)}'); event.stopPropagation()">Edit</button>
      <button class="acktg-del-btn  ra-act-sm" onclick="raDeleteLeg('${_raA(tradeId)}','${_raA(l.id)}'); event.stopPropagation()">Del</button>
    </td>
  </tr>`;
}

// ── Toggle expand / collapse ──────────────────────────────────────────

function raToggleTrade(id) {
  if (_raExpanded.has(id)) _raExpanded.delete(id);
  else _raExpanded.add(id);
  const row    = document.getElementById(`ra-trade-row-${id}`);
  const lrow   = document.getElementById(`ra-legs-row-${id}`);
  const chev   = row?.querySelector('.ra-chevron');
  const open   = _raExpanded.has(id);
  if (lrow) lrow.style.display  = open ? '' : 'none';
  if (row)  row.classList.toggle('ra-trade-expanded', open);
  if (chev) chev.classList.toggle('open', open);
}

// ── New trade (horizontal inline form row) ────────────────────────────

function raNewTrade() {
  let tbody = document.getElementById('ra-tbody');

  // Expand collapsed section first
  if (!tbody) {
    const section = document.getElementById('ra-section');
    if (!section) return;
    section.classList.remove('acktg-section--collapsed');
    section.querySelector('.acktg-collapsed-bar')?.remove();
    const wrap = document.createElement('div');
    wrap.className = 'ra-master-wrap';
    wrap.innerHTML = `<table class="ra-master-table">
      <thead><tr>
        <th class="ra-th-name">Name</th><th class="ra-th-acct">Account</th>
        <th class="ra-th-r">Last Price</th><th class="ra-th-r">Open Qty</th>
        <th class="ra-th-r">Avg Cost</th><th class="ra-th-r">Current Value</th>
        <th class="ra-th-r">Unrealized G/L</th><th class="ra-th-r">Realized P&amp;L</th>
        <th class="ra-th-r">Total G/L</th>
        <th class="ra-th-acts"></th><th class="ra-th-chevron"></th>
      </tr></thead>
      <tbody id="ra-tbody"></tbody>
    </table>`;
    section.appendChild(wrap);
    tbody = document.getElementById('ra-tbody');
  }

  if (document.getElementById('ra-new-trade-row')) {
    document.querySelector('#ra-new-trade-row input, #ra-new-trade-row select')?.focus();
    return;
  }

  const tr = document.createElement('tr');
  tr.id        = 'ra-new-trade-row';
  tr.className = 'ra-form-row';
  tr.innerHTML = `<td colspan="${_RA_COLS}" class="ra-form-td">
    <div class="ra-trade-form">
      ${_raTradeFormFields(null, 'new')}
      <button class="acktg-save-btn"   onclick="raSaveNewTrade(); event.stopPropagation()">Save</button>
      <button class="acktg-cancel-btn" onclick="_renderAccountingView()">Cancel</button>
    </div>
  </td>`;
  tbody.insertBefore(tr, tbody.firstChild);
  document.getElementById('ra-sym-new')?.focus();
}

async function raSaveNewTrade() {
  const data = _raReadTradeForm('new');
  if (!data) return;
  const trade = {
    id: 'rt_' + uid(), clientId: getActiveClientId(),
    ...data, legs: [], createdAt: new Date().toISOString(),
  };
  await dbPut('riskAssets', trade);
  _raTrades = await dbGetAll('riskAssets');
  _raExpanded.add(trade.id);
  _renderAccountingView();
}

// ── Edit trade (replace trade row with inline form) ───────────────────

function raEditTrade(id) {
  const t    = _raTrades.find(x => x.id === id);
  const trow = document.getElementById(`ra-trade-row-${id}`);
  if (!t || !trow) return;

  const formRow = document.createElement('tr');
  formRow.id        = `ra-edit-trade-row-${id}`;
  formRow.className = 'ra-form-row';
  formRow.innerHTML = `<td colspan="${_RA_COLS}" class="ra-form-td">
    <div class="ra-trade-form">
      ${_raTradeFormFields(t, id)}
      <button class="acktg-save-btn"   onclick="raSaveTradeEdit('${_raA(id)}'); event.stopPropagation()">Save</button>
      <button class="acktg-cancel-btn" onclick="_renderAccountingView()">Cancel</button>
    </div>
  </td>`;

  trow.parentNode.insertBefore(formRow, trow);
  trow.style.display = 'none';
  document.getElementById(`ra-sym-${id}`)?.focus();
}

async function raSaveTradeEdit(id) {
  const t = _raTrades.find(x => x.id === id);
  if (!t) return;
  const data = _raReadTradeForm(id);
  if (!data) return;
  await dbPut('riskAssets', { ...t, ...data });
  _raTrades = await dbGetAll('riskAssets');
  _renderAccountingView();
}

// ── Trade form (one horizontal row with all fields) ───────────────────

function _raTradeFormFields(t, safeId) {
  const opts  = _acktgAccountOptions(t?.accountId);
  const isOpt = (t?.type ?? 'stock') === 'option';
  return `
    <label class="ra-form-lbl">Account</label>
    <select class="acktg-inline-sel ra-f-acct" id="ra-acct-${safeId}">${opts}</select>

    <label class="ra-form-lbl">Symbol</label>
    <input class="acktg-inline-input ra-f-sym" type="text" id="ra-sym-${safeId}"
      value="${_raV(t?.symbol ?? '')}" placeholder="e.g. TSLA"
      oninput="this.value=this.value.toUpperCase()">

    <label class="ra-form-lbl">Type</label>
    <select class="acktg-inline-sel ra-f-type" id="ra-type-${safeId}"
      onchange="raToggleOpt('${safeId}', this.value==='option')">
      <option value="stock"${(t?.type ?? 'stock')==='stock' ? ' selected' : ''}>Stock</option>
      <option value="option"${t?.type==='option' ? ' selected' : ''}>Option</option>
    </select>

    <span class="ra-opt-group${!isOpt ? ' ra-hidden' : ''}" id="ra-optgrp-${safeId}">
      <label class="ra-form-lbl">Call/Put</label>
      <select class="acktg-inline-sel ra-f-opt" id="ra-opt-${safeId}">
        <option value="">—</option>
        <option value="call"${t?.optionType==='call' ? ' selected' : ''}>Call</option>
        <option value="put"${t?.optionType==='put'  ? ' selected' : ''}>Put</option>
      </select>
      <label class="ra-form-lbl">Strike</label>
      <input class="acktg-inline-input acktg-inline-amt ra-f-strike" type="number" step="0.01"
        id="ra-strike-${safeId}" value="${_raV(t?.strikePrice ?? '')}" placeholder="0.00">
      <label class="ra-form-lbl">Expiry</label>
      <input class="acktg-inline-input ra-f-expiry" type="date"
        id="ra-expiry-${safeId}" value="${_raV(t?.expiryDate ?? '')}">
    </span>

    <label class="ra-form-lbl">Last Price</label>
    <input class="acktg-inline-input acktg-inline-amt ra-f-lp" type="number" step="0.01" min="0"
      id="ra-lp-${safeId}" value="${_raV(t?.lastPrice ?? '')}" placeholder="0.00">

    <label class="ra-form-lbl">Notes</label>
    <input class="acktg-inline-input ra-f-notes" type="text" id="ra-notes-${safeId}"
      value="${_raV(t?.notes ?? '')}" placeholder="Notes…" maxlength="200">`;
}

function _raReadTradeForm(safeId) {
  const g      = id => document.getElementById(id);
  const symbol = (g(`ra-sym-${safeId}`)?.value || '').trim().toUpperCase();
  const type   = g(`ra-type-${safeId}`)?.value   || 'stock';
  const acctId = g(`ra-acct-${safeId}`)?.value   || '';
  const notes  = (g(`ra-notes-${safeId}`)?.value || '').trim();
  if (!symbol) { g(`ra-sym-${safeId}`)?.focus(); return null; }
  const isOpt      = type === 'option';
  const optionType  = isOpt ? (g(`ra-opt-${safeId}`)?.value    || '') : '';
  const strikePrice = isOpt ? (parseFloat(g(`ra-strike-${safeId}`)?.value) || null) : null;
  const expiryDate  = isOpt ? (g(`ra-expiry-${safeId}`)?.value || null) : null;
  const lastPrice   = parseFloat(g(`ra-lp-${safeId}`)?.value) || null;
  return { accountId: acctId, symbol, type, optionType, strikePrice, expiryDate, notes, lastPrice };
}

function raToggleOpt(safeId, isOpt) {
  const grp = document.getElementById(`ra-optgrp-${safeId}`);
  if (grp) grp.classList.toggle('ra-hidden', !isOpt);
}

// ── Delete trade ─────────────────────────────────────────────────────

async function raDeleteTrade(id) {
  if (!confirm('Delete this trade and all its legs? This cannot be undone.')) return;
  await dbDelete('riskAssets', id);
  _raTrades = _raTrades.filter(t => t.id !== id);
  _raExpanded.delete(id);
  _renderAccountingView();
}

// ── Add leg ──────────────────────────────────────────────────────────

function raAddLeg(tradeId) {
  const t = _raTrades.find(x => x.id === tradeId);
  if (!t) return;

  // Make sure trade is expanded first
  if (!_raExpanded.has(tradeId)) {
    _raExpanded.add(tradeId);
    const lrow = document.getElementById(`ra-legs-row-${tradeId}`);
    const trow = document.getElementById(`ra-trade-row-${tradeId}`);
    if (lrow) lrow.style.display = '';
    if (trow) trow.classList.add('ra-trade-expanded');
  }

  let tbody = document.getElementById(`ra-legs-tbody-${tradeId}`);

  // Legs table may not exist yet if no legs
  if (!tbody) {
    const panel = document.querySelector(`#ra-legs-row-${tradeId} .ra-legs-panel`);
    if (!panel) return;
    const noLegs = panel.querySelector('.ra-no-legs');
    if (noLegs) {
      noLegs.outerHTML = `<div class="ra-legs-table-wrap">
        <table class="ra-legs-table">
          <thead><tr>
            <th class="ra-lh-date">Acquired</th><th class="ra-lh-act">Action</th>
            <th class="ra-lh-term">Term</th><th class="ra-lh-r">Price</th>
            <th class="ra-lh-r">Qty</th><th class="ra-lh-r">Total Value</th>
            <th class="ra-lh-r">Comm</th><th class="ra-lh-r">Fees</th>
            <th class="ra-lh-acts"></th>
          </tr></thead>
          <tbody id="ra-legs-tbody-${_raA(tradeId)}"></tbody>
        </table>
      </div>`;
    }
    tbody = document.getElementById(`ra-legs-tbody-${tradeId}`);
    if (!tbody) return;
  }

  if (tbody.querySelector('.ra-leg-new-row')) {
    tbody.querySelector('.ra-leg-new-row input, .ra-leg-new-row select')?.focus();
    return;
  }

  const today  = new Date().toLocaleDateString('en-CA');
  const tr     = document.createElement('tr');
  tr.className = 'ra-leg-new-row';
  tr.innerHTML = _raLegFormCells(null, `lnew-${tradeId}`, tradeId, today);
  tbody.insertBefore(tr, tbody.firstChild);
  document.getElementById(`ra-lpx-lnew-${tradeId}`)?.focus();
}

async function raSaveLegNew(tradeId) {
  const data = _raReadLegForm(`lnew-${tradeId}`);
  if (!data) return;
  const t = _raTrades.find(x => x.id === tradeId);
  if (!t) return;
  const updated = { ...t, legs: [...(t.legs || []), { id: 'leg_' + uid(), ...data }] };
  await dbPut('riskAssets', updated);
  _raTrades = await dbGetAll('riskAssets');
  _raExpanded.add(tradeId);
  _refreshTradeRows(tradeId);
}

// ── Edit leg ─────────────────────────────────────────────────────────

function raEditLeg(tradeId, legId) {
  const t   = _raTrades.find(x => x.id === tradeId);
  const leg = t?.legs?.find(l => l.id === legId);
  const tr  = document.getElementById(`ra-leg-row-${legId}`);
  if (!t || !leg || !tr) return;
  tr.innerHTML = _raLegFormCells(leg, legId, tradeId);
  document.getElementById(`ra-lpx-${legId}`)?.focus();
}

async function raSaveLegEdit(tradeId, legId) {
  const t = _raTrades.find(x => x.id === tradeId);
  if (!t) return;
  const data = _raReadLegForm(legId);
  if (!data) return;
  const updated = { ...t, legs: t.legs.map(l => l.id === legId ? { ...l, ...data } : l) };
  await dbPut('riskAssets', updated);
  _raTrades = await dbGetAll('riskAssets');
  _raExpanded.add(tradeId);
  _refreshTradeRows(tradeId);
}

// ── Delete leg ───────────────────────────────────────────────────────

async function raDeleteLeg(tradeId, legId) {
  if (!confirm('Delete this leg?')) return;
  const t = _raTrades.find(x => x.id === tradeId);
  if (!t) return;
  const updated = { ...t, legs: t.legs.filter(l => l.id !== legId) };
  await dbPut('riskAssets', updated);
  _raTrades = await dbGetAll('riskAssets');
  _raExpanded.add(tradeId);
  _refreshTradeRows(tradeId);
}

// ── Leg form cells ───────────────────────────────────────────────────

function _raLegFormCells(leg, safeId, tradeId, defaultDate) {
  const today = defaultDate || new Date().toLocaleDateString('en-CA');
  const isNew  = !leg;
  const saveF  = isNew
    ? `raSaveLegNew('${_raA(tradeId)}')`
    : `raSaveLegEdit('${_raA(tradeId)}','${_raA(leg.id)}')`;
  const cancelF = `_refreshTradeRows('${_raA(tradeId)}')`;

  return `
    <td><input class="acktg-inline-input" type="date" id="ra-ldate-${safeId}"
      value="${_raV(leg?.date ?? today)}"></td>
    <td><select class="acktg-inline-sel" id="ra-lact-${safeId}">
      <option value="buy"${(leg?.action ?? 'buy')==='buy' ? ' selected' : ''}>Buy</option>
      <option value="sell"${leg?.action==='sell' ? ' selected' : ''}>Sell</option>
    </select></td>
    <td></td>
    <td><input class="acktg-inline-input acktg-inline-amt" type="number" step="0.01" min="0"
      id="ra-lpx-${safeId}" value="${_raV(leg?.price ?? '')}" placeholder="0.00"></td>
    <td><input class="acktg-inline-input acktg-inline-amt" type="number" step="1" min="0"
      id="ra-lqty-${safeId}" value="${_raV(leg?.qty ?? '')}" placeholder="0"></td>
    <td></td>
    <td><input class="acktg-inline-input acktg-inline-amt" type="number" step="0.01" min="0"
      id="ra-lcomm-${safeId}" value="${_raV(leg?.commission ?? '0')}"></td>
    <td><input class="acktg-inline-input acktg-inline-amt" type="number" step="0.01" min="0"
      id="ra-lfees-${safeId}" value="${_raV(leg?.fees ?? '0')}"></td>
    <td class="ra-ld-acts">
      <button class="acktg-save-btn ra-act-sm" onclick="${saveF}; event.stopPropagation()">Save</button>
      <button class="acktg-cancel-btn ra-act-sm" onclick="${cancelF}; event.stopPropagation()">Cancel</button>
    </td>`;
}

function _raReadLegForm(safeId) {
  const g    = id => document.getElementById(id);
  const date = g(`ra-ldate-${safeId}`)?.value  || '';
  const px   = parseFloat(g(`ra-lpx-${safeId}`)?.value);
  const qty  = parseFloat(g(`ra-lqty-${safeId}`)?.value);
  if (!date)     { g(`ra-ldate-${safeId}`)?.focus(); return null; }
  if (isNaN(px)) { g(`ra-lpx-${safeId}`)?.focus();  return null; }
  if (isNaN(qty)){ g(`ra-lqty-${safeId}`)?.focus();  return null; }
  return {
    action:     g(`ra-lact-${safeId}`)?.value   || 'buy',
    date, price: px, qty,
    commission: parseFloat(g(`ra-lcomm-${safeId}`)?.value) || 0,
    fees:       parseFloat(g(`ra-lfees-${safeId}`)?.value) || 0,
  };
}

// ── Partial refresh: just re-render the two trade rows in place ───────

function _refreshTradeRows(tradeId) {
  const t     = _raTrades.find(x => x.id === tradeId);
  const tbody = document.getElementById('ra-tbody');
  if (!t || !tbody) { _renderAccountingView(); return; }

  const trow = document.getElementById(`ra-trade-row-${tradeId}`);
  const lrow = document.getElementById(`ra-legs-row-${tradeId}`);
  if (!trow || !lrow) { _renderAccountingView(); return; }

  const calc = _raCalc(t);
  const expanded = _raExpanded.has(tradeId);

  // Replace both rows in-place
  const tmp = document.createElement('tbody');
  tmp.innerHTML = _raTradeRows(t);

  trow.replaceWith(tmp.firstElementChild);
  lrow.replaceWith(tmp.firstElementChild);
}

// ── Calculations ─────────────────────────────────────────────────────

function _raCalc(t) {
  const legs     = t.legs || [];
  const mult     = t.type === 'option' ? 100 : 1;
  const buys     = legs.filter(l => l.action === 'buy');
  const sells    = legs.filter(l => l.action === 'sell');

  const buyQty    = buys.reduce((s, l)  => s + (l.qty   || 0), 0);
  const sellQty   = sells.reduce((s, l) => s + (l.qty   || 0), 0);
  const openQty   = buyQty - sellQty;

  const buyValue  = buys.reduce((s, l)  => s + (l.price || 0) * (l.qty || 0) * mult, 0);
  const sellValue = sells.reduce((s, l) => s + (l.price || 0) * (l.qty || 0) * mult, 0);

  // Avg cost per unit (per contract for options, per share for stocks)
  const avgCost  = buyQty  ? buyValue  / (buyQty  * mult) : null;
  const avgSell  = sellQty ? sellValue / (sellQty * mult) : null;

  const totalComm = legs.reduce((s, l) => s + (l.commission || 0), 0);
  const totalFees = legs.reduce((s, l) => s + (l.fees       || 0), 0);

  // Open position cost
  const openCostBasis = (avgCost !== null && openQty > 0) ? avgCost * openQty * mult : null;

  // Realized P&L on the sold portion
  const realizedPnl = sells.length
    ? sellValue - (avgCost ?? 0) * sellQty * mult - totalComm - totalFees
    : null;

  // Current market value using last traded price
  const lastPrice     = (t.lastPrice != null && !isNaN(t.lastPrice)) ? t.lastPrice : null;
  const currentValue  = (lastPrice !== null && openQty > 0) ? lastPrice * openQty * mult : null;
  const unrealizedPnl = (currentValue !== null && openCostBasis !== null) ? currentValue - openCostBasis : null;
  const totalGainLoss = (realizedPnl !== null || unrealizedPnl !== null)
    ? (realizedPnl ?? 0) + (unrealizedPnl ?? 0) : null;

  return { buyQty, sellQty, openQty, avgCost, avgSell, buyValue, sellValue,
           totalComm, totalFees, openCostBasis, realizedPnl,
           lastPrice, currentValue, unrealizedPnl, totalGainLoss };
}

// ── Display name ─────────────────────────────────────────────────────

function _raDisplayName(t) {
  if (t.type !== 'option') return t.symbol || '—';
  const exp    = t.expiryDate ? _raFmtExpiry(t.expiryDate) : '—';
  const strike = t.strikePrice != null ? '$' + t.strikePrice : '';
  const ot     = (t.optionType || '').toUpperCase();
  return `${t.symbol || '—'} ${exp} ${strike} ${ot}`.trim();
}

function _raDisplaySub(t) {
  if (t.type !== 'option' || !t.expiryDate) return t.notes || '';
  const days = Math.ceil((new Date(t.expiryDate) - Date.now()) / 86400000);
  const dayStr = days > 0 ? `${days} days until expiration` : days === 0 ? 'Expires today' : `Expired ${Math.abs(days)}d ago`;
  return t.notes ? `${dayStr} · ${t.notes}` : dayStr;
}

// ── Helpers ──────────────────────────────────────────────────────────

function _raTerm(dateStr) {
  if (!dateStr) return '—';
  const ms = Date.now() - new Date(dateStr).getTime();
  return ms >= 365 * 24 * 3600 * 1000 ? 'Long' : 'Short';
}

function _raFmtExpiry(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1];
  return `${mon}-${String(d).padStart(2, '0')}-${y}`;
}

function _raFmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return `${m}/${d}/${y}`;
}

function _raFmtMoney(n) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD',
    minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _raFmtPnl(v) {
  if (v == null) return '—';
  const abs = Math.abs(v).toLocaleString('en-US', { style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return v < 0 ? '-' + abs : v > 0 ? '+' + abs : abs;
}

function _raE(s)  { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function _raA(s)  { return String(s).replace(/'/g,"\\'").replace(/"/g,'&quot;'); }
function _raV(s)  { return String(s ?? '').replace(/"/g,'&quot;'); }
