#!/usr/bin/env node
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const puppeteer = require('puppeteer-core');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const executable = file => read(file).replace(/^import\s+.*?;\s*$/gm, '').replace(/\bexport\s+/g, '');
const escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const chrome = [
  process.env.CHROME_PATH,
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(file => file && fs.existsSync(file));

function coverMarkup() {
  const qaSandbox = {};
  vm.runInNewContext(`${executable('public/story-ad/views/sceneQaPublicState.js')}\nglobalThis.__qa={sceneQaPublicState,publicSceneQaReason,sceneQaRows,sceneQaFailureDetails};`, qaSandbox);
  const sandbox = {
    escapeHtml,
    mediaPreview: () => '<span class="media-zoom-trigger"><img class="media" alt="场景主视图" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221600%22 height=%22900%22%3E%3Crect width=%221600%22 height=%22900%22 fill=%22%23162a31%22/%3E%3C/svg%3E"></span>',
    sceneRuntimeFailureMarkup: () => '', setButtonBusy() {}, toast() {}, ...qaSandbox.__qa,
  };
  vm.runInNewContext(`${executable('public/story-ad/views/sceneDossierCard.js')}\nglobalThis.__render=renderSceneCoverCard;`, sandbox);
  return sandbox.__render({
    id: 'qa-layout', name: '高端商业展台',
    view_images: ['master', 'reverse', 'interaction', 'detail', 'layout'].map(key => ({ key, image_url: `/${key}.png` })),
    qa: { full_space_lock: false, qa_unavailable: true, verification_state: 'unavailable' },
    repair_plan: { action: 'reverify', count: 0 },
  });
}

async function main() {
  assert.ok(chrome, '场景 QA 几何回归需要可用的 Chrome/Chromium');
  const css = ['public/story-ad/styles.css', 'public/story-ad/workspace.css', 'public/story-ad/workspace-ux.css', 'public/story-ad/scene-dossier.css']
    .map(read).join('\n');
  const card = `<article class="scene-production-card"><header><div><small>场景 2</small><h3>高端商业展台</h3></div></header><nav class="scene-production-tabs"><button class="is-active">场景画面 (5)</button></nav><section class="scene-production-pane">${coverMarkup()}</section><footer><span>只重新审核，不重新生成图片。</span><div class="scene-card-controls"><button class="btn primary compact scene-card-generate">重新审核（0 次图片调用）</button></div></footer></article>`;
  const browser = await puppeteer.launch({ headless: true, executablePath: chrome });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    await page.setContent(`<style>${css}</style><main style="width:680px;margin:20px">${card}</main>`);
    const snapshot = () => page.evaluate(() => {
      const rect = selector => {
        const value = document.querySelector(selector).getBoundingClientRect();
        return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height };
      };
      const notice = document.querySelector('.scene-cover-qa-notice');
      const button = document.querySelector('.scene-card-generate');
      const footer = document.querySelector('.scene-production-card>footer');
      return {
        card: rect('.scene-production-card'), visual: rect('.scene-cover-visual'), slots: rect('.scene-cover-slots'),
        notice: rect('.scene-cover-qa-notice'),
        pane: rect('.scene-production-pane'), footer: rect('.scene-production-card>footer'), button: rect('.scene-card-generate'),
        titleSize: parseFloat(getComputedStyle(notice.querySelector('b')).fontSize),
        cardScrollWidth: document.querySelector('.scene-production-card').scrollWidth,
        cardClientWidth: document.querySelector('.scene-production-card').clientWidth,
        footerContentRight: footer.getBoundingClientRect().right - parseFloat(getComputedStyle(footer).paddingRight),
        buttonWidth: button.getBoundingClientRect().width,
      };
    });
    const closed = await snapshot();
    assert.ok(closed.notice.height >= 34 && closed.notice.height <= 44, `桌面状态条高度异常：${closed.notice.height}`);
    assert.ok(closed.titleSize <= 12, `桌面标题字号过大：${closed.titleSize}`);
    assert.ok(closed.visual.bottom <= closed.slots.top + 1 && closed.slots.bottom <= closed.notice.top + 1, '黄色摘要不得覆盖主图或五视图状态条');
    assert.ok(closed.notice.bottom <= closed.pane.bottom + 1 && closed.pane.bottom <= closed.footer.top + 1, '黄色摘要必须在内容流中且位于页脚上方');
    assert.ok(Math.abs(closed.button.right - closed.footerContentRight) <= 2, '桌面重新审核按钮必须右对齐');
    assert.ok(closed.cardScrollWidth <= closed.cardClientWidth + 1, '桌面场景卡不得横向溢出');

    assert.equal((await page.$$('body *')).length > 0 && (await page.evaluate(() => document.body.innerText.includes('这不是图片内容被判失败'))), false,
      '用户不关心的技术解释不得渲染');

    await page.setViewport({ width: 375, height: 900 });
    await page.setContent(`<style>${css}</style><main style="width:100%;padding:8px">${card}</main>`);
    const mobile = await snapshot();
    assert.ok(mobile.notice.height >= 40 && mobile.notice.height <= 48, `窄屏状态条高度异常：${mobile.notice.height}`);
    assert.ok(mobile.buttonWidth >= mobile.footer.width - 34, '窄屏重新审核按钮必须接近全宽');
    assert.ok(mobile.cardScrollWidth <= mobile.cardClientWidth + 1, '窄屏场景卡不得横向溢出');
    assert.ok(mobile.notice.bottom <= mobile.pane.bottom + 1 && mobile.pane.bottom <= mobile.footer.top + 1, '窄屏摘要不得覆盖页脚');
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify({ passed: true, scope: 'scene-qa-layout-v252', viewports: [1366, 375], model_calls: 0 }));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
