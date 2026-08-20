const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public/story-ad/views/referenceUnderstandingView.js'), 'utf8');
const executable = source
  .replace(/^import[^;]+;\s*$/gm, '')
  .replace(/export\s+(?=(?:async\s+)?function\s+)/g, '')
  + '\n;globalThis.__mountReferenceUnderstanding = mountReferenceUnderstanding;';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

async function main() {
  const events = [];
  let clickHandler = null;
  let dialogCopy = null;
  const host = {
    innerHTML: '',
    addEventListener(type, handler) { if (type === 'click') clickHandler = handler; },
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  const document = {
    getElementById() { return null; },
    createElement() { return { id: '', rel: '', href: '' }; },
    head: { appendChild() {} },
  };
  const sandbox = {
    console,
    document,
    window: { dispatchEvent() {} },
    CustomEvent: function CustomEvent() {},
    escapeHtml,
    setButtonBusy() {},
    toast(message) { events.push(['toast', message]); },
    async confirmDialog(message, options) {
      dialogCopy = { message, options };
      events.push(['dialog']);
      return true;
    },
    async request(url, options) {
      events.push(['request', url, options]);
      return { success: true };
    },
  };
  vm.runInNewContext(executable, sandbox, { filename: 'reference-confirm-continue-ui.js' });

  const reference = {
    analysis_id: 'analysis-flow-1',
    status: 'completed',
    analysis_valid: true,
    reference_understanding: {
      analysis_id: 'analysis-flow-1',
      schema_version: 6,
      story_bible: { full_synopsis: '一个跨行业可复用的完整故事' },
      story_events: [{ id: 'event-1', action: '主体行动', evidence_refs: ['F001'] }],
      character_arcs: [],
      scene_narratives: [{ id: 'scene-1', description: '主要空间' }],
      understanding_confirmation: { ready: true, status: 'unconfirmed' },
    },
  };
  const store = {
    state: { bundle: { revisions: { content: 7 } } },
    async loadBundle(taskId, sections) { events.push(['loadBundle', taskId, sections]); },
  };
  sandbox.__mountReferenceUnderstanding(host, {
    reference,
    taskId: 'task-flow-1',
    store,
    async onConfirmed(payload) { events.push(['onConfirmed', payload]); },
  });
  assert.equal(typeof clickHandler, 'function', '报告必须注册确认事件');

  const confirmButton = {};
  await clickHandler({
    target: {
      closest(selector) { return selector === '[data-confirm-reference-understanding]' ? confirmButton : null; },
    },
  });

  assert.match(dialogCopy.message, /立即提交详细剧情与对白生成/);
  assert.match(dialogCopy.message, /不生成图片或视频/);
  assert.equal(dialogCopy.options.confirmText, '确认并生成剧情');
  assert.deepEqual(events.filter(item => ['request', 'loadBundle', 'onConfirmed'].includes(item[0])).map(item => item[0]), [
    'request', 'loadBundle', 'onConfirmed',
  ], '必须先确认权威版本，再刷新服务端状态，最后继续剧情与对白流程');
  const requestEvent = events.find(item => item[0] === 'request');
  assert.equal(requestEvent[1], '/api/story-ad/projects/task-flow-1/reference-understanding/confirm');
  assert.deepEqual(JSON.parse(JSON.stringify(requestEvent[2].body)), {
    analysis_id: 'analysis-flow-1',
    base_revision: 7,
    confirmation: 'authoritative_input',
  });
  assert.equal(events.filter(item => item[0] === 'onConfirmed').length, 1, '一次确认只能继续一次');

  console.log(JSON.stringify({ passed: true, confirm_requests: 1, continue_callbacks: 1, visual_generation_calls: 0 }));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
