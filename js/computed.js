/* ── computed.js ── Computed column management ──────────────────
 *
 * Computed fields sum 2+ existing shown account columns and appear
 * as columns in the Investments and 529 Plans grids.
 * They are listed and managed within the Accounts tab.
 *
 * Exposes: initComputeds(), getComputedColsForTab(tab),
 *          openComputedModal(id), closeComputedModal(),
 *          saveComputedModal(), deleteComputedById(id)
 * ─────────────────────────────────────────────────────────────── */

let _computeds = [];   // filtered to active client

// ─────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────

async function initComputeds() {
  const clientId = typeof getActiveClientId === 'function' ? getActiveClientId() : '';
  const all      = await getComputedFields();
  _computeds     = all.filter(c => !c.clientId || c.clientId === clientId);
}

// ─────────────────────────────────────────────────────────────────
// LOOKUP — called by accounts.js (getOrderedColsForTab) and grids
// ─────────────────────────────────────────────────────────────────

function getComputedColsForTab(tab) {
  return _computeds
    .filter(c => c.tab === tab)
    .sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999))
    .map(c => ({
      header:        c.name,
      field:         `_comp_${c.id}`,
      type:          'currency',
      isComputed:    true,
      computedId:    c.id,
      computedOrder: c.order ?? 9999,
      sourceFields:  c.fields,
    }));
}

// ─────────────────────────────────────────────────────────────────
// MODAL
// ─────────────────────────────────────────────────────────────────

function openComputedModal(id) {
  const c = id ? _computeds.find(x => x.id === id) : null;

  document.getElementById('comp-modal-title').textContent = c ? 'Edit Computed Field' : 'New Computed Field';
  document.getElementById('comp-modal-id').value          = c?.id   || '';
  document.getElementById('comp-modal-name').value        = c?.name || '';

  const tabSel    = document.getElementById('comp-modal-tab');
  tabSel.value    = c?.tab || (typeof _acctTabFilter !== 'undefined' ? _acctTabFilter : 'investments');
  tabSel.disabled = !!c;

  document.getElementById('comp-modal-use-total').checked = c?.useForTotal || false;
  _renderComputedCheckboxes(tabSel.value, c?.fields || []);
  document.getElementById('comp-modal-error').textContent = '';
  document.getElementById('comp-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('comp-modal-name').focus(), 40);
}

function onComputedTabChange() {
  _renderComputedCheckboxes(document.getElementById('comp-modal-tab').value, []);
  document.getElementById('comp-modal-error').textContent = '';
}

function _renderComputedCheckboxes(tab, selectedFields) {
  const wrap     = document.getElementById('comp-modal-fields');
  const accounts = typeof getShownAccountsForTab === 'function' ? getShownAccountsForTab(tab) : [];

  if (!accounts.length) {
    wrap.innerHTML = `<p class="comp-no-accounts">No shown accounts for this tab. Show accounts first.</p>`;
    return;
  }

  wrap.innerHTML = accounts.map(a => {
    const checked = selectedFields.includes(a.field) ? ' checked' : '';
    return `
      <label class="comp-check-label">
        <input type="checkbox" class="comp-check" value="${_cmpEscAttr(a.field)}"${checked}>
        <span>${_cmpEscHtml(a.name)}</span>
      </label>`;
  }).join('');
}

function closeComputedModal() {
  document.getElementById('comp-modal').style.display = 'none';
}

async function saveComputedModal() {
  const existingId = document.getElementById('comp-modal-id').value;
  const name       = document.getElementById('comp-modal-name').value.trim();
  const errEl      = document.getElementById('comp-modal-error');

  if (!name) { document.getElementById('comp-modal-name').focus(); errEl.textContent = 'Name is required.'; return; }

  const checked = [...document.querySelectorAll('#comp-modal-fields .comp-check:checked')].map(cb => cb.value);
  if (checked.length < 2) { errEl.textContent = 'Select at least 2 accounts to sum.'; return; }
  errEl.textContent = '';

  const clientId = typeof getActiveClientId === 'function' ? getActiveClientId() : '';
  const existing = existingId ? _computeds.find(c => c.id === existingId) : null;
  const tab      = existing?.tab || document.getElementById('comp-modal-tab').value;
  const id       = existingId   || `comp_${uid()}`;

  // New computed gets order after all existing items in the tab
  let order = existing?.order;
  if (order == null) {
    const tabItems = [
      ...(typeof _accounts !== 'undefined' ? _accounts.filter(a => a.tab === tab).map(a => a.order ?? -1) : []),
      ..._computeds.filter(c => c.tab === tab).map(c => c.order ?? -1),
    ];
    order = (tabItems.length ? Math.max(...tabItems) : -1) + 1;
  }

  const useForTotal = document.getElementById('comp-modal-use-total').checked;

  // Only one computed field per tab+client can be the dashboard total
  if (useForTotal) {
    const rivals = _computeds.filter(c => c.id !== id && c.tab === tab && c.useForTotal);
    for (const o of rivals) await saveComputedField({ ...o, useForTotal: false });
  }

  await saveComputedField({
    id, clientId: existing?.clientId || clientId,
    tab, name, fields: checked, order, useForTotal,
    createdAt: existing?.createdAt || Date.now(),
  });

  await initComputeds();
  closeComputedModal();
  if (typeof _renderAccountsGrid === 'function') _renderAccountsGrid();

  if (typeof renderInvestmentsGrid === 'function') renderInvestmentsGrid();
  if (typeof renderPlans529Grid    === 'function') renderPlans529Grid();
}

async function deleteComputedById(id) {
  if (!confirm('Delete this computed field?')) return;
  await deleteComputedField(id);
  await initComputeds();
  if (typeof _renderAccountsGrid === 'function') _renderAccountsGrid();

  if (typeof renderInvestmentsGrid === 'function') renderInvestmentsGrid();
  if (typeof renderPlans529Grid    === 'function') renderPlans529Grid();
}

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────

function _cmpEscAttr(s) { return String(s).replace(/'/g, "\\'").replace(/"/g, '&quot;'); }
function _cmpEscHtml(s)  { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
