import { request } from '../api.js?v=20260831-production-v330';
import { escapeHtml } from '../components/ui.js?v=20260831-production-v330';
import { collectBeat } from './plotBeatEditor.js?v=20260831-production-v330';

export async function openPromptPreview({ pop, row, host, projectId, place, closeAll }) {
  closeAll();
  pop.innerHTML = '<div class="beat-floating-head"><b>最终提示词</b><button type="button" data-close-beat-floating aria-label="关闭">×</button></div><div class="beat-prompt-loading">正在根据当前剧情合成实际生成提示词…</div>';
  pop.dataset.group = 'prompt_notes'; pop.showPopover(); place();
  const rows = [...host.querySelectorAll('[data-beat-index]')];
  try {
    const data = await request(`/api/new-story-ad/tasks/${encodeURIComponent(projectId)}/prompt-preview`, {
      method: 'POST', body: { shot_index: rows.indexOf(row), shot: collectBeat(row) }, timeoutMs: 60000,
    });
    pop.innerHTML = `<div class="beat-floating-head"><b>第 ${Number(data.shot_index || rows.indexOf(row) + 1)} 镜 · 最终提示词</b><button type="button" data-close-beat-floating aria-label="关闭">×</button></div><div class="beat-prompt-preview"><label><span>分镜提示词 · 关键帧实际输入</span><textarea class="textarea" readonly>${escapeHtml(data.keyframe_prompt || '')}</textarea></label><label><span>视频运动提示词 · 视频模型实际输入</span><textarea class="textarea" readonly>${escapeHtml(data.motion_prompt || '')}</textarea></label></div><div class="beat-floating-actions"><small>由当前剧情即时合成；仅查看不会生成媒体或产生模型费用。</small><button class="btn primary small" type="button" data-close-beat-floating>完成</button></div>`;
  } catch (error) {
    pop.innerHTML = `<div class="beat-floating-head"><b>最终提示词</b><button type="button" data-close-beat-floating aria-label="关闭">×</button></div><div class="beat-prompt-loading is-error">${escapeHtml(error.message)}</div>`;
  }
  place();
}
