import { escapeHtml } from '../components/ui.js?v=20260828-production-v246';

/** 在画布侧栏编辑权威剧情/分镜，不使用图投影中的截断摘要回写。 */
export function inlineNodeEditor(node = {}, bundle = {}) {
  if (node.type === 'story') {
    const blueprint = bundle.story?.blueprint || {};
    const beats = Array.isArray(blueprint.beats) ? blueprint.beats : [];
    return `<form class="node-inline-editor" data-node-inline-editor="story">
      <label class="field"><span>剧情名称</span><input class="input" name="story_title" value="${escapeHtml(blueprint.story_title || blueprint.title || '')}"></label>
      <label class="field"><span>故事概述</span><textarea class="textarea" name="logline" rows="3">${escapeHtml(blueprint.logline || blueprint.summary || '')}</textarea></label>
      <div class="node-inline-beats">${beats.map((beat, index) => `<fieldset data-inline-beat="${index}"><legend>情节 ${index + 1}</legend>
        <label class="field"><span>名称</span><input class="input" name="beat_title_${index}" value="${escapeHtml(beat.title || beat.role || '')}"></label>
        <label class="field"><span>画面</span><textarea class="textarea" name="beat_visual_${index}" rows="2">${escapeHtml(beat.visual || beat.story_visual || beat.plot || '')}</textarea></label>
        <label class="field"><span>动作</span><textarea class="textarea" name="beat_action_${index}" rows="2">${escapeHtml(beat.action || beat.character_action || '')}</textarea></label>
        <label class="field"><span>旁白 / 台词</span><textarea class="textarea" name="beat_voiceover_${index}" rows="2">${escapeHtml(beat.spoken_line || beat.voiceover || '')}</textarea></label>
      </fieldset>`).join('')}</div>
      <div class="node-inline-actions"><button class="btn" type="button" data-cancel-node-inline>取消</button><button class="btn primary" type="submit" data-save-node-inline>保存剧情</button></div>
    </form>`;
  }
  if (node.type !== 'shot') return '';
  const shots = Array.isArray(bundle.storyboard?.shots) ? bundle.storyboard.shots : [];
  const wantedIndex = Number(node.detail?.shot_index || node.detail?.index || 0);
  const shot = shots.find((item, index) => Number(item.shot_index || item.index || index + 1) === wantedIndex)
    || shots.find(item => String(item.id || item.shot_id || '') === String(node.detail?.shot_id || ''));
  if (!shot) return '';
  const shotIndex = Number(shot.shot_index || shot.index || wantedIndex) || 1;
  return `<form class="node-inline-editor" data-node-inline-editor="shot" data-inline-shot-index="${shotIndex}">
    <label class="field"><span>分镜名称</span><input class="input" name="title" value="${escapeHtml(shot.title || '')}"></label>
    <label class="field"><span>时长（秒）</span><input class="input" name="duration" type="number" min="1" max="15" value="${Number(shot.duration || shot.duration_sec || 3) || 3}"></label>
    <label class="field"><span>画面内容</span><textarea class="textarea" name="visual" rows="3">${escapeHtml(shot.visual || shot.visual_description || '')}</textarea></label>
    <label class="field"><span>人物 / 商品动作</span><textarea class="textarea" name="action" rows="2">${escapeHtml(shot.action || shot.visual_action || '')}</textarea></label>
    <label class="field"><span>旁白 / 台词</span><textarea class="textarea" name="voiceover" rows="2">${escapeHtml(shot.voiceover || shot.narration || '')}</textarea></label>
    <div class="node-inline-actions"><button class="btn" type="button" data-cancel-node-inline>取消</button><button class="btn primary" type="submit" data-save-node-inline>保存分镜</button></div>
  </form>`;
}

export async function saveInlineNode(form, bundle = {}, store) {
  const formData = new FormData(form);
  if (form.dataset.nodeInlineEditor === 'story') {
    const current = bundle.story?.blueprint || {};
    const beats = (Array.isArray(current.beats) ? current.beats : []).map((beat, index) => {
      const visual = String(formData.get(`beat_visual_${index}`) || '').trim();
      const action = String(formData.get(`beat_action_${index}`) || '').trim();
      const voiceover = String(formData.get(`beat_voiceover_${index}`) || '').trim();
      return { ...beat, title: String(formData.get(`beat_title_${index}`) || '').trim() || beat.title, visual, story_visual: visual, plot: visual || action, action, spoken_line: voiceover, voiceover };
    });
    await store.saveBlueprint({ ...current, story_title: String(formData.get('story_title') || '').trim() || current.story_title, logline: String(formData.get('logline') || '').trim(), beats });
    return { kind: 'story' };
  }
  const shots = Array.isArray(bundle.storyboard?.shots) ? bundle.storyboard.shots : [];
  const wanted = Number(form.dataset.inlineShotIndex);
  const sourceIndex = shots.findIndex((shot, index) => Number(shot.shot_index || shot.index || index + 1) === wanted);
  if (sourceIndex < 0) throw new Error('该分镜已变更，请刷新后再编辑。');
  const next = shots.map((shot, index) => {
    if (index !== sourceIndex) return shot;
    const visual = String(formData.get('visual') || '').trim();
    const action = String(formData.get('action') || '').trim();
    const voiceover = String(formData.get('voiceover') || '').trim();
    const duration = Math.max(1, Math.min(15, Number(formData.get('duration')) || 3));
    return { ...shot, title: String(formData.get('title') || '').trim() || shot.title, duration, duration_sec: duration, visual, visual_description: visual, action, visual_action: action, voiceover, narration: voiceover, _nsa_user_edited_fields: { ...(shot._nsa_user_edited_fields || {}), title: true, duration: true, visual: true, action: true, voiceover: true } };
  });
  await store.saveStoryboard(next);
  return { kind: 'shot', shotIndex: wanted };
}
