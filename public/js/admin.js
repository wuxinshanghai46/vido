// ═══════════════════════════════════════════════
//  VIDO Admin Panel
// ═══════════════════════════════════════════════

// 用户的功能与模型权限完全由所选角色决定，不再在用户弹窗中重复配置

let usersCache = [];
let rolesCache = [];
let editingRoleId = null; // null = create, string = edit
let currentUserType = 'enterprise'; // 用户管理当前 Tab

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
      if (tab.dataset.tab === 'knowledgebase') kbInit();
      if (tab.dataset.tab === 'aiteam') aiteamInit();
      if (tab.dataset.tab === 'monitor') monitorRefresh();
      if (tab.dataset.tab === 'dashboard') loadDashboard();
      if (tab.dataset.tab === 'datasource') loadDatasources();
      if (tab.dataset.tab === 'modelpipeline') loadModelPipeline();
    });
  });
  // 初始化时如果默认是 dashboard，立即加载
  if (document.querySelector('.nav-item.active')?.dataset.tab === 'dashboard') {
    setTimeout(loadDashboard, 100);
  }
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

function getUserType(u) {
  const role = rolesCache.find(r => r.id === u.role);
  return role ? (role.type || 'enterprise') : 'enterprise';
}

function switchUserType(type) {
  currentUserType = type;
  document.querySelectorAll('#user-type-tabs .role-type-tab').forEach(el => {
    el.classList.toggle('active', el.dataset.type === type);
  });
  // 隐藏展开中的新建用户表单
  toggleForm('form-new-user', false);
  renderUsers();
  populateRoleDropdowns();
}

function renderUsers() {
  const tbody = $('#users-tbody');
  if (!tbody) return;
  // 按当前 Tab 的类型过滤
  const filtered = usersCache.filter(u => getUserType(u) === currentUserType);
  // 当前 type 对应的角色列表（用于行内角色下拉）
  const typeRoles = rolesCache.filter(r => (r.type || 'enterprise') === currentUserType);
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">暂无用户</td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map(u => {
    const statusClass = u.status === 'active' ? 'badge-active' : u.status === 'disabled' ? 'badge-disabled' : 'badge-pending';
    const statusLabel = u.status === 'active' ? '正常' : u.status === 'disabled' ? '禁用' : u.status || '-';
    const lastLogin = u.last_login ? new Date(u.last_login).toLocaleString('zh-CN') : '-';
    return `
      <tr data-uid="${u.id}">
        <td><strong>${esc(u.username)}</strong></td>
        <td>${esc(u.email || '-')}</td>
        <td>
          <select class="role-select" onchange="changeUserRole('${u.id}', this.value)">
            ${typeRoles.map(r => `<option value="${esc(r.id)}" ${r.id === u.role ? 'selected' : ''}>${esc(r.label || r.id)}</option>`).join('')}
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

  // 填充角色 select — 仅展示与当前用户同类型的角色（避免跨类切换）
  const roleSel = document.getElementById('ud-role');
  const userType = getUserType(u);
  const sameTypeRoles = rolesCache.filter(r => (r.type || 'enterprise') === userType);
  roleSel.innerHTML = sameTypeRoles.map(r =>
    `<option value="${esc(r.id)}" ${r.id === u.role ? 'selected' : ''}>${esc(r.label || r.id)}</option>`
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

  // 1. 更新基本信息（邮箱/角色/状态） — 功能与模型完全由角色决定
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
let currentRoleType = 'platform'; // platform | enterprise
let selectedRoleId = null;
let matrixCache = null; // { platform: {...}, enterprise: {...} }

async function loadRoles() {
  try {
    const [rRes, mRes] = await Promise.all([
      authFetch('/api/admin/roles'),
      matrixCache ? Promise.resolve(null) : authFetch('/api/admin/permissions-matrix')
    ]);
    const rData = await rRes.json();
    rolesCache = rData.success ? (rData.data || []) : [];
    if (mRes) {
      const mData = await mRes.json();
      matrixCache = mData.success ? mData.data : null;
    }
  } catch { rolesCache = []; }
  renderRoles();
}

function switchRoleType(type) {
  currentRoleType = type;
  selectedRoleId = null;
  document.querySelectorAll('.role-type-tab').forEach(el => {
    el.classList.toggle('active', el.dataset.type === type);
  });
  renderRoles();
}

function renderRoles() {
  const tbody = $('#roles-tbody');
  if (!tbody) return;
  const filtered = rolesCache.filter(r => (r.type || 'enterprise') === currentRoleType);
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">暂无角色</td></tr>';
    updateMatrixPreview(null);
    return;
  }
  tbody.innerHTML = filtered.map(r => {
    const typeLabel = (r.type === 'platform') ? '平台' : '用户';
    const typeClass = (r.type === 'platform') ? 'role-type-badge' : 'role-type-badge enterprise';
    const isSelected = r.id === selectedRoleId;
    const builtinTag = r.builtin ? '<span style="font-size:10px;color:var(--text3);margin-left:6px">内置</span>' : '';
    return `
      <tr class="${isSelected ? 'selected' : ''}" data-rid="${esc(r.id)}" onclick="selectRole('${esc(r.id)}')">
        <td style="font-family:monospace;font-size:12px;color:var(--text2)">${esc(r.id)}${builtinTag}</td>
        <td><strong>${esc(r.label || r.id)}</strong></td>
        <td style="color:var(--text3);font-size:12px">${esc(r.description || '-')}</td>
        <td><span class="${typeClass}">${typeLabel}</span></td>
        <td>${r.user_count ?? 0}</td>
        <td class="actions-cell" onclick="event.stopPropagation()">
          <button class="btn-sm accent" onclick="openRoleModal('${esc(r.id)}')">权限配置</button>
          ${r.builtin ? '' : `<button class="btn-sm danger" onclick="confirmDeleteRole('${esc(r.id)}','${esc(r.label || r.id)}')">删除</button>`}
        </td>
      </tr>
    `;
  }).join('');

  // 首次渲染 / 切换 tab 时自动选中第一个
  if (!selectedRoleId && filtered.length) {
    selectRole(filtered[0].id);
  } else if (selectedRoleId) {
    updateMatrixPreview(rolesCache.find(x => x.id === selectedRoleId));
  }
}

function selectRole(id) {
  selectedRoleId = id;
  document.querySelectorAll('#roles-tbody tr').forEach(tr => {
    tr.classList.toggle('selected', tr.dataset.rid === id);
  });
  const role = rolesCache.find(r => r.id === id);
  updateMatrixPreview(role);
}

// 只读矩阵预览
function updateMatrixPreview(role) {
  const thead = $('#matrix-thead');
  const tbody = $('#matrix-tbody');
  const title = $('#matrix-title');
  const hint = $('#matrix-hint');
  if (!thead || !tbody) return;
  if (!role || !matrixCache) {
    thead.innerHTML = '';
    tbody.innerHTML = '<tr><td style="text-align:center;padding:24px;color:var(--text3)">请选择角色查看权限矩阵</td></tr>';
    if (title) title.textContent = '权限矩阵概览';
    if (hint) hint.textContent = '点击上方任一角色查看其权限矩阵';
    return;
  }
  const type = role.type || 'enterprise';
  const matrix = matrixCache[type];
  if (!matrix) { thead.innerHTML=''; tbody.innerHTML=''; return; }
  if (title) title.textContent = `权限矩阵概览 — ${role.label || role.id}`;
  if (hint) hint.textContent = `${type === 'platform' ? '平台角色' : '用户角色'} · 此为只读预览，点击"权限配置"进行编辑`;

  // 表头
  const colspan = matrix.actions.length + 1;
  thead.innerHTML = `<tr><th>功能模块</th>${matrix.actions.map(a => `<th>${esc(a.label)}</th>`).join('')}</tr>`;
  // 表体 — 按 group 分组插入标题行
  const perms = new Set(role.permissions || []);
  const wild = perms.has('*');
  let lastGroup = null;
  const rows = [];
  matrix.modules.forEach(m => {
    if (m.group && m.group !== lastGroup) {
      rows.push(`<tr class="pm-group-row"><td colspan="${colspan}">${esc(m.group)}</td></tr>`);
      lastGroup = m.group;
    }
    const cells = matrix.actions.map(a => {
      const key = `${type}:${m.id}:${a.id}`;
      const enabled = wild || perms.has(key);
      return `<td>${enabled ? '<span style="color:var(--accent);font-size:16px">✓</span>' : '<span style="color:var(--border2)">-</span>'}</td>`;
    }).join('');
    rows.push(`<tr><td style="padding-left:28px">${esc(m.label)}</td>${cells}</tr>`);
  });
  tbody.innerHTML = rows.join('');
}

// 为指定 type 自动生成下一个角色 ID — 形如 platform_role_001 / enterprise_role_001
function generateNextRoleId(type) {
  const prefix = (type === 'platform' ? 'platform' : 'enterprise') + '_role_';
  const re = new RegExp('^' + prefix + '(\\d+)$');
  const nums = rolesCache
    .map(r => {
      const m = (r.id || '').match(re);
      return m ? parseInt(m[1], 10) : null;
    })
    .filter(n => n !== null && !isNaN(n));
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return prefix + String(next).padStart(3, '0');
}

function openRoleModal(roleId) {
  editingRoleId = roleId;
  const modal = $('#role-modal');
  const isNew = !roleId;

  $('#role-modal-title').textContent = isNew ? '新建角色' : '权限配置';
  $('#btn-delete-role').style.display = isNew ? 'none' : 'inline-flex';
  $('#btn-save-role').disabled = false; // 每次打开都重置保存按钮可用
  // 新建时：ID 只读（自动生成）；编辑时：ID 只读（不可改）
  $('#rm-id').readOnly = true;

  let role = null;
  if (isNew) {
    // 自动生成 ID（基于当前 Tab 类型）
    $('#rm-id').value = generateNextRoleId(currentRoleType);
    $('#rm-label').value = '';
    $('#rm-description').value = '';
    $('#rm-credits').value = '100';
    $('#rm-max-projects').value = '10';
    $('#rm-type').value = currentRoleType;
    $('#rm-type').disabled = false;
  } else {
    role = rolesCache.find(x => x.id === roleId);
    if (!role) return;
    $('#rm-id').value = role.id;
    $('#rm-label').value = role.label || '';
    $('#rm-description').value = role.description || '';
    $('#rm-credits').value = role.default_credits ?? '';
    $('#rm-max-projects').value = role.max_projects ?? '';
    $('#rm-type').value = role.type || 'enterprise';
    // 内置角色或已被使用的角色不可改类型
    $('#rm-type').disabled = role.builtin || (role.user_count || 0) > 0;
    $('#btn-delete-role').style.display = role.builtin ? 'none' : 'inline-flex';
    if (role.id === 'admin') $('#btn-save-role').disabled = true;
    else $('#btn-save-role').disabled = false;
  }

  renderModelCheckboxes(roleId, isNew);
  renderRoleMatrixEditor(role);
  onRoleTypeChange(); // 根据类型决定是否显示允许模型行

  modal.classList.add('show');
}

// 类型切换：平台角色不涉及"允许模型"；新建时重新生成 ID
function onRoleTypeChange() {
  const type = $('#rm-type').value;
  const modelsRow = document.getElementById('rm-models-row');
  if (modelsRow) modelsRow.style.display = (type === 'platform') ? 'none' : '';
  const hint = document.getElementById('rm-matrix-type-hint');
  if (hint) hint.textContent = (type === 'platform')
    ? '（平台权限 — 管理后台功能）'
    : '（用户权限 — 前端平台所有模块的增删改查）';
  // 新建模式下，类型变更时重新生成 ID
  if (!editingRoleId) {
    $('#rm-id').value = generateNextRoleId(type);
  }
  // 类型变更时重渲染矩阵
  const role = editingRoleId ? rolesCache.find(x => x.id === editingRoleId) : null;
  const mockRole = role
    ? { ...role, type }
    : { type, permissions: [] };
  renderRoleMatrixEditor(mockRole);
}

function renderRoleMatrixEditor(role) {
  const thead = $('#rm-matrix-thead');
  const tbody = $('#rm-matrix-tbody');
  if (!thead || !tbody || !matrixCache) return;
  const type = (role && role.type) || $('#rm-type').value || 'enterprise';
  const matrix = matrixCache[type];
  if (!matrix) { thead.innerHTML=''; tbody.innerHTML=''; return; }

  const colspan = matrix.actions.length + 1;
  thead.innerHTML = `<tr><th>功能模块</th>${matrix.actions.map(a => `<th>${esc(a.label)}</th>`).join('')}</tr>`;
  const perms = new Set((role && role.permissions) || []);
  const wild = perms.has('*');
  const isAdmin = role && role.id === 'admin';
  let lastGroup = null;
  const rows = [];
  matrix.modules.forEach(m => {
    if (m.group && m.group !== lastGroup) {
      rows.push(`<tr class="pm-group-row" data-group="${esc(m.group)}">
        <td colspan="${colspan}">
          <span class="pm-group-label">${esc(m.group)}</span>
          ${isAdmin ? '' : `<span class="pm-group-actions">
            <button type="button" class="btn-sm" onclick="rmGroupToggle('${esc(m.group)}', true)">本组全选</button>
            <button type="button" class="btn-sm" onclick="rmGroupToggle('${esc(m.group)}', false)">本组清空</button>
          </span>`}
        </td>
      </tr>`);
      lastGroup = m.group;
    }
    const cells = matrix.actions.map(a => {
      const key = `${type}:${m.id}:${a.id}`;
      const checked = wild || perms.has(key);
      return `<td><input type="checkbox" data-key="${esc(key)}" data-group="${esc(m.group || '')}" ${checked ? 'checked' : ''} ${isAdmin ? 'disabled' : ''} /></td>`;
    }).join('');
    rows.push(`<tr data-group="${esc(m.group || '')}"><td style="padding-left:28px">${esc(m.label)}</td>${cells}</tr>`);
  });
  tbody.innerHTML = rows.join('');
}

function rmGroupToggle(group, checked) {
  document.querySelectorAll(`#rm-matrix-tbody input[type="checkbox"][data-group="${group}"]`).forEach(cb => {
    if (!cb.disabled) cb.checked = checked;
  });
}

function rmMatrixToggleAll(checked) {
  document.querySelectorAll('#rm-matrix-tbody input[type="checkbox"]').forEach(cb => {
    if (!cb.disabled) cb.checked = checked;
  });
}

function closeRoleModal() {
  $('#role-modal').classList.remove('show');
  editingRoleId = null;
}

async function saveRole() {
  const id = $('#rm-id').value.trim();
  const label = $('#rm-label').value.trim();
  const description = $('#rm-description').value.trim();
  const type = $('#rm-type').value;
  const default_credits = parseInt($('#rm-credits').value) || 0;
  const max_projects = parseInt($('#rm-max-projects').value) || 10;
  const wildcard = $('#rm-models-wildcard')?.checked;
  const allowed_models = type === 'platform'
    ? [] // 平台角色不涉及模型分配
    : (wildcard ? ['*'] : getTransferSelected('rm-transfer'));
  // 从矩阵收集权限字符串（{type}:{module}:{action}）
  const permissions = [...document.querySelectorAll('#rm-matrix-tbody input[type="checkbox"]:checked')].map(cb => cb.dataset.key);

  if (!id) return toast('角色 ID 必填', 'error');
  if (!label) return toast('角色名称必填', 'error');

  const body = { id, label, description, type, default_credits, max_projects, allowed_models, permissions };
  const isNew = !editingRoleId;
  // admin 内置角色锁定，不允许编辑
  if (editingRoleId === 'admin') { toast('内置管理员角色不可编辑', 'error'); return; }

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
  // New user role select — 只展示当前 Tab 对应 type 的角色
  const nuRole = $('#nu-role');
  if (nuRole && rolesCache.length) {
    const typeRoles = rolesCache.filter(r => (r.type || 'enterprise') === currentUserType);
    nuRole.innerHTML = typeRoles.map(r =>
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

// ══════════════════════ 穿梭框（Transfer List）══════════════════════
//
// 为每个挂载点维护独立状态：#rm-transfer / #ud-transfer
//   transferState[containerId] = { all: [], selected: Set<id>, filterL: '', filterR: '' }
const transferState = {};

function getAllModelOptions() {
  const all = [];
  if (typeof settingsData !== 'undefined' && settingsData?.providers) {
    settingsData.providers.forEach(p => {
      (p.models || []).forEach(m => {
        if (!all.find(x => x.id === m.id)) {
          all.push({ id: m.id, name: m.name || m.id, provider: p.name || p.id, use: m.use || '' });
        }
      });
    });
  }
  if (!all.find(x => x.id === 'demo')) all.push({ id: 'demo', name: 'demo', provider: '内置', use: '' });
  return all;
}

// 初始化穿梭框 — selectedIds 已选中的 id 数组（* 表示全选）
function initTransfer(containerId, selectedIds) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const all = getAllModelOptions();
  const wildcard = Array.isArray(selectedIds) && selectedIds.includes('*');
  const selected = new Set(wildcard ? all.map(m => m.id) : (selectedIds || []));
  transferState[containerId] = { all, selected, filterL: '', filterR: '', highlighted: new Set() };
  renderTransfer(containerId);
}

function renderTransfer(containerId) {
  const container = document.getElementById(containerId);
  const state = transferState[containerId];
  if (!container || !state) return;
  const { all, selected, filterL, filterR, highlighted } = state;

  const available = all.filter(m => !selected.has(m.id));
  const chosen = all.filter(m => selected.has(m.id));
  const filt = (list, q) => {
    if (!q) return list;
    const lq = q.toLowerCase();
    return list.filter(m => m.id.toLowerCase().includes(lq) || m.name.toLowerCase().includes(lq) || (m.provider || '').toLowerCase().includes(lq));
  };
  const availableF = filt(available, filterL);
  const chosenF = filt(chosen, filterR);

  const renderCol = (side, list, count) => `
    <div class="transfer-col">
      <div class="transfer-header">
        <span>${side === 'L' ? '可用模型' : '已选模型'}</span>
        <span class="tl-count">${count}</span>
      </div>
      <input type="text" class="transfer-search" data-side="${side}" placeholder="搜索..." value="${esc(side === 'L' ? filterL : filterR)}" />
      <div class="transfer-items" data-side="${side}">
        ${list.length ? list.map(m => `
          <div class="transfer-item ${highlighted.has(side + ':' + m.id) ? 'selected' : ''}" data-side="${side}" data-id="${esc(m.id)}" title="${esc(m.name)} · ${esc(m.provider)}">
            <span class="tl-name">${esc(m.name)}</span>
            <span class="tl-tag" title="${esc(m.provider)}">${esc(m.provider)}</span>
          </div>
        `).join('') : '<div class="transfer-empty">无</div>'}
      </div>
    </div>
  `;

  container.innerHTML = `
    ${renderCol('L', availableF, available.length)}
    <div class="transfer-actions">
      <button type="button" title="添加全部"     data-action="all-r"  ${available.length === 0 ? 'disabled' : ''}>»</button>
      <button type="button" title="添加选中"     data-action="move-r" ${![...highlighted].some(k=>k.startsWith('L:')) ? 'disabled' : ''}>›</button>
      <button type="button" title="移除选中"     data-action="move-l" ${![...highlighted].some(k=>k.startsWith('R:')) ? 'disabled' : ''}>‹</button>
      <button type="button" title="移除全部"     data-action="all-l"  ${chosen.length === 0 ? 'disabled' : ''}>«</button>
    </div>
    ${renderCol('R', chosenF, chosen.length)}
  `;

  // 绑定事件
  container.querySelectorAll('.transfer-item').forEach(el => {
    el.addEventListener('click', () => {
      const key = el.dataset.side + ':' + el.dataset.id;
      if (highlighted.has(key)) highlighted.delete(key);
      else highlighted.add(key);
      renderTransfer(containerId);
    });
    el.addEventListener('dblclick', () => {
      const side = el.dataset.side;
      const id = el.dataset.id;
      if (side === 'L') selected.add(id);
      else selected.delete(id);
      highlighted.clear();
      renderTransfer(containerId);
    });
  });
  container.querySelectorAll('.transfer-search').forEach(el => {
    el.addEventListener('input', e => {
      const side = el.dataset.side;
      if (side === 'L') state.filterL = e.target.value;
      else state.filterR = e.target.value;
      renderTransfer(containerId);
    });
  });
  container.querySelectorAll('.transfer-actions button').forEach(el => {
    el.addEventListener('click', () => {
      const act = el.dataset.action;
      if (act === 'all-r') all.forEach(m => selected.add(m.id));
      else if (act === 'all-l') selected.clear();
      else if (act === 'move-r') {
        [...highlighted].forEach(k => { if (k.startsWith('L:')) selected.add(k.slice(2)); });
      } else if (act === 'move-l') {
        [...highlighted].forEach(k => { if (k.startsWith('R:')) selected.delete(k.slice(2)); });
      }
      highlighted.clear();
      renderTransfer(containerId);
    });
  });
}

function getTransferSelected(containerId) {
  const state = transferState[containerId];
  if (!state) return [];
  return [...state.selected];
}

function setTransferDisabled(containerId, disabled) {
  const container = document.getElementById(containerId);
  if (container) container.classList.toggle('disabled', !!disabled);
}

// 兼容原接口 — 角色弹窗调用
function renderModelCheckboxes(roleId, isNew) {
  const role = isNew ? null : rolesCache.find(x => x.id === roleId);
  const existing = role ? (role.allowed_models || []) : [];
  const wildcardCb = $('#rm-models-wildcard');
  const isWildcard = existing.includes('*');
  if (wildcardCb) wildcardCb.checked = isWildcard;
  initTransfer('rm-transfer', existing);
  setTransferDisabled('rm-transfer', isWildcard);
}

function toggleModelsWildcard(checked) {
  setTransferDisabled('rm-transfer', checked);
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
          <label class="sp-toggle" title="${p.enabled ? '点击禁用：所有 service 跳过此供应商' : '点击启用'}">
            <input type="checkbox" ${p.enabled ? 'checked' : ''} onchange="toggleProvider('${esc(p.id)}', this.checked)">
            <span class="sp-toggle-slider"></span>
          </label>
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
// 启用/禁用供应商
async function toggleProvider(id, enabled) {
  try {
    const res = await authFetch(`/api/settings/providers/${id}/toggle`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || '切换失败');
    // 本地更新（避免 race），再 reload 数据
    const p = settingsData?.providers?.find(p => p.id === id);
    if (p) p.enabled = data.data.enabled;
    await loadProviders();
    // 同步刷新「模型调用管理」缓存：禁用的供应商不应再出现在候选列表
    try { _pmsCache = null; await loadModelPipeline(); } catch {}
    toast(enabled ? '已启用' : '已禁用');
  } catch (e) {
    toast('切换失败: ' + e.message, 'error');
    await loadProviders();  // 回滚 UI
  }
}
window.toggleProvider = toggleProvider;
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
// v8: 当前激活的内容模块
let ctActiveModule = 'all';
let ctModules = [];

async function loadContents() {
  // 初始化一次
  if (!contentsLoaded) {
    const sel = document.getElementById('ct-user');
    usersCache.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id; opt.textContent = u.username;
      sel.appendChild(opt);
    });
    contentsLoaded = true;
  }

  // 先加载模块元信息
  try {
    const mr = await authFetch('/api/admin/contents/modules');
    const mj = await mr.json();
    if (mj.success) {
      ctModules = mj.data;
      ctRenderModules();
    }
  } catch (e) { console.error('[CT] modules failed', e); }

  // 再加载当前模块的内容
  await ctLoadItems();
}

function ctRenderModules() {
  const el = document.getElementById('content-modules');
  if (!el) return;
  el.innerHTML = ctModules.map(m => `
    <button class="content-module-tab ${ctActiveModule === m.id ? 'active' : ''}" onclick="ctSwitchModule('${m.id}')">
      <span class="ct-mod-emoji">${m.emoji}</span>
      <span class="ct-mod-name">${esc(m.name)}</span>
      <span class="ct-mod-count">${m.count}</span>
    </button>
  `).join('');
}

function ctSwitchModule(id) {
  ctActiveModule = id;
  ctRenderModules();
  ctLoadItems();
}

async function ctLoadItems() {
  const userId = document.getElementById('ct-user')?.value || '';
  const view = document.getElementById('ct-view')?.value || 'grid';

  const params = new URLSearchParams();
  if (ctActiveModule !== 'all') params.set('type', ctActiveModule);
  if (userId) params.set('user_id', userId);
  params.set('limit', '200');

  try {
    const res = await authFetch('/api/admin/contents?' + params.toString());
    const data = await res.json();
    if (!data.success) return;

    const items = data.data.items;

    // 统计
    const stats = document.getElementById('contents-stats');
    if (stats) {
      stats.innerHTML = `<span class="ct-stat">共 <b>${data.data.total}</b> 条内容</span>`;
    }

    // 视图切换
    document.getElementById('content-grid').style.display = view === 'grid' ? 'grid' : 'none';
    document.getElementById('content-table-wrap').style.display = view === 'table' ? 'block' : 'none';

    if (view === 'grid') {
      ctRenderGrid(items);
    } else {
      ctRenderTable(items);
    }
  } catch (e) { console.error('ctLoadItems error', e); }
}

const CT_TYPE_LABELS = {
  project: '🎬 视频项目',
  drama: '📺 网剧',
  i2v: '🎥 图生视频',
  novel: '📖 小说',
  comic: '🖼️ 漫画',
  avatar: '👤 数字人',
  portrait: '🎨 角色形象',
};

function ctRenderGrid(items) {
  const el = document.getElementById('content-grid');
  if (!items.length) {
    el.innerHTML = '<div class="kb-empty" style="grid-column:1/-1;padding:40px;">暂无内容</div>';
    return;
  }
  const token = getToken() || '';
  el.innerHTML = items.map(item => {
    // v11: 缩略图显示
    // - 有 thumbnail URL: 用 <img loading="lazy"> 带 token
    // - onerror: 如果是 project/drama/i2v/avatar，降级到 video poster，否则显示占位图
    let thumb;
    if (item.thumbnail) {
      const thumbWithToken = item.thumbnail + (item.thumbnail.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
      thumb = `<img loading="lazy" src="${thumbWithToken}" onerror="this.onerror=null;this.parentElement.classList.add('ct-card-noimg-fallback');this.style.display='none';">`;
    } else {
      thumb = '<div class="ct-card-noimg">🎞️</div>';
    }
    const hasMedia = item.has_video || item.has_content;
    return `
      <div class="ct-card" onclick="viewContent('${item.type}','${item.id}')">
        <div class="ct-card-thumb">
          ${thumb}
          ${hasMedia ? '<span class="ct-card-badge">✓ 已生成</span>' : ''}
          <span class="ct-card-type">${CT_TYPE_LABELS[item.type] || item.type}</span>
        </div>
        <div class="ct-card-body">
          <div class="ct-card-title" title="${esc(item.title)}">${esc(item.title)}</div>
          <div class="ct-card-meta">
            <span>${esc(item.username || '-')}</span>
            <span class="ct-card-status">${esc(item.status || '-')}</span>
          </div>
          <div class="ct-card-detail">${esc(item.detail || '')}</div>
          <div class="ct-card-time">${item.created_at ? new Date(item.created_at).toLocaleString('zh-CN') : '-'}</div>
        </div>
        <div class="ct-card-actions">
          <button class="btn-sm" onclick="event.stopPropagation();viewContent('${item.type}','${item.id}')">查看</button>
          <button class="btn-sm danger" onclick="event.stopPropagation();deleteContent('${item.type}','${item.id}')">删除</button>
        </div>
      </div>
    `;
  }).join('');
}

function ctRenderTable(items) {
  const tbody = document.getElementById('contents-tbody');
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text3);padding:40px">暂无内容</td></tr>';
    return;
  }
  tbody.innerHTML = items.map(item => `<tr>
    <td>${CT_TYPE_LABELS[item.type] || item.type}</td>
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
  const TYPE_NAMES = {
    project: 'AI 视频项目', i2v: '图生视频', novel: 'AI 小说',
    drama: '网剧', comic: '漫画', avatar: '数字人', portrait: '角色形象'
  };

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
  } else if (item.type === 'drama') {
    body = `
      <div class="ct-detail-meta">
        <div class="ct-meta-row"><span class="ct-meta-label">用户</span><span>${esc(item.username)}</span></div>
        <div class="ct-meta-row"><span class="ct-meta-label">状态</span><span>${esc(item.status || '-')}</span></div>
        <div class="ct-meta-row"><span class="ct-meta-label">风格</span><span>${esc(item.style || '-')}</span></div>
        <div class="ct-meta-row"><span class="ct-meta-label">集数</span><span>${item.episodes?.length || 0}/${item.episode_count || 0}</span></div>
        <div class="ct-meta-row"><span class="ct-meta-label">比例</span><span>${esc(item.aspect_ratio || '-')}</span></div>
        <div class="ct-meta-row"><span class="ct-meta-label">运镜</span><span>${esc(item.motion_preset || '-')}</span></div>
      </div>
      ${item.synopsis ? `<div class="ct-section"><div class="ct-sec-title">剧情简介</div><div class="ct-text-block">${esc(item.synopsis)}</div></div>` : ''}
      ${item.cover_url ? `<div class="ct-section"><div class="ct-sec-title">封面</div><img class="ct-image" src="${item.cover_url}"/></div>` : ''}
      ${item.characters?.length ? `<div class="ct-section"><div class="ct-sec-title">角色</div>${item.characters.map(c => `<div class="ct-scene-card"><b>${esc(c.name)}</b> <span style="color:var(--text3);font-size:11px">${esc(c.appearance_prompt || c.description || '')}</span></div>`).join('')}</div>` : ''}
      ${item.episodes?.length ? `<div class="ct-section"><div class="ct-sec-title">剧集</div>${item.episodes.map(e => `
        <div class="ct-scene-card">
          <span class="ct-scene-idx">第${e.episode_index}集</span>
          <span class="ct-scene-desc">${esc(e.title || '-')} · ${esc(e.status || '-')} ${e.progress ? '('+e.progress+'%)' : ''}</span>
          ${e.has_video ? `<button class="btn-sm" onclick="ctPlayDrama('${e.id}','${token}')">▶ 播放</button>` : ''}
        </div>
      `).join('')}</div>` : ''}
    `;
  } else if (item.type === 'comic') {
    body = `
      <div class="ct-detail-meta">
        <div class="ct-meta-row"><span class="ct-meta-label">用户</span><span>${esc(item.username)}</span></div>
        <div class="ct-meta-row"><span class="ct-meta-label">状态</span><span>${esc(item.status || '-')}</span></div>
        <div class="ct-meta-row"><span class="ct-meta-label">主题</span><span>${esc(item.theme || '-')}</span></div>
        <div class="ct-meta-row"><span class="ct-meta-label">风格</span><span>${esc(item.style || '-')}</span></div>
        <div class="ct-meta-row"><span class="ct-meta-label">格子数</span><span>${item.panels?.length || 0}</span></div>
      </div>
      ${item.panels?.length ? `<div class="ct-section"><div class="ct-sec-title">漫画内容</div>
        <div class="ct-comic-panels">
          ${item.panels.map(p => `
            <div class="ct-comic-panel">
              <div class="ct-comic-idx">#${p.index + 1}</div>
              ${p.image_url ? `<img src="${p.image_url}" class="ct-image"/>` : '<div class="ct-empty">无图</div>'}
              <div class="ct-comic-desc">${esc(p.description || '')}</div>
              ${p.dialogue ? `<div class="ct-comic-dialog">"${esc(p.dialogue)}"</div>` : ''}
            </div>
          `).join('')}
        </div>
      </div>` : '<div class="ct-section"><div class="ct-empty">暂无漫画格</div></div>'}
    `;
  } else if (item.type === 'avatar') {
    body = `
      <div class="ct-detail-meta">
        <div class="ct-meta-row"><span class="ct-meta-label">用户</span><span>${esc(item.username)}</span></div>
        <div class="ct-meta-row"><span class="ct-meta-label">状态</span><span>${esc(item.status || '-')}</span></div>
        <div class="ct-meta-row"><span class="ct-meta-label">供应商</span><span>${esc(item.provider || '-')}</span></div>
        <div class="ct-meta-row"><span class="ct-meta-label">音色</span><span>${esc(item.voice || '-')}</span></div>
        <div class="ct-meta-row"><span class="ct-meta-label">时长</span><span>${item.duration || '-'} 秒</span></div>
      </div>
      ${item.text ? `<div class="ct-section"><div class="ct-sec-title">台词</div><div class="ct-text-block">${esc(item.text)}</div></div>` : ''}
      ${item.avatar_url ? `<div class="ct-section"><div class="ct-sec-title">数字人形象</div><img class="ct-image" src="${item.avatar_url}"/></div>` : ''}
      ${item.video_url ? `<div class="ct-section"><div class="ct-sec-title">生成视频</div><video class="ct-video" controls src="${item.video_url}"></video></div>` : '<div class="ct-section"><div class="ct-empty">视频未生成</div></div>'}
    `;
  } else if (item.type === 'portrait') {
    body = `
      <div class="ct-detail-meta">
        <div class="ct-meta-row"><span class="ct-meta-label">用户</span><span>${esc(item.username)}</span></div>
        <div class="ct-meta-row"><span class="ct-meta-label">风格</span><span>${esc(item.style || '-')}</span></div>
        <div class="ct-meta-row"><span class="ct-meta-label">性别</span><span>${esc(item.gender || '-')}</span></div>
        <div class="ct-meta-row"><span class="ct-meta-label">年龄</span><span>${esc(item.age || '-')}</span></div>
      </div>
      ${item.prompt ? `<div class="ct-section"><div class="ct-sec-title">生成提示词</div><div class="ct-text-block">${esc(item.prompt)}</div></div>` : ''}
      ${item.appearance ? `<div class="ct-section"><div class="ct-sec-title">外貌描述</div><div class="ct-text-block">${esc(item.appearance)}</div></div>` : ''}
      ${item.images?.length ? `<div class="ct-section"><div class="ct-sec-title">生成图片 (${item.images.length})</div>
        <div class="ct-portrait-grid">
          ${item.images.map(img => `<img src="${img}" class="ct-portrait-img" onclick="window.open('${img}','_blank')"/>`).join('')}
        </div>
      </div>` : '<div class="ct-section"><div class="ct-empty">暂无图片</div></div>'}
      ${item.three_view ? `<div class="ct-section"><div class="ct-sec-title">三视图</div>
        <div class="ct-portrait-grid">
          ${item.three_view.front ? `<img src="${item.three_view.front}" class="ct-portrait-img"/>` : ''}
          ${item.three_view.side ? `<img src="${item.three_view.side}" class="ct-portrait-img"/>` : ''}
          ${item.three_view.back ? `<img src="${item.three_view.back}" class="ct-portrait-img"/>` : ''}
        </div>
      </div>` : ''}
    `;
  }

  function ctPlayDrama(episodeId, token) {
    const url = `/api/drama/tasks/${episodeId}/stream?token=${encodeURIComponent(token)}`;
    window.open(url, '_blank');
  }
  window.ctPlayDrama = ctPlayDrama;

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
  ['chars', 'scenes', 'styles'].forEach(t => {
    const pane = document.getElementById('aicap-pane-' + t);
    const tabEl = document.getElementById('aicap-tab-' + t);
    if (pane) pane.style.display = t === tab ? '' : 'none';
    if (tabEl) tabEl.classList.toggle('active', t === tab);
  });
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


// ══════════════════════ KNOWLEDGE BASE ══════════════════════
let kbState = {
  collections: [],
  agentTypes: [],
  activeCollection: null,
  activeSubcategory: null,
  docs: [],
  activeDoc: null,
  loaded: false,
};

async function kbInit() {
  if (kbState.loaded) return;
  try {
    const [rCol, rAgents] = await Promise.all([
      authFetch('/api/admin/knowledgebase/collections'),
      authFetch('/api/admin/knowledgebase/agent-types'),
    ]);
    const jCol = await rCol.json();
    const jAgents = await rAgents.json();
    kbState.collections = jCol.data || [];
    kbState.agentTypes = jAgents.data || [];
    kbState.loaded = true;
    kbRenderCollections();
    kbUpdatePreviewAgentDropdown();
    await kbLoadDocs();
    await kbLoadForceState();
  } catch (e) {
    console.error('[KB] init failed', e);
  }
}

// ── 强制使用 KB 全局开关 ──
async function kbLoadForceState() {
  const el = document.getElementById('kb-force-toggle');
  if (!el) return;
  try {
    const r = await authFetch('/api/admin/knowledgebase/_force');
    const j = await r.json();
    if (j.success) el.checked = j.data?.enabled !== false;
  } catch {}
}
async function kbToggleForce(enabled) {
  try {
    const r = await authFetch('/api/admin/knowledgebase/_force', {
      method: 'PUT',
      body: JSON.stringify({ enabled: !!enabled }),
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error || '保存失败');
    toast(enabled ? '✅ 已开启：所有 AI 创作必走知识库' : '⚠ 已关闭：AI 创作不再强制注入 KB', enabled ? 'success' : 'warning');
  } catch (e) {
    toast('保存失败：' + e.message, 'error');
    const el = document.getElementById('kb-force-toggle');
    if (el) el.checked = !enabled;
  }
}

// ── 飞书提示词同步 Modal ──
function kbOpenImportModal() {
  const m = document.getElementById('kb-import-modal');
  if (m) m.style.display = 'flex';
}
async function kbDoImport() {
  const source = document.getElementById('kbi-source').value.trim() || '飞书 wiki';
  const collection = document.getElementById('kbi-collection').value;
  const appliesRaw = document.getElementById('kbi-applies').value.trim();
  const content = document.getElementById('kbi-content').value;
  if (!content || !content.trim()) return toast('请粘贴提示词内容', 'error');
  const applies_to = appliesRaw
    ? appliesRaw.split(/[,，]/).map(s => s.trim()).filter(Boolean)
    : ['screenwriter', 'director', 'storyboard', 'atmosphere'];
  try {
    const r = await authFetch('/api/admin/knowledgebase/import-prompts', {
      method: 'POST',
      body: JSON.stringify({ source, collection, applies_to, content }),
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error || '导入失败');
    toast(`✅ 已导入 ${j.data.inserted} 条到知识库`, 'success');
    document.getElementById('kbi-content').value = '';
    document.getElementById('kb-import-modal').style.display = 'none';
    await kbLoadDocs();
  } catch (e) {
    toast('导入失败：' + e.message, 'error');
  }
}

// 旧的 kbUpdatePreviewAgentDropdown 已弃用（预览现在用 showModal 动态生成）
function kbUpdatePreviewAgentDropdown() { /* noop - 保留兼容性 */ }

function kbRenderCollections() {
  const el = document.getElementById('kb-collections');
  const all = `<div class="kb-col-item ${!kbState.activeCollection ? 'active' : ''}" onclick="kbSelectCollection(null,null)">
    <div class="kb-col-name">全部合集</div>
    <div class="kb-col-desc">跨 4 个合集搜索</div>
  </div>`;
  const items = kbState.collections.map(c => {
    const sub = (c.subcategories || []).map(s => {
      const active = kbState.activeCollection === c.id && kbState.activeSubcategory === s;
      return `<div class="kb-col-sub ${active ? 'active' : ''}" onclick="event.stopPropagation();kbSelectCollection('${c.id}','${esc(s)}')">${esc(s)}</div>`;
    }).join('');
    const colActive = kbState.activeCollection === c.id && !kbState.activeSubcategory;
    return `<div class="kb-col-block">
      <div class="kb-col-item ${colActive ? 'active' : ''}" onclick="kbSelectCollection('${c.id}',null)">
        <div class="kb-col-name">${esc(c.name)}</div>
        <div class="kb-col-desc">${esc(c.desc || '')}</div>
      </div>
      <div class="kb-col-subs">${sub}</div>
    </div>`;
  }).join('');
  el.innerHTML = all + items;
}

function kbSelectCollection(colId, sub) {
  kbState.activeCollection = colId;
  kbState.activeSubcategory = sub;
  kbRenderCollections();
  kbLoadDocs();
}

async function kbLoadDocs() {
  const q = document.getElementById('kb-search')?.value || '';
  const appliesTo = document.getElementById('kb-applies-filter')?.value || '';
  const params = new URLSearchParams();
  if (kbState.activeCollection) params.set('collection', kbState.activeCollection);
  if (kbState.activeSubcategory) params.set('subcategory', kbState.activeSubcategory);
  if (q) params.set('q', q);
  if (appliesTo) params.set('appliesTo', appliesTo);
  try {
    const r = await authFetch('/api/admin/knowledgebase?' + params.toString());
    const j = await r.json();
    kbState.docs = j.data || [];
    kbRenderDocList();
  } catch (e) {
    console.error('[KB] load docs failed', e);
  }
}

let kbSearchTimer = null;
function kbOnSearch() {
  clearTimeout(kbSearchTimer);
  kbSearchTimer = setTimeout(kbLoadDocs, 240);
}

function kbRenderDocList() {
  const el = document.getElementById('kb-doc-list');
  if (!kbState.docs.length) {
    el.innerHTML = '<div class="kb-empty">没有匹配的条目</div>';
    return;
  }
  el.innerHTML = kbState.docs.map(d => {
    const active = kbState.activeDoc?.id === d.id;
    const tags = (d.tags || []).slice(0, 4).map(t => `<span class="kb-tag">${esc(t)}</span>`).join('');
    return `<div class="kb-doc-item ${active ? 'active' : ''} ${d.enabled === false ? 'disabled' : ''}" onclick="kbSelectDoc('${d.id}')">
      <div class="kb-doc-title">${esc(d.title)}</div>
      <div class="kb-doc-meta">${esc(d.collection)} · ${esc(d.subcategory || '通用')} ${d.enabled === false ? '· <span style="color:#f66">已禁用</span>' : ''}</div>
      <div class="kb-doc-summary">${esc(d.summary || '').slice(0, 90)}</div>
      <div class="kb-doc-tags">${tags}</div>
    </div>`;
  }).join('');
}

async function kbSelectDoc(id) {
  const d = kbState.docs.find(x => x.id === id);
  if (!d) return;
  kbState.activeDoc = d;
  kbRenderDocList();
  kbRenderEditor(d, false);
}

function kbNewDoc() {
  kbState.activeDoc = null;
  kbRenderEditor({
    id: '',
    collection: kbState.activeCollection || 'drama',
    subcategory: kbState.activeSubcategory || '',
    title: '',
    summary: '',
    content: '',
    tags: [],
    keywords: [],
    prompt_snippets: [],
    applies_to: ['screenwriter', 'director'],
    source: '',
    lang: 'zh',
    enabled: true,
  }, true);
}

function kbRenderEditor(d, isNew) {
  const el = document.getElementById('kb-editor');
  // 动态从 kbState.agentTypes 生成 checkbox，按层级分组
  const agents = kbState.agentTypes.length ? kbState.agentTypes : [
    { id: 'screenwriter', name: '编剧', emoji: '✍️' },
    { id: 'director', name: '导演', emoji: '🎬' },
    { id: 'character_consistency', name: '人物一致性', emoji: '🎭' },
    { id: 'storyboard', name: '分镜师', emoji: '🎥' },
    { id: 'atmosphere', name: '氛围师', emoji: '🌫️' },
    { id: 'digital_human', name: '数字人', emoji: '👤' },
  ];
  const layerOrder = ['creative', 'production', 'strategy', 'marketing', 'orchestration'];
  const layerNames = {
    creative: '创作层',
    production: '制作层',
    strategy: '战略层',
    marketing: '营销层',
    orchestration: '协调层',
  };
  const byLayer = {};
  agents.forEach(a => {
    const l = a.layer || 'creative';
    if (!byLayer[l]) byLayer[l] = [];
    byLayer[l].push(a);
  });
  const appliesHtml = layerOrder.filter(l => byLayer[l]).map(l => {
    const items = byLayer[l].map(a => {
      const checked = (d.applies_to || []).includes(a.id);
      return `<label class="kb-check kb-check-agent" title="${a.id}"><input type="checkbox" value="${a.id}" ${checked ? 'checked' : ''} class="kb-applies-cb"/>${a.emoji || ''} ${a.name}</label>`;
    }).join('');
    return `<div class="kb-applies-group"><div class="kb-applies-layer">${layerNames[l] || l}</div>${items}</div>`;
  }).join('');
  const colOpts = ['digital_human', 'drama', 'storyboard', 'atmosphere', 'production']
    .map(c => `<option value="${c}" ${d.collection === c ? 'selected' : ''}>${c}</option>`).join('');

  el.innerHTML = `
    <div class="kb-editor-header">
      <strong>${isNew ? '新建知识条目' : '编辑知识条目'}</strong>
      <div style="display:flex;gap:6px">
        <label class="kb-check"><input type="checkbox" id="kb-ed-enabled" ${d.enabled !== false ? 'checked' : ''}/>启用</label>
        ${!isNew ? `<button class="btn-sm danger" onclick="kbDeleteDoc('${d.id}')">删除</button>` : ''}
        <button class="btn-primary" onclick="kbSaveDoc(${isNew})">保存</button>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group" style="flex:1"><label>标题</label><input id="kb-ed-title" value="${esc(d.title || '')}"/></div>
      <div class="form-group" style="flex:0.5"><label>合集</label><select id="kb-ed-collection">${colOpts}</select></div>
      <div class="form-group" style="flex:0.5"><label>子分类</label><input id="kb-ed-subcategory" value="${esc(d.subcategory || '')}"/></div>
    </div>
    <div class="form-group"><label>一句话摘要</label><input id="kb-ed-summary" value="${esc(d.summary || '')}"/></div>
    <div class="form-group"><label>正文内容</label><textarea id="kb-ed-content" rows="10">${esc(d.content || '')}</textarea></div>
    <div class="form-row">
      <div class="form-group" style="flex:1"><label>标签（逗号分隔）</label><input id="kb-ed-tags" value="${esc((d.tags || []).join(','))}"/></div>
      <div class="form-group" style="flex:1"><label>关键词（逗号分隔）</label><input id="kb-ed-keywords" value="${esc((d.keywords || []).join(','))}"/></div>
    </div>
    <div class="form-group"><label>提示词片段（每行一条，注入 agent 时作为 reusable prompt）</label><textarea id="kb-ed-snippets" rows="4">${esc((d.prompt_snippets || []).join('\n'))}</textarea></div>
    <div class="form-group">
      <label>适用 Agent（被哪些 agent 注入）</label>
      <div class="kb-applies">${appliesHtml}</div>
    </div>
    <div class="form-row">
      <div class="form-group" style="flex:1"><label>来源 / source</label><input id="kb-ed-source" value="${esc(d.source || '')}"/></div>
      <div class="form-group" style="flex:0.4"><label>语言</label><input id="kb-ed-lang" value="${esc(d.lang || 'zh')}"/></div>
      ${isNew ? '<div class="form-group" style="flex:0.6"><label>ID (可选,留空自动生成)</label><input id="kb-ed-id"/></div>' : ''}
    </div>
  `;
}

async function kbSaveDoc(isNew) {
  const applies = Array.from(document.querySelectorAll('.kb-applies-cb')).filter(x => x.checked).map(x => x.value);
  const body = {
    collection: document.getElementById('kb-ed-collection').value,
    subcategory: document.getElementById('kb-ed-subcategory').value.trim(),
    title: document.getElementById('kb-ed-title').value.trim(),
    summary: document.getElementById('kb-ed-summary').value.trim(),
    content: document.getElementById('kb-ed-content').value,
    tags: document.getElementById('kb-ed-tags').value.split(',').map(s => s.trim()).filter(Boolean),
    keywords: document.getElementById('kb-ed-keywords').value.split(',').map(s => s.trim()).filter(Boolean),
    prompt_snippets: document.getElementById('kb-ed-snippets').value.split('\n').map(s => s.trim()).filter(Boolean),
    applies_to: applies,
    source: document.getElementById('kb-ed-source').value.trim(),
    lang: document.getElementById('kb-ed-lang').value.trim() || 'zh',
    enabled: document.getElementById('kb-ed-enabled').checked,
  };
  if (!body.title) return alert('标题必填');
  try {
    let r;
    if (isNew) {
      const idEl = document.getElementById('kb-ed-id');
      if (idEl && idEl.value.trim()) body.id = idEl.value.trim();
      r = await authFetch('/api/admin/knowledgebase', { method: 'POST', body: JSON.stringify(body) });
    } else {
      r = await authFetch('/api/admin/knowledgebase/' + kbState.activeDoc.id, { method: 'PUT', body: JSON.stringify(body) });
    }
    const j = await r.json();
    if (!j.success) return alert('保存失败: ' + (j.error || ''));
    await kbLoadDocs();
    kbState.activeDoc = j.data;
    kbRenderEditor(j.data, false);
    kbRenderDocList();
  } catch (e) {
    alert('保存失败: ' + e.message);
  }
}

async function kbDeleteDoc(id) {
  if (!confirm('确定删除此条目？')) return;
  try {
    const r = await authFetch('/api/admin/knowledgebase/' + id, { method: 'DELETE' });
    const j = await r.json();
    if (!j.success) return alert('删除失败: ' + (j.error || ''));
    kbState.activeDoc = null;
    document.getElementById('kb-editor').innerHTML = '<div class="kb-empty">← 选择或新建一条知识</div>';
    await kbLoadDocs();
  } catch (e) {
    alert('删除失败: ' + e.message);
  }
}

function kbOpenPreview() {
  // 用统一的 modal 系统弹窗，动态从 agentTypes 生成下拉
  const agents = kbState.agentTypes.length ? kbState.agentTypes : [];
  const agentOptions = agents.map(a =>
    `<option value="${a.id}">${a.emoji || ''} ${a.name} (${a.id})</option>`
  ).join('');

  showModal({
    title: '🔮 Agent 注入上下文预览',
    subtitle: '模拟某个 agent 在当前题材下会拿到的知识库上下文',
    maxWidth: '960px',
    body: `
      <div class="form-row" style="margin-bottom:14px;">
        <div class="form-group">
          <label>Agent 类型</label>
          <select id="kb-preview-agent-modal" onchange="kbRunPreviewInModal()">${agentOptions}</select>
        </div>
        <div class="form-group">
          <label>题材 genre（可选）</label>
          <input id="kb-preview-genre-modal" placeholder="如：悬疑 / 爽文 / 甜宠 / 末日 / 仙侠" oninput="kbRunPreviewInModalDebounced()"/>
        </div>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-bottom:8px;" id="kb-preview-stats-modal">请选择 agent 类型</div>
      <pre class="kb-preview-body" id="kb-preview-body-modal" style="max-height:55vh;overflow-y:auto;">点击下拉框选择 agent 类型后自动加载</pre>
    `,
    footer: `<button class="btn-sm" onclick="closeModal()">关闭</button>`,
  });

  // 自动加载一次
  setTimeout(kbRunPreviewInModal, 50);
}

let _kbPrevTimer = null;
function kbRunPreviewInModalDebounced() {
  clearTimeout(_kbPrevTimer);
  _kbPrevTimer = setTimeout(kbRunPreviewInModal, 300);
}

async function kbRunPreviewInModal() {
  const agent = document.getElementById('kb-preview-agent-modal')?.value;
  const genre = document.getElementById('kb-preview-genre-modal')?.value.trim() || '';
  if (!agent) return;
  const url = `/api/admin/knowledgebase/_preview/${encodeURIComponent(agent)}${genre ? '?genre=' + encodeURIComponent(genre) : ''}`;
  const body = document.getElementById('kb-preview-body-modal');
  const stats = document.getElementById('kb-preview-stats-modal');
  body.textContent = '加载中…';
  try {
    const r = await authFetch(url);
    const j = await r.json();
    const ctx = j.data?.context || '';
    if (ctx) {
      stats.textContent = `agent: ${agent}${genre ? ' · genre: ' + genre : ''} · 共 ${j.data.length} 字符`;
      body.textContent = ctx;
    } else {
      stats.textContent = `agent: ${agent} · 无匹配`;
      body.textContent = '（无匹配条目，检查 applies_to 字段是否对应此 agent）';
    }
  } catch (e) {
    body.textContent = '加载失败: ' + e.message;
  }
}

// 保留旧的 kbRunPreview 作为兼容（旧弹窗如果还存在）
async function kbRunPreview() {
  return kbRunPreviewInModal();
}

// ══════════════════════ UNIFIED MODAL ══════════════════════
// 统一弹窗系统 (v8+)
// 使用：showModal({ title, subtitle, body, footer, maxWidth })
// 关闭：closeModal() 或点击遮罩外
let _modalStack = [];

function showModal({ title = '', subtitle = '', body = '', footer = '', maxWidth = '720px', onClose = null }) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.cssText = 'display:flex;position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:1000;align-items:center;justify-content:center;padding:20px;';

  modal.innerHTML = `
    <div class="modal-content" style="max-width:${maxWidth};width:100%;">
      <div class="modal-header">
        <div>
          <div>${title}</div>
          ${subtitle ? `<div style="font-size:11px;color:var(--text3);margin-top:3px;font-weight:normal;">${subtitle}</div>` : ''}
        </div>
        <button class="btn-sm" onclick="closeModal()" style="font-size:18px;padding:2px 10px;">×</button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-footer" style="padding:12px 20px;border-top:1px solid var(--border2);display:flex;gap:8px;justify-content:flex-end;">${footer}</div>` : ''}
    </div>
  `;

  // 点击遮罩外关闭
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  document.body.appendChild(modal);
  _modalStack.push({ modal, onClose });

  // ESC 关闭
  const escHandler = (e) => { if (e.key === 'Escape') closeModal(); };
  modal._escHandler = escHandler;
  document.addEventListener('keydown', escHandler);

  return modal;
}

function closeModal() {
  const top = _modalStack.pop();
  if (!top) return;
  if (top.modal._escHandler) document.removeEventListener('keydown', top.modal._escHandler);
  top.modal.remove();
  if (top.onClose) top.onClose();
}

// ══════════════════════ AI TEAM ══════════════════════
let aiteamState = { teams: [], loaded: false };

async function aiteamInit() {
  if (aiteamState.loaded) return;
  await aiteamRefresh();
}

async function aiteamRefresh() {
  try {
    const r = await authFetch('/api/admin/knowledgebase/teams');
    const j = await r.json();
    aiteamState.teams = j.data || [];
    aiteamState.loaded = true;
    aiteamRender();
  } catch (e) {
    console.error('[AI Team] failed', e);
  }
}

function aiteamRender() {
  const el = document.getElementById('aiteam-teams');
  const stats = document.getElementById('aiteam-stats');

  const totalAgents = aiteamState.teams.reduce((s, t) => s + t.total_agents, 0);
  const totalDocs = aiteamState.teams.reduce((s, t) => s + t.total_docs, 0);
  stats.textContent = `${aiteamState.teams.length} 个团队 · ${totalAgents} 名 agent · ${totalDocs} 条知识`;

  el.innerHTML = aiteamState.teams.map(team => {
    const agentsHtml = team.agents.map(a => {
      const skills = (a.skills || []).map(s => `<span class="aiteam-skill">${esc(s)}</span>`).join('');
      const colDocs = Object.entries(a.by_collection || {})
        .map(([col, n]) => `<span class="aiteam-col" title="${esc(col)}">${esc(col)}:${n}</span>`)
        .join('');
      return `<div class="aiteam-agent" onclick="aiteamShowDetails('${a.id}')">
        <div class="aiteam-agent-head">
          <span class="aiteam-emoji">${a.emoji}</span>
          <span class="aiteam-name">${esc(a.name)}</span>
          <span class="aiteam-id">${esc(a.id)}</span>
          <span class="aiteam-badge aiteam-layer-${a.layer}">${aiteamLayerName(a.layer)}</span>
        </div>
        <div class="aiteam-desc-line">${esc(a.desc || '')}</div>
        <div class="aiteam-skills">${skills}</div>
        <div class="aiteam-foot">
          <span class="aiteam-count">📚 ${a.total_docs} 条</span>
          <span class="aiteam-collections">${colDocs}</span>
        </div>
      </div>`;
    }).join('');
    return `<div class="aiteam-team">
      <div class="aiteam-team-head">
        <span class="aiteam-team-emoji">${team.emoji}</span>
        <span class="aiteam-team-name">${esc(team.name)}</span>
        <span class="aiteam-team-meta">${team.total_agents} 名 · ${team.total_docs} 条知识</span>
      </div>
      <div class="aiteam-agents">${agentsHtml}</div>
    </div>`;
  }).join('');
}

function aiteamLayerName(l) {
  return ({
    creative: '创作', production: '制作', engineering: '工程',
    strategy: '战略', marketing: '营销', orchestration: '协调',
  })[l] || l;
}

async function aiteamShowDetails(agentId) {
  // v8 改为弹窗显示：在当前页直接显示该 agent 的能力 + KB 条目列表
  // 找到 agent 元信息
  let agent = null;
  for (const team of aiteamState.teams) {
    const found = team.agents.find(a => a.id === agentId);
    if (found) { agent = { ...found, team: team.name, teamEmoji: team.emoji }; break; }
  }
  if (!agent) return;

  // 加载该 agent 所有知识条目
  let docs = [];
  try {
    const r = await authFetch('/api/admin/knowledgebase?appliesTo=' + encodeURIComponent(agentId));
    const j = await r.json();
    if (j.success) docs = j.data;
  } catch (e) { console.error('[AI team] load docs failed', e); }

  // 按合集分组
  const byCollection = {};
  docs.forEach(d => {
    if (!byCollection[d.collection]) byCollection[d.collection] = [];
    byCollection[d.collection].push(d);
  });

  // 构建弹窗
  const skills = (agent.skills || []).map(s => `<span class="aiteam-skill">${esc(s)}</span>`).join('');
  const docsHtml = Object.keys(byCollection).sort().map(col => {
    const items = byCollection[col].map(d => `
      <div class="agent-kb-item" onclick="kbQuickView('${esc(d.id)}')">
        <div class="agent-kb-item-head">
          <span class="agent-kb-sub">${esc(d.subcategory || '通用')}</span>
          <span class="agent-kb-title">${esc(d.title)}</span>
        </div>
        ${d.summary ? `<div class="agent-kb-summary">${esc(d.summary)}</div>` : ''}
      </div>
    `).join('');
    return `<div class="agent-kb-col">
      <div class="agent-kb-col-head">📚 ${esc(col)} <span class="agent-kb-col-count">${byCollection[col].length}</span></div>
      ${items}
    </div>`;
  }).join('');

  showModal({
    title: `${agent.emoji} ${agent.name} <span class="aiteam-badge aiteam-layer-${agent.layer}">${aiteamLayerName(agent.layer)}</span>`,
    subtitle: `${agent.teamEmoji} ${agent.team} · <code>${agent.id}</code>`,
    maxWidth: '900px',
    body: `
      <div class="agent-detail-meta">
        <div class="agent-detail-desc">${esc(agent.desc || '')}</div>
        <div class="agent-detail-skills"><strong>核心技能：</strong>${skills}</div>
        <div class="agent-detail-stats">
          📚 <strong>${docs.length}</strong> 条知识
          ${agent.by_collection ? ' · 跨 <strong>' + Object.keys(agent.by_collection).length + '</strong> 个合集' : ''}
        </div>
      </div>
      <div class="agent-kb-section">
        <div class="agent-kb-section-title">此 Agent 可读取的知识库内容</div>
        ${docs.length === 0 ? '<div class="kb-empty">暂无对应知识，请在知识库中新增或为已有条目勾选此 agent</div>' : `<div class="agent-kb-list">${docsHtml}</div>`}
      </div>
    `,
    footer: `
      <button class="btn-sm" onclick="aiteamGoToFilteredKB('${agentId}')">→ 在知识库中查看完整列表</button>
      <button class="btn-sm" onclick="closeModal()">关闭</button>
    `,
  });
}

// 跳转到知识库 tab 并按 agent 过滤（用户从弹窗点"完整列表"时）
async function aiteamGoToFilteredKB(agentId) {
  closeModal();
  const navKB = document.querySelector('.nav-item[data-tab="knowledgebase"]');
  if (navKB) navKB.click();
  await kbInit();
  // 等待 dropdown 渲染完成
  setTimeout(() => {
    const sel = document.getElementById('kb-applies-filter');
    if (sel) {
      sel.value = agentId;
      kbLoadDocs();
    }
  }, 100);
}

// 快速预览单个 KB 条目（从 agent 详情弹窗里点条目时）
async function kbQuickView(docId) {
  try {
    const r = await authFetch('/api/admin/knowledgebase/' + docId);
    const j = await r.json();
    if (!j.success) return;
    const d = j.data;
    showModal({
      title: `📄 ${esc(d.title)}`,
      subtitle: `<code>${esc(d.collection)}/${esc(d.subcategory || '通用')}</code> · ID: <code>${esc(d.id)}</code>`,
      maxWidth: '800px',
      body: `
        ${d.summary ? `<div class="kb-view-section"><div class="kb-view-label">摘要</div><div class="kb-view-summary">${esc(d.summary)}</div></div>` : ''}
        ${d.content ? `<div class="kb-view-section"><div class="kb-view-label">正文</div><pre class="kb-view-content">${esc(d.content)}</pre></div>` : ''}
        ${(d.tags || []).length ? `<div class="kb-view-section"><div class="kb-view-label">标签</div>${d.tags.map(t => `<span class="kb-tag">${esc(t)}</span>`).join(' ')}</div>` : ''}
        ${(d.keywords || []).length ? `<div class="kb-view-section"><div class="kb-view-label">关键词</div><div style="font-size:11px;color:var(--text3);">${d.keywords.map(k => esc(k)).join(', ')}</div></div>` : ''}
        ${(d.prompt_snippets || []).length ? `<div class="kb-view-section"><div class="kb-view-label">提示词片段</div>${d.prompt_snippets.map(p => `<code class="kb-view-snippet">${esc(p)}</code>`).join('')}</div>` : ''}
        <div class="kb-view-section"><div class="kb-view-label">注入到</div>${(d.applies_to || []).map(a => `<span class="kb-tag">${esc(a)}</span>`).join(' ') || '<span style="color:var(--text3);font-size:11px;">无</span>'}</div>
      `,
      footer: `<button class="btn-sm" onclick="closeModal()">关闭</button>`,
    });
  } catch (e) {
    alert('加载失败: ' + e.message);
  }
}

// ══════════════════════ LOGS TREE ══════════════════════
async function aiteamInitWithLogs() {
  await aiteamInit();
  await logsTreeRefresh();
}

// 覆盖原来的 aiteamInit tab 点击：打开 AI 团队 tab 时也加载日志
const _origAiteamInit = aiteamInit;
aiteamInit = async function() {
  await _origAiteamInit();
  try { await logsTreeRefresh(); } catch (e) { console.warn('[Logs] refresh failed', e); }
};

async function logsTreeRefresh() {
  try {
    const r = await authFetch('/api/admin/logs/tree');
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    logsTreeRender(j.data);
  } catch (e) {
    const el = document.getElementById('logs-tree');
    if (el) el.innerHTML = '<div class="kb-empty">加载失败: ' + esc(e.message) + '</div>';
  }
}

function logsTreeRender(data) {
  const el = document.getElementById('logs-tree');
  const stats = document.getElementById('logs-stats');

  if (stats && data.stats) {
    stats.textContent = `${data.stats.total_sessions} 会话 · ${data.stats.total_learning_days} 学习日 · ${data.stats.total_changes} 修改 · ${data.stats.total_deployments} 部署`;
  }

  if (!data.exists) {
    el.innerHTML = '<div class="kb-empty">docs/logs/ 目录不存在，请先部署 v7</div>';
    return;
  }

  const icons = {
    sessions: '💬',
    learning: '🎓',
    changes: '🔧',
    deployments: '🚀',
  };
  const names = {
    sessions: '会话日志',
    learning: '每日学习',
    changes: '修改日志',
    deployments: '部署记录',
  };

  const html = data.categories.map(cat => {
    const entriesHtml = cat.entries.slice(0, 10).map(e => {
      if (e.type === 'directory') {
        const filesList = (e.file_list || []).map(f =>
          `<div class="log-subfile" onclick="logsViewFile('${esc(f.path)}')">📄 ${esc(f.name)} <span class="log-size">${(f.size/1024).toFixed(1)} KB</span></div>`
        ).join('');
        return `<div class="log-entry">
          <div class="log-entry-head">📁 ${esc(e.name)} <span class="log-size">(${e.files} 文件)</span></div>
          <div class="log-subfiles">${filesList}</div>
        </div>`;
      } else {
        return `<div class="log-entry" onclick="logsViewFile('${esc(e.path)}')">
          <div class="log-entry-head">📄 ${esc(e.name)} <span class="log-size">${(e.size/1024).toFixed(1)} KB</span></div>
        </div>`;
      }
    }).join('');

    return `<div class="log-category">
      <div class="log-cat-head">${icons[cat.id] || '📂'} ${names[cat.id] || cat.id} <span class="log-cat-path">${esc(cat.path)}</span></div>
      <div class="log-entries">${entriesHtml || '<div class="kb-empty" style="padding:10px;">（暂无日志）</div>'}</div>
    </div>`;
  }).join('');

  el.innerHTML = html;
}

async function logsViewFile(filePath) {
  try {
    const r = await authFetch('/api/admin/logs/file?file=' + encodeURIComponent(filePath));
    const j = await r.json();
    if (!j.success) throw new Error(j.error);

    showModal({
      title: `📄 ${esc(filePath.split('/').pop())}`,
      subtitle: `<code>${esc(filePath)}</code> · ${(j.data.size/1024).toFixed(1)} KB`,
      maxWidth: '900px',
      body: `<pre class="kb-preview-body" style="max-height:65vh;overflow-y:auto;">${esc(j.data.content)}</pre>`,
      footer: `<button class="btn-sm" onclick="closeModal()">关闭</button>`,
    });
  } catch (e) {
    alert('读取失败: ' + e.message);
  }
}

// ══════════════════════ MODEL MONITOR ══════════════════════
async function monitorRefresh() {
  const days = parseInt(document.getElementById('monitor-days')?.value) || 7;
  try {
    const [overview, server, recent] = await Promise.all([
      authFetch(`/api/admin/token-stats/overview?days=${days}`).then(r => r.json()),
      authFetch('/api/admin/token-stats/server').then(r => r.json()),
      authFetch('/api/admin/token-stats/recent?limit=50').then(r => r.json()),
    ]);

    if (overview.success) {
      monitorRenderOverview(overview.data, days);
    }
    if (server.success) {
      monitorRenderServer(server.data);
    }
    if (recent.success) {
      monitorRenderRecent(recent.data);
    }
  } catch (e) {
    console.error('[Monitor] refresh failed', e);
  }
}

function monitorRenderOverview(data, days) {
  const stats = data.stats;
  const budget = data.budget;
  const alerts = data.alerts || [];

  // 汇率 USD→CNY，从 budget 读
  const rate = (budget && budget.usd_cny_rate) || 7.20;
  const cny = (usd) => '¥' + (Number(usd || 0) * rate).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // 告警条
  const alertsEl = document.getElementById('monitor-alerts');
  if (alerts.length > 0) {
    alertsEl.innerHTML = alerts.map(a =>
      `<div class="monitor-alert alert-${a.level}">
        ${a.level === 'critical' ? '🔴' : '🟡'} <strong>${esc(a.type)}</strong>: ${esc(a.message)}
      </div>`
    ).join('');
  } else {
    alertsEl.innerHTML = '<div class="monitor-alert alert-ok">✅ 一切正常</div>';
  }

  // 总览卡片
  const overviewEl = document.getElementById('monitor-overview');
  const budgetCard = budget.has_budget ? `
    <div class="monitor-card ${budget.alerting ? 'card-alert' : ''}">
      <div class="monitor-card-label">本月预算</div>
      <div class="monitor-card-value">${cny(budget.used_cost_usd)} / ${cny(budget.monthly_budget_usd)}</div>
      <div class="monitor-card-meta">
        <div class="monitor-progress"><div class="monitor-progress-bar" style="width:${Math.min(100, budget.used_percent || 0)}%;background:${budget.alerting ? '#ff6b6b' : 'var(--accent)'}"></div></div>
        <div style="font-size:10px;color:var(--text3);">剩余 ${cny(budget.remaining_usd || 0)} · ${budget.used_percent || 0}% · ($${budget.used_cost_usd.toFixed(2)} / $${budget.monthly_budget_usd})</div>
      </div>
    </div>
  ` : `
    <div class="monitor-card">
      <div class="monitor-card-label">本月预算</div>
      <div class="monitor-card-value" style="color:var(--text3);">未设置</div>
      <div class="monitor-card-meta" style="font-size:11px;">
        已用: ${cny(budget.used_cost_usd)} ($${budget.used_cost_usd.toFixed(2)})
        <br><a href="#" onclick="monitorOpenBudget();return false;" style="color:var(--accent);">设置预算 →</a>
      </div>
    </div>
  `;

  overviewEl.innerHTML = `
    <div class="monitor-card">
      <div class="monitor-card-label">总调用 (${days}d)</div>
      <div class="monitor-card-value">${stats.total_calls.toLocaleString()}</div>
      <div class="monitor-card-meta">成功 ${stats.success_count} · 失败 ${stats.fail_count}</div>
    </div>
    <div class="monitor-card">
      <div class="monitor-card-label">总 Tokens</div>
      <div class="monitor-card-value">${stats.total_tokens.toLocaleString()}</div>
      <div class="monitor-card-meta">输入 ${stats.total_input_tokens.toLocaleString()} · 输出 ${stats.total_output_tokens.toLocaleString()}</div>
    </div>
    <div class="monitor-card">
      <div class="monitor-card-label">总成本（人民币）</div>
      <div class="monitor-card-value" style="color:var(--accent)">${cny(stats.total_cost_usd)}</div>
      <div class="monitor-card-meta">$${stats.total_cost_usd.toFixed(4)} · 近 ${days} 天 · 1$≈¥${rate.toFixed(2)}</div>
    </div>
    ${budgetCard}
    <div class="monitor-card">
      <div class="monitor-card-label">视频生成</div>
      <div class="monitor-card-value">${stats.total_video_seconds.toFixed(0)} 秒</div>
      <div class="monitor-card-meta">图像 ${stats.total_image_count} 张</div>
    </div>
  `;

  // 暴露给 monitorRenderTable 使用
  window._monitorRate = rate;

  // 按 provider
  document.getElementById('monitor-by-provider').innerHTML = monitorRenderTable(stats.by_provider, 'key', 'provider');
  document.getElementById('monitor-by-model').innerHTML = monitorRenderTable(stats.by_model, 'key', 'model');
  document.getElementById('monitor-by-agent').innerHTML = monitorRenderTable(stats.by_agent, 'key', 'agent');

  // 按天
  document.getElementById('monitor-by-day').innerHTML = monitorRenderDayChart(stats.by_day);
}

function monitorRenderTable(rows, keyField, label) {
  if (!rows || rows.length === 0) {
    return '<div class="monitor-empty">暂无数据</div>';
  }
  const maxCost = Math.max(...rows.map(r => r.cost_usd));
  const rate = window._monitorRate || 7.20;
  const cny = (usd) => '¥' + (Number(usd || 0) * rate).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `
    <table class="monitor-table">
      <thead>
        <tr>
          <th>${label}</th>
          <th>调用</th>
          <th>Tokens</th>
          <th>消耗 (CNY/USD)</th>
        </tr>
      </thead>
      <tbody>
        ${rows.slice(0, 10).map(r => `
          <tr>
            <td class="monitor-key">${esc(r[keyField] || '-')}</td>
            <td>${r.calls}</td>
            <td>${(r.tokens || 0).toLocaleString()}</td>
            <td>
              <div class="monitor-cost-cell">
                <span style="color:var(--accent);font-weight:700">${cny(r.cost_usd)}</span> <span style="font-size:10px;color:var(--text3)">$${r.cost_usd.toFixed(4)}</span>
                <div class="monitor-mini-bar" style="width:${(r.cost_usd / maxCost * 100)}%;"></div>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function monitorRenderDayChart(days) {
  if (!days || days.length === 0) return '<div class="monitor-empty">暂无数据</div>';
  const maxCost = Math.max(...days.map(d => d.cost_usd));
  const maxCalls = Math.max(...days.map(d => d.calls));
  const rate = window._monitorRate || 7.20;
  const cny = (usd) => '¥' + (Number(usd || 0) * rate).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `
    <div class="monitor-day-chart">
      ${days.map(d => `
        <div class="monitor-day-bar">
          <div class="monitor-day-label">${d.day.slice(5)}</div>
          <div class="monitor-day-visual">
            <div class="monitor-day-cost-bar" style="width:${maxCost ? (d.cost_usd / maxCost * 100) : 0}%;"></div>
          </div>
          <div class="monitor-day-meta">
            <span>${d.calls} 次</span>
            <span>${(d.tokens || 0).toLocaleString()} t</span>
            <span style="color:var(--accent);font-weight:700">${cny(d.cost_usd)}</span>
            <span style="color:var(--text3);font-size:10px">$${d.cost_usd.toFixed(4)}</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function monitorRenderServer(data) {
  const el = document.getElementById('monitor-server');
  el.innerHTML = `
    <div class="monitor-server-grid">
      <div class="monitor-server-item">
        <div class="monitor-server-label">CPU 使用率</div>
        <div class="monitor-server-value ${data.cpu.usage_percent > 80 ? 'alert' : ''}">${data.cpu.usage_percent}%</div>
        <div class="monitor-server-meta">${data.cpu.count} 核 · Load ${data.cpu.load_avg_1m.toFixed(2)} / ${data.cpu.load_avg_5m.toFixed(2)} / ${data.cpu.load_avg_15m.toFixed(2)}</div>
      </div>
      <div class="monitor-server-item">
        <div class="monitor-server-label">内存使用率</div>
        <div class="monitor-server-value ${data.memory.used_percent > 90 ? 'alert' : ''}">${data.memory.used_percent}%</div>
        <div class="monitor-server-meta">${data.memory.used_gb} / ${data.memory.total_gb} GB</div>
      </div>
      <div class="monitor-server-item">
        <div class="monitor-server-label">Node 进程内存</div>
        <div class="monitor-server-value">${data.process_memory.rss_mb} MB</div>
        <div class="monitor-server-meta">Heap ${data.process_memory.heap_used_mb} / ${data.process_memory.heap_total_mb} MB</div>
      </div>
      <div class="monitor-server-item">
        <div class="monitor-server-label">进程运行时间</div>
        <div class="monitor-server-value">${formatUptime(data.uptime_seconds)}</div>
        <div class="monitor-server-meta">系统已运行 ${formatUptime(data.system_uptime_seconds)}</div>
      </div>
      <div class="monitor-server-item">
        <div class="monitor-server-label">平台</div>
        <div class="monitor-server-value" style="font-size:14px;">${esc(data.platform)} ${esc(data.arch)}</div>
        <div class="monitor-server-meta">Node ${esc(data.node_version)}</div>
      </div>
      <div class="monitor-server-item">
        <div class="monitor-server-label">CPU 型号</div>
        <div class="monitor-server-value" style="font-size:12px;">${esc(data.cpu.model.slice(0, 30))}</div>
        <div class="monitor-server-meta">主机名: ${esc(data.hostname)}</div>
      </div>
    </div>
  `;
}

function formatUptime(seconds) {
  if (seconds < 60) return seconds + 's';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h';
  return Math.floor(seconds / 86400) + 'd ' + Math.floor((seconds % 86400) / 3600) + 'h';
}

function monitorRenderRecent(rows) {
  const el = document.getElementById('monitor-recent');
  if (!rows || rows.length === 0) {
    el.innerHTML = '<div class="monitor-empty">暂无调用记录，触发一次 AI 调用后会出现在这里</div>';
    return;
  }
  const rate = window._monitorRate || 7.20;
  const cny = (usd) => '¥' + (Number(usd || 0) * rate).toLocaleString('zh-CN', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  el.innerHTML = `
    <table class="monitor-table">
      <thead>
        <tr>
          <th>时间</th>
          <th>Provider</th>
          <th>Model</th>
          <th>Category</th>
          <th>Agent</th>
          <th>Tokens</th>
          <th>消耗 (CNY/USD)</th>
          <th>耗时</th>
          <th>状态</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr class="${r.status === 'fail' ? 'row-fail' : ''}">
            <td>${r.timestamp?.slice(11, 19) || '-'}</td>
            <td>${esc(r.provider || '-')}</td>
            <td class="monitor-key">${esc(r.model || '-')}</td>
            <td>${esc(r.category || '-')}</td>
            <td>${esc(r.agent_id || '-')}</td>
            <td>${(r.total_tokens || 0).toLocaleString()}</td>
            <td><span style="color:var(--accent);font-weight:700">${cny(r.cost_usd)}</span> <span style="font-size:10px;color:var(--text3)">$${(r.cost_usd || 0).toFixed(6)}</span></td>
            <td>${r.duration_ms}ms</td>
            <td>${r.status === 'success' ? '✓' : '✗'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

async function monitorOpenBudget() {
  try {
    const r = await authFetch('/api/admin/token-stats/budget');
    const j = await r.json();
    if (j.success) {
      document.getElementById('budget-monthly').value = j.data.monthly_budget_usd || '';
      document.getElementById('budget-threshold').value = j.data.alert_threshold || 0.8;
      const rateEl = document.getElementById('budget-rate');
      if (rateEl) rateEl.value = j.data.usd_cny_rate || 7.20;
    }
  } catch {}
  document.getElementById('budget-modal').style.display = 'flex';
}

async function monitorSaveBudget() {
  const monthly = parseFloat(document.getElementById('budget-monthly').value) || 0;
  const threshold = parseFloat(document.getElementById('budget-threshold').value) || 0.8;
  const rateEl = document.getElementById('budget-rate');
  const rate = rateEl ? (parseFloat(rateEl.value) || 7.20) : 7.20;
  try {
    const r = await authFetch('/api/admin/token-stats/budget', {
      method: 'PUT',
      body: JSON.stringify({ monthly_budget_usd: monthly, alert_threshold: threshold, usd_cny_rate: rate }),
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    document.getElementById('budget-modal').style.display = 'none';
    alert('✓ 已保存');
    await monitorRefresh();
  } catch (e) {
    alert('保存失败: ' + e.message);
  }
}

async function logsTriggerDailyLearn() {
  if (!confirm('手动触发每日学习任务？（会扫描所有 knowledgeSources + 为每个 agent 生成 digest）')) return;
  try {
    const r = await authFetch('/api/admin/daily-learn/trigger', { method: 'POST' });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    alert(`✓ 已完成\n耗时: ${j.data.duration_ms}ms\n新增: ${j.data.new_docs} 条\nAgent digest: ${j.data.agent_digests.length} 份`);
    await logsTreeRefresh();
  } catch (e) {
    alert('触发失败: ' + e.message);
  }
}

// ══════════════════════ DASHBOARD (v9) ══════════════════════
async function loadDashboard() {
  const body = document.getElementById('dashboard-body');
  if (!body) return;
  body.innerHTML = '<div class="kb-empty">加载中…</div>';

  try {
    const r = await authFetch('/api/admin/dashboard');
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    renderDashboard(j.data);
    document.getElementById('dashboard-time').textContent = '更新于 ' + new Date(j.data.timestamp).toLocaleString('zh-CN');
  } catch (e) {
    body.innerHTML = `<div class="kb-empty">加载失败: ${esc(e.message)}</div>`;
  }
}

function renderDashboard(d) {
  const body = document.getElementById('dashboard-body');

  // 汇率（USD→CNY），来自后端 budget 配置
  const rate = (d.currency && d.currency.usd_cny_rate) || 7.20;
  const fmtCNY = (usd) => '¥' + (Number(usd || 0) * rate).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtUSD = (usd) => '$' + Number(usd || 0).toFixed(4);
  const dualCost = (usd) => `<span style="font-weight:700;color:var(--accent)">${fmtCNY(usd)}</span> <span style="font-size:11px;color:var(--text3)">(${fmtUSD(usd)})</span>`;

  // ——— 用户 + 内容 + 模型 + Token 四类总览卡片 ———
  const overviewCards = `
    <div class="dash-section-title">📊 核心指标 <span style="font-size:11px;color:var(--text3);font-weight:400">· 汇率 1$ ≈ ¥${rate.toFixed(2)}</span></div>
    <div class="dash-cards">
      <div class="dash-card dash-card-primary">
        <div class="dash-card-icon">👥</div>
        <div class="dash-card-main">
          <div class="dash-card-label">用户总数</div>
          <div class="dash-card-value">${d.users.total}</div>
          <div class="dash-card-meta">今日 +${d.users.today} · 本周 +${d.users.week} · 本月 +${d.users.month}</div>
          ${typeof d.users.dau === 'number' ? `<div class="dash-card-meta" style="margin-top:4px">活跃 DAU ${d.users.dau} · WAU ${d.users.wau} · MAU ${d.users.mau}</div>` : ''}
        </div>
      </div>
      <div class="dash-card">
        <div class="dash-card-icon">📦</div>
        <div class="dash-card-main">
          <div class="dash-card-label">生成内容总数</div>
          <div class="dash-card-value">${d.content._total.total}</div>
          <div class="dash-card-meta">今日 +${d.content._total.today} · 本周 +${d.content._total.week}</div>
        </div>
      </div>
      <div class="dash-card">
        <div class="dash-card-icon">🤖</div>
        <div class="dash-card-main">
          <div class="dash-card-label">已接入模型</div>
          <div class="dash-card-value">${d.models.enabled_models} / ${d.models.total_models}</div>
          <div class="dash-card-meta">${d.models.enabled_providers} 个 provider · ${d.models.by_category.story || 0} story · ${d.models.by_category.video || 0} video</div>
        </div>
      </div>
      <div class="dash-card">
        <div class="dash-card-icon">💰</div>
        <div class="dash-card-main">
          <div class="dash-card-label">累计消耗（人民币）</div>
          <div class="dash-card-value" style="color:var(--accent)">${fmtCNY(d.tokens.total_cost_usd)}</div>
          <div class="dash-card-meta">${fmtUSD(d.tokens.total_cost_usd)} · 今日 ${fmtCNY(d.tokens.today.cost_usd)} · 本月 ${fmtCNY(d.tokens.month.cost_usd)}</div>
        </div>
      </div>
      <div class="dash-card">
        <div class="dash-card-icon">🧠</div>
        <div class="dash-card-main">
          <div class="dash-card-label">知识库</div>
          <div class="dash-card-value">${d.knowledge.total_docs}</div>
          <div class="dash-card-meta">${d.knowledge.total_agents} 个 agent · 研发 ${d.knowledge.by_team.rd} · 运营 ${d.knowledge.by_team.ops}</div>
        </div>
      </div>
      <div class="dash-card">
        <div class="dash-card-icon">⚙️</div>
        <div class="dash-card-main">
          <div class="dash-card-label">Token 调用次数</div>
          <div class="dash-card-value">${d.tokens.total_calls}</div>
          <div class="dash-card-meta">今日 ${d.tokens.today.calls} · 本月 ${d.tokens.month.calls}${typeof d.tokens.success_rate === 'number' ? ` · 成功率 ${d.tokens.success_rate}%` : ''}</div>
        </div>
      </div>
    </div>
  `;

  // ——— 按品类拆分（LLM / 视频 / 图片 / TTS）以人民币优先 ———
  const cat = d.tokens.total_by_category || null;
  const todayCat = d.tokens.today?.by_category || null;
  const monthCat = d.tokens.month?.by_category || null;
  const categoryBlock = cat ? `
    <div class="dash-section-title">🧩 按品类消耗拆分（人民币优先）</div>
    <table class="monitor-table">
      <thead><tr>
        <th>品类</th>
        <th>累计调用</th>
        <th>累计消耗（CNY）</th>
        <th>累计消耗（USD）</th>
        <th>本月调用</th>
        <th>本月消耗（CNY）</th>
        <th>今日调用</th>
        <th>今日消耗（CNY）</th>
        <th>用量</th>
      </tr></thead>
      <tbody>
        <tr>
          <td class="dash-key">🧠 LLM (剧情/对白)</td>
          <td>${cat.llm.calls}</td>
          <td style="color:var(--accent);font-weight:700">${fmtCNY(cat.llm.cost_usd)}</td>
          <td style="color:var(--text3)">${fmtUSD(cat.llm.cost_usd)}</td>
          <td>${monthCat?.llm?.calls || 0}</td>
          <td>${fmtCNY(monthCat?.llm?.cost_usd || 0)}</td>
          <td>${todayCat?.llm?.calls || 0}</td>
          <td>${fmtCNY(todayCat?.llm?.cost_usd || 0)}</td>
          <td style="color:var(--text3);font-size:11px">${(cat.llm.tokens || 0).toLocaleString()} tokens</td>
        </tr>
        <tr>
          <td class="dash-key">🎬 视频生成</td>
          <td>${cat.video.calls}</td>
          <td style="color:var(--accent);font-weight:700">${fmtCNY(cat.video.cost_usd)}</td>
          <td style="color:var(--text3)">${fmtUSD(cat.video.cost_usd)}</td>
          <td>${monthCat?.video?.calls || 0}</td>
          <td>${fmtCNY(monthCat?.video?.cost_usd || 0)}</td>
          <td>${todayCat?.video?.calls || 0}</td>
          <td>${fmtCNY(todayCat?.video?.cost_usd || 0)}</td>
          <td style="color:var(--text3);font-size:11px">${cat.video.seconds || 0} s</td>
        </tr>
        <tr>
          <td class="dash-key">🎨 图像生成</td>
          <td>${cat.image.calls}</td>
          <td style="color:var(--accent);font-weight:700">${fmtCNY(cat.image.cost_usd)}</td>
          <td style="color:var(--text3)">${fmtUSD(cat.image.cost_usd)}</td>
          <td>${monthCat?.image?.calls || 0}</td>
          <td>${fmtCNY(monthCat?.image?.cost_usd || 0)}</td>
          <td>${todayCat?.image?.calls || 0}</td>
          <td>${fmtCNY(todayCat?.image?.cost_usd || 0)}</td>
          <td style="color:var(--text3);font-size:11px">${cat.image.count || 0} 张</td>
        </tr>
        <tr>
          <td class="dash-key">🔊 TTS / 语音</td>
          <td>${cat.tts.calls}</td>
          <td style="color:var(--accent);font-weight:700">${fmtCNY(cat.tts.cost_usd)}</td>
          <td style="color:var(--text3)">${fmtUSD(cat.tts.cost_usd)}</td>
          <td>${monthCat?.tts?.calls || 0}</td>
          <td>${fmtCNY(monthCat?.tts?.cost_usd || 0)}</td>
          <td>${todayCat?.tts?.calls || 0}</td>
          <td>${fmtCNY(todayCat?.tts?.cost_usd || 0)}</td>
          <td style="color:var(--text3);font-size:11px">${(cat.tts.chars || 0).toLocaleString()} 字符</td>
        </tr>
      </tbody>
    </table>
  ` : '';

  // ——— 平台消耗分时段（人民币 + 美元 双显）———
  const usageBlock = `
    <div class="dash-section-title">💴 平台消耗清单（人民币优先）</div>
    <table class="monitor-table">
      <thead><tr><th>时段</th><th>调用次数</th><th>Tokens</th><th>消耗（CNY）</th><th>消耗（USD）</th></tr></thead>
      <tbody>
        <tr><td class="dash-key">今日</td><td>${d.tokens.today.calls}</td><td>${(d.tokens.today.tokens || 0).toLocaleString()}</td><td style="color:var(--accent);font-weight:700">${fmtCNY(d.tokens.today.cost_usd)}</td><td style="color:var(--text3)">${fmtUSD(d.tokens.today.cost_usd)}</td></tr>
        <tr><td class="dash-key">本周</td><td>${d.tokens.week.calls}</td><td>${(d.tokens.week.tokens || 0).toLocaleString()}</td><td style="color:var(--accent);font-weight:700">${fmtCNY(d.tokens.week.cost_usd)}</td><td style="color:var(--text3)">${fmtUSD(d.tokens.week.cost_usd)}</td></tr>
        <tr><td class="dash-key">本月</td><td>${d.tokens.month.calls}</td><td>${(d.tokens.month.tokens || 0).toLocaleString()}</td><td style="color:var(--accent);font-weight:700">${fmtCNY(d.tokens.month.cost_usd)}</td><td style="color:var(--text3)">${fmtUSD(d.tokens.month.cost_usd)}</td></tr>
        <tr><td class="dash-key">本季</td><td>${d.tokens.quarter.calls}</td><td>${(d.tokens.quarter.tokens || 0).toLocaleString()}</td><td style="color:var(--accent);font-weight:700">${fmtCNY(d.tokens.quarter.cost_usd)}</td><td style="color:var(--text3)">${fmtUSD(d.tokens.quarter.cost_usd)}</td></tr>
        <tr style="background:var(--bg2);font-weight:700"><td class="dash-key">累计</td><td>${d.tokens.total_calls}</td><td>${(d.tokens.total_tokens || 0).toLocaleString()}</td><td style="color:var(--accent)">${fmtCNY(d.tokens.total_cost_usd)}</td><td style="color:var(--text3)">${fmtUSD(d.tokens.total_cost_usd)}</td></tr>
      </tbody>
    </table>
  `;

  // ——— 内容分模块统计表 ———
  const contentRows = Object.entries(d.content)
    .filter(([k]) => k !== '_total')
    .map(([k, v]) => `
      <tr>
        <td class="dash-key">${esc(v.name)}</td>
        <td>${v.total}</td>
        <td>+${v.today}</td>
        <td>+${v.week}</td>
        <td>+${v.month}</td>
      </tr>
    `).join('');
  const contentTable = `
    <div class="dash-section-title">📂 内容模块统计</div>
    <table class="monitor-table">
      <thead><tr><th>模块</th><th>总数</th><th>今日</th><th>本周</th><th>本月</th></tr></thead>
      <tbody>${contentRows}</tbody>
    </table>
  `;

  // ——— 模型排行（日/月/季）———
  function rankCard(label, ranking) {
    const topRows = ranking.top.map(m => `
      <tr>
        <td class="dash-key">${esc(m.model || '-')}</td>
        <td style="color:var(--text3);font-size:10px;">${esc(m.provider || '-')}</td>
        <td>${m.calls}</td>
        <td>${dualCost(m.cost_usd)}</td>
      </tr>
    `).join('');
    const bottomRows = ranking.bottom.map(m => `
      <tr>
        <td class="dash-key">${esc(m.model || '-')}</td>
        <td style="color:var(--text3);font-size:10px;">${esc(m.provider || '-')}</td>
        <td>${m.calls}</td>
      </tr>
    `).join('');
    return `
      <div class="dash-rank-card">
        <div class="dash-rank-title">${label}</div>
        <div class="dash-rank-body">
          <div class="dash-rank-col">
            <div class="dash-rank-sub">🔥 调用最多 Top 5</div>
            ${ranking.top.length === 0 ? '<div class="monitor-empty">暂无数据</div>' : `
              <table class="monitor-table"><thead><tr><th>模型</th><th>供应商</th><th>调用</th><th>成本</th></tr></thead>
              <tbody>${topRows}</tbody></table>
            `}
          </div>
          <div class="dash-rank-col">
            <div class="dash-rank-sub">❄️ 调用最少 Bottom 5</div>
            ${ranking.bottom.length === 0 ? '<div class="monitor-empty">暂无数据</div>' : `
              <table class="monitor-table"><thead><tr><th>模型</th><th>供应商</th><th>调用</th></tr></thead>
              <tbody>${bottomRows}</tbody></table>
            `}
          </div>
        </div>
      </div>
    `;
  }

  const modelRankings = `
    <div class="dash-section-title">🏆 模型调用排行</div>
    ${rankCard('今日排行', d.model_ranking.today)}
    ${rankCard('本月排行', d.model_ranking.month)}
    ${rankCard('本季排行', d.model_ranking.quarter)}
  `;

  // ——— Top 10 用户 Token 消耗 ———
  const userRows = d.top_users.map((u, i) => `
    <tr>
      <td>#${i + 1}</td>
      <td class="dash-key">${esc(u.username)}</td>
      <td>${u.calls}</td>
      <td>${u.tokens.toLocaleString()}</td>
      <td>${dualCost(u.cost_usd)}</td>
    </tr>
  `).join('');
  const topUsersTable = `
    <div class="dash-section-title">👥 Top 10 用户 Token 消耗</div>
    ${d.top_users.length === 0 ? '<div class="monitor-empty">暂无调用数据</div>' : `
      <table class="monitor-table">
        <thead><tr><th>排名</th><th>用户</th><th>调用次数</th><th>Tokens</th><th>成本</th></tr></thead>
        <tbody>${userRows}</tbody>
      </table>
    `}
  `;

  // ——— 已接入 provider 列表 ———
  const providersList = d.models.provider_list.map(p => `
    <div class="dash-provider-chip ${p.enabled ? '' : 'disabled'}">
      <strong>${esc(p.name)}</strong>
      <span class="dash-provider-count">${p.model_count} 模型</span>
    </div>
  `).join('');
  const providersSection = `
    <div class="dash-section-title">🔌 已接入供应商 (${d.models.provider_list.length})</div>
    <div class="dash-providers">${providersList || '<div class="monitor-empty">尚未配置</div>'}</div>
  `;

  // ——— 最近注册用户 ———
  const recentSignupsRows = d.users.recent_signups.map(u => `
    <tr>
      <td class="dash-key">${esc(u.username)}</td>
      <td>${esc(u.role)}</td>
      <td style="color:var(--text3);font-size:11px;">${u.created_at ? new Date(u.created_at).toLocaleString('zh-CN') : '-'}</td>
    </tr>
  `).join('');
  const recentSignups = `
    <div class="dash-section-title">🆕 最近注册用户</div>
    ${d.users.recent_signups.length === 0 ? '<div class="monitor-empty">无</div>' : `
      <table class="monitor-table">
        <thead><tr><th>用户名</th><th>角色</th><th>注册时间</th></tr></thead>
        <tbody>${recentSignupsRows}</tbody>
      </table>
    `}
  `;

  body.innerHTML = overviewCards + usageBlock + categoryBlock + contentTable + modelRankings + topUsersTable + providersSection + recentSignups;
}

// ══════════════════════ NEW AGENT (v9) ══════════════════════
function aiteamOpenNewAgent() {
  showModal({
    title: '🤖 新增 AI 团队成员',
    subtitle: '创建后会自动学习对应岗位的高阶能力，生成 5 条 KB 并写入工作流',
    maxWidth: '680px',
    body: `
      <div class="form-row">
        <div class="form-group" style="flex:1;">
          <label>Agent ID (英文，小写+下划线)</label>
          <input id="new-agent-id" placeholder="如: seo_specialist / game_designer"/>
          <small style="font-size:10px;color:var(--text3);">只能用小写字母、数字、下划线，以字母开头</small>
        </div>
        <div class="form-group" style="flex:0.3;">
          <label>Emoji</label>
          <input id="new-agent-emoji" value="🤖" maxlength="4"/>
        </div>
      </div>
      <div class="form-group"><label>中文名称</label><input id="new-agent-name" placeholder="如: SEO 优化师"/></div>
      <div class="form-row">
        <div class="form-group">
          <label>团队</label>
          <select id="new-agent-team">
            <option value="ops" selected>📣 市场运营团队</option>
            <option value="rd">🔬 研发团队</option>
          </select>
        </div>
        <div class="form-group">
          <label>层级</label>
          <select id="new-agent-layer">
            <option value="marketing">营销 marketing</option>
            <option value="strategy">战略 strategy</option>
            <option value="orchestration">协调 orchestration</option>
            <option value="creative">创作 creative</option>
            <option value="production">制作 production</option>
            <option value="engineering">工程 engineering</option>
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>核心技能 (逗号分隔)</label>
        <input id="new-agent-skills" placeholder="如: SEO / 关键词研究 / 站内优化 / 外链建设"/>
      </div>
      <div class="form-group">
        <label>职责描述</label>
        <textarea id="new-agent-desc" rows="2" placeholder="一句话描述这个 agent 负责什么"></textarea>
      </div>
      <div class="form-group">
        <label>岗位背景 (用于自动学习 - 越具体越好)</label>
        <textarea id="new-agent-context" rows="4" placeholder="如: 负责 AI 视频平台的 SEO 工作，需要精通 Google/百度 搜索引擎算法、长尾关键词挖掘、技术 SEO (schema/sitemap)、内容 SEO、以及社交搜索 (TikTok SEO / 小红书 SEO) 等"></textarea>
      </div>
      <div style="background:var(--bg);border:1px dashed var(--border2);padding:10px 14px;border-radius:6px;font-size:11px;color:var(--text3);margin-bottom:8px;">
        💡 <strong>创建后自动执行</strong>：<br>
        1. 写入自定义 agent 存储<br>
        2. 合并进 listAgentTypes（供所有路由/弹窗使用）<br>
        3. 自动调用 LLM 为该岗位生成 5 条高阶能力 KB（~30-60s）<br>
        4. KB 条目的 applies_to 自动设置为新 agent id<br>
        5. 立即进入 orchestrator 的可调用列表
      </div>
    `,
    footer: `
      <button class="btn-sm" onclick="closeModal()">取消</button>
      <button class="btn-primary" onclick="aiteamSubmitNewAgent()">创建 + 自动学习</button>
    `,
  });
}

// ══════════════════════ RUN WORKFLOW (v12) ══════════════════════
function aiteamOpenRunWorkflow(presetWorkflow = 'auto') {
  showModal({
    title: '▶ 执行任务 / 工作流',
    subtitle: '任务会经过完整的多阶段 pipeline，每个阶段由相关 agent 协作完成',
    maxWidth: '720px',
    body: `
      <div class="form-group">
        <label>任务描述</label>
        <textarea id="wf-task" rows="4" placeholder="例如:
- 研发任务: 优化 dashboard 的加载速度
- 漫剧: 生成一部关于重生复仇的甜宠短剧
- 数字人: 做一个美妆赛道的虚拟主播
- 爆款复刻: 复刻抖音情感账号的爆款公式"></textarea>
      </div>
      <div class="form-group">
        <label>选择工作流</label>
        <select id="wf-name">
          <option value="auto">🤖 自动识别（按关键词匹配）</option>
          <optgroup label="—— 业务工作流 ——">
            <option value="video">🎬 AI 视频生成</option>
            <option value="drama">📺 漫剧 / 短剧</option>
            <option value="comic">📖 漫画生成</option>
            <option value="novel">📚 小说创作</option>
            <option value="digital_human">👤 数字人</option>
            <option value="viral_replicate">🔥 爆款复刻</option>
            <option value="voice_clone">🎙️ 声音克隆</option>
            <option value="image_gen">🖼️ 图片生成</option>
            <option value="character_bg">🌅 角色与背景</option>
          </optgroup>
          <optgroup label="—— 研发工作流 ——">
            <option value="rd_task">🛠️ 研发任务（PM→UI→Dev→Test→Deploy）</option>
          </optgroup>
        </select>
      </div>
      <div style="background:var(--bg);border:1px dashed var(--border2);padding:10px 14px;border-radius:6px;font-size:11px;color:var(--text3);margin-bottom:8px;">
        ⏱️ <strong>预期耗时</strong>: 30-180 秒（阶段越多/agent 越多越久）<br>
        💡 选错也没关系，"自动识别"会按关键词决定走哪条流水线
      </div>
    `,
    footer: `
      <button class="btn-sm" onclick="closeModal()">取消</button>
      <button class="btn-primary" onclick="aiteamRunWorkflow()">▶ 开始执行</button>
    `,
  });
  // 预选
  setTimeout(() => {
    const sel = document.getElementById('wf-name');
    if (sel && presetWorkflow) sel.value = presetWorkflow;
  }, 50);
}

async function aiteamRunWorkflow() {
  const task = document.getElementById('wf-task').value.trim();
  const wfName = document.getElementById('wf-name').value;
  if (!task) return alert('请输入任务描述');
  // 推断 task_type
  const type = wfName === 'rd_task' ? 'rd' : (wfName === 'auto' ? 'auto' : 'business');

  closeModal();

  // 显示执行中弹窗
  showModal({
    title: '⏳ 工作流执行中...',
    subtitle: `任务: ${task.slice(0, 80)}${task.length > 80 ? '...' : ''}`,
    maxWidth: '900px',
    body: `
      <div id="wf-progress" style="padding:20px;text-align:center;">
        <div class="wf-spinner"></div>
        <div style="font-size:13px;color:var(--text2);margin-top:16px;">
          正在调用 AI 团队执行完整工作流<br>
          <span style="color:var(--text3);font-size:11px;">请耐心等待 (通常 30-90 秒)</span>
        </div>
        <div id="wf-elapsed" style="font-size:11px;color:var(--text3);margin-top:10px;">0s</div>
      </div>
    `,
    footer: `<button class="btn-sm" onclick="closeModal()" id="wf-close-btn" disabled style="opacity:0.5;">执行中...</button>`,
  });

  // 计时器
  const startTime = Date.now();
  const timer = setInterval(() => {
    const el = document.getElementById('wf-elapsed');
    if (el) el.textContent = Math.floor((Date.now() - startTime) / 1000) + 's';
  }, 1000);

  try {
    const r = await authFetch('/api/ai-team/run-workflow', {
      method: 'POST',
      body: JSON.stringify({ task, task_type: type, workflow_name: wfName }),
    });
    const j = await r.json();
    clearInterval(timer);
    if (!j.success) throw new Error(j.error);

    // 渲染完整执行结果
    aiteamRenderWorkflowResult(j.data);
  } catch (e) {
    clearInterval(timer);
    const el = document.getElementById('wf-progress');
    if (el) {
      el.innerHTML = `<div style="color:#ff6b6b;padding:20px;">❌ 执行失败<br><span style="font-size:11px;color:var(--text3);">${esc(e.message)}</span></div>`;
    }
    const btn = document.getElementById('wf-close-btn');
    if (btn) {
      btn.textContent = '关闭';
      btn.disabled = false;
      btn.style.opacity = '1';
    }
  }
}

function aiteamRenderWorkflowResult(data) {
  const typeLabel = data.workflow_label || (data.task_type === 'rd' ? '🛠️ 研发任务' : '📣 业务工作流');
  const totalSec = (data.total_duration_ms / 1000).toFixed(1);

  const phasesHtml = data.phases.map((phase, idx) => `
    <div class="wf-phase ${phase.status}">
      <div class="wf-phase-head">
        <span class="wf-phase-num">#${idx + 1}</span>
        <span class="wf-phase-emoji">${phase.emoji}</span>
        <span class="wf-phase-name">${esc(phase.name)}</span>
        <span class="wf-phase-meta">${phase.participants.length} 参与 · ${(phase.duration_ms/1000).toFixed(1)}s</span>
        <span class="wf-phase-status">${phase.status === 'done' ? '✅' : '⚠️'}</span>
      </div>
      <div class="wf-phase-body">
        ${phase.participants.map(p => `
          <div class="wf-agent ${p.error ? 'error' : ''}">
            <div class="wf-agent-head">
              <span class="wf-agent-emoji">${p.emoji}</span>
              <span class="wf-agent-name">${esc(p.agent_name)}</span>
              <span class="wf-agent-action">— ${esc(p.action)}</span>
            </div>
            ${p.error ? `<div class="wf-agent-error">❌ ${esc(p.error)}</div>` : `
              <div class="wf-agent-field">
                <div class="wf-field-label">📝 做了什么</div>
                <div class="wf-field-value">${esc(p.summary || '-')}</div>
              </div>
              <div class="wf-agent-field">
                <div class="wf-field-label">📦 产出</div>
                <div class="wf-field-value wf-deliverable">${esc(p.deliverable || '-')}</div>
              </div>
              <div class="wf-agent-field">
                <div class="wf-field-label">💭 决策理由</div>
                <div class="wf-field-value wf-reasoning">${esc(p.reasoning || '-')}</div>
              </div>
              ${p.next_action ? `<div class="wf-agent-field">
                <div class="wf-field-label">➡️ 下一步</div>
                <div class="wf-field-value">${esc(p.next_action)}</div>
              </div>` : ''}
            `}
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');

  const body = `
    <div class="wf-result-header">
      <div class="wf-result-stat">
        <div class="wf-stat-label">任务类型</div>
        <div class="wf-stat-value">${typeLabel}</div>
      </div>
      <div class="wf-result-stat">
        <div class="wf-stat-label">总耗时</div>
        <div class="wf-stat-value">${totalSec}s</div>
      </div>
      <div class="wf-result-stat">
        <div class="wf-stat-label">阶段数</div>
        <div class="wf-stat-value">${data.phases.length}</div>
      </div>
      <div class="wf-result-stat">
        <div class="wf-stat-label">参与 agent</div>
        <div class="wf-stat-value">${data.total_agents_involved}</div>
      </div>
    </div>

    <div class="wf-task-box">
      <div class="wf-task-label">原始任务</div>
      <div class="wf-task-text">${esc(data.task)}</div>
    </div>

    <div class="wf-phases">${phasesHtml}</div>

    <div style="margin-top:16px;padding:10px;background:var(--bg);border-left:3px solid var(--accent);border-radius:4px;font-size:11px;color:var(--text3);">
      📋 <strong>项目助理已自动记录</strong>到 <code>docs/logs/changes/${new Date().toISOString().slice(0,10)}.md</code>
      <br>workflow_id: <code>${data.workflow_id}</code>
    </div>
  `;

  // 关闭当前弹窗，开新的结果弹窗
  closeModal();
  showModal({
    title: `✅ 工作流执行完成`,
    subtitle: `${typeLabel} · 完成于 ${totalSec}s`,
    maxWidth: '960px',
    body,
    footer: `<button class="btn-sm" onclick="closeModal()">关闭</button>`,
  });
}

// ═══════════════════════════════════════════════════
// 【v13】工作流图谱 - ComfyUI / Coze 风格可视化
// ═══════════════════════════════════════════════════
async function aiteamOpenWorkflowAtlas() {
  // 兜底：关闭任何残留的 modal，避免 querySelector('.modal-body') 命中旧 modal
  while (_modalStack && _modalStack.length) closeModal();

  const myModal = showModal({
    title: '🗺️ AI 工作流图谱',
    subtitle: '加载所有工作流定义中...',
    maxWidth: '1200px',
    body: `<div style="padding:60px;text-align:center;color:var(--text3);"><div class="wf-spinner"></div><div style="margin-top:14px;">加载中...</div><div id="wfa-debug" style="font-size:10px;margin-top:8px;color:var(--text3);"></div></div>`,
    footer: `<button class="btn-sm" onclick="closeModal()">关闭</button>`,
  });

  const dbg = (msg) => { const el = myModal.querySelector('#wfa-debug'); if (el) el.textContent = msg; };

  // 准备 agent meta 缓存（从 aiteamState.teams 扁平化）
  try {
    if (typeof aiteamState !== 'undefined' && aiteamState && Array.isArray(aiteamState.teams)) {
      window.__aiteamRoster = aiteamState.teams.flatMap(t => t.agents || []);
    }
  } catch (e) { console.warn('[atlas] roster prep failed:', e); }

  try {
    dbg('请求 /api/ai-team/workflows ...');
    const r = await authFetch('/api/ai-team/workflows');
    dbg('HTTP ' + r.status + ' 解析中 ...');
    const text = await r.text();
    let j;
    try { j = JSON.parse(text); }
    catch (pe) { throw new Error('返回非 JSON: ' + text.slice(0, 120)); }
    if (!j.success) throw new Error(j.error || '后端 success=false');
    if (!Array.isArray(j.data)) throw new Error('data 不是数组');
    dbg('收到 ' + j.data.length + ' 条工作流，渲染中 ...');
    try {
      aiteamRenderWorkflowAtlas(j.data, myModal);
    } catch (re) {
      console.error('[atlas] render failed:', re);
      throw new Error('渲染失败: ' + re.message);
    }
  } catch (e) {
    console.error('[atlas] failed:', e);
    const wrap = myModal.querySelector('.modal-body');
    if (wrap) wrap.innerHTML = `<div style="padding:40px;text-align:center;color:#ff6b6b;">❌ 加载失败<br><span style="font-size:11px;color:var(--text3);">${esc(e.message)}</span><br><button class="btn-sm" style="margin-top:14px;" onclick="closeModal();aiteamOpenWorkflowAtlas()">重试</button></div>`;
  }
}

function aiteamRenderWorkflowAtlas(workflows, ownerModal) {
  console.log('[atlas] render start, workflows:', workflows?.length);
  if (!Array.isArray(workflows)) workflows = [];
  // 顶部 tab 切换 (业务 vs 研发)
  const businessWfs = workflows.filter(w => w && w.type === 'business');
  const rdWfs = workflows.filter(w => w && w.type === 'rd');
  console.log('[atlas] business:', businessWfs.length, 'rd:', rdWfs.length);

  const renderWorkflow = (wf) => {
    const phases = Array.isArray(wf.phases) ? wf.phases : [];
    const totalAgents = new Set(phases.flatMap(p => (p.agents || []).map(a => a.id))).size;
    const phasesHtml = phases.map((phase, idx) => `
      <div class="wfa-phase">
        <div class="wfa-phase-head">
          <span class="wfa-phase-num">${idx + 1}</span>
          <span class="wfa-phase-emoji">${phase.emoji || '📍'}</span>
          <div class="wfa-phase-name">${esc(phase.name || '')}</div>
        </div>
        <div class="wfa-phase-agents">
          ${(phase.agents || []).map(a => {
            const meta = (window.__aiteamRoster || []).find(x => x.id === a.id) || { emoji: '🤖', name: a.id };
            return `<div class="wfa-agent" title="${esc(a.action || '')}">
              <span class="wfa-agent-emoji">${meta.emoji || '🤖'}</span>
              <span class="wfa-agent-name">${esc(meta.name || a.id)}</span>
              <span class="wfa-agent-action">${esc(a.action || '')}</span>
            </div>`;
          }).join('')}
        </div>
        ${idx < phases.length - 1 ? '<div class="wfa-arrow">→</div>' : ''}
      </div>
    `).join('');

    return `
      <div class="wfa-workflow" data-type="${wf.type}">
        <div class="wfa-wf-head">
          <div class="wfa-wf-title">
            <span class="wfa-wf-emoji">${wf.emoji}</span>
            <span class="wfa-wf-name">${esc(wf.name)}</span>
            <span class="wfa-wf-meta">${wf.phases.length} 阶段 · ${totalAgents} agents</span>
          </div>
          <div class="wfa-wf-desc">${esc(wf.desc || '')}</div>
          <button class="btn-sm wfa-run-btn" onclick="aiteamCloseAndRun('${wf.key}')">▶ 跑这条流水线</button>
        </div>
        <div class="wfa-pipeline">
          ${phasesHtml}
        </div>
      </div>
    `;
  };

  const body = `
    <div class="wfa-tabs">
      <button class="wfa-tab active" data-tab="business" onclick="wfaSwitchTab(this,'business')">📣 业务工作流 <span class="wfa-tab-count">${businessWfs.length}</span></button>
      <button class="wfa-tab" data-tab="rd" onclick="wfaSwitchTab(this,'rd')">🛠️ 研发工作流 <span class="wfa-tab-count">${rdWfs.length}</span></button>
    </div>
    <div class="wfa-info">
      💡 每个节点是一个工作流阶段，方框内是该阶段并行执行的 agent。点击"跑这条流水线"立即执行。横向滚动查看完整流程。
    </div>
    <div class="wfa-list" id="wfa-list-business">
      ${businessWfs.map(renderWorkflow).join('')}
    </div>
    <div class="wfa-list" id="wfa-list-rd" style="display:none;">
      ${rdWfs.map(renderWorkflow).join('')}
    </div>
  `;

  // 用调用方传入的 ownerModal 直接定位 body，杜绝 querySelector 命中错误的 modal
  console.log('[atlas] body length:', body.length, 'ownerModal?', !!ownerModal);
  const modalBody = ownerModal
    ? ownerModal.querySelector('.modal-body')
    : document.querySelector('.modal-body');
  if (modalBody) {
    modalBody.innerHTML = body;
    console.log('[atlas] innerHTML set OK');
  } else {
    console.error('[atlas] no .modal-body element found!');
    throw new Error('未找到 modal-body 容器');
  }
}

function wfaSwitchTab(btn, tab) {
  document.querySelectorAll('.wfa-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('wfa-list-business').style.display = tab === 'business' ? 'block' : 'none';
  document.getElementById('wfa-list-rd').style.display = tab === 'rd' ? 'block' : 'none';
}

function aiteamCloseAndRun(workflowKey) {
  closeModal();
  setTimeout(() => aiteamOpenRunWorkflow(workflowKey), 100);
}

async function aiteamSubmitNewAgent() {
  const id = document.getElementById('new-agent-id').value.trim();
  const name = document.getElementById('new-agent-name').value.trim();
  const emoji = document.getElementById('new-agent-emoji').value.trim() || '🤖';
  const team = document.getElementById('new-agent-team').value;
  const layer = document.getElementById('new-agent-layer').value;
  const skills = document.getElementById('new-agent-skills').value.trim();
  const desc = document.getElementById('new-agent-desc').value.trim();
  const role_context = document.getElementById('new-agent-context').value.trim();

  if (!id || !name) {
    alert('ID 和名称必填');
    return;
  }

  closeModal();
  // 显示进度弹窗
  showModal({
    title: '⏳ 正在创建 agent + 自动学习',
    maxWidth: '560px',
    body: `
      <div id="new-agent-progress">
        <div style="padding:20px;text-align:center;">
          <div style="font-size:32px;margin-bottom:10px;">${emoji}</div>
          <div style="font-size:14px;font-weight:600;margin-bottom:6px;">${esc(name)}</div>
          <div style="font-size:11px;color:var(--text3);margin-bottom:16px;"><code>${esc(id)}</code> · ${team === 'rd' ? '研发' : '运营'}</div>
          <div id="new-agent-step1" class="new-agent-step">⏳ Step 1: 创建 agent 记录...</div>
          <div id="new-agent-step2" class="new-agent-step pending">⏳ Step 2: 调用 LLM 学习岗位能力...</div>
          <div id="new-agent-step3" class="new-agent-step pending">⏳ Step 3: 生成 KB 条目并入库...</div>
          <div id="new-agent-step4" class="new-agent-step pending">⏳ Step 4: 注入到工作流...</div>
        </div>
      </div>
    `,
    footer: `<button class="btn-sm" id="new-agent-close-btn" onclick="closeModal()" disabled style="opacity:0.5;">处理中...</button>`,
  });

  const setStep = (n, txt, done) => {
    const el = document.getElementById('new-agent-step' + n);
    if (el) {
      el.textContent = (done ? '✅' : '⏳') + ' ' + txt;
      el.className = 'new-agent-step' + (done ? ' done' : '');
    }
  };

  try {
    // Step 1: 创建 agent
    const r1 = await authFetch('/api/admin/agents/custom', {
      method: 'POST',
      body: JSON.stringify({
        id, name, emoji, team, layer, desc, role_context,
        skills: skills.split(',').map(s => s.trim()).filter(Boolean),
      }),
    });
    const j1 = await r1.json();
    if (!j1.success) throw new Error(j1.error);
    setStep(1, 'Agent 已创建', true);

    // Step 2 + 3: 自动学习 (LLM 生成 KB)
    setStep(2, '正在调用 LLM 生成高阶能力...', false);
    const r2 = await authFetch(`/api/admin/agents/${id}/learn`, { method: 'POST' });
    const j2 = await r2.json();
    if (!j2.success) throw new Error('学习失败: ' + j2.error);
    setStep(2, `LLM 返回（${(j2.data.duration_ms/1000).toFixed(1)}s）`, true);
    setStep(3, `已生成 ${j2.data.inserted_count} 条 KB（合集: ${j2.data.collection}）`, true);

    // Step 4: 注入工作流（其实 orchestrator 自动读 listAgentTypes，无需显式操作）
    setStep(4, '已加入 orchestrator 路由列表', true);

    // 显示生成的 KB 列表
    const progressEl = document.getElementById('new-agent-progress');
    progressEl.innerHTML += `
      <div style="margin-top:14px;padding:12px;background:var(--bg);border-radius:6px;border:1px solid var(--border2);">
        <div style="font-size:11px;color:var(--text3);margin-bottom:8px;">✨ 自动学习生成的 KB 条目：</div>
        ${j2.data.inserted.map(d => `<div style="font-size:12px;color:var(--text);padding:4px 0;">📄 ${esc(d.title)}</div>`).join('')}
      </div>
    `;

    // 开启关闭按钮
    const btn = document.getElementById('new-agent-close-btn');
    if (btn) {
      btn.textContent = '完成';
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.className = 'btn-primary';
    }

    // 刷新 AI 团队 roster
    aiteamState.loaded = false;
    await aiteamInit();
  } catch (e) {
    const progressEl = document.getElementById('new-agent-progress');
    if (progressEl) {
      progressEl.innerHTML += `<div style="color:#ff6b6b;padding:10px;margin-top:10px;">❌ 失败: ${esc(e.message)}</div>`;
    }
    const btn = document.getElementById('new-agent-close-btn');
    if (btn) {
      btn.textContent = '关闭';
      btn.disabled = false;
      btn.style.opacity = '1';
    }
  }
}

// ════════════════════════════════════════════════════════════════════
// 通用模态框（VidoModal）
// ════════════════════════════════════════════════════════════════════
const VidoModal = {
  open({ title = '', body = '', large = false, onConfirm = null, confirmText = '确定', cancelText = '取消', hideFoot = false } = {}) {
    const old = document.getElementById('__vido_modal_mask');
    if (old) old.remove();
    const mask = document.createElement('div');
    mask.id = '__vido_modal_mask';
    mask.className = 'vido-modal-mask';
    mask.innerHTML = `
      <div class="vido-modal ${large ? 'lg' : ''}" onclick="event.stopPropagation()">
        <div class="vido-modal-head">
          <div class="vido-modal-title">${title}</div>
          <button class="vido-modal-close" onclick="VidoModal.close()">×</button>
        </div>
        <div class="vido-modal-body">${body}</div>
        ${hideFoot ? '' : `<div class="vido-modal-foot">
          <button class="btn-sm" onclick="VidoModal.close()">${cancelText}</button>
          ${onConfirm ? `<button class="btn-primary btn-sm" id="__vmConfirm">${confirmText}</button>` : ''}
        </div>`}
      </div>
    `;
    mask.addEventListener('click', e => { if (e.target === mask) VidoModal.close(); });
    document.body.appendChild(mask);
    if (onConfirm) {
      document.getElementById('__vmConfirm').onclick = async () => {
        const ok = await onConfirm();
        if (ok !== false) VidoModal.close();
      };
    }
    return mask.querySelector('.vido-modal-body');
  },
  close() {
    const m = document.getElementById('__vido_modal_mask');
    if (m) m.remove();
  },
};

// ════════════════════════════════════════════════════════════════════
// 数据源管理（爆款复刻 search providers）
// ════════════════════════════════════════════════════════════════════
async function loadDatasources() {
  try {
    const r = await authFetch('/api/admin/datasources');
    const j = await r.json();
    const list = document.getElementById('datasource-list');
    if (!list) return;
    list.innerHTML = (j.providers || []).map(p => {
      const enabled = !!p.config?.enabled;
      const config = p.config || {};
      const fields = Object.entries(p.config_schema || {}).map(([k, schema]) => {
        const v = config[k] !== undefined ? config[k] : (schema.default || '');
        const id = `ds_${p.id}_${k}`;
        if (schema.type === 'select') {
          return `<div style="margin-top:8px"><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px">${esc(schema.label || k)}</label>
            <select id="${id}" style="width:100%;padding:8px 10px;background:var(--bg2);border:1px solid var(--border);color:var(--text);border-radius:6px;font-size:12px">
              ${(schema.options || []).map(o => `<option value="${o}" ${o===v?'selected':''}>${o}</option>`).join('')}
            </select></div>`;
        }
        const inputType = schema.type === 'password' ? 'password' : (schema.type === 'number' ? 'number' : 'text');
        return `<div style="margin-top:8px"><label style="font-size:11px;color:var(--text3);display:block;margin-bottom:4px">${esc(schema.label || k)}</label>
          <input type="${inputType}" id="${id}" value="${esc(String(v||''))}" placeholder="${esc(schema.label||'')}" style="width:100%;padding:8px 10px;background:var(--bg2);border:1px solid var(--border);color:var(--text);border-radius:6px;font-size:12px;font-family:monospace" /></div>`;
      }).join('');
      return `
        <div id="ds_card_${p.id}" style="background:var(--bg2);border:1px solid ${enabled ? 'rgba(33,255,243,0.4)' : 'var(--border)'};border-radius:12px;padding:18px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <div style="flex:1">
              <div style="font-size:14px;font-weight:700;margin-bottom:4px;display:flex;align-items:center;gap:8px">
                <span>${esc(p.name)}</span>
                ${p.requires_key ? '<span style="font-size:10px;color:#FF8B3D;background:rgba(255,139,61,0.15);padding:2px 7px;border-radius:3px">需 Key</span>' : '<span style="font-size:10px;color:#10b981;background:rgba(16,185,129,0.15);padding:2px 7px;border-radius:3px">免 Key</span>'}
                <span style="font-size:11px;color:${enabled?'#10b981':'var(--text3)'};font-weight:500">${enabled?'● 已启用':'○ 已禁用'}</span>
              </div>
              <div style="font-size:11px;color:var(--text3)">${esc(p.description || '')}</div>
              <div style="font-size:10px;color:var(--text3);margin-top:4px">id: <code>${p.id}</code> · platform: <code>${p.platform}</code></div>
            </div>
            <label class="vido-toggle">
              <input type="checkbox" id="ds_${p.id}_enabled" ${enabled?'checked':''} onchange="saveDatasource('${p.id}', true)" />
              <span class="vido-toggle-slider"></span>
            </label>
          </div>
          ${fields}
          <div style="display:flex;gap:6px;margin-top:14px;align-items:center">
            <button class="btn-primary btn-sm" onclick="saveDatasource('${p.id}')">💾 保存配置</button>
            <button class="btn-sm" onclick="testDatasource('${p.id}')">🩺 测试连通</button>
            <span style="flex:1"></span>
            <button class="btn-sm danger" onclick="resetDatasource('${p.id}')" title="清空所有配置 + 禁用">🗑 重置</button>
          </div>
          <div id="ds_${p.id}_status" style="font-size:11px;margin-top:8px;color:var(--text3)"></div>
        </div>
      `;
    }).join('');
  } catch (e) { toast('加载失败：' + e.message); }
}

async function resetDatasource(id) {
  if (!confirm(`重置数据源 ${id}？\n\n会清空所有 API Key/Cookie 等配置并禁用该 provider`)) return;
  try {
    const r = await authFetch(`/api/admin/datasources/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ enabled: false, api_key: '', cookie: '', region: '', timeout: undefined })
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    toast('已重置');
    loadDatasources();
  } catch (e) { toast('重置失败：' + e.message); }
}

async function saveDatasource(id, silent) {
  const enabled = document.getElementById('ds_' + id + '_enabled')?.checked;
  const config = { enabled };
  document.querySelectorAll(`[id^="ds_${id}_"]`).forEach(el => {
    if (el.id === 'ds_' + id + '_enabled') return;
    const field = el.id.replace('ds_' + id + '_', '');
    config[field] = el.tagName === 'INPUT' && el.type === 'number' ? +el.value : el.value;
  });
  try {
    const r = await authFetch(`/api/admin/datasources/${id}`, { method: 'PUT', body: JSON.stringify(config) });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    const stat = document.getElementById('ds_' + id + '_status');
    if (stat) stat.innerHTML = `<span style="color:#10b981">✓ 已保存 ${new Date().toLocaleTimeString('zh-CN')}</span>`;
    if (!silent) toast('已保存');
    // 切换 toggle 时同步刷新顶部状态显示
    if (silent) {
      const card = document.getElementById('ds_card_' + id);
      if (card) card.style.borderColor = enabled ? 'rgba(33,255,243,0.4)' : 'var(--border)';
      const statusText = card?.querySelector('div[style*="color:"]');
      // simpler: 直接 reload 整个面板
      setTimeout(loadDatasources, 200);
    }
  } catch (e) {
    const stat = document.getElementById('ds_' + id + '_status');
    if (stat) stat.innerHTML = `<span style="color:#FF5470">✗ ${e.message}</span>`;
  }
}

async function testDatasource(id) {
  const status = document.getElementById('ds_' + id + '_status');
  if (status) status.innerHTML = '⏳ 测试中...';
  try {
    const r = await authFetch(`/api/admin/datasources/${id}/health`, { method: 'POST' });
    const j = await r.json();
    const h = j.health;
    status.innerHTML = `<span style="color:${h.ok?'#10b981':'#FF5470'}">${h.ok?'✓ 连通':'✗ 失败'} · ${esc(h.message || '')}</span>`;
  } catch (e) {
    status.innerHTML = `<span style="color:#FF5470">✗ ${e.message}</span>`;
  }
}

// ════════════════════════════════════════════════════════════════════
// 模型调用管理（Pipeline 模型路由）
// ════════════════════════════════════════════════════════════════════
let _pmsCache = null;

// 模型 ID → 中文展示名（兜底字典；优先使用 settings.providers.models[].name）
const _MODEL_I18N = {
  'jimeng_realman_avatar_picture_omni_v15': '即梦 Omni v1.5（照片+音频驱动）',
  'jimeng_realman_avatar_object_detection': '即梦主体检测',
  'jimeng_t2i_v30': '即梦图片 3.0（文生图）',
  'jimeng_i2i_v30': '即梦图片 3.0（参考图）',
  'jimeng_t2i_v40_pro': '即梦图片 4.0 Pro',
  'jimeng_t2v_v30': '即梦视频 3.0（文生视频）',
  'jimeng_i2v_first_v30': '即梦视频 3.0（图生视频）',
  'doubao-seedream-5-0-260128': '豆包 Seedream 5.0 文生图',
  'doubao-seedream-4-0-250828': '豆包 Seedream 4.0',
  'doubao-seedance-2-0-260128': '豆包 Seedance 2.0 文生视频',
  'doubao-seedance-1-0-pro-250528': '豆包 Seedance 1.0 Pro',
  'doubao-seedance-1-0-lite-i2v-250428': '豆包 Seedance 1.0 Lite 图生视频',
  'doubao-seedance-1-0-lite-t2v-250428': '豆包 Seedance 1.0 Lite 文生视频',
  'doubao-1-5-vision-pro': '豆包视觉 1.5 Pro',
  'wan2.2-animate-move': '通义万相动作迁移 2.2',
  'wan2.1-i2v': '通义万相 2.1 图生视频',
  'cosyvoice-v3.5-plus': '阿里 CosyVoice 3.5 Plus',
  'cosyvoice-v3-flash': '阿里 CosyVoice 3 Flash',
  'gpt-4o': 'GPT-4o',
  'gpt-4o-mini': 'GPT-4o Mini',
  'sora-2': 'Sora 2（OpenAI 旗舰）',
  'kling-v1-5-pro': 'Kling 1.5 Pro 高质量视频',
  'kling-v1-5': 'Kling 1.5',
  'kling-v2': 'Kling 2.0',
  'deepseek-chat': 'DeepSeek Chat V3',
  'deepseek-reasoner': 'DeepSeek R1（推理模型）',
  'glm-4-plus': '智谱 GLM-4 Plus',
  'glm-4-flash': '智谱 GLM-4 Flash',
  'cogview-3-flash': '智谱 CogView-3 Flash',
  'cogvideox-flash': '智谱 CogVideoX Flash',
  'nano-banana': 'Nano Banana 文生图',
};
const _PROVIDER_I18N = {
  'volcengine': '火山引擎',
  'jimeng': '即梦 AI',
  'dashscope': '阿里百炼',
  'aliyun-tts': '阿里 TTS',
  'aliyun-nls': '阿里 NLS',
  'deepseek': 'DeepSeek',
  'openai': 'OpenAI',
  'anthropic': 'Anthropic Claude',
  'zhipu': '智谱 AI',
  'kling': '可灵 AI',
  'pika': 'Pika',
  'minimax': 'MiniMax',
  'elevenlabs': 'ElevenLabs',
  'fishaudio': 'Fish Audio',
  'huggingface': 'HuggingFace',
  'replicate': 'Replicate',
  'stability': 'Stability AI',
  'runway': 'Runway',
  'luma': 'Luma',
  'vidu': 'Vidu',
  'seedance': 'Seedance',
  'veo': 'Google Veo',
  'baidu': '百度',
  'xunfei': '科大讯飞',
  'qwen': '通义千问',
  'fal': 'FAL',
  'hifly': '飞影',
  'hedra': 'Hedra',
  'deyunai': '得云 AI',
};
function _i18nModelName(id) { return _MODEL_I18N[id] || ''; }
function _i18nProviderName(id) { return _PROVIDER_I18N[id] || ''; }

async function loadModelPipeline() {
  try {
    const r = await authFetch('/api/admin/pipeline-models');
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    _pmsCache = j;
    renderModelPipeline();
  } catch (e) { toast('加载失败：' + e.message); }
}

function renderModelPipeline() {
  const body = document.getElementById('model-pipeline-body');
  if (!body || !_pmsCache) return;
  const { schema, config, available } = _pmsCache;

  const groupHtml = Object.entries(schema).map(([groupName, stages]) => {
    const stageNodes = stages.map((stage, sIdx) => {
      const models = config[stage.id] || [];
      const enabledModels = models.filter(m => m.enabled);
      const firstModel = enabledModels[0];
      const isConfigured = models.length > 0;
      return `
        <div class="pms-flow-stage ${isConfigured ? 'configured' : ''}" onclick="openStageEditModal('${stage.id}', '${stage.type}')">
          <div class="pms-stage-num">#${sIdx + 1}</div>
          <div class="pms-stage-title">${esc(stage.name)}</div>
          <div class="pms-stage-type">${stage.type}</div>
          <div class="pms-stage-models">
            ${firstModel
              ? (() => {
                  const meta = (available[stage.type] || []).find(a => a.provider_id === firstModel.provider_id && a.model_id === firstModel.model_id);
                  const dispName = meta?.model_name || _i18nModelName(firstModel.model_id) || firstModel.model_id;
                  const provName = meta?.provider_name || _i18nProviderName(firstModel.provider_id) || firstModel.provider_id;
                  const stale = !meta;
                  const trim = (s) => s.length > 22 ? s.slice(0, 20) + '…' : s;
                  return `<div class="first" ${stale ? 'style="opacity:.5"' : ''}>${esc(trim(dispName))}</div>
                          <div style="font-size:10px;color:var(--text3);margin-top:2px">${esc(provName)}${stale ? ' · 已禁用' : ''}</div>
                          ${enabledModels.length > 1 ? `<div style="font-size:10px;color:var(--text3);margin-top:2px">+${enabledModels.length - 1} 备选</div>` : ''}`;
                })()
              : `<div class="empty">未配置</div>`
            }
          </div>
          <div class="pms-stage-foot">
            <span>${models.length} 个模型 · ${enabledModels.length} 启用</span>
            <span class="pms-stage-edit">编辑 →</span>
          </div>
        </div>
      `;
    });
    // 在 stage 之间插入箭头
    const flowItems = [];
    stageNodes.forEach((node, i) => {
      flowItems.push(node);
      if (i < stageNodes.length - 1) flowItems.push(`<div class="pms-flow-arrow">→</div>`);
    });
    return `
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:18px;margin-bottom:14px">
        <div style="font-size:14px;font-weight:700;margin-bottom:14px;color:var(--accent);display:flex;align-items:center;gap:8px">
          <span>🔀 ${esc(groupName)}</span>
          <span style="font-size:10px;color:var(--text3);font-weight:400">${stages.length} 个环节</span>
        </div>
        <div class="pms-flow">${flowItems.join('')}</div>
      </div>
    `;
  }).join('');

  const totalStages = Object.values(schema).reduce((s, a) => s + a.length, 0);
  const configuredStages = Object.values(config).filter(v => v && v.length > 0).length;

  // 固定工具链（不走 AI 模型路由，但用户也想知道用了什么）
  const fixedToolChain = `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:18px;margin-bottom:14px">
      <div style="font-size:14px;font-weight:700;margin-bottom:10px;color:#FFF600;display:flex;align-items:center;gap:8px">
        <span>🛠️ 固定工具链路（不走 AI 模型路由 · 仅展示）</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px;font-size:12px">
        <div style="background:var(--bg3);padding:10px 12px;border-radius:8px;border-left:3px solid var(--cyan)">
          <div style="font-weight:600;color:var(--text);margin-bottom:4px">📺 视频链接抓取</div>
          <div style="color:var(--text2);line-height:1.7">① iesdouyin SSR（抖音）<br>② yt-dlp 2026.03（B站/通用）<br>③ MCP media-crawler<br>④ axios + 移动端 UA 兜底</div>
        </div>
        <div style="background:var(--bg3);padding:10px 12px;border-radius:8px;border-left:3px solid var(--cyan)">
          <div style="font-weight:600;color:var(--text);margin-bottom:4px">🔍 关键字搜索</div>
          <div style="color:var(--text2);line-height:1.7">① B站 wbi/search/type API<br>② 抖音/小红书 puppeteer headless（要扫码 cookie）<br>③ MCP search_keyword 兜底</div>
        </div>
        <div style="background:var(--bg3);padding:10px 12px;border-radius:8px;border-left:3px solid var(--cyan)">
          <div style="font-weight:600;color:var(--text);margin-bottom:4px">👤 博主主页爬取</div>
          <div style="color:var(--text2);line-height:1.7">① yt-dlp + 扫码 cookie<br>② puppeteer + cookie + scroll 全量<br>③ MCP crawl_creator<br>④ axios 移动 UA</div>
        </div>
        <div style="background:var(--bg3);padding:10px 12px;border-radius:8px;border-left:3px solid var(--yellow,#FFF600)">
          <div style="font-weight:600;color:var(--text);margin-bottom:4px">🔐 平台扫码登录</div>
          <div style="color:var(--text2);line-height:1.7">puppeteer-core + chromium 126（CentOS 7 EPEL）<br>cookies 存 outputs/cookies/{platform}_cookies.json</div>
        </div>
        <div style="background:var(--bg3);padding:10px 12px;border-radius:8px;border-left:3px solid var(--yellow,#FFF600)">
          <div style="font-weight:600;color:var(--text);margin-bottom:4px">📝 字幕烧录</div>
          <div style="color:var(--text2);line-height:1.7">FFmpeg drawtext filter<br>字体：Linux NotoSansCJK / Windows msyh.ttc</div>
        </div>
        <div style="background:var(--bg3);padding:10px 12px;border-radius:8px;border-left:3px solid var(--yellow,#FFF600)">
          <div style="font-weight:600;color:var(--text);margin-bottom:4px">🎬 视频抠像合成</div>
          <div style="color:var(--text2);line-height:1.7">① 百度 body_seg API<br>② videoMattingPipeline（FFmpeg + 自研）</div>
        </div>
        <div style="background:var(--bg3);padding:10px 12px;border-radius:8px;border-left:3px solid #ec4899">
          <div style="font-weight:600;color:var(--text);margin-bottom:4px">🎙️ TTS 语音合成</div>
          <div style="color:var(--text2);line-height:1.7">2026-04-26 全平台统一阿里 TTS：<br>① 阿里 CosyVoice 2 真克隆 voice_id<br>② 阿里 NLS 预设音色<br>（已禁用：火山豆包/MiniMax/讯飞/百度/OpenAI/SAPI）</div>
        </div>
        <div style="background:var(--bg3);padding:10px 12px;border-radius:8px;border-left:3px solid #ec4899">
          <div style="font-weight:600;color:var(--text);margin-bottom:4px">🤖 数字人驱动（核心）</div>
          <div style="color:var(--text2);line-height:1.7">火山即梦 Omni v1.5：<code style="background:var(--bg2);padding:1px 4px;border-radius:3px;font-size:11px">jimeng_realman_avatar_picture_omni_v15</code><br>主体检测：<code style="background:var(--bg2);padding:1px 4px;border-radius:3px;font-size:11px">jimeng_realman_avatar_object_detection</code><br>备用：阿里 Wan-Animate / 飞影 free</div>
        </div>
        <div style="background:var(--bg3);padding:10px 12px;border-radius:8px;border-left:3px solid #a78bfa">
          <div style="font-weight:600;color:var(--text);margin-bottom:4px">👁 视觉理解</div>
          <div style="color:var(--text2);line-height:1.7">性别检测/封面分析：智谱 glm-4v → OpenAI gpt-4o-mini<br>视频内容分析：豆包 doubao-1-5-vision-pro</div>
        </div>
      </div>
      <div style="margin-top:10px;font-size:11px;color:var(--text3);line-height:1.7">
        💡 上述工具链路是代码硬编码的多级 fallback，<b>不能在此 tab 路由</b>。下面 ↓ 是<b>可路由的 AI 模型环节</b>，每个环节可设置多个备选 + 优先级。
      </div>
    </div>
  `;

  body.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:14px 18px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-size:13px;color:var(--text2)">可路由模型环节：已配置 <b style="color:var(--accent);font-size:18px;font-family:monospace">${configuredStages}</b> / ${totalStages}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:3px">点击任一环节卡片，弹窗里挑选模型并设置优先级</div>
      </div>
    </div>
    ${fixedToolChain}
    ${groupHtml}
  `;
}

// 弹窗：编辑某 stage 的模型链
function openStageEditModal(stageId, type) {
  if (!_pmsCache) return;
  const stage = Object.values(_pmsCache.schema).flat().find(s => s.id === stageId);
  let cur = (_pmsCache.config[stageId] || []).slice();
  // 没用户配置时用代码默认 fallback 链路预填（让用户看到"系统默认"的链）
  let usingDefaults = false;
  if (cur.length === 0) {
    const defaults = (_pmsCache.defaults && _pmsCache.defaults[stageId]) || [];
    if (defaults.length) {
      cur = defaults.map(d => ({ ...d }));
      usingDefaults = true;
    }
  }
  const avail = _pmsCache.available[type] || [];

  const renderBody = () => {
    const inUseSet = new Set(cur.map(m => m.provider_id + '::' + m.model_id));
    const candidates = avail.filter(a => !inUseSet.has(a.provider_id + '::' + a.model_id));

    const defaultsBanner = usingDefaults
      ? `<div style="background:rgba(255,246,0,0.08);border:1px solid rgba(255,246,0,0.3);border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:11px;color:#FFF600;line-height:1.6">💡 当前显示的是<b>系统代码默认 fallback 链路</b>（仅作建议，未保存）。点保存后即生效；点删除可清空恢复"未配置"状态。</div>`
      : '';

    const inUseHtml = cur.length === 0
      ? `<div style="text-align:center;color:var(--text3);font-size:12px;padding:24px;background:var(--bg3);border:1px dashed var(--border);border-radius:8px">还没添加模型 · 从下方候选添加</div>`
      : `<div class="vido-model-list">${cur.map((m, idx) => {
          const meta = avail.find(a => a.provider_id === m.provider_id && a.model_id === m.model_id);
          // 优先用 settings 里的中文 model_name；如果该 provider 已被禁用 / 模型已删除 → meta 是 undefined
          const isStale = !meta;
          const displayName = meta?.model_name || _i18nModelName(m.model_id) || m.model_id;
          const provName = meta?.provider_name || _i18nProviderName(m.provider_id) || m.provider_id;
          return `
            <div class="vido-model-item ${m.enabled?'selected':''}" ${isStale ? 'style="opacity:.5"' : ''}>
              <span style="font-family:monospace;font-size:14px;color:var(--accent);min-width:28px;text-align:center">#${idx+1}</span>
              <div class="vido-model-item-info">
                <div class="vido-model-item-id" style="font-weight:600">${esc(displayName)}${isStale ? ' <span style="color:#ff5050;font-weight:400;font-size:10px">(已禁用/已删除)</span>' : ''}</div>
                <div class="vido-model-item-meta" style="opacity:.7">${esc(provName)} · <code style="font-size:10px">${esc(m.model_id)}</code></div>
              </div>
              <label class="vido-toggle" title="启用/禁用">
                <input type="checkbox" ${m.enabled?'checked':''} onchange="_stageEditToggle(${idx})" />
                <span class="vido-toggle-slider"></span>
              </label>
              <button class="btn-sm" onclick="_stageEditMove(${idx},-1)" ${idx===0?'disabled':''} title="上移">▲</button>
              <button class="btn-sm" onclick="_stageEditMove(${idx},1)" ${idx===cur.length-1?'disabled':''} title="下移">▼</button>
              <button class="btn-sm danger" onclick="_stageEditRemove(${idx})">删除</button>
            </div>
          `;
        }).join('')}</div>`;

    const candHtml = candidates.length === 0
      ? `<div style="text-align:center;color:var(--text3);font-size:11px;padding:14px">没有更多可选的「${type}」类型模型（请先在「AI 配置」里启用对应的供应商和模型）</div>`
      : `<div class="vido-model-list">${candidates.map((c, i) => `
          <div class="vido-model-item" onclick="_stageEditAdd(${i})">
            <span style="font-size:18px;color:var(--accent)">+</span>
            <div class="vido-model-item-info">
              <div class="vido-model-item-id" style="font-weight:600">${esc(c.model_name || c.model_id)}</div>
              <div class="vido-model-item-meta" style="opacity:.7">${esc(c.provider_name || c.provider_id)} · <code style="font-size:10px">${esc(c.model_id)}</code></div>
            </div>
          </div>
        `).join('')}</div>`;

    return `
      <div style="font-size:12px;color:var(--text3);margin-bottom:14px;line-height:1.6">
        ${esc(stage.desc || '')} · stage_id: <code>${stageId}</code> · 业务方按 #1 → #2 顺序取第一个启用的
      </div>
      ${defaultsBanner}
      <div style="font-size:12px;color:var(--text2);font-weight:600;margin-bottom:8px">已配置（按优先级）${usingDefaults ? '<span style="font-weight:400;color:var(--text3);font-size:11px;margin-left:6px">— 系统默认链路</span>' : ''}</div>
      ${inUseHtml}
      <div style="font-size:12px;color:var(--text2);font-weight:600;margin:18px 0 8px">候选模型（点击添加）</div>
      ${candHtml}
    `;
  };

  // 把临时编辑状态挂在 window
  window._stageEditCur = cur;
  window._stageEditId = stageId;
  window._stageEditType = type;

  const bodyEl = VidoModal.open({
    title: `编辑环节：${stage.name}`,
    body: renderBody(),
    large: true,
    confirmText: '保存',
    onConfirm: async () => {
      try {
        await saveStage(stageId, window._stageEditCur);
        return true;
      } catch (e) { toast('保存失败：' + e.message); return false; }
    }
  });

  // 子操作：刷新弹窗体
  window._stageEditRefresh = () => { bodyEl.innerHTML = renderBody(); };
}

window._stageEditAdd = function(candIdx) {
  const avail = _pmsCache.available[window._stageEditType] || [];
  const cur = window._stageEditCur;
  const inUseSet = new Set(cur.map(m => m.provider_id + '::' + m.model_id));
  const candidates = avail.filter(a => !inUseSet.has(a.provider_id + '::' + a.model_id));
  const m = candidates[candIdx];
  if (!m) return;
  cur.push({ provider_id: m.provider_id, model_id: m.model_id, priority: cur.length + 1, enabled: true });
  window._stageEditRefresh();
};
window._stageEditToggle = function(idx) {
  const cur = window._stageEditCur;
  if (cur[idx]) cur[idx].enabled = !cur[idx].enabled;
  window._stageEditRefresh();
};
window._stageEditMove = function(idx, dir) {
  const cur = window._stageEditCur;
  const t = idx + dir;
  if (t < 0 || t >= cur.length) return;
  [cur[idx], cur[t]] = [cur[t], cur[idx]];
  cur.forEach((m, i) => m.priority = i + 1);
  window._stageEditRefresh();
};
window._stageEditRemove = function(idx) {
  const cur = window._stageEditCur;
  cur.splice(idx, 1);
  cur.forEach((m, i) => m.priority = i + 1);
  window._stageEditRefresh();
};

function addModelToStage(stageId, type) { openStageEditModal(stageId, type); } // 兼容旧调用

function toggleStageModel(stageId, idx, enabled) {
  const cur = (_pmsCache.config[stageId] || []).slice();
  if (cur[idx]) { cur[idx].enabled = enabled; saveStage(stageId, cur); }
}

function removeStageModel(stageId, idx) {
  if (!confirm('删除此模型？')) return;
  const cur = (_pmsCache.config[stageId] || []).slice();
  cur.splice(idx, 1);
  cur.forEach((m, i) => m.priority = i + 1);
  saveStage(stageId, cur);
}

function moveStageModel(stageId, idx, dir) {
  const cur = (_pmsCache.config[stageId] || []).slice();
  const target = idx + dir;
  if (target < 0 || target >= cur.length) return;
  [cur[idx], cur[target]] = [cur[target], cur[idx]];
  cur.forEach((m, i) => m.priority = i + 1);
  saveStage(stageId, cur);
}

async function saveStage(stageId, models) {
  try {
    const r = await authFetch(`/api/admin/pipeline-models/${encodeURIComponent(stageId)}`, {
      method: 'PUT', body: JSON.stringify({ models })
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    _pmsCache.config[stageId] = j.models;
    renderModelPipeline();
    toast('已保存');
  } catch (e) { toast('保存失败：' + e.message); }
}

