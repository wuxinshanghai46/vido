const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const view = ['finalSoundDesignView.js', 'soundDesignFeature.js'].map(file => fs.readFileSync(path.join(root, 'public/story-ad/views', file), 'utf8')).join('\n');
const css = fs.readFileSync(path.join(root, 'public/story-ad/workspace-ux.css'), 'utf8');
const avatar = fs.readFileSync(path.join(root, 'src/routes/avatar.js'), 'utf8');
const tts = fs.readFileSync(path.join(root, 'src/services/ttsService.js'), 'utf8');

assert(view.includes('data-voice-library-query'), '音色弹窗必须支持搜索');
assert(view.includes("/api/avatar/voice-list?scope=story"), '剧情声音页必须使用不等待数字人供应商的快速音色目录');
assert(view.includes('data-voice-library-provider'), '音色弹窗必须支持供应商筛选');
assert(view.includes('data-preview-library-voice') && view.includes('data-choose-library-voice'), '试听和选择必须在弹窗内');
assert(view.includes('data-voice-select') && view.includes('hidden'), '必须保留原声音方案字段，避免破坏保存合同');
assert(!view.includes('data-preview-selected-voice'), '禁止恢复主表单旁的试听按钮');
assert(view.includes('volcengine-tts|字节豆包语音') && view.includes('voice.has_volc === true'), '剧情声音库必须只保留字节豆包 TTS 2.0 与已就绪的字节复刻音色');
assert(!view.includes('return /aliyun-tts|阿里百炼|cosyvoice/.test(provider)'), '剧情声音库不得恢复阿里 TTS 旧合同');
assert(css.includes('.voice-picker-trigger') && css.includes('.voice-library-item.is-selected'));
assert(css.includes('.voice-settings-grid label{align-content:start}') && css.includes('.voice-settings-grid select{height:58px;min-height:58px}'), '音色按钮和字幕选择框必须固定等高且禁止网格拉伸');
assert(view.includes('voice-library-provider-select') && css.includes('.voice-library-provider-select'), '供应商筛选必须使用工作台主题样式，禁止裸原生灰色控件');
assert(css.includes('color-scheme:inherit') && css.includes(':root[data-theme="light"] .voice-library-dialog'), '音色弹窗和供应商下拉必须继承平台主题并显式支持浅色主题');
assert(!css.includes('cursor:pointer;color-scheme:dark'), '音色供应商下拉不得写死深色系统控件');
assert(tts.includes('strictProvider') && tts.includes("item.id === selectedProvider"), '显式试听必须锁定所选供应商');
assert(avatar.includes('providerId: providerKey') && avatar.includes("err.code === 'TTS_PROVIDER_BILLING'"), '试听接口必须传递供应商并返回真实账户错误');
assert(avatar.includes("req.query.scope") && avatar.includes("scope: storyScope ? 'story' : 'all'"), '剧情音色目录必须保留快速 scope 合同');
assert(!avatar.includes('await hifly.listVoices') && !avatar.includes('await topview.listVoices'), '统一音色目录不得再拉取非字节 TTS 音色');
assert(view.includes("error.code === 'TTS_PROVIDER_BILLING'") && view.includes('story-ad-blocked-voice-providers'), '供应商级合成失败后必须停止展示该服务的全部音色，禁止逐个重复报错');
console.log('story-ad voice library v351 checks passed');
