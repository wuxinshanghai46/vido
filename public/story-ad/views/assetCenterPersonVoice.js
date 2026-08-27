import { escapeHtml } from '../components/ui.js?v=20260827-production-v233e';

export function renderPersonVoiceBinding(profile = {}) {
  const bound = Boolean(profile.voice_id);
  const name = profile.voice_binding?.display_name || (bound ? '账号授权音色' : '等待系统匹配');
  const status = bound
    ? '已按当前账号自动绑定；首次实际配音时系统会自动注册并长期复用，无需填写音色 ID。'
    : '保存人物方案或开始正式生成时，系统会从当前账号的已授权声音素材包自动匹配。';
  const direction = profile.voice_tone || '系统会根据人物身份、年龄和剧情表演自动补齐语气、节奏与停连。';
  return `<section class="person-system-voice" data-system-voice-binding><div><span>声音与对白表演</span><b>${escapeHtml(name)}</b><small>${status}</small></div><p>${escapeHtml(direction)}</p></section>`;
}
