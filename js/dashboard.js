/* ── dashboard.js ── Portfolio Dashboard ─────────────────────────────
 *
 * First tab. Reads from investments + plans529 stores.
 * No dependencies on import.js or the other view modules.
 * ─────────────────────────────────────────────────────────────────── */

// ── State ─────────────────────────────────────────────────────────────
let _dashRange      = 'ytd';
let _dashInvRecs    = [];   // sorted investment records for active client
let _dashP529Recs   = [];   // sorted 529 records for active client
let _dashTotalField    = 'totalPortfolio'; // auto-detected per client
let _dashTotalComputed = null;            // computed field set as dashboard total (overrides auto-detect)
let _dashAcktgTotals   = null;           // { totalDeposits, totalRmds, totalWithdrawals } or null
let _dashCashEntries   = [];             // type:'cash' accounting entries for active client
let _dashAllAccounts   = [];             // all account records for name lookup
let _dashLatest529Date = null;           // last-entered date across all 529 records
let _dashGainLossField     = 'gainLoss';  // designated gain/loss field for active client
let _dashSecondaryComputed = null;        // computed field marked as secondary total
let _dashBorrowedByAccount  = {};         // accountId → net borrowed/repaid for latest display
let _dashBorrowedEntries   = [];         // raw borrowed entries for active client
let _dashRepaymentEntries  = [];         // raw repayment entries for active client
let _dashRiskTrades       = [];          // risk asset trades for active client

function getDashTotalField() { return _dashTotalField; }

// chart hover state
let _dashChartPoints  = [];
let _dashChartLayout  = null;
let _dashHoverIdx     = -1;

// ── Helpers ──────────────────────────────────────────────────────────
function _dEsc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function _dFmtCur(v, compact) {
  if (v === null || v === undefined) return '—';
  if (compact) {
    const abs = Math.abs(v);
    const prefix = v < 0 ? '-$' : '$';
    if (abs >= 1_000_000) return prefix + (abs / 1_000_000).toFixed(2) + 'M';
    if (abs >= 1_000)     return prefix + (abs / 1_000).toFixed(1)     + 'K';
    return prefix + abs.toFixed(0);
  }
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function _dFmtSigned(v) {
  if (v === null || v === undefined) return '—';
  const s = _dFmtCur(v);
  return v > 0 ? '+' + s : s;
}
function _dFmtK(v) {
  const abs = Math.abs(v);
  const prefix = v < 0 ? '-$' : '$';
  if (abs >= 1_000_000) return prefix + (abs / 1_000_000).toFixed(1) + 'M';
  if (abs >= 1_000)     return prefix + (abs / 1_000).toFixed(0)     + 'K';
  return prefix + abs.toFixed(0);
}
function _dFmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}
function _dFmtDateShort(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}
function _dFmtMon(yyyymm) {
  const [y, m] = yyyymm.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

// ── Portfolio total value for a record ───────────────────────────────
function _dashTotalVal(r) {
  if (_dashTotalComputed) {
    const fields = _dashTotalComputed.fields;
    if (!fields.some(f => r[f] != null)) return null;
    return fields.reduce((s, f) => s + (typeof r[f] === 'number' ? r[f] : 0), 0);
  }
  return r[_dashTotalField] ?? null;
}

// ── Auto-detect best portfolio total field ────────────────────────────
function _dashDetectTotalField(records) {
  // Prefer these in order — stop at first one that has actual values
  const SKIP = new Set(['id','clientId','importRunId','importTypeId','format','date','weeklyDate','pct']);
  const preferred = ['totalPortfolio','investmentTotal','fidelityTotal','fidelityTotalKids','totalRetirement'];
  for (const f of preferred) {
    if (records.some(r => typeof r[f] === 'number')) return f;
  }
  // Fall back: whichever numeric field has the highest median value (likely the grand total)
  if (!records.length) return 'totalPortfolio';
  const sample = records.slice(-Math.min(20, records.length));
  const fields  = Object.keys(sample[sample.length - 1]).filter(k => !SKIP.has(k) && !k.toLowerCase().includes('gain') && !k.toLowerCase().includes('loss'));
  let best = 'totalPortfolio', bestMed = -Infinity;
  for (const f of fields) {
    const vals = sample.map(r => r[f]).filter(v => typeof v === 'number');
    if (!vals.length) continue;
    const med = vals.sort((a, b) => a - b)[Math.floor(vals.length / 2)];
    if (med > bestMed) { bestMed = med; best = f; }
  }
  return best;
}

// ── Entry point ──────────────────────────────────────────────────────
async function initDashboardView() {
  const clientId = getActiveClientId();

  const [allInv, all529, allAcktgRaw, allAcctsRaw, allClients, allRiskRaw] = await Promise.all([
    dbGetAll('investments'),
    dbGetAll('plans529'),
    dbGetAll('accountingEntries'),
    dbGetAll('accounts'),
    dbGetAll('clients'),
    dbGetAll('riskAssets'),
  ]);

  // Include no-clientId records only when there is a single client (legacy imports)
  const multiClient = allClients.length > 1;
  _dashInvRecs = allInv
    .filter(r => r.clientId === clientId || (!multiClient && !r.clientId))
    .filter(r => r.date)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  // Check if any computed field is marked as the dashboard total
  const allComputeds   = await getComputedFields();
  _dashTotalComputed   = allComputeds.find(
    c => c.clientId === clientId && c.tab === 'investments' && c.useForTotal
  ) || null;
  _dashSecondaryComputed = allComputeds.find(
    c => c.clientId === clientId && c.tab === 'investments' && c.useForSecondaryTotal
  ) || null;
  _dashTotalField      = _dashTotalComputed ? null : _dashDetectTotalField(_dashInvRecs);

  _dashP529Recs = all529
    .filter(r => r.clientId === clientId || (!multiClient && !r.clientId))
    .filter(r => r.date)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  _dashLatest529Date = _dashP529Recs.length ? _dashP529Recs.at(-1).date : null;

  const acktgFiltered = allAcktgRaw.filter(e => e.clientId === clientId);
  _dashAcktgTotals = {
    totalDeposits:    acktgFiltered.filter(e => e.type === 'deposit').reduce((s, e) => s + e.amount, 0),
    totalRmds:        acktgFiltered.filter(e => e.type === 'rmd').reduce((s, e) => s + e.amount, 0),
    totalWithdrawals: acktgFiltered.filter(e => e.type === 'withdrawal').reduce((s, e) => s + e.amount, 0),
  };
  _dashCashEntries = acktgFiltered.filter(e => e.type === 'cash');

  _dashBorrowedEntries   = acktgFiltered.filter(e => e.type === 'borrowed');
  _dashRepaymentEntries  = acktgFiltered.filter(e => e.type === 'repayment');
  _dashBorrowedByAccount = {};
  for (const e of _dashBorrowedEntries) {
    const amt = e.amount || 0;
    if (e.fromAccount) _dashBorrowedByAccount[e.fromAccount] = (_dashBorrowedByAccount[e.fromAccount] || 0) + amt;
    if (e.toAccount)   _dashBorrowedByAccount[e.toAccount]   = (_dashBorrowedByAccount[e.toAccount]   || 0) - amt;
  }
  // Repayments reverse the borrowed flow: fromAccount (repayer) gains back, toAccount (lender) loses outstanding
  for (const e of _dashRepaymentEntries) {
    const amt = e.amount || 0;
    if (e.fromAccount) _dashBorrowedByAccount[e.fromAccount] = (_dashBorrowedByAccount[e.fromAccount] || 0) + amt;
    if (e.toAccount)   _dashBorrowedByAccount[e.toAccount]   = (_dashBorrowedByAccount[e.toAccount]   || 0) - amt;
  }

  _dashAllAccounts = allAcctsRaw;
  _dashRiskTrades  = allRiskRaw.filter(t => t.clientId === clientId);

  const glAcct = allAcctsRaw.find(a => a.clientId === clientId && a.tab === 'investments' && a.useForGainLoss && !a.hidden);
  _dashGainLossField = glAcct?.field || 'gainLoss';

  _renderDashboard();
}

// ── Main renderer ─────────────────────────────────────────────────────
function _renderDashboard() {
  const body = document.getElementById('dash-body');
  if (!body) return;

  if (!_dashInvRecs.length) {
    body.innerHTML = `
      <div class="dash-empty-state">
        <div class="dash-empty-icon">📈</div>
        <div class="dash-empty-title">No investment data yet</div>
        <div class="dash-empty-sub">Import your first CSV file to see your portfolio dashboard.</div>
        <button class="dash-empty-btn" onclick="switchView('import')">Go to Import</button>
      </div>`;
    return;
  }

  const latestDateRec = _dashInvRecs.at(-1);                                              // last-entered record (for date display)
  const latest        = [..._dashInvRecs].reverse().find(r => _dashTotalVal(r) !== null)  // last record with a value (for $ display)
                        ?? latestDateRec;
  const prev          = _dashInvRecs.length > 1
                        ? [..._dashInvRecs].slice(0, _dashInvRecs.indexOf(latest)).reverse().find(r => _dashTotalVal(r) !== null) ?? null
                        : null;
  const now    = new Date();
  const yr     = now.getFullYear().toString();

  const ytdRecs   = _dashInvRecs.filter(r => r.date >= `${yr}-01-01`);
  const ytdGain   = ytdRecs.reduce((s, r) => s + (r[_dashGainLossField] || 0), 0);
  const weekGainRec = [..._dashInvRecs].reverse().find(r => typeof r[_dashGainLossField] === 'number');
  const weekGain    = weekGainRec?.[_dashGainLossField] ?? null;
  const latestVal = _dashTotalVal(latest);
  const prevVal   = prev ? _dashTotalVal(prev) : null;
  const portfolioDelta = (latestVal !== null && prevVal !== null) ? latestVal - prevVal : null;

  const y1Date = new Date(now); y1Date.setFullYear(y1Date.getFullYear() - 1);
  const y1Str  = _localIso(y1Date);
  const y1Rec  = _dashInvRecs.find(r => r.date >= y1Str && _dashTotalVal(r) !== null);
  const y1Ret  = (y1Rec && latestVal !== null) ? ((latestVal - _dashTotalVal(y1Rec)) / _dashTotalVal(y1Rec) * 100) : null;

  const clientId529    = getActiveClientId();
  const latestP529     = _dashP529Recs.length ? _dashP529Recs.at(-1) : null;
  // Compute 529 total from individual account fields (TOTAL 529 is a computed column, not stored)
  const p529Accts = _dashAllAccounts.filter(a => a.clientId === clientId529 && a.tab === '529' && !a.hidden && a.field && a.field !== 'total529');
  let total529 = null;
  if (latestP529) {
    if (p529Accts.length) {
      const sum = p529Accts.reduce((s, a) => s + (typeof latestP529[a.field] === 'number' ? latestP529[a.field] : 0), 0);
      total529 = sum > 0 ? sum : (latestP529.total529 ?? null);
    } else {
      total529 = latestP529.total529 ?? null;
    }
  }

  // Kids total — sum of all kids-tab accounts from latest investment record that has kids data
  const clientId    = getActiveClientId();
  const kidsAccts   = _dashAllAccounts.filter(a => a.clientId === clientId && a.tab === 'kids' && !a.hidden && a.field);
  const latestKidsRec = kidsAccts.length
    ? [..._dashInvRecs].reverse().find(r => kidsAccts.some(a => typeof r[a.field] === 'number'))
    : null;
  const kidsTotal   = latestKidsRec
    ? kidsAccts.reduce((s, a) => s + (typeof latestKidsRec[a.field] === 'number' ? latestKidsRec[a.field] : 0), 0)
    : null;

  // Borrowed net adjustments — +FROM, −TO per account, applied to each tab total (display only)
  const invAccts      = _dashAllAccounts.filter(a => a.clientId === clientId && a.tab === 'investments' && !a.hidden);
  const netBorrowInv  = invAccts.reduce((s, a)  => s + (_dashBorrowedByAccount[a.id] || 0), 0);
  const netBorrow529  = p529Accts.reduce((s, a) => s + (_dashBorrowedByAccount[a.id] || 0), 0);
  const netBorrowKids = kidsAccts.reduce((s, a) => s + (_dashBorrowedByAccount[a.id] || 0), 0);

  const displayInvVal = latestVal !== null ? latestVal + netBorrowInv  : null;
  const display529    = total529  !== null ? total529  + netBorrow529  : null;
  const displayKids   = kidsTotal !== null ? kidsTotal + netBorrowKids : null;

  // Combined / grand use display-adjusted values
  const combinedTotal = (displayInvVal !== null && display529 !== null) ? displayInvVal + display529 : null;
  const grandTotal    = (displayInvVal !== null && display529 !== null && displayKids !== null)
    ? displayInvVal + display529 + displayKids
    : null;

  // Secondary investments total — from designated computed field
  let secondaryTotal = null;
  if (_dashSecondaryComputed && _dashInvRecs.length) {
    const sf = _dashSecondaryComputed.fields;
    const val = sf.reduce((s, f) => s + (typeof latest[f] === 'number' ? latest[f] : 0), 0);
    if (sf.some(f => latest[f] != null)) secondaryTotal = val;
  }

  // Borrowed pills — grouped by lender (fromAccount in borrowed), showing net outstanding
  const _borrowedFromMap = {};
  for (const e of _dashBorrowedEntries) {
    if (!e.fromAccount) continue;
    if (!_borrowedFromMap[e.fromAccount]) _borrowedFromMap[e.fromAccount] = { total: 0, repaid: 0, toNames: new Set() };
    _borrowedFromMap[e.fromAccount].total += (e.amount || 0);
    if (e.toAccount) {
      const toAcct = _dashAllAccounts.find(a => a.id === e.toAccount);
      _borrowedFromMap[e.fromAccount].toNames.add(toAcct?.name || e.toAccount);
    }
  }
  // Subtract repayments: repayment toAccount = the original lender
  for (const e of _dashRepaymentEntries) {
    if (!e.toAccount || !_borrowedFromMap[e.toAccount]) continue;
    _borrowedFromMap[e.toAccount].repaid += (e.amount || 0);
  }
  const borrowedPills = Object.entries(_borrowedFromMap)
    .map(([acctId, { total, repaid, toNames }]) => {
      const net  = total - repaid;
      if (net <= 0) return '';
      const acct = _dashAllAccounts.find(a => a.id === acctId);
      const name = acct?.name || 'Account';
      const toLabel = toNames.size ? `Outstanding to: ${[...toNames].join(', ')}` : '';
      return _statCard(`Borrowed · ${name}`, -net, 'gain', toLabel);
    })
    .filter(Boolean)
    .join('');

  // True Return calculation using accounting totals
  let trueReturn = null;
  if (_dashAcktgTotals && latestVal !== null && _dashInvRecs.length > 0) {
    const firstVal    = _dashTotalVal(_dashInvRecs[0]);
    const netInvested = _dashAcktgTotals.totalDeposits - _dashAcktgTotals.totalRmds - _dashAcktgTotals.totalWithdrawals;
    if (firstVal !== null) trueReturn = latestVal - firstVal - netInvested;
  }

  body.innerHTML = `

    <!-- ── Hero + stat cards ── -->
    <div class="dash-top-row">

      <div class="dash-hero-card">
        <div class="dash-hero-label">${_dashTotalComputed ? _dEsc(_dashTotalComputed.name) : 'Total Portfolio'}</div>
        <div class="dash-hero-value">${_dFmtCur(displayInvVal ?? latestVal)}</div>
        <div class="dash-hero-date">${_dFmtDate(latestDateRec.date)}</div>
        ${portfolioDelta !== null ? `
          <div class="dash-hero-delta ${portfolioDelta >= 0 ? 'pos' : 'neg'}">
            <span class="dash-delta-arrow">${portfolioDelta >= 0 ? '▲' : '▼'}</span>
            ${_dFmtSigned(portfolioDelta)} from previous week
          </div>` : ''}
        ${_heroSubTotals(display529, displayKids, combinedTotal, grandTotal, secondaryTotal, latestKidsRec)}
      </div>

      <div class="dash-top-right">
        <div class="dash-stat-cards">
          ${_statCard('Weekly Gain / Loss', weekGain, 'gain', 'This week')}
          ${_statCard('YTD Gain / Loss',    ytdGain,  'gain', `Jan 1 – today`)}
          ${_statCard('1-Year Return',       y1Ret,   'pct',  '12-month period')}
          ${trueReturn !== null ? _statCard('True Return', trueReturn, 'gain', 'Since inception – net invested') : ''}
          ${borrowedPills}
        </div>
        <div class="dash-card">
          <div class="dash-section-title">Profit Matrix</div>
          ${_buildProfitMatrix()}
        </div>
      </div>
    </div>

    <!-- ── Risk Asset Book ── -->
    ${_buildRiskAssetsWidget()}

    <!-- ── Portfolio chart ── -->
    <div class="dash-card dash-chart-card">
      <div class="dash-chart-topbar">
        <span class="dash-section-title">Portfolio Value</span>
        <div class="dash-range-pills" id="dash-range-pills">
          ${['1m','3m','ytd','1y','3y','all'].map(r =>
            `<button class="dash-range-pill${_dashRange === r ? ' active' : ''}" onclick="dashSetRange('${r}')">${r.toUpperCase()}</button>`
          ).join('')}
        </div>
      </div>
      <div class="dash-chart-wrap" style="position:relative">
        <canvas id="dash-main-canvas" height="260" style="display:block;width:100%"></canvas>
        <div class="dash-tooltip" id="dash-tooltip" style="display:none;position:absolute;pointer-events:none"></div>
      </div>
    </div>

    <!-- ── Row: Asset Allocation | Yearly Gain/Loss ── -->
    <div class="dash-mid-row">
      ${_buildAssetAllocationWidget(displayInvVal ?? latestVal)}
      <div class="dash-card dash-yearly-card">
        <div class="dash-section-title">Yearly Gain / Loss</div>
        ${_buildYearlyTable()}
      </div>
    </div>

    <!-- ── Row: Account Breakdown | Monthly Performance ── -->
    <div class="dash-mid-row">
      <div class="dash-card">
        <div class="dash-section-title">Account Breakdown</div>
        <div id="dash-breakdown" class="dash-breakdown"></div>
      </div>
      <div class="dash-card">
        <div class="dash-section-title">Monthly Performance</div>
        <canvas id="dash-monthly-canvas" height="200" style="display:block;width:100%"></canvas>
      </div>
    </div>

  `;

  // Draw after DOM is ready
  requestAnimationFrame(() => {
    _dashDrawMainChart();
    _dashDrawMonthlyChart();
    _dashAttachChartHover();
    _dashRenderBreakdown(latest);
  });
}

// ── Risk Asset Book widget ────────────────────────────────────────────

function _buildRiskAssetsWidget() {
  const trades = _dashRiskTrades;

  const emptyCard = `
    <div class="dash-card dash-ra-card">
      <div class="dash-ra-header">
        <div>
          <span class="dash-section-title" style="margin-bottom:0">Risk Asset Book</span>
          <span class="dash-ra-header-sub">Options &amp; equities trading book</span>
        </div>
        <button class="dash-ra-link" onclick="switchView('accounting')">Open in Accounting →</button>
      </div>
      <div class="dash-ra-empty">
        No risk asset positions recorded.
        <button class="dash-ra-empty-btn" onclick="switchView('accounting')">Add in Accounting →</button>
      </div>
    </div>`;

  if (!trades.length) return emptyCard;

  const calcs = trades.map(t => ({ t, c: _dashRaCalc(t) }));

  // ── KPI computation ──────────────────────────────────────────────────
  const openTrades      = calcs.filter(x => x.c.openQty > 0);
  const closedTrades    = calcs.filter(x => x.c.sellQty > 0 && x.c.realizedPnl !== null);
  const winners         = closedTrades.filter(x => x.c.realizedPnl > 0).length;
  const winRate         = closedTrades.length ? winners / closedTrades.length * 100 : null;
  const capitalDeployed = calcs.reduce((s, x) => s + (x.c.openCostBasis  ?? 0), 0);
  const totalCurrentVal = calcs.reduce((s, x) => s + (x.c.currentValue   ?? 0), 0);
  const totalPnl        = calcs.reduce((s, x) => s + (x.c.realizedPnl    ?? 0), 0);
  const totalUnrealized = calcs.reduce((s, x) => s + (x.c.unrealizedPnl  ?? 0), 0);
  const totalGL         = calcs.reduce((s, x) => s + (x.c.totalGainLoss  ?? x.c.realizedPnl ?? 0), 0);
  const anyLastPrice    = calcs.some(x => x.c.lastPrice !== null);

  const pnlCls = totalPnl       > 0 ? ' num-pos' : totalPnl       < 0 ? ' num-neg' : '';
  const urCls  = totalUnrealized > 0 ? ' num-pos' : totalUnrealized < 0 ? ' num-neg' : '';
  const glCls  = totalGL         > 0 ? ' num-pos' : totalGL         < 0 ? ' num-neg' : '';
  const winCls = winRate === null ? '' : winRate >= 50 ? ' num-pos' : ' num-neg';

  const kpis = [
    { lbl: 'Open Positions',   val: openTrades.length,  fmt: 'int', sub: `of ${trades.length} total trade${trades.length !== 1 ? 's' : ''}` },
    { lbl: 'Capital Deployed', val: capitalDeployed,    fmt: 'cur', sub: 'open cost basis' },
    { lbl: 'Current Value',    val: anyLastPrice ? totalCurrentVal : null, fmt: 'cur',
      sub: anyLastPrice ? 'open qty × last price' : 'enter last price to enable' },
    { lbl: 'Unrealized G/L',   val: anyLastPrice ? totalUnrealized : null, fmt: 'pnl',
      sub: 'current value − cost basis', cls: anyLastPrice ? urCls : '' },
    { lbl: 'Realized P&amp;L', val: totalPnl,           fmt: 'pnl', sub: 'net of commissions &amp; fees', cls: pnlCls },
    { lbl: 'Total G/L',        val: anyLastPrice ? totalGL : totalPnl, fmt: 'pnl',
      sub: anyLastPrice ? 'unrealized + realized' : 'realized only', cls: anyLastPrice ? glCls : pnlCls },
  ];

  const kpiHtml = kpis.map(k => {
    let display;
    const cls = k.cls ?? '';
    if      (k.fmt === 'int') display = k.val != null ? k.val.toLocaleString() : '—';
    else if (k.fmt === 'cur') display = k.val != null ? _dFmtCur(k.val) : '—';
    else if (k.fmt === 'pnl') display = _dashRaFmtPnl(k.val);
    else if (k.fmt === 'pct') display = k.val != null ? k.val.toFixed(1) + '%' : '—';
    return `
      <div class="dash-ra-kpi">
        <div class="dash-ra-kpi-lbl">${k.lbl}</div>
        <div class="dash-ra-kpi-val${cls}">${display}</div>
        <div class="dash-ra-kpi-sub">${k.sub}</div>
      </div>`;
  }).join('');

  // ── Positions table ──────────────────────────────────────────────────
  // Open first, then by absolute P&L descending
  const sorted = [...calcs].sort((a, b) => {
    const aOpen = a.c.openQty > 0 ? 1 : 0;
    const bOpen = b.c.openQty > 0 ? 1 : 0;
    if (bOpen !== aOpen) return bOpen - aOpen;
    return Math.abs(b.c.realizedPnl ?? 0) - Math.abs(a.c.realizedPnl ?? 0);
  });

  const MAX_ROWS  = 10;
  const shown     = sorted.slice(0, MAX_ROWS);
  const moreCount = sorted.length - MAX_ROWS;

  const rows = shown.map(({ t, c }) => {
    const acctName = _dashAllAccounts.find(a => a.id === t.accountId)?.name || '—';
    const legCount = (t.legs || []).length;
    const pnlCls   = c.realizedPnl   === null ? '' : c.realizedPnl   >= 0 ? ' num-pos' : ' num-neg';
    const urCls    = c.unrealizedPnl === null ? '' : c.unrealizedPnl  >= 0 ? ' num-pos' : ' num-neg';
    const glCls    = c.totalGainLoss === null ? '' : c.totalGainLoss  >= 0 ? ' num-pos' : ' num-neg';
    const status   = c.openQty > 0 && c.sellQty > 0 ? 'MIXED'
                   : c.openQty > 0                   ? 'OPEN'
                   : 'CLOSED';
    const optSub   = t.type === 'option' ? _dashRaOptSub(t) : '';
    const glVal    = c.totalGainLoss !== null ? _dashRaFmtPnl(c.totalGainLoss) : _dashRaFmtPnl(c.realizedPnl);
    const glCls2   = c.totalGainLoss !== null ? glCls : pnlCls;
    return `
      <tr>
        <td class="dash-ra-td-name">
          <div class="dash-ra-sym">${_dEsc(t.symbol || '—')}</div>
          ${t.type === 'option' ? `<div class="dash-ra-name-detail">${_dEsc(_dashRaOptDetail(t))}</div>` : ''}
          ${optSub ? `<div class="dash-ra-name-sub">${_dEsc(optSub)}</div>` : ''}
        </td>
        <td><span class="dash-ra-type-badge dash-ra-type-${t.type}">${t.type === 'option' ? 'OPT' : 'STK'}</span></td>
        <td class="dash-ra-td-acct">${_dEsc(acctName)}</td>
        <td class="dash-ra-td-r">${c.openQty > 0 ? c.openQty.toLocaleString() : '—'}</td>
        <td class="dash-ra-td-r">${c.lastPrice !== null ? _dFmtCur(c.lastPrice) : '<span style="color:var(--ink-faint)">—</span>'}</td>
        <td class="dash-ra-td-r">${c.currentValue  !== null ? _dFmtCur(c.currentValue)  : '—'}</td>
        <td class="dash-ra-td-r${urCls}">${c.unrealizedPnl !== null ? _dashRaFmtPnl(c.unrealizedPnl) : '—'}</td>
        <td class="dash-ra-td-r${pnlCls}">${_dashRaFmtPnl(c.realizedPnl)}</td>
        <td class="dash-ra-td-r${glCls2}">${glVal}</td>
        <td><span class="dash-ra-status dash-ra-status-${status.toLowerCase()}">${status}</span></td>
      </tr>`;
  }).join('');

  const moreRow = moreCount > 0 ? `
    <tr>
      <td colspan="10" class="dash-ra-more-row">
        +${moreCount} more position${moreCount !== 1 ? 's' : ''} —
        <button onclick="switchView('accounting')">view all in Accounting</button>
      </td>
    </tr>` : '';

  // ── Total G/L by symbol bar (right panel) ───────────────────────────
  const bySymbol = {};
  for (const { t, c } of calcs) {
    const gl  = c.totalGainLoss ?? c.realizedPnl;
    if (gl === null) continue;
    const sym = t.symbol || '—';
    bySymbol[sym] = (bySymbol[sym] || 0) + gl;
  }
  const symEntries = Object.entries(bySymbol)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 8);
  const maxAbsSym  = Math.max(...symEntries.map(([, v]) => Math.abs(v)), 1);

  const symBars = symEntries.length ? symEntries.map(([sym, pnl]) => {
    const pct  = (Math.abs(pnl) / maxAbsSym * 100).toFixed(1);
    const pos  = pnl >= 0;
    return `
      <div class="dash-ra-bar-row">
        <div class="dash-ra-bar-sym">${_dEsc(sym)}</div>
        <div class="dash-ra-bar-track">
          <div class="dash-ra-bar-fill ${pos ? 'pos' : 'neg'}" style="width:${pct}%"></div>
        </div>
        <div class="dash-ra-bar-val ${pos ? 'num-pos' : 'num-neg'}">${_dashRaFmtPnl(pnl)}</div>
      </div>`;
  }).join('') : '<div class="dash-ra-bar-empty">No realized P&amp;L yet</div>';

  return `
    <div class="dash-card dash-ra-card">

      <div class="dash-ra-header">
        <div>
          <span class="dash-section-title" style="margin-bottom:0">Risk Asset Book</span>
          <span class="dash-ra-header-sub">Options &amp; equities trading book · ${trades.length} position${trades.length !== 1 ? 's' : ''}</span>
        </div>
        <button class="dash-ra-link" onclick="switchView('accounting')">Open in Accounting →</button>
      </div>

      <div class="dash-ra-kpis">
        ${kpiHtml}
      </div>

      <div class="dash-ra-body">
        <div class="dash-ra-table-wrap">
          <table class="dash-ra-table">
            <thead>
              <tr>
                <th class="dash-ra-th-name">Position</th>
                <th>Type</th>
                <th>Account</th>
                <th class="dash-ra-th-r">Open Qty</th>
                <th class="dash-ra-th-r">Last Price</th>
                <th class="dash-ra-th-r">Current Value</th>
                <th class="dash-ra-th-r">Unrealized G/L</th>
                <th class="dash-ra-th-r">Realized P&amp;L</th>
                <th class="dash-ra-th-r">Total G/L</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
            <tfoot>${moreRow}</tfoot>
          </table>
        </div>
        <div class="dash-ra-pnl-panel">
          <div class="dash-ra-pnl-title">Total G/L by Symbol</div>
          <div class="dash-ra-bars">${symBars}</div>
        </div>
      </div>

    </div>`;
}

// ── Risk asset calc (mirrors risk-assets.js, self-contained here) ──────

function _dashRaCalc(t) {
  const legs   = t.legs || [];
  const mult   = t.type === 'option' ? 100 : 1;
  const buys   = legs.filter(l => l.action === 'buy');
  const sells  = legs.filter(l => l.action === 'sell');

  const buyQty  = buys.reduce((s, l) => s + (l.qty  || 0), 0);
  const sellQty = sells.reduce((s, l) => s + (l.qty || 0), 0);
  const openQty = buyQty - sellQty;

  const buyValue  = buys.reduce((s, l)  => s + (l.price || 0) * (l.qty || 0) * mult, 0);
  const sellValue = sells.reduce((s, l) => s + (l.price || 0) * (l.qty || 0) * mult, 0);

  const avgCost = buyQty  ? buyValue  / (buyQty  * mult) : null;
  const avgSell = sellQty ? sellValue / (sellQty * mult) : null;

  const totalComm = legs.reduce((s, l) => s + (l.commission || 0), 0);
  const totalFees = legs.reduce((s, l) => s + (l.fees       || 0), 0);

  const openCostBasis = (avgCost !== null && openQty > 0) ? avgCost * openQty * mult : null;
  const realizedPnl   = sells.length
    ? sellValue - (avgCost ?? 0) * sellQty * mult - totalComm - totalFees
    : null;

  const lastPrice     = (t.lastPrice != null && !isNaN(t.lastPrice)) ? t.lastPrice : null;
  const currentValue  = (lastPrice !== null && openQty > 0) ? lastPrice * openQty * mult : null;
  const unrealizedPnl = (currentValue !== null && openCostBasis !== null) ? currentValue - openCostBasis : null;
  const totalGainLoss = (realizedPnl !== null || unrealizedPnl !== null)
    ? (realizedPnl ?? 0) + (unrealizedPnl ?? 0) : null;

  return { buyQty, sellQty, openQty, avgCost, avgSell,
           totalComm, totalFees, openCostBasis, realizedPnl,
           lastPrice, currentValue, unrealizedPnl, totalGainLoss };
}

function _dashRaOptDetail(t) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (!t.expiryDate) return '';
  const [y, m, d] = t.expiryDate.split('-').map(Number);
  const exp    = `${months[m - 1]}-${String(d).padStart(2, '0')}-${y}`;
  const strike = t.strikePrice != null ? ' $' + t.strikePrice : '';
  return `${exp}${strike} ${(t.optionType || '').toUpperCase()}`.trim();
}

function _dashRaOptSub(t) {
  if (!t.expiryDate) return '';
  const days = Math.ceil((new Date(t.expiryDate) - Date.now()) / 86400000);
  if (days > 0)   return `${days}d to exp`;
  if (days === 0) return 'Expires today';
  return `Exp ${Math.abs(days)}d ago`;
}

function _dashRaFmtPnl(v) {
  if (v == null) return '—';
  const abs = Math.abs(v).toLocaleString('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  });
  return v < 0 ? '−' + abs : v > 0 ? '+' + abs : abs;
}

// ── Stat card builders ────────────────────────────────────────────────
function _statCard(label, value, kind, sub) {
  let display, cls;
  if (kind === 'gain') {
    display = value !== null ? _dFmtSigned(value) : '—';
    cls = value === null ? '' : value >= 0 ? 'pos' : 'neg';
  } else if (kind === 'pct') {
    display = value !== null ? (value >= 0 ? '+' : '') + value.toFixed(2) + '%' : '—';
    cls = value === null ? '' : value >= 0 ? 'pos' : 'neg';
  } else {
    display = value !== null ? _dFmtCur(value) : '—';
    cls = '';
  }
  return `
    <div class="dash-stat-card">
      <div class="dash-stat-label">${_dEsc(label)}</div>
      <div class="dash-stat-value ${cls}">${display}</div>
      <div class="dash-stat-sub">${_dEsc(sub)}</div>
    </div>`;
}
function _statCardBlank(label, note) {
  return `
    <div class="dash-stat-card">
      <div class="dash-stat-label">${_dEsc(label)}</div>
      <div class="dash-stat-value" style="color:var(--ink-faint)">—</div>
      <div class="dash-stat-sub">${_dEsc(note)}</div>
    </div>`;
}

function _heroSubTotals(total529, kidsTotal, combinedTotal, grandTotal, secondaryTotal, latestKidsRec) {
  const items = [];
  if (total529 !== null)
    items.push({ label: '529 Plans', val: total529, date: _dFmtDate(_dashLatest529Date), cls: '' });
  if (kidsTotal !== null && latestKidsRec)
    items.push({ label: 'Kids Portfolio', val: kidsTotal, date: _dFmtDate(latestKidsRec.date), cls: '' });
  if (combinedTotal !== null)
    items.push({ label: 'Investments + 529', val: combinedTotal, date: '', cls: 'combined' });
  if (grandTotal !== null)
    items.push({ label: 'Grand Total', val: grandTotal, date: '', cls: 'grand' });
  if (secondaryTotal !== null && _dashSecondaryComputed)
    items.push({ label: _dEsc(_dashSecondaryComputed.name), val: secondaryTotal, date: '', cls: 'secondary' });

  if (!items.length) return '';

  return `<div class="dash-hero-subtotals">
    ${items.map(it => `
      <div class="dash-hero-sub-row${it.cls ? ' ' + it.cls : ''}">
        <span class="dash-hero-sub-lbl">${it.label}${it.date ? `<span class="dash-hero-sub-date"> · ${it.date}</span>` : ''}</span>
        <span class="dash-hero-sub-val${it.val < 0 ? ' num-neg' : ''}">${_dFmtCur(it.val)}</span>
      </div>`).join('')}
  </div>`;
}

// ── Range control ─────────────────────────────────────────────────────
function dashSetRange(r) {
  _dashRange = r;
  document.querySelectorAll('.dash-range-pill').forEach(b => {
    b.classList.toggle('active', b.textContent.toLowerCase() === r);
  });
  _dashDrawMainChart();
}

// ── Filtered points for chart ─────────────────────────────────────────
function _localIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function _dashFilteredPoints() {
  const now  = new Date();
  let cutoff = null;
  if (_dashRange === '1m') { const d = new Date(now); d.setMonth(d.getMonth() - 1);     cutoff = _localIso(d); }
  if (_dashRange === '3m') { const d = new Date(now); d.setMonth(d.getMonth() - 3);     cutoff = _localIso(d); }
  if (_dashRange === 'ytd')  cutoff = `${now.getFullYear()}-01-01`;
  if (_dashRange === '1y') { const d = new Date(now); d.setFullYear(d.getFullYear()-1); cutoff = _localIso(d); }
  if (_dashRange === '3y') { const d = new Date(now); d.setFullYear(d.getFullYear()-3); cutoff = _localIso(d); }

  // Pre-build set of investment account IDs for borrowed adjustment
  const clientId = getActiveClientId();
  const invAcctIds = new Set(
    _dashAllAccounts.filter(a => a.clientId === clientId && a.tab === 'investments' && !a.hidden).map(a => a.id)
  );

  const recs = cutoff ? _dashInvRecs.filter(r => r.date >= cutoff) : _dashInvRecs;
  return recs
    .filter(r => _dashTotalVal(r) !== null)
    .map((r, i) => {
      // Borrowed + repayment adjustments dated on or before this record's date
      const borrowAdj = [
        ..._dashBorrowedEntries.filter(e => e.date <= r.date),
        ..._dashRepaymentEntries.filter(e => e.date <= r.date),
      ].reduce((s, e) => {
        if (invAcctIds.has(e.fromAccount)) s += (e.amount || 0);
        if (invAcctIds.has(e.toAccount))   s -= (e.amount || 0);
        return s;
      }, 0);
      return {
        date:   r.date,
        value:  _dashTotalVal(r) + borrowAdj,
        change: i > 0 ? (r[_dashGainLossField] ?? null) : null,
      };
    });
}

// ── Main portfolio chart ──────────────────────────────────────────────
function _dashDrawMainChart(hoverIdx) {
  const canvas = document.getElementById('dash-main-canvas');
  if (!canvas) return;

  const pts = _dashFilteredPoints();
  _dashChartPoints = pts;
  if (!pts.length) {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.parentElement.clientWidth || 600;
    const H = 260;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#b5b4ac';
    ctx.font = `13px 'Inter Tight', sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('No data for this time range', W / 2, H / 2);
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.parentElement.clientWidth || 600;
  const H   = 260;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const PAD   = { t: 16, r: 20, b: 38, l: 72 };
  const CW    = W - PAD.l - PAD.r;
  const CH    = H - PAD.t - PAD.b;
  _dashChartLayout = { PAD, CW, CH, W, H };

  const vals  = pts.map(p => p.value);
  const minV  = Math.min(...vals);
  const maxV  = Math.max(...vals);
  const range = maxV - minV || 1;
  const pad5  = range * 0.06;

  const xFor = i => PAD.l + (pts.length > 1 ? i / (pts.length - 1) : 0.5) * CW;
  const yFor = v => PAD.t + CH - ((v - (minV - pad5)) / (range + pad5 * 2)) * CH;

  // Grid lines
  const gridCount = 4;
  for (let g = 0; g <= gridCount; g++) {
    const v = maxV + pad5 - ((range + pad5 * 2) / gridCount) * g;
    const y = yFor(v);
    ctx.beginPath();
    ctx.setLineDash([3, 5]);
    ctx.strokeStyle = '#e6e2d7';
    ctx.lineWidth = 1;
    ctx.moveTo(PAD.l, y);
    ctx.lineTo(W - PAD.r, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#b5b4ac';
    ctx.font = `10px 'Inter Tight', sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText(_dFmtK(v), PAD.l - 6, y + 4);
  }

  // Area fill
  const grad = ctx.createLinearGradient(0, PAD.t, 0, PAD.t + CH);
  grad.addColorStop(0, 'rgba(37,99,235,0.18)');
  grad.addColorStop(1, 'rgba(37,99,235,0)');

  ctx.beginPath();
  ctx.moveTo(xFor(0), PAD.t + CH);
  ctx.lineTo(xFor(0), yFor(pts[0].value));
  for (let i = 1; i < pts.length; i++) {
    const cx = (xFor(i - 1) + xFor(i)) / 2;
    ctx.bezierCurveTo(cx, yFor(pts[i-1].value), cx, yFor(pts[i].value), xFor(i), yFor(pts[i].value));
  }
  ctx.lineTo(xFor(pts.length - 1), PAD.t + CH);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.moveTo(xFor(0), yFor(pts[0].value));
  for (let i = 1; i < pts.length; i++) {
    const cx = (xFor(i - 1) + xFor(i)) / 2;
    ctx.bezierCurveTo(cx, yFor(pts[i-1].value), cx, yFor(pts[i].value), xFor(i), yFor(pts[i].value));
  }
  ctx.strokeStyle = '#2563eb';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Hover crosshair
  if (hoverIdx !== undefined && hoverIdx >= 0 && hoverIdx < pts.length) {
    const hx = xFor(hoverIdx);
    const hy = yFor(pts[hoverIdx].value);
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#2563eb66';
    ctx.lineWidth = 1;
    ctx.moveTo(hx, PAD.t);
    ctx.lineTo(hx, PAD.t + CH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(hx, hy, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#2563eb';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(hx, hy, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
  } else {
    // End dot
    const lx = xFor(pts.length - 1);
    const ly = yFor(pts[pts.length - 1].value);
    ctx.beginPath();
    ctx.arc(lx, ly, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#2563eb';
    ctx.fill();
  }

  // X-axis labels
  ctx.fillStyle = '#b5b4ac';
  ctx.font = `10px 'Inter Tight', sans-serif`;
  ctx.textAlign = 'center';
  const labelCount = Math.min(6, pts.length);
  for (let i = 0; i < labelCount; i++) {
    const idx = Math.round((i / (labelCount - 1 || 1)) * (pts.length - 1));
    ctx.fillText(_dFmtDateShort(pts[idx].date), xFor(idx), H - 10);
  }
}

function _dashAttachChartHover() {
  const canvas  = document.getElementById('dash-main-canvas');
  const tooltip = document.getElementById('dash-tooltip');
  if (!canvas || !tooltip) return;

  canvas.addEventListener('mousemove', e => {
    if (!_dashChartPoints.length || !_dashChartLayout) return;
    const { PAD, CW } = _dashChartLayout;
    const rect   = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const relX   = mouseX - PAD.l;
    const n      = _dashChartPoints.length;
    const idx    = Math.max(0, Math.min(n - 1, Math.round((relX / CW) * (n - 1))));
    const pt     = _dashChartPoints[idx];

    _dashHoverIdx = idx;
    _dashDrawMainChart(idx);

    const xFrac = (n > 1 ? idx / (n - 1) : 0.5);
    const xPx   = PAD.l + xFrac * CW;
    const tipLeft = Math.min(xPx + 12, canvas.offsetWidth - 170);

    tooltip.style.display = 'block';
    tooltip.style.left    = tipLeft + 'px';
    tooltip.style.top     = '8px';
    tooltip.innerHTML = `
      <div class="dash-tip-date">${_dFmtDate(pt.date)}</div>
      <div class="dash-tip-val">${_dFmtCur(pt.value)}</div>
      ${pt.change !== null ? `<div class="dash-tip-change ${pt.change >= 0 ? 'pos' : 'neg'}">${_dFmtSigned(pt.change)} this week</div>` : ''}`;
  });

  canvas.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
    _dashHoverIdx = -1;
    _dashDrawMainChart();
  });
}

// ── Monthly bar chart ─────────────────────────────────────────────────
function _dashDrawMonthlyChart() {
  const canvas = document.getElementById('dash-monthly-canvas');
  if (!canvas || !_dashInvRecs.length) return;

  // Build last 12 months
  const months = {};
  _dashInvRecs.forEach(r => {
    const mo = r.date?.slice(0, 7);
    if (!mo) return;
    months[mo] = (months[mo] || 0) + (r[_dashGainLossField] || 0);
  });

  const now = new Date();
  const keys = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  const pts  = keys.map(k => ({ month: k, value: months[k] ?? null }));
  const vals = pts.map(p => p.value).filter(v => v !== null);
  if (!vals.length) return;

  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.parentElement.clientWidth || 400;
  const H   = 200;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const PAD = { t: 12, r: 8, b: 36, l: 58 };
  const CW  = W - PAD.l - PAD.r;
  const CH  = H - PAD.t - PAD.b;

  const maxAbsV = Math.max(...vals.map(Math.abs), 1);
  const zero    = PAD.t + CH / 2;
  const barW    = (CW / pts.length) * 0.6;
  const gap     = CW / pts.length;

  // Grid — zero line + upper/lower
  ctx.setLineDash([3, 5]);
  ctx.strokeStyle = '#e6e2d7';
  ctx.lineWidth = 1;
  [0, maxAbsV / 2, maxAbsV, -maxAbsV / 2, -maxAbsV].forEach(v => {
    const y = zero - (v / maxAbsV) * (CH / 2);
    ctx.beginPath();
    ctx.moveTo(PAD.l, y);
    ctx.lineTo(W - PAD.r, y);
    ctx.stroke();
    if (v !== 0) {
      ctx.setLineDash([]);
      ctx.fillStyle = '#b5b4ac';
      ctx.font = `9px 'Inter Tight', sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillText(_dFmtK(v), PAD.l - 4, y + 3);
      ctx.setLineDash([3, 5]);
    }
  });
  ctx.setLineDash([]);

  // Zero line (solid)
  ctx.beginPath();
  ctx.strokeStyle = '#d0ccc2';
  ctx.lineWidth = 1;
  ctx.moveTo(PAD.l, zero);
  ctx.lineTo(W - PAD.r, zero);
  ctx.stroke();

  // Bars
  pts.forEach((pt, i) => {
    if (pt.value === null) return;
    const x  = PAD.l + i * gap + (gap - barW) / 2;
    const bh = Math.abs((pt.value / maxAbsV) * (CH / 2));
    const y  = pt.value >= 0 ? zero - bh : zero;
    ctx.fillStyle = pt.value >= 0 ? '#1f6b3a' : '#a52a2a';
    const r = Math.min(3, barW / 2);
    ctx.beginPath();
    if (pt.value >= 0) {
      ctx.roundRect(x, y, barW, bh, [r, r, 0, 0]);
    } else {
      ctx.roundRect(x, zero, barW, bh, [0, 0, r, r]);
    }
    ctx.fill();

    // Month label
    ctx.fillStyle = '#b5b4ac';
    ctx.font = `9px 'Inter Tight', sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(_dFmtMon(pt.month), x + barW / 2, H - 8);
  });
}

// ── Account breakdown ─────────────────────────────────────────────────
async function _dashRenderBreakdown(latestRecord) {
  const el = document.getElementById('dash-breakdown');
  if (!el) return;

  const allAccts  = await getAccounts();
  const clientId  = getActiveClientId();
  const shown     = allAccts
    .filter(a => a.clientId === clientId && a.tab === 'investments' && !a.hidden && !a.useForGainLoss)
    .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));

  // For accounts that have a cash entry, use the cash entry amount as the base
  // so the value matches Asset Allocation's adjusted total for the same account.
  const cashByAcctId = Object.fromEntries(_dashCashEntries.map(e => [e.accountId, e.amount]));

  const withVals = shown
    .map(a => {
      const cashVal  = cashByAcctId[a.id] ?? null;
      const fieldVal = latestRecord[a.field] ?? null;
      const base = cashVal !== null ? cashVal : fieldVal;
      const adj  = _dashBorrowedByAccount[a.id] || 0;
      return { name: a.name || a.field, field: a.field, value: base !== null ? base + adj : (adj !== 0 ? adj : null) };
    })
    .filter(a => a.value !== null && a.value !== 0);

  if (!withVals.length) {
    el.innerHTML = '<p class="dash-breakdown-empty">No account values found in latest record.</p>';
    return;
  }

  const total  = withVals.reduce((s, a) => s + Math.abs(a.value), 0) || 1;
  const sorted = withVals.slice(0, 12); // already in accounts-tab order from the filter above

  el.innerHTML = sorted.map(a => {
    const pct = (Math.abs(a.value) / total * 100).toFixed(1);
    const pos = a.value >= 0;
    return `
      <div class="dash-bk-row">
        <div class="dash-bk-name">${_dEsc(a.name)}</div>
        <div class="dash-bk-bar-wrap">
          <div class="dash-bk-bar ${pos ? 'pos' : 'neg'}" style="width:${pct}%"></div>
        </div>
        <div class="dash-bk-val ${pos ? 'pos' : 'neg'}">${_dFmtCur(a.value)}</div>
      </div>`;
  }).join('');
}

// ── Asset Allocation widget ───────────────────────────────────────────
function _buildAssetAllocationWidget(latestVal) {
  if (!_dashCashEntries.length || latestVal === null || latestVal <= 0) return '';

  const cashRows = [..._dashCashEntries]
    .sort((a, b) => b.amount - a.amount)
    .map(e => {
      const acct     = _dashAllAccounts.find(a => a.id === e.accountId);
      const name     = acct?.name || 'Unknown Account';
      const original = e.amount;
      const adj      = _dashBorrowedByAccount[e.accountId] || 0;

      // Collect unique account names for borrowed/repayment entries touching this account
      const fromNames = [...new Set(
        [..._dashBorrowedEntries, ..._dashRepaymentEntries]
          .filter(b => b.fromAccount === e.accountId || b.toAccount === e.accountId)
          .map(b => {
            const fa = _dashAllAccounts.find(a => a.id === b.fromAccount);
            return fa?.name || b.fromAccount || '';
          })
          .filter(Boolean)
      )];

      return { name, original, adj, adjusted: original + adj, fromNames };
    });

  const anyAdj     = cashRows.some(r => r.adj !== 0);
  const totalCash  = cashRows.reduce((s, r) => s + r.adjusted, 0);
  const riskAssets = latestVal - totalCash;
  const cashPct    = (totalCash  / latestVal * 100);
  const riskPct    = (riskAssets / latestVal * 100);
  const span       = anyAdj ? 3 : 1;

  const subRows = cashRows.map(r => {
    const adjCls  = r.adj < 0 ? 'num-neg' : r.adj > 0 ? 'num-pos' : 'dash-alloc-zero';
    const adjDisp = r.adj !== 0 ? (r.adj > 0 ? '+' : '') + _dFmtCur(r.adj) : '—';
    const fromDisp = r.fromNames.length ? `From: ${r.fromNames.map(n => _dEsc(n)).join(', ')}` : '';
    return `
      <tr class="dash-alloc-sub">
        <td class="dash-alloc-lbl dash-alloc-lbl-sub">${_dEsc(r.name)}</td>
        <td class="dash-alloc-amt">${_dFmtCur(r.original)}</td>
        ${anyAdj ? `
          <td class="dash-alloc-adj ${adjCls}">${adjDisp}</td>
          <td class="dash-alloc-adjusted${r.adjusted < 0 ? ' num-neg' : ''}">${r.adj !== 0 ? _dFmtCur(r.adjusted) : ''}</td>
        ` : ''}
        <td class="dash-alloc-from">${fromDisp}</td>
      </tr>`;
  }).join('');

  return `
    <div class="dash-card dash-alloc-card">
      <div class="dash-section-title">Asset Allocation</div>
      <table class="dash-alloc-table">
        <tbody>
          <tr class="dash-alloc-total">
            <td class="dash-alloc-lbl">Total Inv. Value</td>
            <td class="dash-alloc-amt dash-alloc-total-val" colspan="${span}">${_dFmtCur(latestVal)}</td>
            <td class="dash-alloc-pct-col"></td>
          </tr>
          <tr class="dash-alloc-cat">
            <td class="dash-alloc-lbl">Risk Assets</td>
            <td class="dash-alloc-amt dash-alloc-risk${riskAssets < 0 ? ' num-neg' : ''}" colspan="${span}">${_dFmtCur(riskAssets)}</td>
            <td class="dash-alloc-pct-col dash-alloc-risk">${riskPct.toFixed(2)}%</td>
          </tr>
          <tr class="dash-alloc-cat">
            <td class="dash-alloc-lbl">Cash</td>
            <td class="dash-alloc-amt dash-alloc-cash" colspan="${span}">${_dFmtCur(totalCash)}</td>
            <td class="dash-alloc-pct-col dash-alloc-cash">${cashPct.toFixed(2)}%</td>
          </tr>
          ${subRows}
        </tbody>
      </table>
    </div>`;
}

// ── Yearly Gain/Loss table ────────────────────────────────────────────
function _buildYearlyTable() {
  if (!_dashInvRecs.length) return '<p class="dash-breakdown-empty">No data.</p>';

  const byYear = {};
  for (const r of _dashInvRecs) {
    if (!r.date) continue;
    const yr = r.date.slice(0, 4);
    byYear[yr] = (byYear[yr] || 0) + (typeof r[_dashGainLossField] === 'number' ? r[_dashGainLossField] : 0);
  }

  const years = Object.keys(byYear).sort((a, b) => b - a);
  if (!years.length) return '<p class="dash-breakdown-empty">No gain/loss data.</p>';

  const grandTotal = years.reduce((s, y) => s + byYear[y], 0);

  const rows = years.map(yr => {
    const v   = byYear[yr];
    const cls = v > 0 ? 'pos' : v < 0 ? 'neg' : '';
    return `<tr>
      <td class="dash-yr-td-year">${yr}</td>
      <td class="dash-yr-td-val ${cls}">${_dFmtSigned(v)}</td>
    </tr>`;
  }).join('');

  const totalCls = grandTotal > 0 ? 'pos' : grandTotal < 0 ? 'neg' : '';

  return `<table class="dash-yearly-table">
    <thead>
      <tr>
        <th>Year</th>
        <th>Gain / Loss</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr class="dash-yr-total">
        <td>Grand Total</td>
        <td class="dash-yr-td-val ${totalCls}">${_dFmtSigned(grandTotal)}</td>
      </tr>
    </tfoot>
  </table>`;
}

// ── Profit Matrix ─────────────────────────────────────────────────────
function _buildProfitMatrix() {
  if (!_dashInvRecs.length) return '<p class="dash-breakdown-empty">No data.</p>';

  const now = new Date();

  const d2m = new Date(now); d2m.setMonth(d2m.getMonth() - 2);
  const d1m = new Date(now); d1m.setMonth(d1m.getMonth() - 1);
  const d2w = new Date(now - 14 * 86400000);
  const d1w = new Date(now -  7 * 86400000);

  const periods = [
    { label: 'Last 2 Months', cutoff: _localIso(d2m) },
    { label: '1 Month',       cutoff: _localIso(d1m) },
    { label: '2 Weeks',       cutoff: _localIso(d2w) },
    { label: '1 Week',        cutoff: _localIso(d1w) },
  ];

  const cards = periods.map(({ label, cutoff }) => {
    const recs  = _dashInvRecs.filter(r => r.date >= cutoff);
    const total = recs.reduce((s, r) => s + (r[_dashGainLossField] || 0), 0);
    const cls   = total > 0 ? 'pos' : total < 0 ? 'neg' : '';
    const disp  = recs.length ? (total >= 0 ? '+' : '') + _dFmtCur(total) : '—';
    const weeks = recs.length;
    return `
      <div class="dash-pm-card">
        <div class="dash-pm-label">${label}</div>
        <div class="dash-pm-value ${cls}">${disp}</div>
        <div class="dash-pm-sub">${weeks} ${weeks !== 1 ? 'entries' : 'entry'}</div>
      </div>`;
  }).join('');

  return `<div class="dash-pm-grid">${cards}</div>`;
}
