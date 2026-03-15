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

async function deleteContent(type, id) {
  if (!confirm('确定删除此内容？')) return;
  try {
    const res = await authFetch(`/api/admin/contents/${type}/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) { toast('已删除'); loadContents(); document.querySelectorAll('.ct-detail-overlay').forEach(e => e.remove()); }
    else toast(data.error, 'error');
  } catch (e) { toast('删除失败: ' + e.message, 'error'); }
}
