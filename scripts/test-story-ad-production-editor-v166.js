#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const chrome = [
  process.env.CHROME_PATH,
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(file => file && fs.existsSync(file));

async function main() {
  assert.ok(chrome, '制作表交互回归需要可用的 Chrome/Chromium');
  const source = read('public/story-ad/views/plotRoomView.js');
  const editor = read('public/story-ad/views/plotBeatEditor.js');
  assert.match(source, /popover="auto"/, '编辑浮层必须使用浏览器原生轻触关闭和互斥语义');
  assert.match(editor, /beat-row-menu" popover="auto"/, '所有行菜单必须使用同一互斥浮层栈');
  assert.match(source, /productionIssues\(host\)/, '确认前必须检查制作字段完整度');
  assert.match(source, /data-add-beat>＋ 新增镜头/, '表格底部必须有新增镜头入口');
  assert.doesNotMatch(editor, /beat-detail-editor/, '不得再渲染整行大表单');

  const browser = await puppeteer.launch({ headless: true, executablePath: chrome });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`http://localhost:3007/story-ad/release.js?qa=${Date.now()}`, { waitUntil: 'domcontentloaded' });
    for (const relative of ['public/story-ad/styles.css', 'public/story-ad/workspace.css', 'public/story-ad/workspace-ux.css']) {
      await page.addStyleTag({ content: read(relative) });
    }
    await page.evaluate(async () => {
      document.body.innerHTML = '<main class="view-host" id="qa-host"></main>';
      const { mount } = await import(`/story-ad/views/plotRoomView.js?qa=${Date.now()}`);
      const blueprint = {
        story_title: '测试剧情', logline: '验证制作表交互', characters: [],
        beats: [
          { shot_id: 's1', title: '镜头一', duration: 6, scene: '展厅', visual: '人物走入展厅', spoken_line: '开始吧', speaker: '旁白', shot_size: 'medium' },
          { shot_id: 's2', title: '镜头二', duration: 5, scene: '会所', visual: '镜头转向墙面', spoken_line: '', speech_mode: 'silent', shot_size: 'close_up' },
        ],
      };
      window.__qa = { navigations: [], saves: 0 };
      await mount(document.querySelector('#qa-host'), {
        bundle: { project: { id: 'qa-production-editor' }, brief: { content_mode: 'commercial_subject' }, story: { blueprint }, generation: {} },
        store: { async runStage() {}, async updateRequest() {}, async saveBlueprint() { window.__qa.saves += 1; } },
        async refreshShell() {}, navigate(url) { window.__qa.navigations.push(url); },
      });
    });

    assert.equal(await page.$$eval('[data-beat-index]', rows => rows.length), 2, '必须显示原有两镜');
    await page.click('[data-beat-index="0"] [data-open-beat-cell="scene"]');
    await page.waitForFunction(() => document.querySelector('[data-beat-floating-editor]')?.matches(':popover-open'));
    assert.deepEqual(await page.$eval('[data-beat-floating-editor]', node => ({ open: node.matches(':popover-open'), group: node.dataset.group })), { open: true, group: 'scene' });
    await page.click('[data-beat-index="0"] [data-open-beat-cell="lighting_mood"]');
    await page.waitForFunction(() => document.querySelector('[data-beat-floating-editor]')?.dataset.group === 'lighting_mood');
    assert.deepEqual(await page.$eval('[data-beat-floating-editor]', node => ({ open: node.matches(':popover-open'), group: node.dataset.group, count: document.querySelectorAll(':popover-open').length })), { open: true, group: 'lighting_mood', count: 1 }, '切换单元格时只能保留一个浮层');
    await page.click('.view-head h1');
    assert.equal(await page.$eval('[data-beat-floating-editor]', node => node.matches(':popover-open')), false, '点击外部必须关闭编辑浮层');

    await page.click('[data-beat-index="0"] [data-row-menu]');
    assert.equal(await page.$eval('[data-beat-index="0"] .beat-row-menu', node => node.matches(':popover-open')), true);
    await page.click('[data-beat-index="1"] [data-row-menu]');
    const mutualMenuState = await page.$$eval('.beat-row-menu', menus => menus.map(menu => menu.matches(':popover-open')));
    assert.deepEqual(mutualMenuState, [false, true], `行菜单必须互斥，实际 ${JSON.stringify(mutualMenuState)}`);
    await page.click('.view-head h1');
    assert.deepEqual(await page.$$eval('.beat-row-menu', menus => menus.map(menu => menu.matches(':popover-open'))), [false, false], '点击外部必须关闭行菜单');

    await page.click('.beat-table-footer [data-add-beat]');
    await page.waitForFunction(() => document.querySelectorAll('[data-beat-index]').length === 3 && document.querySelector('[data-beat-floating-editor]')?.matches(':popover-open'));
    assert.equal(await page.$$eval('[data-beat-index]', rows => rows.length), 3, '底部新增镜头必须立即创建可编辑行');
    assert.equal(await page.$eval('[data-beat-floating-editor]', node => node.dataset.group), 'visual', '新增后应直接打开画面编辑');

    await page.click('.view-head h1');
    await page.click('[data-open-storyboard]');
    await page.waitForFunction(() => document.querySelector('[data-beat-floating-editor]')?.matches(':popover-open'));
    assert.equal(await page.evaluate(() => window.__qa.navigations.length), 0, '制作字段缺失时不得进入下一步');
    assert.equal(await page.$eval('[data-beat-floating-editor]', node => node.matches(':popover-open')), true, '确认被拦截后必须打开第一个缺失项');

    const geometry = await page.$$eval('.beat-actions .compact', buttons => buttons.slice(0, 2).map(button => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })));
    geometry.forEach(size => { assert.ok(size.width <= 36 && size.height <= 32, `操作按钮过大：${JSON.stringify(size)}`); });
    console.log(JSON.stringify({ ok: true, checks: 20, rows_after_add: 3, floating_editors: 1, model_calls: 0, media_calls: 0 }));
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error.stack || error.message); process.exit(1); });
