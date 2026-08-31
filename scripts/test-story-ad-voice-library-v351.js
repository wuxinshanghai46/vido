const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const view = fs.readFileSync(path.join(root, 'public/story-ad/views/finalSoundDesignView.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/story-ad/workspace-ux.css'), 'utf8');
const avatar = fs.readFileSync(path.join(root, 'src/routes/avatar.js'), 'utf8');
const tts = fs.readFileSync(path.join(root, 'src/services/ttsService.js'), 'utf8');

assert(view.includes('data-voice-library-query'), '音色弹窗必须支持搜索');
assert(view.includes('data-voice-library-provider'), '音色弹窗必须支持供应商筛选');
assert(view.includes('data-preview-library-voice') && view.includes('data-choose-library-voice'), '试听和选择必须在弹窗内');
assert(view.includes('data-voice-select') && view.includes('hidden'), '必须保留原声音方案字段，避免破坏保存合同');
assert(!view.includes('data-preview-selected-voice'), '禁止恢复主表单旁的试听按钮');
assert(css.includes('.voice-picker-trigger') && css.includes('.voice-library-item.is-selected'));
assert(tts.includes('strictProvider') && tts.includes("item.id === selectedProvider"), '显式试听必须锁定所选供应商');
assert(avatar.includes('providerId: providerKey') && avatar.includes("err.code === 'TTS_PROVIDER_BILLING'"), '试听接口必须传递供应商并返回真实账户错误');
console.log('story-ad voice library v351 checks passed');
