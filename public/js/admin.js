// ═══════════════════════════════════════════════
//  VIDO Admin Panel
// ═══════════════════════════════════════════════

const ALL_PERMISSIONS = [
  'create_project', 'view_project', 'delete_project',
  'generate_video', 'generate_story', 'generate_image',
  'use_tts', 'use_editor', 'use_i2v',
  'manage_users', 'manage_roles', 'manage_settings',
  'view_credits_log', 'adjust_credits'
];

let usersCache = [];
let rolesCache = [];
let editingRoleId = null; // null = create, string = edit

// ── Init ──
(async function init() {
  const ok = await requireAdmin();
  if (!ok) return;

  // 加载主题
  const saved = localStorage.getItem('vido-theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);

  const user = getCurrentUser();
  document.getElementById('topbar-user').innerHTML =
    `<strong>${esc(user.username)}</strong> (${esc(user.role)})`;

  initTabs();
  await Promise.all([loadUsers(), loadRoles(), loadProviders()]);
  populateRoleDropdowns();
  loadCreditsLog();
  loadStats();
  bindEvents();
})();

// ══════════════════════ TABS ══════════════════════
function initTabs() {
  document.querySelectorAll('.nav-item[data-tab]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.nav-item[data-tab]').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
      if (tab.dataset.tab === 'credits') loadCreditsLog();
      if (tab.dataset.tab === 'contents') loadContents();
      if (tab.dataset.tab === 'system') loadStats();
      if (tab.dataset.tab === 'ai') loadProviders();
      if (tab.dataset.tab === 'aicap') loadAICapData();
      if (tab.dataset.tab === 'sync') loadSyncConfig();
    });
  });
}

// ══════════════════════ EVENTS ══════════════════════
function bindEvents() {
  // New user form toggle
  $('#btn-new-user').onclick = () => toggleForm('form-new-user', true);
  $('#btn-cancel-user').onclick = () => toggleForm('form-new-user', false);
  $('#btn-save-user').onclick = createUser;

  // Credits filter
  $('#btn-filter-credits').onclick = loadCreditsLog;

  // Role modal
  $('#btn-new-role').onclick = () => openRoleModal(null);
  $('#btn-cancel-role').onclick = closeRoleModal;
  $('#btn-save-role').onclick = saveRole;
  $('#btn-delete-role').onclick = deleteRole;
  $('#role-modal').onclick = e => { if (e.target === $('#role-modal')) closeRoleModal(); };
}

// ══════════════════════ USERS ══════════════════════
async function loadUsers() {
  try {
    const res = await authFetch('/api/admin/users');
    const data = await res.json();
    usersCache = data.success ? (data.data || []) : [];
  } catch { usersCache = []; }
  renderUsers();
}

function renderUsers() {
  const tbody = $('#users-tbody');
  if (!usersCache.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">暂无用户</td></tr>';
    return;
  }
  tbody.innerHTML = usersCache.map(u => {
    const statusClass = u.status === 'active' ? 'badge-active' : u.status === 'disabled' ? 'badge-disabled' : 'badge-pending';
    const statusLabel = u.status === 'active' ? '正常' : u.status === 'disabled' ? '禁用' : u.status || '-';
    const lastLogin = u.last_login ? new Date(u.last_login).toLocaleString('zh-CN') : '-';
    return `
      <tr data-uid="${u.id}">
        <td><strong>${esc(u.username)}</strong></td>
        <td>${esc(u.email || '-')}</td>
        <td>
          <select class="role-select" onchange="changeUserRole('${u.id}', this.value)">
            ${rolesCache.map(r => `<option value="${r.id}" ${r.id === u.role ? 'selected' : ''}>${esc(r.label || r.id)}</option>`).join('')}
          </select>
        </td>
        <td>${u.credits ?? '-'}</td>
        <td><span class="badge ${statusClass}">${statusLabel}</span></td>
        <td style="font-size:12px;">${lastLogin}</td>
        <td class="actions-cell">
          <button class="btn-sm" onclick="openUserDetail('${u.id}')">查看</button>
          <button class="btn-sm accent" onclick="toggleCreditsForm('${u.id}')">调整积分</button>
          <button class="btn-sm danger" onclick="deleteUser('${u.id}','${esc(u.username)}')">删除</button>
        </td>
      </tr>
      <tr class="row-form" id="credits-form-${u.id}">
        <td colspan="7" style="padding:0;">
          <div style="display:flex;align-items:center;gap:10px;padding:8px 14px;flex-wrap:wrap;">
            <input id="credits-amt-${u.id}" type="number" placeholder="积分变动 (正/负)" style="width:140px;" />
            <input id="credits-reason-${u.id}" placeholder="原因" style="width:200px;" />
            <button class="btn-sm accent" onclick="adjustCredits('${u.id}')">确认</button>
            <button class="btn-sm" onclick="toggleCreditsForm('${u.id}')">取消</button>
          </div>
        </td>
      </tr>
      <tr class="row-form" id="pwd-form-${u.id}">
        <td colspan="7" style="padding:0;">
          <div style="display:flex;align-items:center;gap:10px;padding:8px 14px;flex-wrap:wrap;">
            <input id="pwd-val-${u.id}" type="password" placeholder="新密码" style="width:200px;" />
            <button class="btn-sm accent" onclick="resetPassword('${u.id}')">确认</button>
            <button class="btn-sm" onclick="togglePasswordForm('${u.id}')">取消</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function toggleCreditsForm(uid) {
  const row = $(`#credits-form-${uid}`);
  row.style.display = row.style.display === 'table-row' ? 'none' : 'table-row';
}

function togglePasswordForm(uid) {
  const row = $(`#pwd-form-${uid}`);
  row.style.display = row.style.display === 'table-row' ? 'none' : 'table-row';
}

async function createUser() {
  const body = {
    username: $('#nu-username').value.trim(),
    email: $('#nu-email').value.trim(),
    password: $('#nu-password').value,
    role: $('#nu-role').value
  };
  if (!body.username || !body.password) return toast('用户名和密码必填', 'error');
  try {
    const res = await authFetch('/api/admin/users', { method: 'POST', body: JSON.stringify(body) });
    const data = await res.json();
    if (data.success) {
      toast('用户已创建');
      toggleForm('form-new-user', false);
      $('#nu-username').value = ''; $('#nu-email').value = ''; $('#nu-password').value = '';
      await loadUsers();
    } else {
      toast(data.error || '创建失败', 'error');
    }
  } catch (e) { toast('请求失败: ' + e.message, 'error'); }
}

async function changeUserRole(uid, role) {
  try {
    const res = await authFetch(`/api/admin/users/${uid}`, { method: 'PUT', body: JSON.stringify({ role }) });
    const data = await res.json();
    if (data.success) toast('角色已更新');
    else toast(data.error || '更新失败', 'error');
  } catch (e) { toast('请求失败', 'error'); }
}

async function adjustCredits(uid) {
  const amount = parseInt($(`#credits-amt-${uid}`).value);
  const reason = $(`#credits-reason-${uid}`).value.trim();
  if (isNaN(amount) || amount === 0) return toast('请输入有效的积分数', 'error');
  try {
    const res = await authFetch(`/api/admin/users/${uid}/credits`, {
      method: 'POST', body: JSON.stringify({ amount, reason })
    });
    const data = await res.json();
    if (data.success) {
      toast(`积分已调整 ${amount > 0 ? '+' : ''}${amount}`);
      toggleCreditsForm(uid);
      await loadUsers();
    } else toast(data.error || '调整失败', 'error');
  } catch (e) { toast('请求失败', 'error'); }
}

async function resetPassword(uid) {
  const password = $(`#pwd-val-${uid}`).value;
  if (!password || password.length < 4) return toast('密码至少4位', 'error');
  try {
    const res = await authFetch(`/api/admin/users/${uid}/reset-password`, {
      method: 'POST', body: JSON.stringify({ password })
    });
    const data = await res.json();
    if (data.success) {
      toast('密码已重置');
      togglePasswordForm(uid);
    } else toast(data.error || '重置失败', 'error');
  } catch (e) { toast('请求失败', 'error'); }
}

async function deleteUser(uid, username) {
  if (!confirm(`确定删除用户 "${username}"？此操作不可撤销。`)) return;
  try {
    const res = await authFetch(`/api/admin/users/${uid}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) { toast('用户已删除'); await loadUsers(); }
    else toast(data.error || '删除失败', 'error');
  } catch (e) { toast('请求失败', 'error'); }
}

// ══════════════════════ USER DETAIL MODAL ══════════════════════
let currentDetailUid = null;
let currentDetailPwd = null;

function openUserDetail(uid) {
  const u = usersCache.find(x => x.id === uid);
  if (!u) return;
  currentDetailUid = uid;
  currentDetailPwd = u.password_plain || null;

  document.getElementById('user-modal-title').textContent = `用户详情 — ${u.username}`;
  document.getElementById('ud-id').textContent = u.id;
  document.getElementById('ud-username').textContent = u.username;
  document.getElementById('ud-created').textContent = u.created_at ? new Date(u.created_at).toLocaleString('zh-CN') : '-';
  document.getElementById('ud-login').textContent = u.last_login ? new Date(u.last_login).toLocaleString('zh-CN') : '从未登录';
  document.getElementById('ud-status').textContent = u.status === 'active' ? '正常' : u.status === 'disabled' ? '已禁用' : (u.status || '-');

  // 密码显示
  document.getElementById('ud-pwd-display').textContent = '••••••';
  document.getElementById('btn-show-pwd').textContent = '显示';
  document.getElementById('ud-email').value = u.email || '';
  document.getElementById('ud-credits').textContent = u.credits ?? 0;
  document.getElementById('ud-credits-adj').value = '';
  document.getElementById('ud-credits-reason').value = '';
  document.getElementById('ud-password').value = '';
  document.getElementById('ud-password').type = 'password';
  document.getElementById('ud-status-sel').value = u.status || 'active';

  // 填充角色 select
  const roleSel = document.getElementById('ud-role');
  roleSel.innerHTML = rolesCache.map(r =>
    `<option value="${r.id}" ${r.id === u.role ? 'selected' : ''}>${esc(r.label || r.id)}</option>`
  ).join('');

  document.getElementById('user-modal').classList.add('show');
}

function closeUserModal() {
  document.getElementById('user-modal').classList.remove('show');
  currentDetailUid = null;
}

function toggleShowPwd() {
  const el = document.getElementById('ud-pwd-display');
  const btn = document.getElementById('btn-show-pwd');
  if (btn.textContent === '显示') {
    el.textContent = currentDetailPwd || '（无记录，仅重置后可见）';
    btn.textContent = '隐藏';
  } else {
    el.textContent = '••••••';
    btn.textContent = '显示';
  }
}

function toggleUdPwd() {
  const inp = document.getElementById('ud-password');
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

async function saveUserDetail() {
  if (!currentDetailUid) return;
  const uid = currentDetailUid;
  let changed = false;

  // 1. 更新基本信息（邮箱/角色/状态）
  const email = document.getElementById('ud-email').value.trim();
  const role = document.getElementById('ud-role').value;
  const status = document.getElementById('ud-status-sel').value;
  try {
    const res = await authFetch(`/api/admin/users/${uid}`, {
      method: 'PUT', body: JSON.stringify({ email, role, status })
    });
    const data = await res.json();
    if (!data.success) { toast(data.error || '更新失败', 'error'); return; }
    changed = true;
  } catch (e) { toast('更新失败: ' + e.message, 'error'); return; }

  // 2. 积分调整
  const adj = parseInt(document.getElementById('ud-credits-adj').value);
  if (!isNaN(adj) && adj !== 0) {
    const reason = document.getElementById('ud-credits-reason').value.trim();
    try {
      const res = await authFetch(`/api/admin/users/${uid}/credits`, {
        method: 'POST', body: JSON.stringify({ amount: adj, reason: reason || '管理员调整' })
      });
      const data = await res.json();
      if (!data.success) toast(data.error || '积分调整失败', 'error');
      else changed = true;
    } catch (e) { toast('积分调整失败', 'error'); }
  }

  // 3. 重置密码
  const newPwd = document.getElementById('ud-password').value;
  if (newPwd) {
    if (newPwd.length < 6) { toast('密码至少 6 位', 'error'); return; }
    try {
      const res = await authFetch(`/api/admin/users/${uid}/reset-password`, {
        method: 'POST', body: JSON.stringify({ password: newPwd })
      });
      const data = await res.json();
      if (!data.success) toast(data.error || '密码重置失败', 'error');
      else changed = true;
    } catch (e) { toast('密码重置失败', 'error'); }
  }

  if (changed) {
    toast('用户信息已更新');
    await loadUsers();
    closeUserModal();
  }
}

// Click overlay to close
document.getElementById('user-modal')?.addEventListener('click', e => {
  if (e.target === document.getElementById('user-modal')) closeUserModal();
});

// ══════════════════════ ROLES ══════════════════════
async function loadRoles() {
  try {
    const res = await authFetch('/api/admin/roles');
    const data = await res.json();
    rolesCache = data.success ? (data.data || []) : [];
  } catch { rolesCache = []; }
  renderRoles();
}

function renderRoles() {
  const container = $('#roles-container');
  if (!rolesCache.length) {
    container.innerHTML = '<div class="empty-state">暂无角色</div>';
    return;
  }
  container.innerHTML = rolesCache.map(r => {
    const perms = (r.permissions || []).map(p => `<span class="role-perm-tag">${esc(p)}</span>`).join('');
    return `
      <div class="role-card">
        <div class="role-card-header">
          <span class="role-card-name">${esc(r.label || r.id)}</span>
          <span class="role-card-id">${esc(r.id)}</span>
        </div>
        <div class="role-meta">
          <div class="role-meta-row"><span class="role-meta-label">默认积分</span><span class="role-meta-value">${r.default_credits ?? '-'}</span></div>
          <div class="role-meta-row"><span class="role-meta-label">最大项目</span><span class="role-meta-value">${r.max_projects ?? '-'}</span></div>
          <div class="role-meta-row"><span class="role-meta-label">允许模型</span><span class="role-meta-value">${(r.allowed_models || []).join(', ') || '全部'}</span></div>
          <div class="role-meta-row"><span class="role-meta-label">权限</span><div class="role-perms">${perms || '<span style="color:var(--text3)">无</span>'}</div></div>
        </div>
        <div class="role-card-actions">
          <button class="btn-sm accent" onclick="openRoleModal('${esc(r.id)}')">编辑</button>
          <button class="btn-sm danger" onclick="confirmDeleteRole('${esc(r.id)}','${esc(r.label || r.id)}')">删除</button>
        </div>
      </div>
    `;
  }).join('');
}

function openRoleModal(roleId) {
  editingRoleId = roleId;
  const modal = $('#role-modal');
  const isNew = !roleId;

  $('#role-modal-title').textContent = isNew ? '新建角色' : '编辑角色';
  $('#btn-delete-role').style.display = isNew ? 'none' : 'inline-flex';
  $('#rm-id').disabled = !isNew;

  if (isNew) {
    $('#rm-id').value = '';
    $('#rm-label').value = '';
    $('#rm-credits').value = '100';
    $('#rm-max-projects').value = '10';
    $('#rm-models').value = '';
  } else {
    const r = rolesCache.find(x => x.id === roleId);
    if (!r) return;
    $('#rm-id').value = r.id;
    $('#rm-label').value = r.label || '';
    $('#rm-credits').value = r.default_credits ?? '';
    $('#rm-max-projects').value = r.max_projects ?? '';
    $('#rm-models').value = (r.allowed_models || []).join(', ');
  }

  // Render permission checkboxes
  const permsContainer = $('#rm-permissions');
  const existingPerms = isNew ? [] : (rolesCache.find(x => x.id === roleId)?.permissions || []);
  permsContainer.innerHTML = ALL_PERMISSIONS.map(p => `
    <label style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--text2);cursor:pointer;">
      <input type="checkbox" value="${p}" ${existingPerms.includes(p) ? 'checked' : ''} /> ${p}
    </label>
  `).join('');

  // Render model checkboxes
  renderModelCheckboxes(roleId, isNew);

  modal.classList.add('show');
}

function closeRoleModal() {
  $('#role-modal').classList.remove('show');
  editingRoleId = null;
}

async function saveRole() {
  const id = $('#rm-id').value.trim();
  const label = $('#rm-label').value.trim();
  const default_credits = parseInt($('#rm-credits').value) || 0;
  const max_projects = parseInt($('#rm-max-projects').value) || 10;
  const wildcard = $('#rm-models-wildcard')?.checked;
  const allowed_models = wildcard ? ['*'] : [...$('#rm-models').querySelectorAll('input:checked')].map(cb => cb.value);
  const permissions = [...$('#rm-permissions').querySelectorAll('input:checked')].map(cb => cb.value);

  if (!id) return toast('角色 ID 必填', 'error');

  const body = { id, label, default_credits, max_projects, allowed_models, permissions };
  const isNew = !editingRoleId;

  try {
    const url = isNew ? '/api/admin/roles' : `/api/admin/roles/${editingRoleId}`;
    const method = isNew ? 'POST' : 'PUT';
    const res = await authFetch(url, { method, body: JSON.stringify(body) });
    const data = await res.json();
    if (data.success) {
      toast(isNew ? '角色已创建' : '角色已更新');
      closeRoleModal();
      await loadRoles();
      populateRoleDropdowns();
    } else toast(data.error || '操作失败', 'error');
  } catch (e) { toast('请求失败', 'error'); }
}

async function deleteRole() {
  if (!editingRoleId) return;
  if (!confirm(`确定删除角色 "${editingRoleId}"？`)) return;
  try {
    const res = await authFetch(`/api/admin/roles/${editingRoleId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      toast('角色已删除');
      closeRoleModal();
      await loadRoles();
      populateRoleDropdowns();
    } else toast(data.error || '删除失败', 'error');
  } catch (e) { toast('请求失败', 'error'); }
}

async function confirmDeleteRole(id, label) {
  if (!confirm(`确定删除角色 "${label}"？`)) return;
  try {
    const res = await authFetch(`/api/admin/roles/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      toast('角色已删除');
      await loadRoles();
      populateRoleDropdowns();
    } else toast(data.error || '删除失败', 'error');
  } catch (e) { toast('请求失败', 'error'); }
}

// ══════════════════════ CREDITS LOG ══════════════════════
async function loadCreditsLog() {
  const params = new URLSearchParams();
  const userId = $('#cf-user').value;
  const operation = $('#cf-operation').value;
  const start = $('#cf-start').value;
  const end = $('#cf-end').value;
  if (userId) params.set('user_id', userId);
  if (operation) params.set('operation', operation);
  if (start) params.set('start_date', start);
  if (end) params.set('end_date', end);
  params.set('limit', '100');

  const tbody = $('#credits-tbody');
  try {
    const res = await authFetch(`/api/admin/credits-log?${params}`);
    const data = await res.json();
    const logs = data.success ? (data.data || []) : [];
    if (!logs.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">暂无记录</td></tr>';
      return;
    }
    tbody.innerHTML = logs.map(l => {
      const time = l.created_at ? new Date(l.created_at).toLocaleString('zh-CN') : '-';
      const amtClass = (l.amount || 0) >= 0 ? 'color:var(--success)' : 'color:var(--error)';
      const amtStr = (l.amount || 0) >= 0 ? `+${l.amount}` : `${l.amount}`;
      return `<tr>
        <td style="font-size:12px;">${time}</td>
        <td>${esc(l.username || l.user_id || '-')}</td>
        <td><span class="badge badge-pending">${esc(l.operation || '-')}</span></td>
        <td style="${amtClass};font-weight:600;">${amtStr}</td>
        <td>${l.balance ?? '-'}</td>
        <td style="font-size:12px;color:var(--text3);">${esc(l.reason || l.detail || '-')}</td>
      </tr>`;
    }).join('');
  } catch { tbody.innerHTML = '<tr><td colspan="6" class="empty-state">加载失败</td></tr>'; }
}

// ══════════════════════ STATS ══════════════════════
async function loadStats() {
  try {
    const res = await authFetch('/api/admin/stats');
    const data = await res.json();
    if (data.success && data.data) {
      const s = data.data;
      $('#st-total-users').textContent = s.total_users ?? '-';
      $('#st-active-users').textContent = s.active_users ?? '-';
      $('#st-today-credits').textContent = s.today_credits_consumed ?? '-';
      $('#st-total-txns').textContent = s.total_transactions ?? '-';
    }
  } catch {}
}

// ══════════════════════ HELPERS ══════════════════════
function $(sel) { return document.querySelector(sel); }

function esc(str) {
  if (str == null) return '';
  const d = document.createElement('div');
  d.textContent = String(str);
  return d.innerHTML;
}

function toggleForm(id, show) {
  document.getElementById(id).classList.toggle('show', show);
}

function populateRoleDropdowns() {
  // New user role select
  const nuRole = $('#nu-role');
  if (nuRole) {
    nuRole.innerHTML = rolesCache.map(r =>
      `<option value="${esc(r.id)}">${esc(r.label || r.id)}</option>`
    ).join('');
  }
  // Credits filter user select
  const cfUser = $('#cf-user');
  if (cfUser) {
    const current = cfUser.value;
    cfUser.innerHTML = '<option value="">全部</option>' +
      usersCache.map(u => `<option value="${u.id}">${esc(u.username)}</option>`).join('');
    cfUser.value = current;
  }
  // Re-render user table to update role selects
  renderUsers();
}

// ══════════════════════ MODEL CHECKBOXES ══════════════════════
function renderModelCheckboxes(roleId, isNew) {
  const container = $('#rm-models');
  const wildcardCb = $('#rm-models-wildcard');
  const role = isNew ? null : rolesCache.find(x => x.id === roleId);
  const existing = role ? (role.allowed_models || []) : [];
  const isWildcard = existing.includes('*');

  if (wildcardCb) wildcardCb.checked = isWildcard;

  // Gather all models from settings providers
  const allModels = [];
  if (settingsData?.providers) {
    settingsData.providers.forEach(p => {
      (p.models || []).forEach(m => {
        if (!allModels.find(x => x.id === m.id)) {
          allModels.push({ id: m.id, name: m.name, provider: p.name, use: m.use });
        }
      });
    });
  }
  // Also add special entries
  ['demo', '*'].forEach(id => {
    if (id === '*') return;
    if (!allModels.find(x => x.id === id)) allModels.push({ id, name: id, provider: '内置', use: '' });
  });

  if (!allModels.length) {
    container.innerHTML = '<div style="font-size:11px;color:var(--text3)">暂无可选模型，请先在 AI 配置中添加供应商和模型</div>';
    return;
  }

  container.innerHTML = allModels.map(m => `
    <label style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--text2);cursor:pointer;min-width:160px;${isWildcard ? 'opacity:0.4;pointer-events:none' : ''}">
      <input type="checkbox" value="${esc(m.id)}" ${isWildcard || existing.includes(m.id) ? 'checked' : ''} />
      <span>${esc(m.name)}</span>
      <span style="font-size:10px;color:var(--text3)">${esc(m.provider)}</span>
    </label>
  `).join('');
}

function toggleAllModels(selectAll) {
  const container = $('#rm-models');
  if (!container) return;
  container.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = selectAll);
}

function toggleModelsWildcard(checked) {
  const container = $('#rm-models');
  if (!container) return;
  container.querySelectorAll('label').forEach(l => {
    l.style.opacity = checked ? '0.4' : '';
    l.style.pointerEvents = checked ? 'none' : '';
  });
  if (checked) container.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
}

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `admin-toast ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

// ══════════════════════════════════════════════════
//  AI 配置（供应商 / MCP / Skill — 与前端 app.js 同结构）
// ══════════════════════════════════════════════════

let settingsData = null;
let editingProviderId = null;
let addingModelForProv = null;
let presetsCache = null;
const USE_LABELS = { story: '剧情生成', image: '图像生成', video: '视频生成', tts: '语音合成', avatar: '数字人' };

function switchAITab(tab) {
  ['providers', 'mcps', 'skills'].forEach(t => {
    document.getElementById('sptab-' + t)?.classList.toggle('active', t === tab);
    const pane = document.getElementById('sppane-' + t);
    if (pane) pane.style.display = t === tab ? '' : 'none';
  });
}

async function loadProviders() {
  const list = document.getElementById('sp-providers-list');
  if (list) list.innerHTML = '<div class="sp-loading">加载中...</div>';
  try {
    const [sRes, pRes] = await Promise.all([authFetch('/api/settings'), authFetch('/api/settings/presets')]);
    const sData = await sRes.json(); const pData = await pRes.json();
    if (!sData.success) throw new Error(sData.error);
    settingsData = sData.data;
    presetsCache = pData.success ? pData.data : [];
    renderProviders(); renderMCPs(); renderSkills();
  } catch (e) {
    if (list) list.innerHTML = `<div class="sp-loading" style="color:var(--error)">${esc(e.message)}</div>`;
  }
}

// 供应商渲染
function renderProviders() {
  const container = document.getElementById('sp-providers-list');
  if (!container || !settingsData) return;
  if (!settingsData.providers.length) {
    container.innerHTML = `<div class="sp-empty-state"><p>还没有供应商<br><span style="font-size:11px">点击「添加供应商」开始配置</span></p></div>`;
    return;
  }
  container.innerHTML = settingsData.providers.map(p => {
    const models = p.models || [];
    const checking = p._checking;
    const statusClass = checking ? 'checking' : !p.enabled ? 'inactive' : p.test_status === 'error' ? 'error' : p.test_status === 'ok' ? 'active' : 'unknown';
    const statusText  = checking ? '检测中' : !p.enabled ? '未启用' : p.test_status === 'error' ? '异常' : p.test_status === 'ok' ? '正常' : '未检测';
    const statusIcon  = checking ? '<span class="sp-status-spin"></span>' : p.test_status === 'ok' ? '<span class="sp-status-dot active"></span>' : p.test_status === 'error' ? '<span class="sp-status-dot error"></span>' : '';
    const statusTip   = p.test_error ? esc(p.test_error) : '';
    const testedAt = p.last_tested ? new Date(p.last_tested).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-';
    const useSummary = [...new Set(models.map(m => USE_LABELS[m.use]).filter(Boolean))].join(' · ');
    return `<div class="sp-provider-row" id="sprow-${esc(p.id)}">
      <div class="sp-prov-main" onclick="toggleProviderModels('${esc(p.id)}')">
        <div class="sp-prov-info">
          <div class="sp-prov-name-line">
            ${statusIcon}<span class="sp-prov-name">${esc(p.name)}</span>
            <span class="sp-status-badge ${statusClass}" ${statusTip ? `title="${statusTip}"` : ''}>${statusText}</span>
          </div>
          <div class="sp-prov-meta">
            <span class="sp-prov-tag">${esc(p.id.toUpperCase())}</span>
            ${useSummary ? `<span class="sp-prov-use-summary">${useSummary}</span>` : ''}
          </div>
        </div>
        <div class="sp-prov-url" title="${esc(p.api_url)}">${esc(p.api_url)}</div>
        <div class="sp-prov-key">${p.api_key_masked ? esc(p.api_key_masked) : '<span style="color:var(--text3)">未配置</span>'}</div>
        <div class="sp-prov-model-count"><span class="sp-cnt-num">${models.length}</span><span class="sp-cnt-label">模型</span></div>
        <div class="sp-prov-tested">${testedAt !== '-' ? `<span class="sp-tested-label">最近测试</span>` : ''}<span class="sp-tested-time">${testedAt}</span></div>
        <div class="sp-prov-actions" onclick="event.stopPropagation()">
          <button class="sp-btn" onclick="editProviderKey('${esc(p.id)}')">编辑</button>
          <button class="sp-btn" id="sptest-${esc(p.id)}" onclick="testProvider('${esc(p.id)}')" ${!p.enabled?'disabled':''}>测试</button>
          <button class="sp-btn danger" onclick="deleteProvider('${esc(p.id)}')">删除</button>
        </div>
        <span class="sp-expand-icon">▶</span>
      </div>
      ${statusTip ? `<div class="sp-error-bar">${statusTip}</div>` : ''}
      <div class="sp-models-sub" id="spmodels-${esc(p.id)}">
        <div class="sp-models-sub-head"><span>${models.length} 个模型</span><button class="sp-btn primary-btn" onclick="showAddModel('${esc(p.id)}')">＋ 添加模型</button></div>
        ${models.length ? models.map(m => `
          <div class="sp-model-row">
            <span class="sp-model-name">${esc(m.name)}</span>
            <span class="sp-model-id">${esc(m.id)}</span>
            <span class="sp-model-type">${esc(m.type)}</span>
            <span class="sp-model-use">${esc(USE_LABELS[m.use] || m.use)}</span>
            <button class="sp-model-del" onclick="deleteModel('${esc(p.id)}','${esc(m.id)}')" title="删除">×</button>
          </div>`).join('')
        : '<div style="font-size:11px;color:var(--text3);padding:4px 0">暂无模型</div>'}
      </div>
    </div>`;
  }).join('');
}

function toggleProviderModels(id) {
  const sub = document.getElementById('spmodels-' + id);
  const main = sub?.previousElementSibling;
  if (!sub) return;
  const open = sub.classList.toggle('open');
  main?.classList.toggle('expanded', open);
}

// 添加供应商
async function showAddProvider() {
  if (!presetsCache) { const res = await authFetch('/api/settings/presets'); const d = await res.json(); presetsCache = d.success ? d.data : []; }
  ['prov-name','prov-id','prov-url','prov-key'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('modal-provider-title').textContent = '添加供应商';
  document.getElementById('btn-save-provider').textContent = '添加';
  const btns = document.getElementById('sp-preset-btns');
  btns.innerHTML = presetsCache.map(p => `<button onclick="applyPreset('${esc(p.id)}')">${esc(p.name || p.id)}</button>`).join('');
  updateModelsPreview([]);
  document.getElementById('modal-provider').classList.add('show');
}

function applyPreset(presetId) {
  const preset = presetsCache?.find(p => p.id === presetId);
  if (!preset) return;
  document.getElementById('prov-name').value = preset.name;
  document.getElementById('prov-id').value = presetId;
  document.getElementById('prov-url').value = preset.api_url;
  document.querySelectorAll('#sp-preset-btns button').forEach(b => b.classList.toggle('active', b.textContent === preset.name));
  updateModelsPreview(preset.defaultModels || []);
}

function updateModelsPreview(models) {
  const el = document.getElementById('prov-models-preview');
  if (!el) return;
  el.innerHTML = models.length
    ? models.map(m => `<div style="display:flex;gap:8px;padding:2px 0;font-size:12px"><span>${esc(m.name)}</span><span style="color:var(--text3)">${esc(m.id)}</span><span style="font-size:10px;color:var(--accent)">${esc(m.type)}</span></div>`).join('')
    : '<div style="font-size:11px;color:var(--text3)">选择预设后将自动添加默认模型</div>';
}

function closeProviderModal() { document.getElementById('modal-provider').classList.remove('show'); }

async function saveProvider() {
  const name = document.getElementById('prov-name').value.trim();
  const id = document.getElementById('prov-id').value.trim();
  const url = document.getElementById('prov-url').value.trim();
  const key = document.getElementById('prov-key').value.trim();
  if (!name || !url) { toast('请填写供应商名称和 API 地址', 'error'); return; }
  const btn = document.getElementById('btn-save-provider');
  btn.disabled = true; btn.textContent = '添加中...';
  const preset = presetsCache?.find(p => p.id === id);
  const models = preset?.defaultModels || [];
  try {
    const res = await authFetch('/api/settings/providers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id || undefined, name, api_url: url, api_key: key, models }) });
    const data = await res.json(); if (!data.success) throw new Error(data.error);
    closeProviderModal(); await loadProviders(); toast('供应商已添加');
  } catch (e) { toast('添加失败: ' + e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = '添加'; }
}

// 编辑供应商
function editProviderKey(id) {
  editingProviderId = id;
  const p = settingsData?.providers.find(p => p.id === id);
  if (!p) return;
  document.getElementById('modal-apikey-title').textContent = `编辑 ${p.name}`;
  document.getElementById('modal-prov-url').value = p.api_url || '';
  document.getElementById('modal-apikey-input').value = '';
  document.getElementById('modal-apikey').classList.add('show');
}
function closeApiKeyModal() { document.getElementById('modal-apikey').classList.remove('show'); editingProviderId = null; }
async function saveProviderEdit() {
  if (!editingProviderId) return;
  const url = document.getElementById('modal-prov-url').value.trim();
  const key = document.getElementById('modal-apikey-input').value.trim();
  try {
    const body = {}; if (url) body.api_url = url; if (key) body.api_key = key;
    const res = await authFetch(`/api/settings/providers/${editingProviderId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json(); if (!data.success) throw new Error(data.error);
    closeApiKeyModal(); await loadProviders(); toast('已保存');
  } catch (e) { toast('保存失败: ' + e.message, 'error'); }
}

// 删除/测试供应商
async function deleteProvider(id) {
  const p = settingsData?.providers.find(p => p.id === id);
  if (!confirm(`确认删除供应商「${p?.name || id}」？`)) return;
  await authFetch(`/api/settings/providers/${id}`, { method: 'DELETE' });
  await loadProviders(); toast('已删除');
}
async function testProvider(id) {
  const btn = document.getElementById('sptest-' + id);
  if (btn) { btn.disabled = true; btn.textContent = '测试中...'; }
  try {
    const res = await authFetch(`/api/settings/providers/${id}/test`, { method: 'POST' });
    const data = await res.json();
    if (btn) { btn.textContent = data.success ? '✓ 正常' : '✕ 失败'; btn.style.color = data.success ? '#00d464' : '#ff5050'; setTimeout(() => { if(btn){btn.textContent='测试';btn.style.color='';btn.disabled=false;} },3000); }
    await loadProviders();
  } catch (e) { if (btn) { btn.textContent = '失败'; btn.disabled = false; } }
}
async function refreshAllProviders() {
  const indicator = document.getElementById('sp-refresh-indicator');
  if (indicator) { indicator.style.display = 'inline-flex'; indicator.textContent = '刷新中...'; }
  settingsData?.providers?.forEach(p => { if (p.enabled && p.api_key) p._checking = true; }); renderProviders();
  try {
    await authFetch('/api/settings/providers/refresh-all', { method: 'POST' });
    await loadProviders();
    if (indicator) { indicator.textContent = '刷新完成'; setTimeout(() => { indicator.style.display = 'none'; }, 2000); }
    toast('刷新完成');
  } catch (e) { toast('刷新失败', 'error'); if (indicator) indicator.style.display = 'none'; }
  finally { settingsData?.providers?.forEach(p => { delete p._checking; }); }
}

// 模型
function showAddModel(providerId) {
  addingModelForProv = providerId;
  ['model-id','model-name'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('modal-model').classList.add('show');
}
function closeModelModal() { document.getElementById('modal-model').classList.remove('show'); addingModelForProv = null; }
async function saveModel() {
  if (!addingModelForProv) return;
  const modelId = document.getElementById('model-id').value.trim();
  const name = document.getElementById('model-name').value.trim();
  if (!modelId || !name) { toast('请填写模型 ID 和名称', 'error'); return; }
  try {
    const res = await authFetch(`/api/settings/providers/${addingModelForProv}/models`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: modelId, name, type: document.getElementById('model-type').value, use: document.getElementById('model-use').value }) });
    const data = await res.json(); if (!data.success) throw new Error(data.error);
    closeModelModal(); await loadProviders(); toast('模型已添加');
    setTimeout(() => { const sub = document.getElementById('spmodels-' + addingModelForProv); if (sub && !sub.classList.contains('open')) toggleProviderModels(addingModelForProv); }, 100);
  } catch (e) { toast('添加失败: ' + e.message, 'error'); }
}
async function deleteModel(providerId, modelId) {
  if (!confirm(`确认删除模型 ${modelId}？`)) return;
  await authFetch(`/api/settings/providers/${providerId}/models/${modelId}`, { method: 'DELETE' });
  await loadProviders(); toast('已删除');
  setTimeout(() => { const sub = document.getElementById('spmodels-' + providerId); if (sub && !sub.classList.contains('open')) toggleProviderModels(providerId); }, 100);
}

// MCP
function renderMCPs() {
  const container = document.getElementById('sp-mcps-list');
  if (!container || !settingsData) return;
  if (!settingsData.mcps || !settingsData.mcps.length) {
    container.innerHTML = `<div class="sp-empty-state"><p>还没有 MCP 连接器<br><span style="font-size:11px">点击「添加连接器」接入外部工具</span></p></div>`;
    return;
  }
  container.innerHTML = settingsData.mcps.map(m => `
    <div class="sp-card">
      <div class="sp-card-head">
        <div class="sp-card-icon">🔌</div>
        <div class="sp-card-info">
          <div class="sp-card-name">${esc(m.name)}</div>
          <div class="sp-card-desc">${esc(m.description || '外部 MCP 服务')}</div>
          <div class="sp-card-url">${esc(m.url)}</div>
        </div>
      </div>
      <div class="sp-card-actions"><button class="sp-card-del" onclick="deleteMCP('${m.id}')">删除</button></div>
    </div>`).join('');
}
function showAddMCP() {
  ['mcp-name','mcp-url','mcp-desc'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
  document.getElementById('modal-mcp').classList.add('show');
}
function closeMCPModal() { document.getElementById('modal-mcp').classList.remove('show'); }
async function saveMCP() {
  const name = document.getElementById('mcp-name').value.trim();
  const url = document.getElementById('mcp-url').value.trim();
  if (!name || !url) { toast('请填写名称和 URL', 'error'); return; }
  try {
    const res = await authFetch('/api/settings/mcps', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, url, description: document.getElementById('mcp-desc').value.trim() }) });
    const data = await res.json(); if (!data.success) throw new Error(data.error);
    closeMCPModal(); await loadProviders(); switchAITab('mcps'); toast('MCP 已添加');
  } catch(e) { toast('添加失败: ' + e.message, 'error'); }
}
async function deleteMCP(id) {
  if (!confirm('确认删除该 MCP 连接器？')) return;
  await authFetch(`/api/settings/mcps/${id}`, { method: 'DELETE' });
  await loadProviders(); switchAITab('mcps'); toast('已删除');
}

// Skill
function renderSkills() {
  const container = document.getElementById('sp-skills-list');
  if (!container || !settingsData) return;
  if (!settingsData.skills || !settingsData.skills.length) {
    container.innerHTML = `<div class="sp-empty-state"><p>还没有 Skill<br><span style="font-size:11px">点击「新建 Skill」创建 AI 能力</span></p></div>`;
    return;
  }
  const TYPE_COLORS = { '图像':'#ffb400','文本':'#2178ff','视频':'#7850ff','语音':'#00c878','通用':'#7c6cf0' };
  container.innerHTML = settingsData.skills.map(s => `
    <div class="sp-card">
      <div class="sp-card-head">
        <div class="sp-card-icon">${esc(s.emoji||'⚡')}</div>
        <div class="sp-card-info">
          <div class="sp-card-name">${esc(s.name)}</div>
          <div class="sp-card-desc">${esc(s.description||'')}</div>
        </div>
      </div>
      <div class="sp-card-meta">
        <span class="sp-card-type" style="color:${TYPE_COLORS[s.type]||'#7c6cf0'}">${esc(s.type)}</span>
        ${s.endpoint ? `<span style="font-size:10px;color:var(--text3)">${esc(s.endpoint)}</span>` : ''}
      </div>
      <div class="sp-card-actions"><button class="sp-card-del" onclick="deleteSkill('${s.id}')">删除</button></div>
    </div>`).join('');
}
function showAddSkill() {
  ['skill-name','skill-emoji','skill-endpoint','skill-desc'].forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
  document.getElementById('modal-skill').classList.add('show');
}
function closeSkillModal() { document.getElementById('modal-skill').classList.remove('show'); }
async function saveSkill() {
  const name = document.getElementById('skill-name').value.trim();
  if (!name) { toast('请填写 Skill 名称', 'error'); return; }
  try {
    const res = await authFetch('/api/settings/skills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, emoji: document.getElementById('skill-emoji').value.trim()||'⚡', type: document.getElementById('skill-type').value, endpoint: document.getElementById('skill-endpoint').value.trim(), description: document.getElementById('skill-desc').value.trim() }) });
    const data = await res.json(); if (!data.success) throw new Error(data.error);
    closeSkillModal(); await loadProviders(); switchAITab('skills'); toast('Skill 已创建');
  } catch(e) { toast('创建失败: ' + e.message, 'error'); }
}
async function deleteSkill(id) {
  if (!confirm('确认删除该 Skill？')) return;
  await authFetch(`/api/settings/skills/${id}`, { method: 'DELETE' });
  await loadProviders(); switchAITab('skills'); toast('已删除');
}

// ══════════════════════ 内容管理 ══════════════════════
let contentsLoaded = false;
async function loadContents() {
  // 填充用户下拉
  if (!contentsLoaded) {
    const sel = document.getElementById('ct-user');
    usersCache.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id; opt.textContent = u.username;
      sel.appendChild(opt);
    });
    contentsLoaded = true;
  }

  const type = document.getElementById('ct-type').value;
  const userId = document.getElementById('ct-user').value;
  const params = new URLSearchParams();
  if (type) params.set('type', type);
  if (userId) params.set('user_id', userId);
  params.set('limit', '200');

  try {
    const res = await authFetch('/api/admin/contents?' + params.toString());
    const data = await res.json();
    if (!data.success) return;

    const items = data.data.items;
    const tbody = document.getElementById('contents-tbody');

    // 统计
    const stats = document.getElementById('contents-stats');
    const pCount = items.filter(i => i.type === 'project').length;
    const iCount = items.filter(i => i.type === 'i2v').length;
    const nCount = items.filter(i => i.type === 'novel').length;
    stats.innerHTML = `<span class="ct-stat">共 <b>${data.data.total}</b> 条</span>` +
      (pCount ? `<span class="ct-stat">视频项目 <b>${pCount}</b></span>` : '') +
      (iCount ? `<span class="ct-stat">图生视频 <b>${iCount}</b></span>` : '') +
      (nCount ? `<span class="ct-stat">小说 <b>${nCount}</b></span>` : '');

    const TYPE_LABELS = { project: 'AI 视频', i2v: '图生视频', novel: 'AI 小说' };
    const TYPE_COLORS = { project: '#7c6cf0', i2v: '#21fff3', novel: '#f5c518' };

    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:40px">暂无内容</td></tr>';
      return;
    }

    tbody.innerHTML = items.map(item => `<tr>
      <td><span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;background:${TYPE_COLORS[item.type]}18;color:${TYPE_COLORS[item.type]};border:1px solid ${TYPE_COLORS[item.type]}30">${TYPE_LABELS[item.type] || item.type}</span></td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(item.title)}">${esc(item.title)}</td>
      <td>${esc(item.username)}</td>
      <td><span style="font-size:12px;color:var(--text2)">${esc(item.status || '-')}</span></td>
      <td style="font-size:12px;color:var(--text3)">${esc(item.detail || '')}</td>
      <td style="font-size:12px;color:var(--text3);white-space:nowrap">${item.created_at ? new Date(item.created_at).toLocaleString('zh-CN') : '-'}</td>
      <td class="actions-cell">
        <button class="btn-sm" onclick="viewContent('${item.type}','${item.id}')">查看</button>
        <button class="btn-sm danger" onclick="deleteContent('${item.type}','${item.id}')">删除</button>
      </td>
    </tr>`).join('');
  } catch (e) { console.error('loadContents error', e); }
}

async function viewContent(type, id) {
  try {
    const res = await authFetch(`/api/admin/contents/${type}/${id}`);
    const data = await res.json();
    if (!data.success) return toast(data.error || '获取失败', 'error');
    const item = data.data;
    showContentDetail(item);
  } catch (e) { toast('获取失败: ' + e.message, 'error'); }
}

function showContentDetail(item) {
  // 移除已有的弹窗
  document.querySelectorAll('.ct-detail-overlay').forEach(e => e.remove());
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay show ct-detail-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  let body = '';
  const token = getToken() || '';
  const TYPE_NAMES = { project: 'AI 视频项目', i2v: '图生视频', novel: 'AI 小说' };

  if (item.type === 'project') {
    body = `
      <div class="ct-detail-meta">
        <div class="ct-meta-row"><span class="ct-meta-label">用户</span><span>${esc(item.username)}</span></div>
        <div class="ct-meta-row"><span class="ct-meta-label">状态</span><span>${esc(item.status || '-')}</span></div>
        <div class="ct-meta-row"><span class="ct-meta-label">场景数</span><span>${item.scene_count || '-'}</span></div>
        <div class="ct-meta-row"><span class="ct-meta-label">视频供应商</span><span>${esc(item.video_provider || '-')} / ${esc(item.video_model || '-')}</span></div>
        <div class="ct-meta-row"><span class="ct-meta-label">动画风格</span><span>${esc(item.anim_style || '-')}</span></div>
        <div class="ct-meta-row"><span class="ct-meta-label">创建时间</span><span>${item.created_at ? new Date(item.created_at).toLocaleString('zh-CN') : '-'}</span></div>
      </div>
      ${item.prompt ? `<div class="ct-section"><div class="ct-sec-title">创作提示词</div><div class="ct-text-block">${esc(item.prompt)}</div></div>` : ''}
      ${item.has_video ? `<div class="ct-section"><div class="ct-sec-title">生成视频</div><video class="ct-video" controls src="${item.stream_url}?token=${encodeURIComponent(token)}"></video></div>` : '<div class="ct-section"><div class="ct-sec-title">视频</div><div class="ct-empty">尚未生成视频</div></div>'}
      ${item.scenes?.length ? `<div class="ct-section"><div class="ct-sec-title">场景列表</div>${item.scenes.map(s => `<div class="ct-scene-card"><span class="ct-scene-idx">S${s.index}</span><span class="ct-scene-desc">${esc(s.description || s.visual_prompt || '')}</span></div>`).join('')}</div>` : ''}
    `;
  } else if (item.type === 'i2v') {
    body = `
      <div class="ct-detail-meta">
        <div class="ct-meta-row"><span class="ct-meta-label">用户</span><span>${esc(item.username)}</span></div>
        <div class="ct-meta-row"><span class="ct-meta-label">状态</span><span>${esc(item.status || '-')}</span></div>
        <div class="ct-meta-row"><span class="ct-meta-label">供应商</span><span>${esc(item.provider || '-')} / ${esc(item.model || '-')}</span></div>
        <div class="ct-meta-row"><span class="ct-meta-label">创建时间</span><span>${item.created_at ? new Date(item.created_at).toLocaleString('zh-CN') : '-'}</span></div>
      </div>
      ${item.prompt ? `<div class="ct-section"><div class="ct-sec-title">提示词</div><div class="ct-text-block">${esc(item.prompt)}</div></div>` : ''}
      ${item.image_url ? `<div class="ct-section"><div class="ct-sec-title">源图片</div><img class="ct-image" src="${item.image_url}?token=${encodeURIComponent(token)}" /></div>` : ''}
      ${item.has_video ? `<div class="ct-section"><div class="ct-sec-title">生成视频</div><video class="ct-video" controls src="${item.stream_url}?token=${encodeURIComponent(token)}"></video></div>` : '<div class="ct-section"><div class="ct-sec-title">视频</div><div class="ct-empty">尚未完成</div></div>'}
    `;
  } else if (item.type === 'novel') {
    const GENRE_MAP = { fantasy:'奇幻', wuxia:'武侠', xianxia:'仙侠', scifi:'科幻', romance:'言情', mystery:'悬疑', horror:'恐怖', urban:'都市', historical:'历史' };
    const TYPE_MAP = { flash:'超短篇', short:'短篇', long:'长篇' };
    body = `
      <div class="ct-detail-meta">
        <div class="ct-meta-row"><span class="ct-meta-label">用户</span><span>${esc(item.username)}</span></div>
        <div class="ct-meta-row"><span class="ct-meta-label">篇幅</span><span>${TYPE_MAP[item.novel_type] || '短篇'}</span></div>
        <div class="ct-meta-row"><span class="ct-meta-label">题材</span><span>${GENRE_MAP[item.genre] || item.genre || '-'}</span></div>
        <div class="ct-meta-row"><span class="ct-meta-label">总字数</span><span>${(item.total_words || 0).toLocaleString()} 字</span></div>
        <div class="ct-meta-row"><span class="ct-meta-label">章节</span><span>${item.chapters?.length || 0} 章已写</span></div>
        <div class="ct-meta-row"><span class="ct-meta-label">创建时间</span><span>${item.created_at ? new Date(item.created_at).toLocaleString('zh-CN') : '-'}</span></div>
      </div>
      ${item.synopsis ? `<div class="ct-section"><div class="ct-sec-title">故事简介</div><div class="ct-text-block">${esc(item.synopsis)}</div></div>` : ''}
      ${item.outline_chapters?.length ? `<div class="ct-section"><div class="ct-sec-title">大纲</div>${item.outline_chapters.map(c => `<div class="ct-scene-card"><span class="ct-scene-idx">${c.index}</span><b>${esc(c.title)}</b> <span style="color:var(--text3);font-size:11px">${esc(c.summary || '')}</span></div>`).join('')}</div>` : ''}
      ${item.chapters?.length ? `<div class="ct-section"><div class="ct-sec-title">正文内容</div>
        <div class="ct-novel-chapters">
          <div class="ct-ch-tabs">${item.chapters.map((c, i) => `<button class="ct-ch-tab ${i === 0 ? 'active' : ''}" onclick="ctSwitchChapter(this,${i})">第${c.index}章 ${esc(c.title)}</button>`).join('')}</div>
          ${item.chapters.map((c, i) => `<div class="ct-ch-content ${i === 0 ? '' : 'hidden'}" data-ch="${i}"><div class="ct-ch-meta">${(c.word_count || 0).toLocaleString()} 字</div><div class="ct-text-block ct-novel-text">${esc(c.content || '（空）')}</div></div>`).join('')}
        </div>
      </div>` : '<div class="ct-section"><div class="ct-sec-title">正文</div><div class="ct-empty">尚未生成章节</div></div>'}
    `;
  }

  overlay.innerHTML = `
    <div class="modal-box ct-detail-box">
      <div class="ct-detail-header">
        <span class="form-title" style="margin:0">${esc(item.title)}</span>
        <span class="ct-type-badge" style="margin-left:8px;font-size:11px;padding:2px 8px;border-radius:999px;background:var(--bg4);color:var(--text2)">${TYPE_NAMES[item.type] || item.type}</span>
        <button class="ct-close-btn" onclick="this.closest('.ct-detail-overlay').remove()">&times;</button>
      </div>
      ${body}
    </div>
  `;
  document.body.appendChild(overlay);
}

function ctSwitchChapter(btn, idx) {
  const box = btn.closest('.ct-novel-chapters');
  box.querySelectorAll('.ct-ch-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  box.querySelectorAll('.ct-ch-content').forEach(c => c.classList.toggle('hidden', parseInt(c.dataset.ch) !== idx));
}

// ══════════════════════════════════════════════════
//  数据同步
// ══════════════════════════════════════════════════

function toggleSyncAuth() {
  const type = document.getElementById('sync-auth-type').value;
  document.getElementById('sync-auth-password').style.display = type === 'password' ? '' : 'none';
  document.getElementById('sync-auth-key').style.display = type === 'key' ? '' : 'none';
}

async function loadSyncConfig() {
  try {
    const [cfgRes, statsRes] = await Promise.all([
      authFetch('/api/sync/config'),
      authFetch('/api/sync/stats'),
    ]);
    const cfgData = await cfgRes.json();
    const statsData = await statsRes.json();

    // 填充配置表单
    if (cfgData.success && cfgData.data) {
      const c = cfgData.data;
      document.getElementById('sync-host').value = c.host || '';
      document.getElementById('sync-port').value = c.port || 22;
      document.getElementById('sync-username').value = c.username || '';
      document.getElementById('sync-auth-type').value = c.auth_type || 'password';
      document.getElementById('sync-keypath').value = c.private_key_path || '';
      document.getElementById('sync-remote-path').value = c.remote_path || '';
      toggleSyncAuth();

      // 上次同步信息
      if (c.last_synced) {
        document.getElementById('sync-stat-last').textContent = new Date(c.last_synced).toLocaleString('zh-CN');
      }
      if (c.last_sync_files) {
        document.getElementById('sync-stat-last-files').textContent = c.last_sync_files + ' 个';
      }
    }

    // 数据统计
    if (statsData.success && statsData.data) {
      const s = statsData.data;
      document.getElementById('sync-stat-files').textContent = s.files + ' 个';
      document.getElementById('sync-stat-size').textContent = formatBytes(s.totalSize);

      // 目录详情
      const breakdown = document.getElementById('sync-dir-breakdown');
      const dirs = Object.entries(s.dirs).filter(([, v]) => v.files > 0);
      if (dirs.length) {
        breakdown.innerHTML = `<div class="sync-dir-list">${dirs.map(([name, d]) =>
          `<div class="sync-dir-item">
            <span class="sync-dir-name">${esc(name)}/</span>
            <span class="sync-dir-meta">${d.files} 个文件 · ${formatBytes(d.size)}</span>
          </div>`
        ).join('')}</div>`;
      }
    }
  } catch (e) { console.error('loadSyncConfig error', e); }
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return v.toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

async function saveSyncConfig() {
  const host = document.getElementById('sync-host').value.trim();
  const username = document.getElementById('sync-username').value.trim();
  if (!host || !username) { toast('请填写主机地址和用户名', 'error'); return; }

  const body = {
    host,
    port: document.getElementById('sync-port').value || 22,
    username,
    auth_type: document.getElementById('sync-auth-type').value,
    password: document.getElementById('sync-password')?.value || '',
    private_key_path: document.getElementById('sync-keypath')?.value.trim() || '',
    passphrase: document.getElementById('sync-passphrase')?.value || '',
    remote_path: document.getElementById('sync-remote-path').value.trim() || '',
  };

  try {
    const res = await authFetch('/api/sync/config', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    toast('同步配置已保存');
  } catch (e) { toast('保存失败: ' + e.message, 'error'); }
}

async function testSyncConnection() {
  const btn = document.getElementById('btn-sync-test');
  btn.disabled = true; btn.textContent = '测试中...';
  try {
    const res = await authFetch('/api/sync/test', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      toast('连接成功: ' + (data.detail || ''));
      btn.textContent = '✓ 连接正常'; btn.style.color = '#00d464';
    } else {
      toast('连接失败: ' + data.error, 'error');
      btn.textContent = '✕ 失败'; btn.style.color = '#ff5050';
    }
    setTimeout(() => { btn.textContent = '测试连接'; btn.style.color = ''; btn.disabled = false; }, 3000);
  } catch (e) {
    toast('测试失败: ' + e.message, 'error');
    btn.textContent = '测试连接'; btn.disabled = false;
  }
}

async function executeSyncNow() {
  const btn = document.getElementById('btn-sync-execute');
  const statusEl = document.getElementById('sync-execute-status');
  const logContainer = document.getElementById('sync-log-container');
  const logEl = document.getElementById('sync-log');

  btn.disabled = true; btn.textContent = '同步中...';
  logContainer.style.display = '';
  logEl.innerHTML = '';
  statusEl.textContent = '正在连接...';

  try {
    const token = getToken();
    const es = new EventSource(`/api/sync/execute?token=${encodeURIComponent(token)}`);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        statusEl.textContent = data.message || '';

        const line = document.createElement('div');
        line.className = 'sync-log-line';
        const stepClass = data.step === 'error' ? 'error' : data.step === 'complete' ? 'done' : '';
        line.innerHTML = `<span class="sync-log-step ${stepClass}">[${data.step}]</span> ${esc(data.message)}${data.detail ? ` <span style="color:var(--text3)">${esc(data.detail)}</span>` : ''}`;
        logEl.appendChild(line);
        logEl.scrollTop = logEl.scrollHeight;

        if (data.step === 'complete' || data.step === 'error') {
          es.close();
          btn.disabled = false;
          btn.textContent = '开始同步';
          if (data.step === 'complete') {
            toast('同步完成！共上传 ' + (data.files || 0) + ' 个文件');
            loadSyncConfig(); // 刷新统计
          } else {
            toast(data.message, 'error');
          }
        }
      } catch {}
    };

    es.onerror = () => {
      es.close();
      btn.disabled = false; btn.textContent = '开始同步';
      statusEl.textContent = '连接中断';
      toast('同步连接中断', 'error');
    };
  } catch (e) {
    btn.disabled = false; btn.textContent = '开始同步';
    toast('同步失败: ' + e.message, 'error');
  }
}

async function deleteContent(type, id) {
  if (!confirm('确定删除此内容？')) return;
  try {
    const res = await authFetch(`/api/admin/contents/${type}/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) { toast('已删除'); loadContents(); document.querySelectorAll('.ct-detail-overlay').forEach(e => e.remove()); }
    else toast(data.error, 'error');
  } catch (e) { toast('删除失败: ' + e.message, 'error'); }
}

// ══════════════════════════════════════════════════
//  AI 能力模块
// ══════════════════════════════════════════════════

let aiCapChars = [], aiCapScenes = [], aiCapStyles = [];
let editingCharId = null, editingSceneId = null, editingStyleId = null;

// ── 子 Tab 切换 ──
function switchAICapTab(tab) {
  ['chars', 'scenes', 'styles', 'workflow'].forEach(t => {
    const pane = document.getElementById('aicap-pane-' + t);
    const tabEl = document.getElementById('aicap-tab-' + t);
    if (pane) pane.style.display = t === tab ? '' : 'none';
    if (tabEl) tabEl.classList.toggle('active', t === tab);
  });
  if (tab === 'workflow') renderWorkflowCanvas();
}

// ── 加载全部数据 ──
async function loadAICapData() {
  await Promise.all([loadAICapChars(), loadAICapScenes(), loadAICapStyles()]);
}

// ════════════ 角色库 ════════════
async function loadAICapChars() {
  try {
    const res = await authFetch('/api/ai-cap/characters');
    const data = await res.json();
    aiCapChars = data.data || [];
    document.getElementById('aicap-char-stats').textContent = `共 ${aiCapChars.length} 个角色`;
    renderCharGrid();
  } catch (e) { console.error('加载角色库失败:', e); }
}

function renderCharGrid() {
  const grid = document.getElementById('aicap-chars-grid');
  if (!aiCapChars.length) { grid.innerHTML = '<div style="color:var(--text3);padding:40px;text-align:center;grid-column:1/-1">暂无角色，点击上方按钮新建</div>'; return; }
  grid.innerHTML = aiCapChars.map(c => {
    const thumb = c.ref_images?.length ? `<img src="${c.ref_images[0]}" alt="${esc(c.name)}" />` : '<div class="placeholder-icon">&#128100;</div>';
    const tags = (c.tags || []).map(t => `<span class="aicap-tag">${esc(t)}</span>`).join('');
    return `<div class="aicap-card" onclick="editChar('${c.id}')">
      <div class="aicap-card-thumb">${thumb}</div>
      <div class="aicap-card-body">
        <div class="aicap-card-name">${esc(c.name)}</div>
        <div class="aicap-card-meta">${esc(c.personality || c.appearance || '').substring(0, 40)}</div>
        <div class="aicap-card-tags">${tags}</div>
      </div>
      <div class="aicap-card-actions" onclick="event.stopPropagation()">
        <button onclick="editChar('${c.id}')">编辑</button>
        <button onclick="aiGenCharImage('${c.id}')" title="AI 生成形象">生图</button>
        <button onclick="genCharThreeView('${c.id}')" title="生成前/侧/后三视图">三视图</button>
        <button onclick="genCharExpressions('${c.id}')" title="生成 6 种表情">表情包</button>
        <button onclick="openCharCard('${c.id}')" title="查看角色卡">角色卡</button>
        <button class="danger" onclick="deleteChar('${c.id}')">删除</button>
      </div>
    </div>`;
  }).join('');
}

function showCharModal(id) {
  editingCharId = id || null;
  document.getElementById('modal-char-title').textContent = id ? '编辑角色' : '新建角色';
  const c = id ? aiCapChars.find(x => x.id === id) : null;
  document.getElementById('ac-name').value = c?.name || '';
  document.getElementById('ac-gender').value = c?.gender || '';
  document.getElementById('ac-age').value = c?.age_range || '';
  document.getElementById('ac-personality').value = c?.personality || '';
  document.getElementById('ac-appearance').value = c?.appearance || '';
  document.getElementById('ac-prompt').value = c?.appearance_prompt || '';
  document.getElementById('ac-tags').value = (c?.tags || []).join(',');
  // 渲染已有参考图
  const preview = document.getElementById('ac-ref-preview');
  if (c?.ref_images?.length) {
    preview.innerHTML = c.ref_images.map(url => `<div class="ref-thumb"><img src="${url}" /><div class="ref-remove" onclick="removeCharRef('${id}','${url}')">x</div></div>`).join('');
  } else {
    preview.innerHTML = '<div class="ref-empty">拖拽或上传参考图</div>';
  }
  document.getElementById('ac-ref-files').value = '';
  document.getElementById('modal-aicap-char').style.display = 'flex';
}

function editChar(id) { showCharModal(id); }

function closeCharModal() { document.getElementById('modal-aicap-char').style.display = 'none'; }

async function saveChar() {
  const fd = new FormData();
  fd.append('name', document.getElementById('ac-name').value);
  fd.append('gender', document.getElementById('ac-gender').value);
  fd.append('age_range', document.getElementById('ac-age').value);
  fd.append('personality', document.getElementById('ac-personality').value);
  fd.append('appearance', document.getElementById('ac-appearance').value);
  fd.append('appearance_prompt', document.getElementById('ac-prompt').value);
  fd.append('tags', JSON.stringify(document.getElementById('ac-tags').value.split(',').map(s => s.trim()).filter(Boolean)));
  const files = document.getElementById('ac-ref-files').files;
  for (let i = 0; i < files.length; i++) fd.append('ref_images', files[i]);

  try {
    const url = editingCharId ? `/api/ai-cap/characters/${editingCharId}` : '/api/ai-cap/characters';
    const method = editingCharId ? 'PUT' : 'POST';
    const token = localStorage.getItem('vido-token');
    const res = await fetch(url, { method, headers: { 'Authorization': `Bearer ${token}` }, body: fd });
    const data = await res.json();
    if (data.success) { toast(editingCharId ? '角色已更新' : '角色已创建'); closeCharModal(); loadAICapChars(); }
    else toast(data.error, 'error');
  } catch (e) { toast('保存失败: ' + e.message, 'error'); }
}

async function deleteChar(id) {
  if (!confirm('确定删除此角色？')) return;
  try {
    const res = await authFetch(`/api/ai-cap/characters/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) { toast('已删除'); loadAICapChars(); }
    else toast(data.error, 'error');
  } catch (e) { toast('删除失败', 'error'); }
}

async function removeCharRef(charId, imageUrl) {
  try {
    await authFetch(`/api/ai-cap/characters/${charId}/images`, { method: 'DELETE', body: JSON.stringify({ image_url: imageUrl }) });
    loadAICapChars();
    if (editingCharId === charId) showCharModal(charId);
  } catch {}
}

async function aiGenCharImage(idFromCard) {
  const id = idFromCard || editingCharId;
  if (!id) { toast('请先保存角色', 'error'); return; }
  const btn = idFromCard ? event.target : document.getElementById('btn-ai-gen-char');
  btn.disabled = true; btn.textContent = '生成中...';
  try {
    const res = await authFetch(`/api/ai-cap/characters/${id}/generate-image`, { method: 'POST' });
    const data = await res.json();
    if (data.success) { toast('形象已生成'); loadAICapChars(); if (editingCharId === id) showCharModal(id); }
    else toast(data.error, 'error');
  } catch (e) { toast('生成失败: ' + e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'AI 生成形象'; }
}

// ════════ 角色三视图 / 表情包 / 角色卡 (Phase 5) ════════
async function genCharThreeView(idFromCard) {
  const id = idFromCard || editingCharId;
  if (!id) { toast('请先保存角色', 'error'); return; }
  if (!confirm('生成前/侧/后三视图(将调用 3 次图片 API,约 30-60 秒). 继续?')) return;
  const btn = event?.target;
  if (btn) { btn.disabled = true; btn.textContent = '生成中...'; }
  try {
    const res = await authFetch(`/api/ai-cap/characters/${id}/generate-three-view`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      toast(`三视图已生成: ${data.data.generated}/3 张`);
      loadAICapChars();
      if (editingCharId === id) showCharModal(id);
    } else toast(data.error, 'error');
  } catch (e) { toast('生成失败: ' + e.message, 'error'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '三视图'; } }
}

async function genCharExpressions(idFromCard) {
  const id = idFromCard || editingCharId;
  if (!id) { toast('请先保存角色', 'error'); return; }
  if (!confirm('生成 6 种表情(开心/悲伤/愤怒/惊讶/害羞/严肃),约 60-120 秒. 继续?')) return;
  const btn = event?.target;
  if (btn) { btn.disabled = true; btn.textContent = '生成中...'; }
  try {
    const res = await authFetch(`/api/ai-cap/characters/${id}/generate-expressions`, { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      toast(`表情包已生成: ${data.data.generated}/6 张`);
      loadAICapChars();
      if (editingCharId === id) showCharModal(id);
    } else toast(data.error, 'error');
  } catch (e) { toast('生成失败: ' + e.message, 'error'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '表情包'; } }
}

function openCharCard(id) {
  // 角色卡 HTML 由后端渲染, 直接新窗口打开
  const token = localStorage.getItem('vido-token');
  // 后端 GET /api/ai-cap/characters/:id/card 走 authenticate 中间件,
  // 浏览器地址栏请求无法带 Bearer header. 用 fetch + blob 方式打开
  authFetch(`/api/ai-cap/characters/${id}/card`).then(async r => {
    if (!r.ok) { toast('打开失败', 'error'); return; }
    const html = await r.text();
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }).catch(e => toast('打开失败: ' + e.message, 'error'));
}

// ════════════ 场景库 ════════════
async function loadAICapScenes() {
  try {
    const res = await authFetch('/api/ai-cap/scenes');
    const data = await res.json();
    aiCapScenes = data.data || [];
    document.getElementById('aicap-scene-stats').textContent = `共 ${aiCapScenes.length} 个场景`;
    renderSceneGrid();
  } catch (e) { console.error('加载场景库失败:', e); }
}

function renderSceneGrid() {
  const grid = document.getElementById('aicap-scenes-grid');
  if (!aiCapScenes.length) { grid.innerHTML = '<div style="color:var(--text3);padding:40px;text-align:center;grid-column:1/-1">暂无场景，点击上方按钮新建</div>'; return; }
  grid.innerHTML = aiCapScenes.map(s => {
    const thumb = s.ref_images?.length ? `<img src="${s.ref_images[0]}" alt="${esc(s.name)}" />` : '<div class="placeholder-icon">&#127968;</div>';
    const typeMap = { indoor: '室内', outdoor: '室外', fantasy: '幻想', urban: '都市', nature: '自然' };
    const tags = (s.tags || []).map(t => `<span class="aicap-tag">${esc(t)}</span>`).join('');
    return `<div class="aicap-card" onclick="editScene('${s.id}')">
      <div class="aicap-card-thumb">${thumb}</div>
      <div class="aicap-card-body">
        <div class="aicap-card-name">${esc(s.name)}</div>
        <div class="aicap-card-meta">${typeMap[s.scene_type] || s.scene_type} · ${esc((s.description || '').substring(0, 30))}</div>
        <div class="aicap-card-tags">${tags}</div>
      </div>
      <div class="aicap-card-actions" onclick="event.stopPropagation()">
        <button onclick="editScene('${s.id}')">编辑</button>
        <button onclick="aiGenSceneImageCard('${s.id}')">AI 生图</button>
        <button class="danger" onclick="deleteScene('${s.id}')">删除</button>
      </div>
    </div>`;
  }).join('');
}

function showSceneModal(id) {
  editingSceneId = id || null;
  document.getElementById('modal-scene-title').textContent = id ? '编辑场景' : '新建场景';
  const s = id ? aiCapScenes.find(x => x.id === id) : null;
  document.getElementById('as-name').value = s?.name || '';
  document.getElementById('as-type').value = s?.scene_type || 'outdoor';
  document.getElementById('as-desc').value = s?.description || '';
  document.getElementById('as-prompt').value = s?.scene_prompt || '';
  document.getElementById('as-tags').value = (s?.tags || []).join(',');
  const preview = document.getElementById('as-ref-preview');
  preview.innerHTML = (s?.ref_images?.length) ? s.ref_images.map(url => `<div class="ref-thumb"><img src="${url}" /></div>`).join('') : '<div class="ref-empty">拖拽或上传参考图</div>';
  document.getElementById('as-ref-files').value = '';
  document.getElementById('modal-aicap-scene').style.display = 'flex';
}

function editScene(id) { showSceneModal(id); }
function closeSceneModal() { document.getElementById('modal-aicap-scene').style.display = 'none'; }

async function saveScene() {
  const fd = new FormData();
  fd.append('name', document.getElementById('as-name').value);
  fd.append('scene_type', document.getElementById('as-type').value);
  fd.append('description', document.getElementById('as-desc').value);
  fd.append('scene_prompt', document.getElementById('as-prompt').value);
  fd.append('tags', JSON.stringify(document.getElementById('as-tags').value.split(',').map(s => s.trim()).filter(Boolean)));
  const files = document.getElementById('as-ref-files').files;
  for (let i = 0; i < files.length; i++) fd.append('ref_images', files[i]);

  try {
    const url = editingSceneId ? `/api/ai-cap/scenes/${editingSceneId}` : '/api/ai-cap/scenes';
    const method = editingSceneId ? 'PUT' : 'POST';
    const token = localStorage.getItem('vido-token');
    const res = await fetch(url, { method, headers: { 'Authorization': `Bearer ${token}` }, body: fd });
    const data = await res.json();
    if (data.success) { toast(editingSceneId ? '场景已更新' : '场景已创建'); closeSceneModal(); loadAICapScenes(); }
    else toast(data.error, 'error');
  } catch (e) { toast('保存失败: ' + e.message, 'error'); }
}

async function deleteScene(id) {
  if (!confirm('确定删除此场景？')) return;
  try {
    const res = await authFetch(`/api/ai-cap/scenes/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) { toast('已删除'); loadAICapScenes(); }
    else toast(data.error, 'error');
  } catch (e) { toast('删除失败', 'error'); }
}

async function aiGenSceneImage() {
  if (!editingSceneId) { toast('请先保存场景', 'error'); return; }
  const btn = event.target; btn.disabled = true; btn.textContent = '生成中...';
  try {
    const res = await authFetch(`/api/ai-cap/scenes/${editingSceneId}/generate-image`, { method: 'POST' });
    const data = await res.json();
    if (data.success) { toast('场景图已生成'); loadAICapScenes(); showSceneModal(editingSceneId); }
    else toast(data.error, 'error');
  } catch (e) { toast('生成失败', 'error'); }
  finally { btn.disabled = false; btn.textContent = 'AI 生成场景图'; }
}

async function aiGenSceneImageCard(id) {
  const btn = event.target; btn.disabled = true; btn.textContent = '生成中...';
  try {
    const res = await authFetch(`/api/ai-cap/scenes/${id}/generate-image`, { method: 'POST' });
    const data = await res.json();
    if (data.success) { toast('场景图已生成'); loadAICapScenes(); }
    else toast(data.error, 'error');
  } catch (e) { toast('生成失败', 'error'); }
  finally { btn.disabled = false; btn.textContent = 'AI 生图'; }
}

// ════════════ 风格库 ════════════
async function loadAICapStyles() {
  try {
    const res = await authFetch('/api/ai-cap/styles');
    const data = await res.json();
    aiCapStyles = data.data || [];
    document.getElementById('aicap-style-stats').textContent = `共 ${aiCapStyles.length} 个风格（${aiCapStyles.filter(s => s.is_preset).length} 预设 + ${aiCapStyles.filter(s => !s.is_preset).length} 自定义）`;
    renderStyleGrid();
  } catch (e) { console.error('加载风格库失败:', e); }
}

function renderStyleGrid() {
  const grid = document.getElementById('aicap-styles-grid');
  if (!aiCapStyles.length) { grid.innerHTML = '<div style="color:var(--text3);padding:40px;text-align:center;grid-column:1/-1">暂无风格</div>'; return; }
  const catMap = { manga: '漫画', comic: '西式漫画', cartoon: '卡通', traditional: '传统', realistic: '写实', scifi: '科幻', dark: '暗黑', soft: '治愈', stylized: '风格化', custom: '自定义' };
  grid.innerHTML = aiCapStyles.map(s => {
    const thumb = s.ref_image ? `<img src="${s.ref_image}" alt="${esc(s.name)}" />` : `<div class="placeholder-icon">&#127912;</div>`;
    const badge = s.is_preset ? '<span class="aicap-preset-badge">预设</span>' : '';
    return `<div class="aicap-card" onclick="editStyle('${s.id}')">
      <div class="aicap-card-thumb">${thumb}${badge}</div>
      <div class="aicap-card-body">
        <div class="aicap-card-name">${esc(s.name)}</div>
        <div class="aicap-card-meta">${catMap[s.category] || s.category} · ${esc((s.prompt_en || '').substring(0, 40))}</div>
      </div>
      <div class="aicap-card-actions" onclick="event.stopPropagation()">
        <button onclick="editStyle('${s.id}')">编辑</button>
        <button class="danger" onclick="deleteStyle('${s.id}')">删除</button>
      </div>
    </div>`;
  }).join('');
}

function showStyleModal(id) {
  editingStyleId = id || null;
  document.getElementById('modal-style-title').textContent = id ? '编辑风格' : '新建风格';
  const s = id ? aiCapStyles.find(x => x.id === id) : null;
  document.getElementById('ast-name').value = s?.name || '';
  document.getElementById('ast-prompt').value = s?.prompt_en || '';
  document.getElementById('ast-category').value = s?.category || 'custom';
  const preview = document.getElementById('ast-ref-preview');
  preview.innerHTML = s?.ref_image ? `<div class="ref-thumb"><img src="${s.ref_image}" /></div>` : '<div class="ref-empty">可上传风格预览图</div>';
  document.getElementById('ast-ref-file').value = '';
  document.getElementById('modal-aicap-style').style.display = 'flex';
}

function editStyle(id) { showStyleModal(id); }
function closeStyleModal() { document.getElementById('modal-aicap-style').style.display = 'none'; }

async function saveStyle() {
  const fd = new FormData();
  fd.append('name', document.getElementById('ast-name').value);
  fd.append('prompt_en', document.getElementById('ast-prompt').value);
  fd.append('category', document.getElementById('ast-category').value);
  const file = document.getElementById('ast-ref-file').files[0];
  if (file) fd.append('ref_image', file);

  try {
    const url = editingStyleId ? `/api/ai-cap/styles/${editingStyleId}` : '/api/ai-cap/styles';
    const method = editingStyleId ? 'PUT' : 'POST';
    const token = localStorage.getItem('vido-token');
    const res = await fetch(url, { method, headers: { 'Authorization': `Bearer ${token}` }, body: fd });
    const data = await res.json();
    if (data.success) { toast(editingStyleId ? '风格已更新' : '风格已创建'); closeStyleModal(); loadAICapStyles(); }
    else toast(data.error, 'error');
  } catch (e) { toast('保存失败: ' + e.message, 'error'); }
}

async function deleteStyle(id) {
  if (!confirm('确定删除此风格？')) return;
  try {
    const res = await authFetch(`/api/ai-cap/styles/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) { toast('已删除'); loadAICapStyles(); }
    else toast(data.error, 'error');
  } catch (e) { toast('删除失败', 'error'); }
}

// ── 弹窗关闭 ──
document.querySelectorAll('#modal-aicap-char, #modal-aicap-scene, #modal-aicap-style').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) el.style.display = 'none'; });
});

// ══════════════════════════════════════════════════
//  工作流可视化
// ══════════════════════════════════════════════════

const WF_PIPELINES = {
  comic: {
    label: '漫画生成流水线',
    nodes: [
      { id: 'input', icon: '📝', label: '输入', desc: '主题 / 故事 / 角色 / 风格', type: 'input',
        detail: '用户输入漫画主题和故事内容。\n可从角色库选择预设角色，从风格库选择画风。\n支持小说/剧本导入（TXT/PDF → AI 自动拆解为分镜结构）。' },
      { id: 'screenwriter', icon: '✍️', label: '编剧 Agent', desc: '剧情脚本创作', type: 'agent',
        detail: '服务: comicService.js → agentScreenwriter()\n\n职责:\n· 构建完整叙事结构（起承转合）\n· 塑造角色性格和独特说话方式\n· 编写精炼对话（每句≤15字）\n· 设计旁白、音效（sfx）\n· 标注每格的情感基调（emotion）和叙事节奏（pacing: slow/normal/fast）\n· 标注每页的叙事目的（page_purpose）\n\n输入: 主题、风格、角色列表（含 appearance_prompt）\n输出: screenplay JSON\n  └ pages[] → panels[] → {description, dialogue, speaker, narrator, sfx, emotion, pacing}\nAI: callLLM() → DeepSeek / OpenAI / Anthropic' },
      { id: 'director', icon: '🎬', label: '导演 Agent', desc: '分镜设计 + 视觉指令', type: 'agent',
        detail: '服务: comicService.js → agentDirector()\n\n职责:\n· 为每个面板设计镜头语言和画面构图\n· 分配镜头类型：特写 / 中景 / 远景 / 仰角 / 俯角 / 鸟瞰 / 荷兰角\n· 设计面板布局比例：full / half / third / quarter\n· 规划镜头切换节奏：对话→正反打，情感→特写，动作→广角\n· 撰写 visual_prompt（英文，≤80词）\n· 指定对话气泡位置：top / bottom / left / right\n· 标注画面氛围关键词（mood）\n\n输入: 编剧脚本 + 画风 + 角色外貌描述\n输出: 在编剧脚本基础上增加 layout / camera / mood / dialogue_position / visual_prompt\nAI: callLLM() → DeepSeek / OpenAI / Anthropic' },
      { id: 'storyboard', icon: '🎞️', label: '分镜脚本', desc: '结构化分镜数据', type: 'data',
        detail: '编剧 + 导演协作输出的完整分镜脚本：\n\n数据结构:\n{\n  title, synopsis, style,\n  pages: [{\n    page_number, page_purpose,\n    panels: [{\n      index, layout, description,\n      dialogue, speaker, dialogue_position,\n      narrator, sfx, emotion, pacing,\n      mood, camera, visual_prompt\n    }]\n  }]\n}\n\n保存为 script.json，可在分镜编辑器中可视化调整。\n支持单格重抽（不影响其他面板）。' },
      { id: 'imagegen', icon: '🖼️', label: '面板生图', desc: 'generatePanelImage() ×N', type: 'service',
        detail: '服务: comicService.js → generatePanelImage()\n调用: imageService.generateCharacterImage()\n\n输入:\n· visual_prompt（导演Agent生成）\n· 风格库 prompt_en（自动注入）\n· 角色 appearance_prompt（自动嵌入）\n\n供应商优先级: mxapi > nanobanana > 智谱CogView > 即梦 > Replicate > Stability > OpenAI\n\n输出: panel_*.png（每面板一张图）' },
      { id: 'compose', icon: '📄', label: '页面合成', desc: 'FFmpeg 网格拼接', type: 'service',
        detail: '服务: comicService.js → composePage()\n工具: FFmpeg filter_complex\n\n功能:\n· 将面板图片按网格布局拼接为漫画页面\n· 自动计算布局：2×1 / 2×2 / 2×3 / 3×N\n· 每格 512×512，间距 8px\n· 统一深色背景 (#0e0e14)\n\n输出: page_N.png' },
      { id: 'output', icon: '📖', label: '漫画作品', desc: '多页漫画 + 分镜数据', type: 'output',
        detail: '输出文件:\n· result.json — 完整漫画数据\n· page_*.png — 每页合成图\n· panel_*.png — 每个面板原图\n· screenplay.json — 编剧脚本\n· script.json — 导演分镜脚本\n\n可操作:\n· 单格重抽 — POST /api/ai-cap/comic/:id/repaint\n· 页面预览 — GET /api/comic/tasks/:id/pages/:num\n· 面板预览 — GET /api/comic/tasks/:id/panels/:filename' }
    ],
    sideNodes: [
      { id: 'charlib', icon: '👤', label: '角色库', target: 'screenwriter', detail: '管理后台维护的角色数据：\n· 名称、性格、外貌描述\n· appearance_prompt（英文，用于AI生图）\n· 参考图（最多5张）\n\n自动注入到编剧和导演 Agent 的 prompt 中，确保角色描述一致性。' },
      { id: 'stylelib', icon: '🎨', label: '风格库', target: 'imagegen', detail: '14个预设风格 + 自定义风格：\n· 每个风格有 prompt_en（英文画风提示词）\n· 自动注入面板生图的 style suffix\n· 支持预览图上传\n\n预设: 日系动漫 / 美式漫画 / 韩国漫画 / 水墨漫画 / 赛博朋克 / 国风仙侠 / 迪士尼卡通 / 暗黑哥特 / 治愈系 等' },
      { id: 'scenelib', icon: '🏞️', label: '场景库', target: 'director', detail: '管理后台维护的场景数据：\n· 名称、描述、场景类型（室内/室外/幻想/都市/自然）\n· scene_prompt（英文）\n· 参考图\n\n为导演 Agent 提供场景参考，提升画面一致性。' },
      { id: 'scriptimport', icon: '📄', label: '小说导入', target: 'screenwriter', detail: '上传 TXT/PDF 文件 → AI 自动解析为分镜 JSON：\n· 自动提取角色信息\n· 按页/格拆解剧情\n· 生成 visual_prompt\n\nAPI: POST /api/ai-cap/import-script' },
      { id: 'repaint', icon: '🔄', label: '单格重抽', target: 'imagegen', detail: '对已完成漫画的单个面板重新生成：\n· 支持自定义 prompt 微调\n· 不影响其他面板\n· 自动重新合成该页\n\nAPI: POST /api/ai-cap/comic/:taskId/repaint\n参数: { page_index, panel_index, custom_prompt }' }
    ]
  },
  video: {
    label: '视频生成流水线',
    nodes: [
      { id: 'input', icon: '📝', label: '输入', desc: '主题 / 角色 / 场景 / 风格', type: 'input',
        detail: '用户输入视频主题。支持4种创作模式：\n· AI快速 — 一键全自动\n· 脚本解析 — 上传剧本，AI拆分场景\n· 自定义场景 — 手动编排每个场景\n· 长篇连续剧 — 多集承接，保持角色和剧情连续性\n\n可从角色库/场景库导入预设数据。' },
      { id: 'story', icon: '📖', label: 'LLM 剧情', desc: '剧情脚本生成', type: 'agent',
        detail: '服务: storyService.js → generateStory()\n\n职责: 根据主题生成完整剧情脚本\n输出:\n{\n  title, synopsis,\n  scenes: [{\n    scene_index, title, description,\n    dialogue, characters, visual_prompt,\n    timeOfDay, mood, location\n  }]\n}\n\nAI: callLLM() → DeepSeek / OpenAI / Anthropic\n支持: 长篇模式（多集剧情承接，通过 previous_summary 传递上集摘要）' },
      { id: 'charimg', icon: '👤', label: '角色形象', desc: '角色转面图 / 肖像', type: 'service',
        detail: '服务: imageService.js → generateCharacterImage()\n\n功能: 为每个角色生成形象图\n· 转面图模式（turnaround）— 正面/侧面/背面三视图\n· 肖像模式（portrait）— 单张全身立绘\n\n供应商: mxapi > nanobanana > 智谱CogView > 即梦 > Replicate > Stability > OpenAI\n\n角色一致性: 从角色库导入的角色直接使用参考图和 appearance_prompt\n并行: 限并发2个，避免 API 限流' },
      { id: 'sceneimg', icon: '🏞️', label: '场景背景', desc: '场景背景图生成', type: 'service',
        detail: '服务: imageService.js → generateSceneImage()\n\n功能: 为每个场景生成纯背景图（无人物）\n· 自动从场景描述中剥离人物内容\n· 注入负提示词（排除人物生成）\n\n供应商: 同角色形象\n场景库: 如果场景来自场景库，优先使用参考图\n并行: 与角色形象同时生成' },
      { id: 'videogen', icon: '🎥', label: '视频生成', desc: '逐场景生成视频片段', type: 'service',
        detail: '服务: videoService.js → generateVideoClip()\n\n核心流程:\n1. 增强 visual_prompt（注入角色外貌 + 画风前缀）\n2. 选择生成模式：\n   · T2V（文生视频）— 纯文字描述生成\n   · I2V（图生视频）— 角色形象图 + 场景背景图作为参考\n3. 调用视频生成 API\n\n供应商（48个模型）:\n· OpenAI Sora-2\n· 智谱 CogVideoX-Flash / Plus\n· FAL: Kling 2.1 / Wan 2.1 / Hunyuan\n· Runway Gen-3 / Gen-4 / Gen-4.5\n· Luma Ray-2 / Ray-3\n· MiniMax Hailuo\n· Vidu / Pika / Seedance / VEO\n\nI2V 是角色一致性的核心技巧。' },
      { id: 'vfx', icon: '✨', label: '后处理特效', desc: 'applyPostVFX()', type: 'service',
        detail: '服务: ffmpegService.js → applyPostVFX()\n\n根据场景的 action_type 和 vfx 标签自动应用后处理特效:\n· 战斗场景 — 色调偏暖、对比度增强、轻微抖动\n· 回忆场景 — 柔焦、褪色、慢动作\n· 紧张场景 — 暗角、色调偏冷\n· 浪漫场景 — 柔光、暖色调\n· 通用特效 — 淡入淡出\n\n工具: FFmpeg filter_complex' },
      { id: 'tts', icon: '🔊', label: '语音配音', desc: '按角色分配声线', type: 'service', optional: true,
        detail: '服务: ttsService.js → generateSpeech()\n\n供应商优先级:\n讯飞WebSocket > 火山引擎 > 百度 > 阿里 > Fish > MiniMax > ElevenLabs > OpenAI > SAPI\n\n功能:\n· 每个场景的对话转为语音\n· 支持指定声线、语速、性别\n· 自动混入对应场景视频\n\n配置: voice_enabled / voice_gender / voice_id / voice_speed' },
      { id: 'subtitle', icon: '💬', label: '字幕烧录', desc: '对话字幕叠加', type: 'service', optional: true,
        detail: '服务: editService.js → renderWithEdits()\n\n功能:\n· 将场景对话文本烧录为字幕\n· 支持字幕大小、位置、颜色自定义\n· 支持多行字幕和自动换行\n\n配置: subtitle_enabled / subtitle_size / subtitle_position / subtitle_color\n工具: FFmpeg drawtext 滤镜' },
      { id: 'transition', icon: '🔀', label: '转场效果', desc: '交叉淡入淡出', type: 'service',
        detail: '服务: ffmpegService.js → mergeVideoClips()\n\n转场效果:\n· 交叉淡入淡出（crossfade）— 场景间平滑过渡\n· 首尾淡入淡出 — 开头渐入、结尾渐出\n· 转场时长: 0.5-1秒\n\n工具: FFmpeg xfade 滤镜\n参数: transition=fade, duration=0.5' },
      { id: 'bgm', icon: '🎵', label: 'BGM 混音', desc: '背景音乐 + 音量控制', type: 'service', optional: true,
        detail: '服务: ffmpegService.js\n\n功能:\n· 混入用户上传或素材库选择的 BGM\n· 自动裁剪 BGM 到视频时长\n· 音量独立控制（0-100%）\n· 支持循环播放\n· 不覆盖角色配音\n\n配置: music_path / music_volume / music_loop / music_trim_start / music_trim_end' },
      { id: 'merge', icon: '🎞️', label: '最终合成', desc: '全部片段合并', type: 'service',
        detail: '服务: ffmpegService.js → mergeVideoClips()\n\n功能:\n· 按场景顺序拼接所有视频片段\n· 统一格式: 统一分辨率、帧率、编码\n· 应用转场效果\n· 混入 BGM\n· 叠加字幕\n\n输出: {projectId}_final.mp4\n工具: FFmpeg concat + filter_complex' },
      { id: 'output', icon: '🎬', label: '最终视频', desc: '完整视频 + 元数据', type: 'output',
        detail: '输出: {projectId}_final.mp4\n\n支持:\n· 在线流式播放 — GET /api/projects/:id/stream\n· 视频下载 — GET /api/projects/:id/download\n· 单场景预览 — GET /api/projects/:id/clips/:clipId/stream\n· 编辑器二次编辑 — /editor?id=xxx\n· 发布到社交媒体' }
    ],
    sideNodes: [
      { id: 'charlib', icon: '👤', label: '角色库', target: 'charimg', detail: '角色库中的参考图直接用于 I2V 生图，保持角色一致性。\n角色的 appearance_prompt 注入到视频生成的 visual_prompt 中。' },
      { id: 'scenelib', icon: '🏞️', label: '场景库', target: 'sceneimg', detail: '场景库参考图可作为背景图直接使用，减少生成时间。\nscene_prompt 自动注入场景描述。' },
      { id: 'stylelib', icon: '🎨', label: '风格库', target: 'story', detail: '画风设置影响:\n· 剧情生成的 visual_prompt 风格前缀\n· 角色形象图的画风后缀\n· 场景背景图的风格注入' },
      { id: 'musiclib', icon: '🎵', label: '音乐素材', target: 'bgm', detail: '用户可上传音乐或从素材库选择 BGM。\n支持裁剪、循环、音量控制。\nAPI: POST /api/projects/upload-music' },
      { id: 'voicelib', icon: '🗣️', label: '声音库', target: 'tts', detail: '自定义声音库:\n· 系统预设声线\n· 用户克隆声音\n· 支持 15+ TTS 供应商\n\nAPI: GET /api/story/voice-list' }
    ]
  }
};

function renderWorkflowCanvas() {
  const sel = document.getElementById('wf-pipeline-select');
  const pipeline = WF_PIPELINES[sel?.value || 'comic'];
  const canvas = document.getElementById('wf-canvas');
  const detailEl = document.getElementById('wf-node-detail');
  if (!canvas) return;

  // 主流程节点
  let html = '<div class="wf-pipeline">';
  pipeline.nodes.forEach((n, i) => {
    if (i > 0) html += '<div class="wf-arrow"></div>';
    const optClass = n.optional ? ' optional' : '';
    const typeLabel = { input: '输入', agent: 'AI Agent', service: '服务', output: '输出' }[n.type] || '';
    html += `<div class="wf-node${optClass}" data-node-id="${n.id}" onclick="showWfNodeDetail('${sel?.value || 'comic'}','${n.id}')">
      <div class="wf-node-icon">${n.icon}</div>
      <div class="wf-node-label">${n.label}</div>
      <div class="wf-node-type">${typeLabel}</div>
    </div>`;
  });
  html += '</div>';

  // 侧边库节点
  if (pipeline.sideNodes?.length) {
    html += '<div class="wf-side-nodes">';
    pipeline.sideNodes.forEach(s => {
      html += `<div class="wf-side-node" onclick="showWfNodeDetail('${sel?.value || 'comic'}','${s.id}')">
        <span class="wf-side-icon">${s.icon}</span>
        <span class="wf-side-label">${s.label}</span>
        <span class="wf-side-arrow">→ ${s.target}</span>
      </div>`;
    });
    html += '</div>';
  }

  canvas.innerHTML = html;
  if (detailEl) { detailEl.style.display = 'none'; detailEl.innerHTML = ''; }
}

function showWfNodeDetail(pipelineKey, nodeId) {
  const pipeline = WF_PIPELINES[pipelineKey];
  const node = [...pipeline.nodes, ...(pipeline.sideNodes || [])].find(n => n.id === nodeId);
  if (!node) return;

  // 高亮
  document.querySelectorAll('.wf-node, .wf-side-node').forEach(el => el.classList.remove('active'));
  const el = document.querySelector(`[data-node-id="${nodeId}"]`);
  if (el) el.classList.add('active');

  const detailEl = document.getElementById('wf-node-detail');
  if (!detailEl) return;
  detailEl.style.display = 'block';
  detailEl.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
      <span style="font-size:28px">${node.icon}</span>
      <div>
        <div style="font-weight:600;font-size:15px">${node.label}</div>
        <div style="font-size:12px;color:var(--text3)">${node.desc || ''}</div>
      </div>
    </div>
    <pre style="font-size:12px;line-height:1.6;color:var(--text2);white-space:pre-wrap;margin:0">${esc(node.detail || '暂无详细信息')}</pre>
  `;
}
