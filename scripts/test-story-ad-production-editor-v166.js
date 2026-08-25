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
  let step = 'startup';
  assert.ok(chrome, '制作表交互回归需要可用的 Chrome/Chromium');
  const source = read('public/story-ad/views/plotRoomView.js');
  const editor = read('public/story-ad/views/plotBeatEditor.js');
  assert.match(source, /popover="auto"/, '编辑浮层必须使用浏览器原生轻触关闭和互斥语义');
  assert.match(editor, /beat-row-menu" popover="auto"/, '所有行菜单必须使用同一互斥浮层栈');
  assert.match(source, /productionIssues\(host\)/, '确认前必须检查制作字段完整度');
  assert.match(source, /plot-sequence-actions[\s\S]*data-add-beat>＋ 新增镜头/, '表格右上角必须有新增镜头入口');
  assert.doesNotMatch(source, /广告专用规则围绕/, '不得继续显示固定教学提示');
  assert.match(source, /const savedQualityDraft = failureCode === 'BLUEPRINT_POLISH_QUALITY_FAILED'/, '已有旧稿时也必须识别可复检的新初稿');
  assert.match(source, /data-recheck-story[\s\S]*重新检查已保存初稿/, '质量失败后必须复检检查点，不能误导用户再次付费重生成');
  assert.match(source, /\[data-recheck-story\][\s\S]*generate\(event\.currentTarget\)/, '复检按钮不得携带 force_regenerate 删除检查点');
  assert.doesNotMatch(editor, /beat-detail-editor/, '不得再渲染整行大表单');

  const browser = await puppeteer.launch({ headless: true, executablePath: chrome });
  try {
    const page = await browser.newPage();
    step = 'load-shell';
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`http://localhost:3007/health?qa=${Date.now()}`, { waitUntil: 'domcontentloaded' });
    for (const relative of ['public/story-ad/styles.css', 'public/story-ad/workspace.css', 'public/story-ad/workspace-ux.css']) {
      await page.addStyleTag({ content: read(relative) });
    }
    await page.evaluate(async () => {
      document.body.innerHTML = '<main class="view-host" id="qa-host"></main>';
      const nativeFetch = window.fetch.bind(window);
      window.fetch = (input, init) => String(input).includes('/api/avatar/voice-list')
        ? Promise.resolve(new Response(JSON.stringify({ voices: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
        : String(input).includes('/prompt-preview')
          ? Promise.resolve(new Response(JSON.stringify({ success: true, shot_index: 1, keyframe_prompt: '主体：人物走入展厅\n光影与氛围：自然侧光', motion_prompt: '时间段 0-3 秒：缓慢推镜\n声音设计：脚步声' }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
          : nativeFetch(input, init);
      const { mount } = await import(`/story-ad/views/plotRoomView.js?qa=${Date.now()}`);
      const blueprint = {
        story_title: '测试剧情', logline: '验证制作表交互', characters: [
          { id: 'designer', name: '林岚', gender: 'female', age_range: '32 岁', role: '设计师' },
          { id: 'customer', name: '陈先生', gender: 'male', age_range: '45 岁', role: '客户' },
        ],
        beats: [
          { shot_id: 's1', title: '镜头一', duration: 6, scene: '展厅', visual: '人物走入展厅', spoken_line: '开始吧', speech_mode: 'dialogue', speaker: '林岚', speaker_id: 'designer', shot_size: 'medium' },
          { shot_id: 's2', title: '镜头二', duration: 5, scene: '会所', visual: '镜头转向墙面', spoken_line: '', speech_mode: 'silent', shot_size: 'close_up' },
        ],
      };
      window.__qa = { navigations: [], saves: [], stageRuns: [] };
      await mount(document.querySelector('#qa-host'), {
        bundle: { project: { id: 'qa-production-editor' }, brief: { content_mode: 'commercial_subject', brief_intake: { cast_intent: { confirmed: true, mode: 'dual', expected_people: 2 } } }, story: { blueprint }, generation: { progress: { error_code: 'BLUEPRINT_POLISH_QUALITY_FAILED' } } },
        store: { async runStage(stage, body) { window.__qa.stageRuns.push({ stage, body }); }, async updateRequest() {}, async saveBlueprint(blueprint) { window.__qa.saves.push(structuredClone(blueprint)); return { blueprint }; } },
        async refreshShell() {}, navigate(url) { window.__qa.navigations.push(url); },
      });
    });

    step = 'initial-assertions';
    assert.equal(await page.$$eval('[data-beat-index]', rows => rows.length), 2, '必须显示原有两镜');
    assert.equal(await page.$eval('[data-character-save-status]', node => node.textContent.trim()), '修改后自动保存', '角色区必须明确提示自动保存');
    assert.equal(await page.$eval('[data-save-characters]', node => node.textContent.trim()), '保存角色设置', '角色区必须保留明确的手动保存入口');
    step = 'character-autosave';
    await page.$eval('[data-character-index="0"] [data-character-field="age_range"]', node => { node.value = '25岁'; node.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForFunction(() => window.__qa.saves.length === 1 && document.querySelector('[data-character-save-status]')?.textContent.includes('已自动保存'));
    assert.equal(await page.evaluate(() => window.__qa.saves[0].characters[0].age_range), '25岁', '角色年龄必须自动写入保存载荷');
    assert.equal(await page.evaluate(() => window.__qa.saves[0].story_title), '测试剧情', '角色自动保存必须保留原正式剧情');
    assert.equal(await page.evaluate(() => window.__qa.saves[0].beats.length), 2, '角色自动保存不得丢失原正式镜头');
    await page.$eval('[data-character-index="0"] [data-character-field="role"]', node => { node.value = ''; node.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForFunction(() => document.querySelector('[data-character-save-status]')?.textContent.includes('待补'));
    assert.equal(await page.evaluate(() => window.__qa.saves.length), 1, '必填人物信息为空时不得覆盖正式数据');
    await page.$eval('[data-character-index="0"] [data-character-field="role"]', node => { node.value = '空间设计师'; node.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForFunction(() => window.__qa.saves.length === 2 && document.querySelector('[data-character-save-status]')?.textContent.includes('已自动保存'));
    await page.click('[data-recheck-story]');
    await page.waitForFunction(() => window.__qa.stageRuns.length === 1);
    assert.deepEqual(await page.evaluate(() => window.__qa.stageRuns[0]), { stage: 'blueprint', body: {} }, '复检已保存初稿不得携带 force_regenerate');
    step = 'popover-mutual';
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

    step = 'simple-cell-editors';
    await page.click('[data-beat-index="0"] [data-open-beat-cell="camera_movement"]');
    await page.waitForFunction(() => document.querySelector('[data-beat-floating-editor]')?.dataset.group === 'camera_movement');
    assert.equal(await page.$$eval('[data-beat-floating-editor] [data-floating-field]', fields => fields.length), 1, '运镜浮层只能显示一个主输入框');
    await page.click('[data-camera-preset="推镜"]');
    assert.equal(await page.$eval('[data-floating-field="camera_movement"]', input => input.value), '推镜', '快捷运镜必须写入真实运镜字段');
    await page.click('[data-save-beat-floating]');
    await page.click('[data-beat-index="0"] [data-open-beat-cell="prompt_notes"]');
    await page.waitForFunction(() => document.querySelector('[data-beat-floating-editor]')?.textContent.includes('关键帧实际输入'));
    const promptPreview = await page.$eval('[data-beat-floating-editor]', node => node.textContent);
    assert.match(promptPreview, /自然侧光/); assert.match(promptPreview, /脚步声/);
    await page.click('[data-close-beat-floating]');

    step = 'add-beat';
    await page.click('.plot-sequence-actions [data-add-beat]');
    await page.waitForFunction(() => document.querySelectorAll('[data-beat-index]').length === 3 && document.querySelector('[data-beat-floating-editor]')?.matches(':popover-open'));
    assert.equal(await page.$$eval('[data-beat-index]', rows => rows.length), 3, '右上角新增镜头必须立即创建可编辑行');
    assert.equal(await page.$eval('[data-beat-floating-editor]', node => node.dataset.group), 'visual', '新增后应直接打开画面编辑');

    step = 'completion-gate';
    await page.click('.view-head h1');
    await page.click('[data-open-storyboard]');
    await page.waitForFunction(() => document.querySelector('[data-beat-floating-editor]')?.matches(':popover-open'));
    assert.equal(await page.evaluate(() => window.__qa.navigations.length), 0, '制作字段缺失时不得进入下一步');
    assert.equal(await page.$eval('[data-beat-floating-editor]', node => node.matches(':popover-open')), true, '确认被拦截后必须打开第一个缺失项');

    step = 'geometry';
    const geometry = await page.$$eval('.beat-actions .compact', buttons => buttons.slice(0, 2).map(button => ({ width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height })));
    geometry.forEach(size => { assert.ok(size.width <= 36 && size.height <= 32, `操作按钮过大：${JSON.stringify(size)}`); });
    const overviewHeight = await page.$eval('[name="story_title"]', node => node.getBoundingClientRect().height);
    assert.ok(overviewHeight <= 132, `故事设定区过高：${overviewHeight}`);

    step = 'dialogue-editor';
    await page.click('.view-head h1');
    await page.click('[data-beat-index="0"] [data-open-beat-cell="spoken_line"]');
    await page.waitForFunction(() => document.querySelector('[data-beat-floating-editor]')?.dataset.group === 'spoken_line'
      && document.querySelectorAll('[data-dialogue-speaker] option:not([value=""])').length === 2);
    const dialogueUi = await page.$eval('[data-beat-floating-editor]', node => ({
      text: node.textContent,
      placeholder: node.querySelector('[data-dialogue-speaker] option[value=""]')?.textContent.trim() || '',
      speakers: [...node.querySelectorAll('[data-dialogue-speaker] option:not([value=""])')].map(option => option.textContent.trim()),
    }));
    assert.doesNotMatch(dialogueUi.text, /说话人 ID|对白时间/, '不得暴露内部 ID 或模糊的对白时间字段');
    assert.equal(dialogueUi.placeholder, '选择说话人物（必填）', '人物对白必须保留未选择占位，不能默认绑定错误人物');
    assert.deepEqual(dialogueUi.speakers, ['林岚', '陈先生'], `说话人必须只来自剧情人物：${JSON.stringify(dialogueUi.speakers)}`);
    await page.click('[data-add-dialogue-line="voiceover"]');
    assert.equal(await page.$$eval('[data-dialogue-line]', lines => lines.length), 2, '同镜头必须允许新增台词或旁白');
    assert.equal(await page.$eval('[data-dialogue-line]:last-child [data-dialogue-speaker]', select => select.value), '旁白', '旁白必须自动绑定旁白者');
    await page.type('[data-dialogue-line]:last-child [data-dialogue-text]', '旁白内容');
    await page.click('[data-save-beat-floating]');
    const persistedLines = await page.$eval('[data-beat-index="0"] [data-beat-field="dialogue_lines_json"]', input => JSON.parse(input.value));
    assert.deepEqual(persistedLines.map(line => line.speaker_id), ['designer', 'narrator'], '人物台词与旁白必须自动写入内部绑定');
    console.log(JSON.stringify({ ok: true, checks: 36, rows_after_add: 3, floating_editors: 1, character_saves: 2, model_calls: 0, media_calls: 0 }));
  } catch (error) {
    error.message = `[${step}] ${error.message}`;
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error.stack || error.message); process.exit(1); });
