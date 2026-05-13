/**
 * VIDO Workflow Engine — JSON 驱动的可配置 AI 工作流执行引擎
 *
 * 设计理念：
 *   - 每个工作流是一份 JSON（inputs + steps + outputs）
 *   - steps 是一组节点调用，按顺序执行
 *   - 节点能力（capability）由 workflowCapabilities.js 注册
 *   - 变量替换：$inputName / $stepId.fieldName / $stepId（整对象）
 *   - 控制流：loop（数组循环）/ branch（条件分支）
 *   - 失败可降级：每个 step 可配 fallback 节点链
 *   - 持久化运行历史到 outputs/workflow_runs/
 *
 * 工作流 JSON 结构：
 *   {
 *     "id": "product-swap",
 *     "name": "场景产品替换",
 *     "version": 1,
 *     "inputs": [{"name":"scene","type":"image","required":true}],
 *     "steps": [
 *       {"id":"cut","type":"cutout","model":"rmbg-2","params":{"image":"$scene"}}
 *     ],
 *     "outputs": [{"name":"result","from":"$cut.outputUrl"}]
 *   }
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './outputs');
const WORKFLOWS_DIR = path.join(OUTPUT_DIR, 'workflows');
const RUNS_DIR = path.join(OUTPUT_DIR, 'workflow_runs');
const BUILTIN_DIR = path.join(__dirname, '..', '..', 'config', 'workflows-builtin');

[WORKFLOWS_DIR, RUNS_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ─── 节点能力注册表 ───
const CAPABILITIES = new Map();

function registerCapability(type, spec) {
  if (!type || typeof spec?.run !== 'function') {
    throw new Error('registerCapability: type + spec.run 必填');
  }
  CAPABILITIES.set(type, {
    type,
    label: spec.label || type,
    description: spec.description || '',
    inputs: spec.inputs || [],   // [{name, type, required, default, desc}]
    outputs: spec.outputs || [], // [{name, type, desc}]
    run: spec.run,               // async (params, ctx) => { ...outputs }
  });
}

function getCapabilities() {
  return Array.from(CAPABILITIES.values()).map(c => ({
    type: c.type, label: c.label, description: c.description,
    inputs: c.inputs, outputs: c.outputs,
  }));
}

function getCapability(type) {
  return CAPABILITIES.get(type) || null;
}

// ─── 工作流文件 IO ───
function _slug(s) { return String(s || '').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80); }

function listWorkflows({ userId } = {}) {
  const builtin = _readDir(BUILTIN_DIR).map(f => ({ ..._readJson(path.join(BUILTIN_DIR, f)), _builtin: true, _file: f }));
  const userFiles = _readDir(WORKFLOWS_DIR);
  const userOnes = userFiles.map(f => ({ ..._readJson(path.join(WORKFLOWS_DIR, f)), _builtin: false, _file: f }));
  let all = [...builtin, ...userOnes].filter(Boolean);
  if (userId) {
    // 内置全部可见；用户自定义按 owner 过滤；无 owner 视为公共
    all = all.filter(w => w._builtin || !w.owner || w.owner === userId);
  }
  return all;
}

function _readDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.json'));
}

function _readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function getWorkflow(id) {
  if (!id) return null;
  // 优先 builtin
  const bp = path.join(BUILTIN_DIR, _slug(id) + '.json');
  if (fs.existsSync(bp)) {
    const wf = _readJson(bp);
    if (wf) return { ...wf, _builtin: true, _file: path.basename(bp) };
  }
  // 然后 user
  const up = path.join(WORKFLOWS_DIR, _slug(id) + '.json');
  if (fs.existsSync(up)) {
    const wf = _readJson(up);
    if (wf) return { ...wf, _builtin: false, _file: path.basename(up) };
  }
  return null;
}

function saveWorkflow(workflow, { userId } = {}) {
  if (!workflow?.id) throw new Error('workflow.id 必填');
  if (!workflow?.name) throw new Error('workflow.name 必填');
  const id = _slug(workflow.id);
  const filePath = path.join(WORKFLOWS_DIR, id + '.json');
  const payload = {
    ...workflow,
    id,
    owner: userId || workflow.owner || null,
    updated_at: new Date().toISOString(),
    created_at: workflow.created_at || new Date().toISOString(),
  };
  delete payload._builtin; delete payload._file;
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return { ...payload, _builtin: false, _file: path.basename(filePath) };
}

function deleteWorkflow(id) {
  const safe = _slug(id);
  const filePath = path.join(WORKFLOWS_DIR, safe + '.json');
  if (!fs.existsSync(filePath)) return false;
  // 内置不允许删
  const bp = path.join(BUILTIN_DIR, safe + '.json');
  if (fs.existsSync(bp)) throw new Error('内置工作流不允许删除');
  fs.unlinkSync(filePath);
  return true;
}

// ─── 变量替换 ───
//   "$varName"             → ctx[varName] 整对象
//   "$varName.field"       → ctx.varName.field 嵌套
//   "$varName.field[0]"    → 数组索引
//   "{{varName}} hello"    → 字符串模板（变量内嵌字符串）
function resolveValue(value, ctx) {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(v => resolveValue(v, ctx));
  if (typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = resolveValue(value[k], ctx);
    return out;
  }
  if (typeof value !== 'string') return value;

  // 整字段替换： "$x" 或 "$x.y" 或 "$x.y[0]"
  const fullMatch = value.match(/^\$([a-zA-Z_][\w]*)((?:\.[a-zA-Z_][\w]*|\[\d+\])*)$/);
  if (fullMatch) {
    return _accessPath(ctx, fullMatch[1], fullMatch[2]);
  }
  // 字符串内嵌模板 {{x}} / {{x.y}}
  return value.replace(/\{\{\s*([a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*|\[\d+\])*)\s*\}\}/g, (_, expr) => {
    const segs = expr.split(/(\[\d+\]|\.)/).filter(s => s && s !== '.');
    const root = segs.shift();
    const tail = segs.join('');
    const v = _accessPath(ctx, root, tail);
    return v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
  });
}

function _accessPath(ctx, root, tail) {
  let cur = ctx?.[root];
  if (cur == null || !tail) return cur;
  const re = /\.([a-zA-Z_][\w]*)|\[(\d+)\]/g;
  let m;
  while ((m = re.exec(tail)) !== null) {
    if (cur == null) return undefined;
    if (m[1]) cur = cur[m[1]];
    else if (m[2] != null) cur = cur[Number(m[2])];
  }
  return cur;
}

// ─── 运行引擎 ───
async function runWorkflow(workflow, inputs, options = {}) {
  if (!workflow) throw new Error('workflow 不能为空');
  const runId = `wfr_${Date.now()}_${uuidv4().slice(0, 8)}`;
  const startedAt = new Date().toISOString();

  // 校验 inputs
  const ctx = { ...(workflow.constants || {}) };
  for (const inputDef of (workflow.inputs || [])) {
    const v = inputs?.[inputDef.name];
    if (inputDef.required && (v == null || v === '')) {
      throw new Error(`缺少必填输入: ${inputDef.name}`);
    }
    ctx[inputDef.name] = v != null ? v : (inputDef.default ?? null);
  }

  const runRecord = {
    runId,
    workflowId: workflow.id,
    workflowName: workflow.name,
    workflowVersion: workflow.version || 1,
    status: 'running',
    startedAt,
    inputs: { ...inputs },
    stepLogs: [],
    error: null,
    outputs: null,
    endedAt: null,
    durationMs: null,
  };
  _persistRun(runRecord);

  const onProgress = options.onProgress || (() => {});

  try {
    await _runSteps(workflow.steps || [], ctx, runRecord, onProgress);

    // 收集 outputs
    const outputs = {};
    for (const o of (workflow.outputs || [])) {
      outputs[o.name] = resolveValue(o.from, ctx);
    }
    runRecord.outputs = outputs;
    runRecord.status = 'succeeded';
  } catch (err) {
    runRecord.status = 'failed';
    runRecord.error = String(err?.message || err);
    console.error('[WorkflowEngine] run 失败:', runRecord.error);
  } finally {
    runRecord.endedAt = new Date().toISOString();
    runRecord.durationMs = Date.parse(runRecord.endedAt) - Date.parse(runRecord.startedAt);
    _persistRun(runRecord);
  }
  return runRecord;
}

async function _runSteps(steps, ctx, runRecord, onProgress) {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step?.id) throw new Error(`步骤 #${i} 缺少 id`);
    if (!step.type) throw new Error(`步骤 ${step.id} 缺少 type`);

    // 条件跳过：when = "$x" 真值才跑（可选）
    if (step.when != null) {
      const cond = resolveValue(step.when, ctx);
      if (!cond) {
        runRecord.stepLogs.push({ id: step.id, type: step.type, skipped: true, reason: 'when=false' });
        continue;
      }
    }

    onProgress({ step: step.id, type: step.type, idx: i, total: steps.length });

    try {
      const result = await _runStep(step, ctx, runRecord, onProgress);
      ctx[step.id] = result;
      const stepUsage = result?._usage || null;
      if (stepUsage) {
        runRecord.totalUsage = runRecord.totalUsage || { promptTokens: 0, completionTokens: 0, costUsd: 0 };
        runRecord.totalUsage.promptTokens += stepUsage.promptTokens || 0;
        runRecord.totalUsage.completionTokens += stepUsage.completionTokens || 0;
        runRecord.totalUsage.costUsd += stepUsage.costUsd || 0;
      }
      runRecord.stepLogs.push({
        id: step.id,
        type: step.type,
        ok: true,
        outputKeys: Object.keys(result || {}).filter(k => k !== '_usage'),
        durationMs: result?._durationMs,
        usage: stepUsage,
      });
      _persistRun(runRecord);
    } catch (err) {
      const log = { id: step.id, type: step.type, ok: false, error: String(err?.message || err) };
      // fallback
      if (Array.isArray(step.fallback) && step.fallback.length) {
        log.fallback_attempted = true;
        try {
          await _runSteps(step.fallback, ctx, runRecord, onProgress);
          // fallback 成功后把最后一步的输出当作本 step 的输出
          const lastFallback = step.fallback[step.fallback.length - 1];
          if (lastFallback?.id && ctx[lastFallback.id]) ctx[step.id] = ctx[lastFallback.id];
          log.fallback_ok = true;
          runRecord.stepLogs.push(log);
          continue;
        } catch (fallbackErr) {
          log.fallback_error = String(fallbackErr?.message || fallbackErr);
        }
      }
      // 容错模式 ignoreError=true 时继续
      runRecord.stepLogs.push(log);
      if (!step.ignoreError) {
        throw new Error(`步骤 ${step.id} (${step.type}) 失败: ${log.error}`);
      }
    }
  }
}

async function _runStep(step, ctx, runRecord, onProgress) {
  // ─── 控制流节点：loop / branch ───
  if (step.type === 'loop') {
    return _runLoop(step, ctx, runRecord, onProgress);
  }
  if (step.type === 'branch') {
    return _runBranch(step, ctx, runRecord, onProgress);
  }

  // ─── 普通能力节点 ───
  const cap = getCapability(step.type);
  if (!cap) throw new Error(`未注册的节点类型: ${step.type}`);

  const params = resolveValue(step.params || {}, ctx);
  // model 字段也支持变量替换并并入 params
  if (step.model) params.model = resolveValue(step.model, ctx);

  const t0 = Date.now();
  const out = await cap.run(params, { ctx, step, runRecord });
  const result = (out && typeof out === 'object') ? { ...out } : { value: out };
  result._durationMs = Date.now() - t0;
  return result;
}

async function _runLoop(step, ctx, runRecord, onProgress) {
  const items = resolveValue(step.over, ctx);
  if (!Array.isArray(items)) throw new Error(`loop.over 不是数组（${typeof items}）`);
  const itemVar = step.as || 'item';
  const innerSteps = step.steps || [];
  const collectKey = step.collect; // 可选：每轮收集哪个 step 的哪个字段
  const collected = [];

  for (let idx = 0; idx < items.length; idx++) {
    const localCtx = { ...ctx, [itemVar]: items[idx], _index: idx };
    onProgress({ loop: step.id, index: idx, total: items.length });
    await _runSteps(innerSteps, localCtx, runRecord, onProgress);
    // 把本轮 step 的产出回写主 ctx 不安全（会被覆盖）；改为按需 collect
    if (collectKey) {
      const v = resolveValue(collectKey, localCtx);
      collected.push(v);
    } else {
      // 默认：收集最后一个内部 step 的结果
      const lastInner = innerSteps[innerSteps.length - 1];
      if (lastInner?.id) collected.push(localCtx[lastInner.id]);
    }
  }
  return { items: collected, count: collected.length };
}

async function _runBranch(step, ctx, runRecord, onProgress) {
  const cond = !!resolveValue(step.if, ctx);
  const branch = cond ? (step.then || []) : (step.else || []);
  await _runSteps(branch, ctx, runRecord, onProgress);
  // 返回最后一步的产出
  const last = branch[branch.length - 1];
  return last?.id ? (ctx[last.id] || { branch: cond }) : { branch: cond };
}

// ─── 运行历史持久化 ───
function _persistRun(record) {
  try {
    const file = path.join(RUNS_DIR, record.runId + '.json');
    fs.writeFileSync(file, JSON.stringify(record, null, 2), 'utf8');
  } catch (e) {
    console.warn('[WorkflowEngine] 持久化运行记录失败:', e.message);
  }
}

function getRun(runId) {
  const file = path.join(RUNS_DIR, _slug(runId) + '.json');
  return fs.existsSync(file) ? _readJson(file) : null;
}

function listRuns({ workflowId, limit = 50 } = {}) {
  if (!fs.existsSync(RUNS_DIR)) return [];
  const files = fs.readdirSync(RUNS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => ({ f, t: fs.statSync(path.join(RUNS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
    .slice(0, limit * 2); // 多读一些，过滤后再切
  const out = [];
  for (const { f } of files) {
    const r = _readJson(path.join(RUNS_DIR, f));
    if (!r) continue;
    if (workflowId && r.workflowId !== workflowId) continue;
    out.push({
      runId: r.runId,
      workflowId: r.workflowId,
      workflowName: r.workflowName,
      status: r.status,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      durationMs: r.durationMs,
      hasError: !!r.error,
    });
    if (out.length >= limit) break;
  }
  return out;
}

module.exports = {
  // capability
  registerCapability, getCapabilities, getCapability,
  // workflow CRUD
  listWorkflows, getWorkflow, saveWorkflow, deleteWorkflow,
  // run
  runWorkflow, getRun, listRuns,
  // util
  resolveValue,
  // dirs
  WORKFLOWS_DIR, RUNS_DIR, BUILTIN_DIR,
};
