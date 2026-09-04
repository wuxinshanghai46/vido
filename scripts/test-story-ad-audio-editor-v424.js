'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const root = path.resolve(__dirname, '../public');
const seen = [];
let rejectConfirmation = false;
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname.startsWith('/api/')) {
    seen.push({ method: req.method, path: pathname });
    res.setHeader('Content-Type', 'application/json');
    if (pathname === '/api/story-ad/version') {
      const source = fs.readFileSync(path.join(root, 'story-ad/release.js'), 'utf8');
      return res.end(JSON.stringify({ build_id: /CLIENT_BUILD_ID = "([^"]+)"/.exec(source)[1], contract_version: /CLIENT_CONTRACT_VERSION = "([^"]+)"/.exec(source)[1], release_bundle_id: 'isolated-fixture', runtime_hash: 'isolated-fixture' }));
    }
    if (pathname.endsWith('/audio-confirm') && rejectConfirmation) { res.statusCode = 422; return res.end(JSON.stringify({ success: false, error: 'fixture private provider details' })); }
    return res.end(JSON.stringify({ success: true, approved: true, items: [], shots: [], assets: [], timeline: [], voices: [], production: {} }));
  }
  if (pathname === '/') { res.setHeader('Content-Type', 'text/html'); return res.end('<div id="host"></div>'); }
  const file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/plain'); res.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(fs.existsSync);
  const browser = await require('puppeteer-core').launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage(); await page.goto(origin);
    await page.evaluate(async () => {
      const view = await import('/story-ad/views/finalEditView.js');
      window.executions = [];
      const context = { bundle: { project: { id: 'ui-fixture' }, permissions: { can_view_errors: false }, generation: { final_video: { video_url: '/fixture.mp4' }, clips: [] } }, store: { runStage: async (stage, body) => window.executions.push({ stage, body }) }, refreshShell: async () => {}, navigate: () => {} };
      await view.openEditorModal(context);
    });
    assert.equal(seen.filter(row => row.path.endsWith('/sound-design')).length, 0);
    assert(await page.$('[data-story-editor-modal]')); assert(await page.$('video.final-video')); assert(await page.$('[data-audio-editor]'));
    await page.click('[data-audio-editor] summary');
    await page.waitForSelector('[data-confirm-audio]');
    assert.equal(seen.filter(row => row.path.endsWith('/sound-design')).length, 1);
    await page.click('[data-confirm-audio]');
    await page.waitForFunction(() => window.executions.length === 1);
    assert.deepEqual(await page.evaluate(() => window.executions), [{ stage: 'compose', body: { apply_audio_edits: true } }]);
    const writes = seen.filter(row => row.method !== 'GET').map(row => row.path.split('/').pop());
    assert.deepEqual(writes, ['audio-plan', 'audio-confirm']);
    rejectConfirmation = true;
    await page.click('[data-confirm-audio]');
    await page.waitForFunction(() => document.querySelector('[data-audio-edit-feedback]')?.hidden === false);
    const text = await page.$eval('[data-audio-edit-feedback]', el => el.textContent);
    assert.match(text, /声音修改失败，原成片已保留/); assert(!text.includes('private'));
    assert.equal(await page.evaluate(() => window.executions.length), 1);
    assert(await page.$('video.final-video'));
    console.log(JSON.stringify({ passed: true, editor_modal: true, lazy_sound_request: 1, explicit_apply: true, ordinary_error_redacted: true, old_movie_preserved: true, model_calls: 0 }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
