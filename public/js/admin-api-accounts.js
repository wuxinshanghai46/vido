// ═══════════════════════════════════════════
// 接口账号（AppID/AppKey）管理 — 管理后台
// 语义: 勾选的是"合作方/用户可调用的 AI 模型"，不是平台功能模块
// ═══════════════════════════════════════════
let apiCatalogCache = null;       // 保留兼容（平台接口）
let modelCatalogCache = null;     // AI 模型目录
let editingApiAcct = null;

function _apaEsc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' }[c])); }
function _apaToken() { try { return localStorage.getItem('vido-token') || sessionStorage.getItem('vido_token') || ''; } catch { return ''; } }
function _apaHeaders(extra) { return Object.assign({ Authorization: 'Bearer ' + _apaToken() }, extra || {}); }

async function loadApiAccounts() {
  try {
    const r = await fetch('/api/admin/api-accounts', { headers: _apaHeaders() });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    const tbody = document.getElementById('api-accounts-body');
    if (!tbody) return;
    tbody.innerHTML = j.data.map(a => `
      <tr>
        <td><b>${_apaEsc(a.name)}</b><div style="font-size:10px;color:var(--text3)">${_apaEsc(a.remark || '')}</div></td>
        <td><code style="font-size:11px">${_apaEsc(a.app_id)}</code></td>
        <td><code style="font-size:11px;color:var(--text3)">${_apaEsc(a.app_secret_masked)}</code>
            <button class="btn-sm" style="margin-left:6px;padding:2px 8px;font-size:10px" onclick="rotateApiSecret('${a.id}')">↻ 重置</button></td>
        <td>${(a.allowed_models || []).includes('*') ? '<span style="color:var(--accent)">全部模型</span>' : ((a.allowed_models || []).length + ' 个模型')}</td>
        <td><span class="pill ${a.status === 'active' ? 'pill-ok' : 'pill-muted'}">${a.status === 'active' ? '启用' : '停用'}</span></td>
        <td>${a.call_count || 0}</td>
        <td style="font-size:11px;color:var(--text3)">${a.last_used_at ? new Date(a.last_used_at).toLocaleString() : '-'}</td>
        <td>
          <button class="btn-sm" onclick="editApiAcct('${a.id}')">编辑</button>
          <button class="btn-sm btn-danger" onclick="deleteApiAcct('${a.id}','${_apaEsc(a.name)}')">删除</button>
        </td>
      </tr>
    `).join('') || '<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text3)">暂无接口账号，点击右上角「+ 新建接口账号」创建</td></tr>';
  } catch (e) {
    console.error('[loadApiAccounts]', e);
  }
}

async function ensureApiCatalog() {
  if (apiCatalogCache) return apiCatalogCache;
  const r = await fetch('/api/admin/api-accounts/catalog', { headers: _apaHeaders() });
  const j = await r.json();
  if (!j.success) throw new Error(j.error);
  apiCatalogCache = j.data;
  return apiCatalogCache;
}

async function ensureModelCatalog() {
  if (modelCatalogCache) return modelCatalogCache;
  const r = await fetch('/api/admin/api-accounts/model-catalog', { headers: _apaHeaders() });
  const j = await r.json();
  if (!j.success) throw new Error(j.error);
  modelCatalogCache = j.data;
  return modelCatalogCache;
}

async function openApiAcctModal(acc) {
  acc = acc || null;
  editingApiAcct = acc;
  document.getElementById('api-acct-modal-title').textContent = acc ? '编辑接口账号：' + acc.name : '新建接口账号';
  document.getElementById('apa-name').value = acc ? (acc.name || '') : '';
  document.getElementById('apa-remark').value = acc ? (acc.remark || '') : '';
  document.getElementById('apa-status').value = acc ? (acc.status || 'active') : 'active';
  document.getElementById('apa-credits').value = acc ? (acc.credits || 0) : 0;

  const catalog = await ensureModelCatalog();
  const allowed = new Set(acc && acc.allowed_models ? acc.allowed_models : []);
  const selectAllCheck = allowed.has('*');
  document.getElementById('apa-select-all').checked = selectAllCheck;
  const USE_COLOR = { story: '#a78bfa', image: '#60a5fa', video: '#f472b6', tts: '#34d399', vlm: '#fbbf24' };
  const html = catalog.length ? catalog.map(g => {
    const rows = g.items.map(it => {
      const checked = allowed.has(it.key) || selectAllCheck;
      const useColor = USE_COLOR[it.use] || 'var(--text3)';
      const useTag = it.use_label ? `<span style="display:inline-block;padding:1px 6px;border-radius:8px;background:${useColor}22;color:${useColor};font-size:10px;margin-left:6px">${_apaEsc(it.use_label)}</span>` : '';
      return '<label class="apa-api-row" style="display:flex;align-items:center;gap:6px;font-size:11px;padding:4px 6px;border-radius:4px;cursor:pointer" data-key="' + it.key + '">'
        + '<input type="checkbox" class="apa-api-check" data-group="' + g.provider_id + '" data-key="' + it.key + '"' + (checked ? ' checked' : '') + ' />'
        + '<span style="color:var(--text2)"><b>' + _apaEsc(it.label) + '</b>' + useTag + ' <code style="font-size:10px;color:var(--text3)">' + _apaEsc(it.model_id) + '</code></span>'
        + '</label>';
    }).join('');
    return '<div style="margin-bottom:10px">'
      + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;font-weight:600;color:var(--accent)">'
      +   '<label style="font-size:11px;font-weight:500;color:var(--text2)"><input type="checkbox" class="apa-group-check" data-group="' + g.provider_id + '" onchange="apaToggleGroup(this,\'' + g.provider_id + '\')" /> ' + _apaEsc(g.provider_name) + ' <span style="color:var(--text3);font-weight:400">(' + g.items.length + ')</span></label>'
      + '</div>'
      + '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:4px;padding-left:14px">' + rows + '</div>'
      + '</div>';
  }).join('') : '<div style="padding:16px;color:var(--text3);text-align:center;font-size:12px">尚无可用模型 — 请先到「AI 配置」添加供应商和模型</div>';
  document.getElementById('apa-apis-list').innerHTML = html;

  document.getElementById('apa-secret-box').style.display = 'none';
  document.getElementById('api-acct-modal').style.display = 'flex';
}

function closeApiAcctModal() {
  document.getElementById('api-acct-modal').style.display = 'none';
  editingApiAcct = null;
}

function apaToggleAllApis(cb) {
  document.querySelectorAll('.apa-api-check').forEach(c => c.checked = cb.checked);
  document.querySelectorAll('.apa-group-check').forEach(c => c.checked = cb.checked);
}

function apaToggleGroup(cb, group) {
  document.querySelectorAll('.apa-api-check[data-group="' + group + '"]').forEach(c => c.checked = cb.checked);
}

async function saveApiAcct() {
  const name = document.getElementById('apa-name').value.trim();
  if (!name) { alert('请填写账号名称'); return; }
  const remark = document.getElementById('apa-remark').value.trim();
  const status = document.getElementById('apa-status').value;
  const credits = parseInt(document.getElementById('apa-credits').value) || 0;
  const allApiChecks = Array.prototype.slice.call(document.querySelectorAll('.apa-api-check'));
  const allChecked = allApiChecks.length > 0 && allApiChecks.every(function (c) { return c.checked; });
  const allowed_models = allChecked ? ['*'] : allApiChecks.filter(function (c) { return c.checked; }).map(function (c) { return c.dataset.key; });
  // 平台接口默认允许全部（此 UI 关注的是 AI 模型权限，接口路由默认放开由 JWT/鉴权层控制）
  const allowed_apis = ['*'];

  try {
    if (editingApiAcct && editingApiAcct.id && !editingApiAcct._justCreated) {
      const r = await fetch('/api/admin/api-accounts/' + editingApiAcct.id, {
        method: 'PUT', headers: _apaHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name: name, remark: remark, status: status, credits: credits, allowed_apis: allowed_apis, allowed_models: allowed_models }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error);
      alert('✓ 已保存');
      closeApiAcctModal();
    } else {
      const r = await fetch('/api/admin/api-accounts', {
        method: 'POST', headers: _apaHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name: name, remark: remark, credits: credits, allowed_apis: allowed_apis, allowed_models: allowed_models }),
      });
      const j = await r.json();
      if (!j.success) throw new Error(j.error);
      document.getElementById('apa-show-appid').textContent = j.data.app_id;
      document.getElementById('apa-show-secret').textContent = j.data.app_secret;
      document.getElementById('apa-secret-box').style.display = 'block';
      editingApiAcct = Object.assign({}, j.data, { _justCreated: true });
      document.getElementById('api-acct-modal-title').textContent = '接口账号已创建';
    }
    loadApiAccounts();
  } catch (e) {
    alert('保存失败: ' + e.message);
  }
}

async function editApiAcct(id) {
  try {
    const r = await fetch('/api/admin/api-accounts/' + id, { headers: _apaHeaders() });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    openApiAcctModal(j.data);
  } catch (e) { alert('加载失败: ' + e.message); }
}

async function rotateApiSecret(id) {
  if (!confirm('确定重置 AppKey？重置后旧密钥立即失效。')) return;
  try {
    const r = await fetch('/api/admin/api-accounts/' + id + '/rotate-secret', {
      method: 'POST', headers: _apaHeaders(),
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    alert('新 AppKey：\n\n' + j.data.app_secret + '\n\n请立即保存，仅此一次显示。');
    loadApiAccounts();
  } catch (e) { alert('重置失败: ' + e.message); }
}

async function deleteApiAcct(id, name) {
  if (!confirm('确定删除接口账号「' + name + '」？')) return;
  try {
    const r = await fetch('/api/admin/api-accounts/' + id, { method: 'DELETE', headers: _apaHeaders() });
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    loadApiAccounts();
  } catch (e) { alert('删除失败: ' + e.message); }
}

function copyApaSecret() {
  const secret = document.getElementById('apa-show-secret').textContent;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(secret).then(function () { alert('已复制'); });
  } else {
    const ta = document.createElement('textarea');
    ta.value = secret; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    alert('已复制');
  }
}

// 注册 tab 切换时自动加载
(function registerApiAcctTab() {
  function bind() {
    const tab = document.querySelector('.nav-item[data-tab="apiaccounts"]');
    if (tab && !tab._apaBound) {
      tab._apaBound = true;
      tab.addEventListener('click', loadApiAccounts);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();

window.openApiAcctModal = openApiAcctModal;
window.closeApiAcctModal = closeApiAcctModal;
window.apaToggleAllApis = apaToggleAllApis;
window.apaToggleGroup = apaToggleGroup;
window.saveApiAcct = saveApiAcct;
window.editApiAcct = editApiAcct;
window.rotateApiSecret = rotateApiSecret;
window.deleteApiAcct = deleteApiAcct;
window.copyApaSecret = copyApaSecret;
window.loadApiAccounts = loadApiAccounts;
