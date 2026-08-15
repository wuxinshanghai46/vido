'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const puppeteer = require('puppeteer-core');

const root = path.resolve(__dirname, '..');
const chrome = [
  process.env.CHROME_PATH,
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(file => file && fs.existsSync(file));
assert.ok(chrome, 'V74 layout regression requires Chrome/Chromium');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const escapeHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
const source = read('public/story-ad/views/assetCheckpointRecovery.js').replace(/^import\s+.*?;\s*$/gm, '').replace(/\bexport\s+/g, '');
const sandbox = { escapeHtml };
vm.runInNewContext(`${source}\nglobalThis.__banner=checkpointRecoveryBanner;`, sandbox, { filename: 'assetCheckpointRecovery.js' });
const people = [7, 6, 6, 6].map((completed, index) => ({ name: `人物${index + 1}`, units: [index < 2 ? '腰部配饰' : '发饰'], reason: '需要平台人工核对后处理', completed }));
const banner = sandbox.__banner({ completed: 25, total: 29, missing: people });
const css = `${read('public/story-ad/styles.css')}\n${read('public/story-ad/workspace.css')}`;
const html = `<style>${css}</style><main>${banner}</main>`;
const rect = node => { const value = node.getBoundingClientRect(); return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height, centerX: value.left + value.width / 2, centerY: value.top + value.height / 2 }; };
const snapshot = page => page.evaluate(rectSource => {
  const toRect = eval(`(${rectSource})`);
  const header = document.querySelector('.asset-checkpoint-recovery header');
  const copy = document.querySelector('.asset-recovery-copy');
  const metric = document.querySelector('.asset-recovery-metric');
  const line = metric.querySelector('h2');
  const number = line.querySelector('strong');
  const label = line.querySelector('span');
  const action = document.querySelector('.asset-recovery-action');
  const lineStyle = getComputedStyle(line);
  return { header: toRect(header), copy: toRect(copy), metric: toRect(metric), line: toRect(line), number: toRect(number), label: toRect(label), action: toRect(action),
    lineDisplay: lineStyle.display, direction: lineStyle.flexDirection, alignItems: lineStyle.alignItems, gap: parseFloat(lineStyle.columnGap || lineStyle.gap || '0'),
    numberText: number.textContent.trim(), labelText: label.textContent.trim(), actionText: action.textContent.trim() };
}, rect.toString());

(async () => {
  const browser = await puppeteer.launch({ headless: true, executablePath: chrome });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 }); await page.setContent(html);
    const wide = await snapshot(page);
    assert.equal(wide.numberText, '25/29'); assert.equal(wide.labelText, '已保留');
    assert.match(wide.lineDisplay, /^(?:flex|inline-flex)$/); assert.notEqual(wide.direction, 'column');
    const centerDelta = Math.abs(wide.number.centerY - wide.label.centerY); const baselineDelta = Math.abs(wide.number.bottom - wide.label.bottom);
    assert.ok(centerDelta <= 3 || (wide.alignItems === 'baseline' && baselineDelta <= 3), `desktop metric center/baseline mismatch ${centerDelta}/${baselineDelta}px`);
    const visualGap = wide.label.left - wide.number.right;
    assert.ok(visualGap >= 4 && visualGap <= 16, `desktop metric gap ${visualGap}px is not deliberate`);
    assert.ok(wide.gap >= 4 && wide.gap <= 16, `computed metric gap ${wide.gap}px is outside contract`);
    assert.ok(wide.copy.width >= wide.header.width * .48, `copy column only uses ${wide.copy.width}/${wide.header.width}px`);
    assert.ok(wide.metric.left - wide.copy.right <= 32, 'isolated blank space before metric');
    assert.ok(wide.action.left - wide.metric.right <= 32, 'isolated blank space before action');
    assert.ok(wide.action.height >= 40 && wide.metric.height >= 22);

    await page.setViewport({ width: 720, height: 720 });
    const narrow = await snapshot(page);
    assert.equal(narrow.numberText, '25/29'); assert.equal(narrow.labelText, '已保留'); assert.equal(narrow.actionText, '查看人物图片');
    assert.ok(narrow.metric.width >= 90 && narrow.metric.height >= 22, 'narrow metric is collapsed');
    assert.ok(narrow.action.width >= 148 && narrow.action.height >= 40, 'narrow action is not clear');
    assert.ok(narrow.action.top >= Math.min(narrow.copy.bottom, narrow.metric.bottom), 'narrow action overlaps header content');
    console.log(JSON.stringify({ passed: true, wide, narrow, paid_model_calls: 0 }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
