'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

(async () => {
  const chrome = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/chromium',
  ].find(fs.existsSync);
  assert(chrome, 'browser required');
  const browser = await require('puppeteer-core').launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(`<div class="project-progress-track is-indeterminate"><i></i></div>
      <div class="person-plan-inline-progress"><div><i></i></div></div>
      <div class="inline-asset-progress"><div class="progress-track"><i></i></div></div>`);
    await page.addStyleTag({ path: path.join(root, 'public/story-ad/progress-motion.css') });
    const motion = await page.evaluate(() => ({
      travel: getComputedStyle(document.querySelector('.project-progress-track i')).animationName,
      sheen: getComputedStyle(document.querySelector('.person-plan-inline-progress i'), '::after').animationName,
      asset: getComputedStyle(document.querySelector('.inline-asset-progress i'), '::after').animationName,
    }));
    assert.match(motion.travel, /vido-progress-travel/);
    assert.match(motion.sheen, /vido-progress-sheen/);
    assert.match(motion.asset, /vido-progress-sheen/);
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    const reduced = await page.evaluate(() => ({
      travel: getComputedStyle(document.querySelector('.project-progress-track i')).animationName,
      sheen: getComputedStyle(document.querySelector('.person-plan-inline-progress i'), '::after').animationName,
    }));
    assert.equal(reduced.travel, 'none');
    assert.equal(reduced.sheen, 'none');
  } finally {
    await browser.close();
  }
  const ui = fs.readFileSync(path.join(root, 'public/story-ad/components/ui.js'), 'utf8');
  assert(ui.includes("view.percent <= 2 ? 'is-indeterminate'"));
  for (const file of ['public/story-ad/views/finalView.js', 'public/story-ad/views/assetCenterInlineProgress.js', 'public/story-ad/views/assetCenterPersonSources.js', 'public/story-ad/views/storyboardImageReview.js', 'public/story-ad/views/storyboardView.js']) {
    assert(/data-elapsed-started-at|ElapsedTimeTag|elapsedTimeTag/.test(fs.readFileSync(path.join(root, file), 'utf8')), `${file} 缺少耗时显示`);
  }
  assert(ui.includes('data-tts-progress-elapsed'));
  console.log(JSON.stringify({ passed: true, animated_progress_types: 3, elapsed_progress_flows: 6, reduced_motion: true, model_calls: 0 }));
})().catch(error => { console.error(error); process.exitCode = 1; });
