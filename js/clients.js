/* ── clients.js ── Client management ────────────────────────────
 *
 * State: _clients array, _activeClientId string
 * Exposes: initClients(), getActiveClientId(), setActiveClient(),
 *          initClientsView(), openClientModal(), closeClientModal(),
 *          saveClientModal(), selectClientColor(), deleteClientById()
 * ─────────────────────────────────────────────────────────────── */

const CLIENT_COLORS = [
  '#b8482e', // burnt sienna
  '#1f6b3a', // forest green
  '#1a3f6b', // deep navy
  '#4a2466', // plum
  '#8a6b14', // amber
  '#2d6b6b', // teal
  '#6b2d2d', // dark red
  '#5a5248', // warm grey
];

let _clients       = [];
let _activeClientId = '';

// ─────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────

async function initClients() {
  _clients = await getClients();

  if (_clients.length === 0) {
    await _createDefaultClient();
    _clients = await getClients();
  }

  const saved = localStorage.getItem('dw-active-client');
  if (saved && _clients.find(c => c.id === saved)) {
    _activeClientId = saved;
  } else {
    _activeClientId = _clients[0]?.id || '';
    localStorage.setItem('dw-active-client', _activeClientId);
  }

  _renderClientSelector();
}

async function _createDefaultClient() {
  const id = 'client_default';
  await saveClient({ id, name: 'My Portfolio', color: '#b8482e', isDefault: true, createdAt: Date.now() });
  await _migrateExistingRecords(id);
}

async function _migrateExistingRecords(clientId) {
  const investments = await getInvestments();
  const unassigned  = investments.filter(r => !r.clientId);
  if (unassigned.length) {
    await dbPutBatch('investments', unassigned.map(r => ({ ...r, clientId })));
  }

  const plans         = await getPlans529();
  const unassigned529 = plans.filter(r => !r.clientId);
  if (unassigned529.length) {
    await dbPutBatch('plans529', unassigned529.map(r => ({ ...r, clientId })));
  }
}

// ─────────────────────────────────────────────────────────────────
// ACTIVE CLIENT
// ─────────────────────────────────────────────────────────────────

function getActiveClientId() { return _activeClientId; }

function setActiveClient(id) {
  _activeClientId = id;
  localStorage.setItem('dw-active-client', id);
  _renderClientSelector();
  const reloads = [];
  if (typeof initAccounts   === 'function') reloads.push(initAccounts());
  if (typeof initComputeds  === 'function') reloads.push(initComputeds());
  Promise.all(reloads).then(() => {
    if (typeof state !== 'undefined') {
      if (state.view === 'dashboard')   initDashboardView();
      if (state.view === 'investments') renderInvestmentsGrid();
      if (state.view === '529')         renderPlans529Grid();
      if (state.view === 'kids')        renderKidsGrid();
      if (state.view === 'accounting')  initAccountingView();
      if (state.view === 'accounts')    _renderAccountsGrid();
    }
  });
}

function _renderClientSelector() {
  const sel = document.getElementById('client-sel');
  if (!sel) return;
  sel.innerHTML = _clients.map(c =>
    `<option value="${_cEscAttr(c.id)}"${c.id === _activeClientId ? ' selected' : ''}>${_cEscText(c.name)}</option>`
  ).join('');
  sel.value = _activeClientId;

  const dot = document.getElementById('client-dot');
  if (dot) {
    const active = _clients.find(c => c.id === _activeClientId);
    dot.style.background = active?.color || 'var(--accent)';
  }
}

// ─────────────────────────────────────────────────────────────────
// CLIENTS VIEW
// ─────────────────────────────────────────────────────────────────

async function initClientsView() {
  _clients = await getClients();
  _renderClientsGrid();
}

function _renderClientsGrid() {
  const countEl = document.getElementById('clients-count');
  if (countEl) {
    const n = _clients.length;
    countEl.innerHTML = `<strong>${n}</strong> client${n !== 1 ? 's' : ''}`;
  }

  const grid = document.getElementById('clients-grid');
  if (!grid) return;

  if (!_clients.length) {
    grid.innerHTML = '<div class="clients-empty">No clients yet.</div>';
    return;
  }

  grid.innerHTML = _clients.map(c => `
    <div class="client-card">
      <div class="client-card-color" style="background:${c.color}"></div>
      <div class="client-card-body">
        <div class="client-card-name">${_cEscHtml(c.name)}</div>
        ${c.isDefault ? '<span class="client-default-badge">Default</span>' : ''}
      </div>
      <div class="client-card-actions">
        <button class="client-edit-btn" onclick="openClientModal('${_cEscAttr(c.id)}')">Edit</button>
        ${!c.isDefault
          ? `<button class="client-del-btn" onclick="deleteClientById('${_cEscAttr(c.id)}')">Delete</button>`
          : ''}
      </div>
    </div>
  `).join('');
}

// ─────────────────────────────────────────────────────────────────
// MODAL
// ─────────────────────────────────────────────────────────────────

function openClientModal(id) {
  const c = id ? _clients.find(cl => cl.id === id) : null;

  document.getElementById('cmodal-title').textContent = c ? 'Edit Client' : 'New Client';
  document.getElementById('cmodal-id').value          = c?.id || '';
  document.getElementById('cmodal-name').value        = c?.name || '';

  const activeColor = c?.color || CLIENT_COLORS[0];
  document.getElementById('cmodal-colors').innerHTML = CLIENT_COLORS.map(color => `
    <button type="button" class="color-swatch${color === activeColor ? ' active' : ''}"
      style="background:${color}" data-color="${color}"
      onclick="selectClientColor(this)" aria-label="${color}"></button>
  `).join('');

  document.getElementById('client-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('cmodal-name').focus(), 40);
}

function closeClientModal() {
  document.getElementById('client-modal').style.display = 'none';
}

function selectClientColor(btn) {
  document.querySelectorAll('#cmodal-colors .color-swatch').forEach(s => s.classList.remove('active'));
  btn.classList.add('active');
}

async function saveClientModal() {
  const existingId = document.getElementById('cmodal-id').value;
  const id         = existingId || ('client_' + uid());
  const name       = document.getElementById('cmodal-name').value.trim();
  if (!name) { document.getElementById('cmodal-name').focus(); return; }

  const activeSwatch = document.querySelector('#cmodal-colors .color-swatch.active');
  const color        = activeSwatch?.dataset.color || CLIENT_COLORS[0];
  const existing     = _clients.find(c => c.id === id);

  await saveClient({
    id,
    name,
    color,
    isDefault:  existing?.isDefault  || false,
    createdAt:  existing?.createdAt  || Date.now(),
  });

  _clients = await getClients();
  _renderClientSelector();
  _renderClientsGrid();
  closeClientModal();
}

async function deleteClientById(id) {
  if (_clients.length <= 1) { alert('Cannot delete the only client.'); return; }
  if (!confirm('Delete this client? Their records will remain but become unassigned.')) return;

  await deleteClient(id);

  if (_activeClientId === id) {
    _activeClientId = _clients.find(c => c.id !== id)?.id || '';
    localStorage.setItem('dw-active-client', _activeClientId);
  }

  _clients = await getClients();
  _renderClientSelector();
  _renderClientsGrid();
}

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────

function _cEscAttr(s) {
  return String(s).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
function _cEscHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function _cEscText(s) {
  return String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
