/* admin-workflows.js — AI 工作流管理后台 (panel-workflows)
 *
 * 功能：
 *   - 左侧列表：内置 + 自定义工作流
 *   - 右侧详情：JSON 编辑器 + 试运行表单（动态从 inputs 渲染）+ 运行历史
 *   - 节点能力浏览（modal）
 * 依赖 admin.js 提供的 fetch wrapper（如有）；这里走原生 fetch + token
 */
(function () {
  let _wfState = {
    workflows: [],
    capabilities: [],
    currentId: null,
    currentWorkflow: null,
    runHistory: [],
    runResult: null,
    isEditing: false,
  };

  function _token() {
    try {
      return (
        localStorage.getItem('vido_token') ||
        localStorage.getItem('vido-token') ||
        sessionStorage.getItem('vido_token') ||
        localStorage.getItem('token') ||
        ''
      );
    } catch { return ''; }
  }
  async function _api(url, opts = {}) {
    const r = await fetch(url, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
        Authorization: 'Bearer ' + _token(),
      },
    });
    let data;
    try { data = await r.json(); }
    catch { throw new Error('返回非 JSON'); }
    if (!data?.success) throw new Error(data?.error || `${r.status} ${r.statusText}`);
    return data;
  }
  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function _toast(msg, ok = true) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = `position:fixed;top:20px;right:20px;z-index:99999;padding:10px 16px;border-radius:8px;font-size:13px;color:#fff;background:${ok ? '#22c55e' : '#ef4444'};box-shadow:0 6px 20px rgba(0,0,0,.3);`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2800);
  }

  // ─── 加载 ───
  window.wfRefreshAll = async function () {
    try {
      const [wfs, caps] = await Promise.all([
        _api('/api/workflows'),
        _api('/api/workflows/capabilities'),
      ]);
      _wfState.workflows = wfs.workflows || [];
      _wfState.capabilities = caps.capabilities || [];
      _renderList();
      if (_wfState.currentId) {
        const exists = _wfState.workflows.find(w => w.id === _wfState.currentId);
        if (exists) wfOpenWorkflow(exists.id);
        else { _wfState.currentId = null; _renderEmpty(); }
      }
    } catch (e) {
      _toast('加载失败：' + e.message, false);
    }
  };

  function _renderList() {
    const builtin = _wfState.workflows.filter(w => w.builtin);
    const user = _wfState.workflows.filter(w => !w.builtin);
    document.getElementById('wf-list-builtin').innerHTML = builtin.length
      ? builtin.map(_listItem).join('')
      : '<div class="wf-list-empty">暂无内置工作流</div>';
    document.getElementById('wf-list-user').innerHTML = user.length
      ? user.map(_listItem).join('')
      : '<div class="wf-list-empty">还没有自定义工作流，点右上角「+ 新建」</div>';
  }
  function _listItem(w) {
    const active = w.id === _wfState.currentId ? 'active' : '';
    const tag = w.builtin ? '<span class="wf-badge wf-badge-builtin">内置</span>' : '';
    return `<div class="wf-list-item ${active}" onclick="wfOpenWorkflow('${_esc(w.id)}')">
      <div class="wf-list-item-head">
        <span class="wf-list-item-name">${_esc(w.name)}</span>${tag}
      </div>
      <div class="wf-list-item-meta">${_esc(w.category || 'custom')} · ${w.stepCount}步 · v${w.version || 1}</div>
      <div class="wf-list-item-desc">${_esc((w.description || '').slice(0, 60))}</div>
    </div>`;
  }

  function _renderEmpty() {
    document.getElementById('wf-detail-pane').innerHTML = `<div class="wf-empty">从左侧选择一个工作流，或点「+ 新建工作流」</div>`;
  }

  // ─── 打开工作流详情 ───
  window.wfOpenWorkflow = async function (id) {
    try {
      const r = await _api('/api/workflows/' + encodeURIComponent(id));
      _wfState.currentId = id;
      _wfState.currentWorkflow = r.workflow;
      _wfState.runResult = null;
      _wfState.isEditing = false;
      _renderList();
      _renderDetail();
      _loadRuns(id);
    } catch (e) {
      _toast('加载工作流失败：' + e.message, false);
    }
  };

  function _renderDetail() {
    const w = _wfState.currentWorkflow;
    if (!w) return _renderEmpty();
    const inputs = w.inputs || [];
    const isBuiltin = !!w._builtin;

    const formHtml = inputs.length
      ? inputs.map(inp => {
          const required = inp.required ? '<span class="wf-required">*</span>' : '';
          const desc = inp.desc ? `<div class="wf-input-desc">${_esc(inp.desc)}</div>` : '';
          const def = inp.default != null ? _esc(inp.default) : '';
          if (inp.type === 'array') {
            return `<div class="wf-form-row">
              <label>${_esc(inp.label || inp.name)} ${required}</label>
              ${desc}
              <textarea class="wf-input" data-input="${_esc(inp.name)}" data-type="array" rows="4" placeholder="一行一个 URL/值">${def}</textarea>
            </div>`;
          }
          if (inp.type === 'number') {
            return `<div class="wf-form-row">
              <label>${_esc(inp.label || inp.name)} ${required}</label>
              ${desc}
              <input class="wf-input" type="number" data-input="${_esc(inp.name)}" data-type="number" value="${def}"/>
            </div>`;
          }
          // string / object 都用 textarea 或 input
          return `<div class="wf-form-row">
            <label>${_esc(inp.label || inp.name)} ${required}</label>
            ${desc}
            <input class="wf-input" data-input="${_esc(inp.name)}" data-type="${_esc(inp.type || 'string')}" value="${def}" placeholder="${_esc(inp.placeholder || '')}"/>
          </div>`;
        }).join('')
      : '<div class="wf-empty-small">该工作流无输入参数</div>';

    document.getElementById('wf-detail-pane').innerHTML = `
      <div class="wf-detail-head">
        <div>
          <div class="wf-detail-title">${_esc(w.name)} ${isBuiltin ? '<span class="wf-badge wf-badge-builtin">内置</span>' : ''}</div>
          <div class="wf-detail-meta">id: <code>${_esc(w.id)}</code> · ${(w.steps || []).length}步 · ${(w.outputs || []).length}个输出</div>
          ${w.description ? `<div class="wf-detail-desc">${_esc(w.description)}</div>` : ''}
        </div>
        <div class="wf-detail-actions">
          <button class="btn-sm" onclick="wfToggleEdit()">${_wfState.isEditing ? '取消编辑' : '编辑 JSON'}</button>
          ${isBuiltin ? '<button class="btn-sm" onclick="wfClone()">克隆为自定义</button>' : '<button class="btn-sm danger" onclick="wfDelete()">删除</button>'}
        </div>
      </div>

      <div class="wf-detail-body">
        <!-- 左：JSON / inputs 表单 -->
        <div class="wf-pane-left">
          ${_wfState.isEditing
            ? `<div class="wf-form-row"><label>工作流 JSON 定义</label>
                <textarea id="wf-json-editor" class="wf-json-editor" rows="22">${_esc(JSON.stringify(w, null, 2))}</textarea>
                <div style="margin-top:8px;display:flex;gap:8px;">
                  <button class="btn-primary" onclick="wfSaveJson()">保存</button>
                  <button class="btn-sm" onclick="wfFormatJson()">格式化</button>
                </div></div>`
            : `<div class="wf-section-title">输入参数</div>${formHtml}
              <div class="wf-form-row" style="margin-top:14px"><button class="btn-primary wf-run-btn" onclick="wfRun()">▶ 试运行</button></div>`
          }
        </div>

        <!-- 右：步骤可视 + 输出 + 历史 -->
        <div class="wf-pane-right">
          <div class="wf-section-title">步骤流</div>
          <div class="wf-steps-vis">
            ${(w.steps || []).map((s, i) => `<div class="wf-step-block">
              <span class="wf-step-idx">${i + 1}</span>
              <div>
                <div class="wf-step-name">${_esc(s.id)} <code>${_esc(s.type)}</code></div>
                ${s.params ? `<div class="wf-step-params">${_esc(JSON.stringify(s.params).slice(0, 100))}${JSON.stringify(s.params).length > 100 ? '…' : ''}</div>` : ''}
              </div>
            </div>`).join('') || '<div class="wf-empty-small">无步骤</div>'}
          </div>

          <div class="wf-section-title" style="margin-top:14px">声明的输出</div>
          <div class="wf-outputs-list">
            ${(w.outputs || []).map(o => `<div class="wf-output-row"><code>${_esc(o.name)}</code> ← <code>${_esc(o.from)}</code> <span style="color:#888">${_esc(o.type || '')}</span></div>`).join('') || '<div class="wf-empty-small">未声明输出</div>'}
          </div>

          <div class="wf-section-title" style="margin-top:14px">运行历史 <button class="btn-sm" onclick="wfRefreshRuns()" style="margin-left:8px;font-size:11px">刷新</button></div>
          <div class="wf-runs-list" id="wf-runs-list"></div>
        </div>
      </div>

      <!-- 试运行结果区 -->
      <div id="wf-run-result-area"></div>
    `;
  }

  // ─── 编辑 ───
  window.wfToggleEdit = function () {
    if (_wfState.currentWorkflow?._builtin && !_wfState.isEditing) {
      _toast('内置工作流不能直接编辑，请「克隆为自定义」后修改', false);
      return;
    }
    _wfState.isEditing = !_wfState.isEditing;
    _renderDetail();
  };
  window.wfFormatJson = function () {
    const ta = document.getElementById('wf-json-editor');
    try {
      ta.value = JSON.stringify(JSON.parse(ta.value), null, 2);
    } catch (e) {
      _toast('JSON 格式错误：' + e.message, false);
    }
  };
  window.wfSaveJson = async function () {
    const ta = document.getElementById('wf-json-editor');
    let parsed;
    try { parsed = JSON.parse(ta.value); }
    catch (e) { return _toast('JSON 格式错误：' + e.message, false); }
    if (!parsed.id) return _toast('JSON 必须包含 id', false);
    if (!parsed.name) return _toast('JSON 必须包含 name', false);
    try {
      await _api('/api/workflows/' + encodeURIComponent(parsed.id), {
        method: 'PUT',
        body: JSON.stringify(parsed),
      });
      _toast('保存成功');
      _wfState.isEditing = false;
      await wfRefreshAll();
      wfOpenWorkflow(parsed.id);
    } catch (e) {
      _toast('保存失败：' + e.message, false);
    }
  };

  window.wfNewWorkflow = function () {
    const tpl = {
      id: 'my-workflow-' + Date.now(),
      name: '我的工作流',
      category: 'custom',
      version: 1,
      description: '描述这个工作流的作用',
      inputs: [
        { name: 'imageUrl', type: 'string', required: true, label: '输入图片 URL' }
      ],
      steps: [
        { id: 'step1', type: 'cutout', params: { imageUrl: '$imageUrl' } }
      ],
      outputs: [
        { name: 'result', from: '$step1.imageUrl', type: 'string' }
      ]
    };
    _wfState.currentId = tpl.id;
    _wfState.currentWorkflow = tpl;
    _wfState.isEditing = true;
    _renderList();
    _renderDetail();
  };

  window.wfClone = function () {
    const w = _wfState.currentWorkflow;
    if (!w) return;
    const cloned = { ...w, id: w.id + '-copy-' + Date.now(), name: w.name + ' (副本)' };
    delete cloned._builtin; delete cloned._file;
    _wfState.currentId = cloned.id;
    _wfState.currentWorkflow = cloned;
    _wfState.isEditing = true;
    _renderList();
    _renderDetail();
    _toast('已生成副本，请保存');
  };

  window.wfDelete = async function () {
    const w = _wfState.currentWorkflow;
    if (!w) return;
    if (!confirm('确定删除工作流「' + w.name + '」？')) return;
    try {
      await _api('/api/workflows/' + encodeURIComponent(w.id), { method: 'DELETE' });
      _toast('已删除');
      _wfState.currentId = null;
      _wfState.currentWorkflow = null;
      await wfRefreshAll();
      _renderEmpty();
    } catch (e) {
      _toast('删除失败：' + e.message, false);
    }
  };

  // ─── 试运行 ───
  window.wfRun = async function () {
    const w = _wfState.currentWorkflow;
    if (!w) return;
    const inputs = {};
    for (const inp of (w.inputs || [])) {
      const el = document.querySelector(`.wf-input[data-input="${inp.name}"]`);
      if (!el) continue;
      let v = el.value;
      if (inp.type === 'number') v = v === '' ? null : Number(v);
      else if (inp.type === 'array') v = String(v || '').split('\n').map(s => s.trim()).filter(Boolean);
      else if (inp.type === 'object') {
        try { v = v ? JSON.parse(v) : null; } catch { return _toast(`输入 ${inp.name} 不是合法 JSON`, false); }
      }
      if (inp.required && (v == null || v === '' || (Array.isArray(v) && !v.length))) {
        return _toast(`必填: ${inp.label || inp.name}`, false);
      }
      inputs[inp.name] = v;
    }

    const area = document.getElementById('wf-run-result-area');
    area.innerHTML = `<div class="wf-running"><div class="wf-spinner"></div>工作流执行中…可能需要 30-180 秒</div>`;
    try {
      const r = await _api(`/api/workflows/${encodeURIComponent(w.id)}/run`, {
        method: 'POST',
        body: JSON.stringify({ inputs }),
      });
      _wfState.runResult = r.run;
      _renderRunResult(r.run);
      wfRefreshRuns();
    } catch (e) {
      area.innerHTML = `<div class="wf-run-fail"><strong>执行失败</strong><pre>${_esc(e.message)}</pre></div>`;
    }
  };

  function _renderRunResult(run) {
    const area = document.getElementById('wf-run-result-area');
    if (!area) return;
    if (run.status === 'failed') {
      area.innerHTML = `<div class="wf-run-fail">
        <div class="wf-section-title" style="color:#ef4444">❌ 执行失败 (${(run.durationMs / 1000).toFixed(1)}s)</div>
        <pre>${_esc(run.error)}</pre>
        ${_renderStepLogs(run.stepLogs)}
      </div>`;
      return;
    }
    const outs = run.outputs || {};
    area.innerHTML = `<div class="wf-run-success">
      <div class="wf-section-title" style="color:#22c55e">✓ 执行成功 (${(run.durationMs / 1000).toFixed(1)}s · run ${_esc(run.runId)})</div>
      <div class="wf-outputs-display">
        ${Object.keys(outs).map(k => _renderOutputValue(k, outs[k])).join('')}
      </div>
      ${_renderStepLogs(run.stepLogs)}
    </div>`;
  }

  function _renderOutputValue(name, value) {
    const isImg = typeof value === 'string' && /\.(png|jpe?g|webp|gif)/i.test(value);
    const isVideo = typeof value === 'string' && /\.(mp4|webm|mov)/i.test(value);
    const isUrl = typeof value === 'string' && /^https?:\/\//i.test(value);
    const isArr = Array.isArray(value);

    let render;
    if (isImg) render = `<img src="${_esc(value)}" class="wf-output-img"/>`;
    else if (isVideo) render = `<video src="${_esc(value)}" class="wf-output-video" controls></video>`;
    else if (isArr && value.every(v => typeof v === 'string' && /\.(png|jpe?g|webp)/i.test(v))) {
      render = `<div class="wf-output-img-grid">${value.map(u => `<img src="${_esc(u)}" />`).join('')}</div>`;
    } else if (isArr) render = `<pre>${_esc(JSON.stringify(value, null, 2))}</pre>`;
    else if (typeof value === 'object') render = `<pre>${_esc(JSON.stringify(value, null, 2))}</pre>`;
    else render = isUrl ? `<a href="${_esc(value)}" target="_blank" class="wf-output-link">${_esc(value)}</a>` : `<code>${_esc(value)}</code>`;
    return `<div class="wf-output-block"><div class="wf-output-key">${_esc(name)}</div>${render}</div>`;
  }

  function _renderStepLogs(logs) {
    if (!logs?.length) return '';
    const hasUsage = logs.some(l => l.usage);
    let usageHtml = '';
    if (hasUsage) {
      let pt = 0, ct = 0, cost = 0;
      logs.forEach(l => { if (l.usage) { pt += l.usage.promptTokens || 0; ct += l.usage.completionTokens || 0; cost += l.usage.costUsd || 0; } });
      usageHtml = `<div class="wf-usage-bar">🪙 Token 合计: <b>${pt.toLocaleString()}</b> in / <b>${ct.toLocaleString()}</b> out &nbsp;·&nbsp; 估算费用: <b>$${cost.toFixed(5)}</b></div>`;
    }
    return usageHtml + `<details class="wf-step-logs"><summary>步骤日志 (${logs.length})</summary>
      ${logs.map(l => `<div class="wf-step-log ${l.ok ? 'ok' : (l.skipped ? 'skip' : 'err')}">
        <span class="wf-step-log-id">${_esc(l.id)}</span>
        <code>${_esc(l.type)}</code>
        ${l.skipped ? '<span class="wf-step-log-tag skip">跳过</span>' : (l.ok ? `<span class="wf-step-log-tag ok">✓ ${l.durationMs || 0}ms</span>` : '<span class="wf-step-log-tag err">✗ 失败</span>')}
        ${l.usage ? `<span class="wf-step-log-usage">${_esc(l.usage.model)} · ${(l.usage.promptTokens||0)+(l.usage.completionTokens||0)} tok · $${(l.usage.costUsd||0).toFixed(5)}</span>` : ''}
        ${l.error ? `<div class="wf-step-log-err">${_esc(l.error)}</div>` : ''}
      </div>`).join('')}
    </details>`;
  }

  // ─── 运行历史 ───
  async function _loadRuns(workflowId) {
    try {
      const r = await _api(`/api/workflows/${encodeURIComponent(workflowId)}/runs?limit=20`);
      _wfState.runHistory = r.runs || [];
      _renderRunsList();
    } catch (e) {
      console.warn(e);
    }
  }
  window.wfRefreshRuns = function () {
    if (_wfState.currentId) _loadRuns(_wfState.currentId);
  };
  function _renderRunsList() {
    const host = document.getElementById('wf-runs-list');
    if (!host) return;
    if (!_wfState.runHistory.length) {
      host.innerHTML = '<div class="wf-empty-small">暂无运行记录</div>';
      return;
    }
    host.innerHTML = _wfState.runHistory.map(r => `
      <div class="wf-run-row" onclick="wfOpenRun('${_esc(r.runId)}')">
        <span class="wf-run-status ${r.status}">${r.status === 'succeeded' ? '✓' : (r.status === 'failed' ? '✗' : '⏳')}</span>
        <span class="wf-run-time">${new Date(r.startedAt).toLocaleString('zh-CN', { hour12: false })}</span>
        <span class="wf-run-dur">${((r.durationMs || 0) / 1000).toFixed(1)}s</span>
      </div>
    `).join('');
  }
  window.wfOpenRun = async function (runId) {
    try {
      const r = await _api(`/api/workflows/runs/${encodeURIComponent(runId)}`);
      _renderRunResult(r.run);
      // 滚到结果区
      document.getElementById('wf-run-result-area')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      _toast('打开失败：' + e.message, false);
    }
  };

  // ─── 节点能力浏览 ───
  window.wfShowCapabilities = function () {
    const caps = _wfState.capabilities;
    const html = caps.map(c => `
      <div class="wf-cap-card">
        <div class="wf-cap-head"><code>${_esc(c.type)}</code> <span>${_esc(c.label)}</span></div>
        <div class="wf-cap-desc">${_esc(c.description || '')}</div>
        <div class="wf-cap-io">
          <div class="wf-cap-io-col"><strong>输入</strong>${(c.inputs || []).map(i => `<div><code>${_esc(i.name)}</code> ${i.required ? '<span class="wf-required">*</span>' : ''} <span class="wf-cap-io-type">${_esc(i.type || '')}</span> ${i.desc ? '<br><small>' + _esc(i.desc) + '</small>' : ''}</div>`).join('') || '—'}</div>
          <div class="wf-cap-io-col"><strong>输出</strong>${(c.outputs || []).map(o => `<div><code>${_esc(o.name)}</code> <span class="wf-cap-io-type">${_esc(o.type || '')}</span></div>`).join('') || '—'}</div>
        </div>
      </div>
    `).join('');
    _showModal('节点能力清单 (' + caps.length + ')', `<div class="wf-cap-grid">${html || '<div>暂无注册节点</div>'}</div>`);
  };

  function _showModal(title, html) {
    let modal = document.getElementById('wf-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'wf-modal';
      modal.className = 'wf-modal';
      modal.innerHTML = `<div class="wf-modal-backdrop" onclick="wfCloseModal()"></div>
        <div class="wf-modal-card">
          <div class="wf-modal-head">
            <span class="wf-modal-title"></span>
            <button class="wf-modal-close" onclick="wfCloseModal()">×</button>
          </div>
          <div class="wf-modal-body"></div>
        </div>`;
      document.body.appendChild(modal);
    }
    modal.querySelector('.wf-modal-title').textContent = title;
    modal.querySelector('.wf-modal-body').innerHTML = html;
    modal.classList.add('open');
  }
  window.wfCloseModal = function () {
    document.getElementById('wf-modal')?.classList.remove('open');
  };

  // ─── 可视化节点图编辑器 ───

  Object.assign(_wfState, {
    visualMode: false,
    graph: { nodes: [], edges: [] },
    _drag: null,
    _conn: null,
    _selNode: null,
    _selEdge: null,
  });

  // ── JSON ↔ Graph ──

  function _wfToGraph(wf) {
    const caps = _wfState.capabilities;
    const capMap = {};
    caps.forEach(c => { capMap[c.type] = c; });
    const steps = wf.steps || [];
    const nodes = steps.map((s, i) => ({
      id: s.id,
      type: s.type,
      params: { ...(s.params || {}) },
      x: 80 + (i % 5) * 260,
      y: 60 + Math.floor(i / 5) * 200,
    }));
    const nodeIds = new Set(nodes.map(n => n.id));
    const edges = [];
    for (const node of nodes) {
      for (const [pname, pval] of Object.entries(node.params)) {
        if (typeof pval !== 'string') continue;
        const m = pval.match(/^\$([a-zA-Z_][\w-]*)(?:\.([a-zA-Z_][\w]*))?$/);
        if (m && nodeIds.has(m[1])) {
          edges.push({
            id: `${m[1]}.${m[2] || 'output'}->${node.id}.${pname}`,
            fromNode: m[1], fromPort: m[2] || 'output',
            toNode: node.id, toPort: pname,
          });
        }
      }
    }
    return { nodes, edges };
  }

  function _graphToWf(graph, orig) {
    const steps = graph.nodes.map(node => {
      const params = { ...node.params };
      for (const e of graph.edges) {
        if (e.toNode === node.id) {
          params[e.toPort] = e.fromPort === 'output' ? `$${e.fromNode}` : `$${e.fromNode}.${e.fromPort}`;
        }
      }
      return { id: node.id, type: node.type, params };
    });
    return { ...orig, steps };
  }

  // ── Render ──

  function _renderVisualEditor() {
    const w = _wfState.currentWorkflow;
    const g = _wfState.graph;
    if (!w) return;
    const isBuiltin = !!w._builtin;
    const caps = _wfState.capabilities;

    const nodesHtml = g.nodes.map(node => {
      const cap = caps.find(c => c.type === node.type) || { inputs: [], outputs: [] };
      const inPorts = (cap.inputs || []).map(p =>
        `<div class="wf-vport in">
          <span class="wf-vpd" data-nid="${_esc(node.id)}" data-port="${_esc(p.name)}" data-dir="in"></span>
          <span class="wf-vpn">${_esc(p.name)}</span>
        </div>`
      ).join('');
      const outPorts = (cap.outputs || []).map(p =>
        `<div class="wf-vport out">
          <span class="wf-vpn">${_esc(p.name)}</span>
          <span class="wf-vpd" data-nid="${_esc(node.id)}" data-port="${_esc(p.name)}" data-dir="out"></span>
        </div>`
      ).join('');
      const sel = _wfState._selNode === node.id ? ' wf-vn-sel' : '';
      return `<div class="wf-vnode${sel}" id="wf-vn-${_esc(node.id)}" style="left:${node.x}px;top:${node.y}px" data-nid="${_esc(node.id)}">
        <div class="wf-vn-hdr" data-drag="${_esc(node.id)}">
          <span class="wf-vn-type">${_esc(node.type)}</span>
          <span class="wf-vn-id" title="${_esc(node.id)}">${_esc(node.id)}</span>
          ${isBuiltin ? '' : `<button class="wf-vn-del" data-del="${_esc(node.id)}">×</button>`}
        </div>
        <div class="wf-vn-ports">
          <div class="wf-vn-in">${inPorts}</div>
          <div class="wf-vn-out">${outPorts}</div>
        </div>
      </div>`;
    }).join('');

    const capOpts = caps.map(c => `<option value="${_esc(c.type)}">${_esc(c.label)} (${_esc(c.type)})</option>`).join('');

    document.getElementById('wf-detail-pane').innerHTML = `
      <div class="wf-detail-head">
        <div>
          <div class="wf-detail-title">${_esc(w.name)} ${isBuiltin ? '<span class="wf-badge wf-badge-builtin">内置</span>' : ''}</div>
          <div class="wf-detail-meta">id: <code>${_esc(w.id)}</code> · ${g.nodes.length} 节点 · ${g.edges.length} 连线</div>
        </div>
        <div class="wf-detail-actions">
          <button class="btn-sm" onclick="wfToggleVisual()">← JSON 视图</button>
          ${isBuiltin
            ? '<button class="btn-sm" onclick="wfClone()">克隆为自定义</button>'
            : '<button class="btn-primary" onclick="wfSaveVisual()">保存</button>'}
        </div>
      </div>
      <div class="wf-vtb">
        ${isBuiltin ? '' : `<select id="wf-vtb-sel" class="wf-vtb-sel">${capOpts}</select>
          <button class="btn-sm" onclick="wfVAddNode()">+ 添加节点</button>`}
        <button class="btn-sm" onclick="wfVAutoLayout()">自动排列</button>
        <button class="btn-sm" onclick="wfVFit()">适应视图</button>
        <span class="wf-vtb-hint">拖动头部移动节点 · 拖输出端口连线到输入端口 · 点连线删除</span>
      </div>
      <div class="wf-vcvs-wrap"><div class="wf-vcvs" id="wf-vcvs">
        <div class="wf-vcvs-inner" id="wf-vcvs-inner">
          <svg class="wf-vcvs-svg" id="wf-vcvs-svg" xmlns="http://www.w3.org/2000/svg"></svg>
          ${nodesHtml}
        </div>
      </div></div>`;

    const cvs = document.getElementById('wf-vcvs');
    if (cvs) {
      cvs.addEventListener('mousemove', _vMouseMove);
      cvs.addEventListener('mouseup', _vMouseUp);
      cvs.addEventListener('mouseleave', _vMouseUp);
    }
    const inner = document.getElementById('wf-vcvs-inner');
    if (inner) {
      inner.addEventListener('mousedown', _vMouseDown);
    }
    requestAnimationFrame(() => { _vRedrawEdges(); _vMarkPorts(); });
  }

  // ── Port geometry ──

  function _vPortCenter(nid, port, dir) {
    const inner = document.getElementById('wf-vcvs-inner');
    if (!inner) return null;
    const dot = inner.querySelector(`.wf-vpd[data-nid="${nid}"][data-port="${port}"][data-dir="${dir}"]`);
    if (!dot) return null;
    const dr = dot.getBoundingClientRect();
    const ir = inner.getBoundingClientRect();
    return { x: dr.left - ir.left + dr.width / 2, y: dr.top - ir.top + dr.height / 2 };
  }

  function _vEdgePath(x1, y1, x2, y2) {
    const cx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
  }

  function _vRedrawEdges() {
    const svg = document.getElementById('wf-vcvs-svg');
    if (!svg) return;
    let html = '';
    for (const e of _wfState.graph.edges) {
      const f = _vPortCenter(e.fromNode, e.fromPort, 'out');
      const t = _vPortCenter(e.toNode, e.toPort, 'in');
      if (!f || !t) continue;
      const sel = _wfState._selEdge === e.id ? ' wf-ve-sel' : '';
      html += `<path class="wf-vedge${sel}" d="${_vEdgePath(f.x, f.y, t.x, t.y)}" data-eid="${_esc(e.id)}"/>`;
    }
    if (_wfState._conn) {
      const c = _wfState._conn;
      const d = c.dir === 'out' ? _vEdgePath(c.sx, c.sy, c.cx, c.cy) : _vEdgePath(c.cx, c.cy, c.sx, c.sy);
      html += `<path class="wf-vedge-tmp" d="${d}"/>`;
    }
    svg.innerHTML = html;
    // Edge click to delete
    svg.querySelectorAll('.wf-vedge').forEach(p => {
      p.addEventListener('click', () => {
        const eid = p.dataset.eid;
        if (eid && confirm('删除这条连线？')) {
          _wfState.graph.edges = _wfState.graph.edges.filter(e => e.id !== eid);
          _wfState._selEdge = null;
          _vRedrawEdges(); _vMarkPorts();
        }
      });
    });
  }

  function _vMarkPorts() {
    const inner = document.getElementById('wf-vcvs-inner');
    if (!inner) return;
    const conn = new Set();
    for (const e of _wfState.graph.edges) {
      conn.add(`${e.fromNode}:${e.fromPort}:out`);
      conn.add(`${e.toNode}:${e.toPort}:in`);
    }
    inner.querySelectorAll('.wf-vpd').forEach(d => {
      d.classList.toggle('wf-pd-conn', conn.has(`${d.dataset.nid}:${d.dataset.port}:${d.dataset.dir}`));
    });
  }

  // ── Unified mousedown on inner ──

  function _vMouseDown(e) {
    const drag = e.target.closest('[data-drag]');
    const dot = e.target.closest('.wf-vpd');
    const del = e.target.closest('[data-del]');
    if (del) {
      const nid = del.dataset.del;
      if (confirm('删除节点 ' + nid + '？')) {
        _wfState.graph.nodes = _wfState.graph.nodes.filter(n => n.id !== nid);
        _wfState.graph.edges = _wfState.graph.edges.filter(e => e.fromNode !== nid && e.toNode !== nid);
        if (_wfState._selNode === nid) _wfState._selNode = null;
        _renderVisualEditor();
      }
      e.preventDefault(); return;
    }
    if (dot) {
      const nid = dot.dataset.nid, port = dot.dataset.port, dir = dot.dataset.dir;
      const pos = _vPortCenter(nid, port, dir);
      if (pos) _wfState._conn = { nid, port, dir, sx: pos.x, sy: pos.y, cx: pos.x, cy: pos.y };
      e.preventDefault(); return;
    }
    if (drag) {
      const nid = drag.dataset.drag;
      const node = _wfState.graph.nodes.find(n => n.id === nid);
      if (!node) return;
      const inner = document.getElementById('wf-vcvs-inner');
      const ir = inner.getBoundingClientRect();
      _wfState._drag = { nid, ox: e.clientX - ir.left - node.x, oy: e.clientY - ir.top - node.y };
      _wfState._selNode = nid;
      document.querySelectorAll('.wf-vnode').forEach(el => el.classList.toggle('wf-vn-sel', el.dataset.nid === nid));
      e.preventDefault(); return;
    }
  }

  function _vMouseMove(e) {
    const inner = document.getElementById('wf-vcvs-inner');
    if (!inner) return;
    const ir = inner.getBoundingClientRect();
    const mx = e.clientX - ir.left, my = e.clientY - ir.top;
    if (_wfState._drag) {
      const d = _wfState._drag;
      const node = _wfState.graph.nodes.find(n => n.id === d.nid);
      if (node) {
        node.x = Math.max(0, mx - d.ox);
        node.y = Math.max(0, my - d.oy);
        const el = document.getElementById('wf-vn-' + d.nid);
        if (el) { el.style.left = node.x + 'px'; el.style.top = node.y + 'px'; }
        _vRedrawEdges();
      }
    }
    if (_wfState._conn) {
      _wfState._conn.cx = mx; _wfState._conn.cy = my;
      _vRedrawEdges();
    }
  }

  function _vMouseUp(e) {
    _wfState._drag = null;
    if (_wfState._conn) {
      const c = _wfState._conn;
      _wfState._conn = null;
      const inner = document.getElementById('wf-vcvs-inner');
      if (inner) {
        const dots = inner.querySelectorAll('.wf-vpd');
        for (const dot of dots) {
          const dr = dot.getBoundingClientRect();
          if (e.clientX >= dr.left && e.clientX <= dr.right && e.clientY >= dr.top && e.clientY <= dr.bottom) {
            const tDir = dot.dataset.dir, tNid = dot.dataset.nid, tPort = dot.dataset.port;
            if (tDir !== c.dir && tNid !== c.nid) {
              const fromNode = c.dir === 'out' ? c.nid : tNid;
              const fromPort = c.dir === 'out' ? c.port : tPort;
              const toNode = c.dir === 'in' ? c.nid : tNid;
              const toPort = c.dir === 'in' ? c.port : tPort;
              const eid = `${fromNode}.${fromPort}->${toNode}.${toPort}`;
              _wfState.graph.edges = _wfState.graph.edges.filter(e => !(e.toNode === toNode && e.toPort === toPort) && e.id !== eid);
              _wfState.graph.edges.push({ id: eid, fromNode, fromPort, toNode, toPort });
            }
            break;
          }
        }
      }
      _vRedrawEdges(); _vMarkPorts();
    }
  }

  // ── Toolbar actions ──

  window.wfVAddNode = function () {
    const sel = document.getElementById('wf-vtb-sel');
    const type = sel?.value; if (!type) return;
    const cap = _wfState.capabilities.find(c => c.type === type); if (!cap) return;
    const id = type.replace(/[^a-z0-9]/g, '_') + '_' + Date.now().toString(36).slice(-4);
    const g = _wfState.graph;
    const maxX = g.nodes.reduce((m, n) => Math.max(m, n.x), 50);
    g.nodes.push({ id, type, params: {}, x: maxX + 280, y: 60 });
    _renderVisualEditor();
  };

  window.wfVAutoLayout = function () {
    const g = _wfState.graph;
    if (!g.nodes.length) return;
    const inDeg = {}, adj = {};
    g.nodes.forEach(n => { inDeg[n.id] = 0; adj[n.id] = []; });
    g.edges.forEach(e => { inDeg[e.toNode]++; if (adj[e.fromNode]) adj[e.fromNode].push(e.toNode); });
    const queue = g.nodes.filter(n => inDeg[n.id] === 0).map(n => n.id);
    const levels = {};
    while (queue.length) {
      const nid = queue.shift();
      if (levels[nid] == null) levels[nid] = 0;
      (adj[nid] || []).forEach(c => {
        levels[c] = Math.max(levels[c] || 0, levels[nid] + 1);
        inDeg[c]--;
        if (inDeg[c] === 0) queue.push(c);
      });
    }
    const colNodes = {};
    g.nodes.forEach(n => { const lv = levels[n.id] || 0; (colNodes[lv] = colNodes[lv] || []).push(n.id); });
    Object.entries(colNodes).forEach(([lv, nids]) => {
      nids.forEach((nid, idx) => {
        const node = g.nodes.find(n => n.id === nid);
        if (node) { node.x = 80 + Number(lv) * 280; node.y = 60 + idx * 200; }
      });
    });
    _renderVisualEditor();
  };

  window.wfVFit = function () {
    const g = _wfState.graph;
    const cvs = document.getElementById('wf-vcvs');
    if (!cvs || !g.nodes.length) return;
    cvs.scrollTo({ left: Math.max(0, Math.min(...g.nodes.map(n => n.x)) - 60), top: Math.max(0, Math.min(...g.nodes.map(n => n.y)) - 40), behavior: 'smooth' });
  };

  // ── Toggle + Save ──

  window.wfToggleVisual = function () {
    const w = _wfState.currentWorkflow;
    if (!w) return;
    if (!_wfState.visualMode) {
      _wfState.visualMode = true;
      _wfState.graph = _wfToGraph(w);
      _renderVisualEditor();
    } else {
      _wfState.visualMode = false;
      _wfState.isEditing = false;
      _renderDetail();
    }
  };

  window.wfSaveVisual = async function () {
    const w = _wfState.currentWorkflow;
    if (!w) return;
    const updated = _graphToWf(_wfState.graph, w);
    try {
      await _api('/api/workflows/' + encodeURIComponent(updated.id), { method: 'PUT', body: JSON.stringify(updated) });
      _toast('保存成功');
      _wfState.currentWorkflow = updated;
      _wfState.graph = _wfToGraph(updated);
      document.querySelector('.wf-detail-meta').textContent = `id: ${updated.id} · ${_wfState.graph.nodes.length} 节点 · ${_wfState.graph.edges.length} 连线`;
    } catch (e) { _toast('保存失败：' + e.message, false); }
  };

  // ── 在普通 JSON 视图里加"可视化"按钮：监听 wfOpenWorkflow 后注入 ──
  const _wfOpenOrig = window.wfOpenWorkflow;
  window.wfOpenWorkflow = async function (id) {
    _wfState.visualMode = false;
    await _wfOpenOrig(id);
    // 在 actions 区注入可视化按钮
    const actions = document.querySelector('#wf-detail-pane .wf-detail-actions');
    if (actions && !actions.querySelector('.wf-vis-btn')) {
      const btn = document.createElement('button');
      btn.className = 'btn-sm wf-vis-btn';
      btn.textContent = '可视化编辑';
      btn.onclick = wfToggleVisual;
      actions.prepend(btn);
    }
  };

  // ─── 自动加载（panel 第一次激活时）───
  document.addEventListener('click', (e) => {
    const tab = e.target?.closest?.('.nav-item[data-tab="workflows"]');
    if (tab && _wfState.workflows.length === 0) {
      setTimeout(() => wfRefreshAll(), 50);
    }
  });
})();
