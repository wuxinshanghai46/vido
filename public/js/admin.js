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

  const user = getCurrentUser();
  document.getElementById('topbar-user').innerHTML =
    `<strong>${esc(user.username)}</strong> (${esc(user.role)})`;

  initTabs();
  await Promise.all([loadUsers(), loadRoles()]);
  populateRoleDropdowns();
  loadCreditsLog();
  loadStats();
  bindEvents();
})();

// ══════════════════════ TABS ══════════════════════
function initTabs() {
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
      if (tab.dataset.tab === 'credits') loadCreditsLog();
      if (tab.dataset.tab === 'system') loadStats();
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
          <button class="btn-sm accent" onclick="toggleCreditsForm('${u.id}')">调整积分</button>
          <button class="btn-sm" onclick="togglePasswordForm('${u.id}')">重置密码</button>
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
  const allowed_models = $('#rm-models').value.split(',').map(s => s.trim()).filter(Boolean);
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

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `admin-toast ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}
