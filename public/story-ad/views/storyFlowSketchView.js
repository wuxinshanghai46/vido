import { request } from '../api.js?v=20260901-production-v365';
import { emptyState, escapeHtml, mediaPreview, setButtonBusy, toast } from '../components/ui.js?v=20260901-production-v365';

function personChecks(unit = {}, people = []) {
  const selected = new Set(Array.isArray(unit.character_ids) ? unit.character_ids : []);
  if (!people.length) return '<span class="flow-empty-binding">本任务没有人物资产</span>';
  return people.map(person => `<label class="flow-binding-check"><input type="checkbox" data-flow-character value="${escapeHtml(person.character_id)}" ${selected.has(person.character_id) ? 'checked' : ''}><span><b>${escapeHtml(person.name || person.character_id)}</b><small>${escapeHtml(person.character_id)} · r${Number(person.person_revision || 0)}</small></span></label>`).join('');
}

function sceneOptions(unit = {}, scenes = []) {
  return `<option value="">请选择场景</option>${scenes.map(scene => `<option value="${escapeHtml(scene.scene_id)}" ${scene.scene_id === unit.scene_id ? 'selected' : ''}>${escapeHtml(scene.name || scene.scene_id)} · r${Number(scene.scene_revision || 1)}</option>`).join('')}`;
}

function flowCard(unit = {}, contract = {}) {
  return `<article class="card flow-contract-card" data-flow-beat="${escapeHtml(unit.beat_id)}">
    <header><span class="flow-beat-index">B${String(unit.beat_index || 0).padStart(2, '0')}</span><div><h2>${escapeHtml(unit.title || `剧情节点 ${unit.beat_index}`)}</h2><p>${escapeHtml(unit.plot || '')}</p></div></header>
    <div class="flow-state-row"><div><small>起始状态</small><p>${escapeHtml(unit.state_before || '承接上一剧情节点')}</p></div><i>→</i><div><small>动作过程</small><p>${escapeHtml(unit.action || unit.plot || '按剧情推进')}</p></div><i>→</i><div><small>结束状态</small><p>${escapeHtml(unit.state_after || '进入下一剧情节点')}</p></div></div>
    <div class="flow-binding-grid"><fieldset><legend>固定人物</legend>${personChecks(unit, contract.people || [])}</fieldset><label><span>固定场景</span><select data-flow-scene>${sceneOptions(unit, contract.scenes || [])}</select><small>后续 Shot List、黑白分镜、关键帧和视频只能使用这里确认的场景。</small></label></div>
  </article>`;
}

function historicalMarkup(rows = []) {
  if (!rows.length) return '';
  return `<details class="card legacy-flow-artifacts" data-legacy-flow-artifacts><summary>历史流向图片（${rows.length}，只读且不参与任何生成）</summary><p>这些是旧版本产物，仅供追溯。新流程不会读取图片地址，也不会把它们传给分镜或视频模型。</p><div class="legacy-flow-grid">${rows.map((row, index) => `<div>${mediaPreview(row, { label: `历史流向 ${index + 1}`, width: 320, symbol: '历史' })}</div>`).join('')}</div></details>`;
}

function collectUnits(host, contract) {
  return (contract.units || []).map(unit => {
    const card = host.querySelector(`[data-flow-beat="${CSS.escape(unit.beat_id)}"]`);
    return {
      beat_id: unit.beat_id,
      character_ids: [...(card?.querySelectorAll('[data-flow-character]:checked') || [])].map(input => input.value),
      scene_id: card?.querySelector('[data-flow-scene]')?.value || '',
      look_bindings: unit.look_bindings || {},
    };
  });
}

export async function mount(host, context) {
  const { bundle, store } = context;
  const projectId = bundle.project.id;
  let payload;
  try {
    payload = await request(`/api/story-ad/projects/${encodeURIComponent(projectId)}/story-flow`);
  } catch (error) {
    host.innerHTML = `<section class="workspace-page"><div class="card">${emptyState({ title: '剧情流向暂不可用', body: error.message })}</div></section>`;
    return () => {};
  }
  const contract = payload.contract || { units: [], people: [], scenes: [] };
  const historical = bundle?.story_flow?.historical_sketches || [];
  host.innerHTML = `<section class="workspace-page flow-contract-page">
    <div class="page-heading flow-contract-heading"><div><h1>剧情流向确认</h1><p>确认每个剧情节点的状态变化，以及它使用的固定人物和固定场景。这里不生成图片。</p></div><div class="flow-zero-cost"><b>零模型调用</b><span>不产生图片费用</span></div></div>
    <div class="guide flow-contract-guide" role="status"><b>${payload.gate?.ready ? '当前绑定已确认' : '确认后进入人物场景分镜'}</b><span>第 6 步会先生成 Shot List，再用这些权威 ID 生成黑白人物场景分镜。任何缺失绑定都会在调用图片模型前阻断。</span></div>
    ${contract.units?.length ? `<div class="flow-contract-list">${contract.units.map(unit => flowCard(unit, contract)).join('')}</div>` : `<div class="card">${emptyState({ title: '还没有剧情节点', body: '请先完成剧情与对白。' })}</div>`}
    ${historicalMarkup(historical)}
    ${contract.units?.length ? `<div class="flow-confirm-bar"><span>共 ${contract.units.length} 个剧情节点 · ${contract.people?.length || 0} 个人物 · ${contract.scenes?.length || 0} 个场景</span><button class="btn primary" type="button" data-confirm-flow-contract>${payload.gate?.ready ? '重新确认并进入第 6 步' : '确认绑定并进入第 6 步'}</button></div>` : ''}
  </section>`;

  host.querySelector('[data-confirm-flow-contract]')?.addEventListener('click', async event => {
    const units = collectUnits(host, contract);
    const missing = units.filter(unit => contract.scenes?.length && !unit.scene_id);
    if (missing.length) return toast(`还有 ${missing.length} 个剧情节点没有选择场景。`, 'warning');
    setButtonBusy(event.currentTarget, true, '正在确认…');
    try {
      const result = await request(`/api/story-ad/projects/${encodeURIComponent(projectId)}/story-flow/confirm`, { method: 'POST', body: { units } });
      if (Number(result.model_call_count || 0) !== 0) throw new Error('零费用合同出现异常模型调用，已停止进入下一步。');
      await store.refreshSections('summary,assets,story,shots');
      context.navigate(`/story-ad/projects/${encodeURIComponent(projectId)}?view=storyboard`);
    } catch (error) {
      setButtonBusy(event.currentTarget, false);
      toast(error.message, 'danger');
    }
  });
  return () => {};
}
