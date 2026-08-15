'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const root = path.resolve(__dirname, '..');
const chrome = [
  process.env.CHROME_PATH,
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(file => file && fs.existsSync(file));
assert.ok(chrome, 'computed-style 回归需要可用的 Chrome/Chromium');

const css = ['public/story-ad/styles.css', 'public/story-ad/workspace.css']
  .map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
const html = `<style>${css}</style><a class="btn asset-recovery-action" href="#people">查看人物图片</a><div id="outside">outside</div>`;
const snapshot = async (page, selector) => page.$eval(selector, node => {
  const style = getComputedStyle(node); const rect = node.getBoundingClientRect();
  const textRange = document.createRange(); textRange.selectNodeContents(node); const textRect = textRange.getBoundingClientRect();
  const parentRect = node.parentElement.getBoundingClientRect();
  return { display: style.display, align: style.alignItems, justify: style.justifyContent, decoration: style.textDecorationLine,
    textAlign: style.textAlign, minWidth: style.minWidth, height: rect.height, border: style.borderColor, background: style.backgroundColor,
    color: style.color, outline: style.outlineStyle, width: rect.width,
    textCenterDelta: Math.abs((textRect.left + textRect.width / 2) - (rect.left + rect.width / 2)),
    parentCenterDelta: Math.abs((parentRect.left + parentRect.width / 2) - (rect.left + rect.width / 2)) };
});

(async () => {
  const browser = await puppeteer.launch({ headless: true, executablePath: chrome });
  try {
    const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 720 }); await page.setContent(html);
    const rest = await snapshot(page, '.asset-recovery-action');
    assert.equal(rest.display, 'inline-flex'); assert.equal(rest.align, 'center'); assert.equal(rest.justify, 'center');
    assert.equal(rest.textAlign, 'center'); assert.equal(rest.decoration, 'none'); assert.ok(parseFloat(rest.minWidth) >= 148); assert.ok(rest.height >= 40);
    assert.ok(rest.textCenterDelta <= 1, `wide label is not centered: ${rest.textCenterDelta}px`);
    await page.click('.asset-recovery-action'); await page.mouse.move(900, 500); await new Promise(resolve => setTimeout(resolve, 420));
    const afterClick = await snapshot(page, '.asset-recovery-action'); assert.equal(afterClick.decoration, 'none'); assert.equal(afterClick.background, rest.background);
    await page.hover('.asset-recovery-action'); await new Promise(resolve => setTimeout(resolve, 220)); const hover = await snapshot(page, '.asset-recovery-action'); assert.notEqual(hover.border, rest.border);
    await page.mouse.move(900, 500); await page.evaluate(() => { document.body.tabIndex = -1; document.body.focus(); }); await page.keyboard.press('Tab');
    const focus = await snapshot(page, '.asset-recovery-action'); assert.notEqual(focus.outline, 'none'); assert.equal(focus.decoration, 'none');
    await page.setViewport({ width: 720, height: 720 });
    await page.evaluate(() => document.body.focus()); await page.mouse.move(700, 700); await new Promise(resolve => setTimeout(resolve, 420));
    const narrow = await snapshot(page, '.asset-recovery-action');
    assert.equal(narrow.display, 'inline-flex'); assert.equal(narrow.align, 'center'); assert.equal(narrow.justify, 'center');
    assert.equal(narrow.decoration, 'none'); assert.ok(narrow.textCenterDelta <= 1, `narrow label is not centered: ${narrow.textCenterDelta}px`);
    assert.ok(narrow.parentCenterDelta <= 1, `narrow action is not centered in header: ${narrow.parentCenterDelta}px`);
    assert.equal(narrow.background, rest.background); assert.equal(narrow.border, rest.border);
    console.log(JSON.stringify({ passed: true, rest, narrow, after_click_background: afterClick.background, hover_border: hover.border, focus_outline: focus.outline }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
