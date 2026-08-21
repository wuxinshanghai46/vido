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

const BUILD = '20260821-guided-workspace-v103';

async function main() {
  const briefViewSource = read('public/story-ad/views/briefView.js');
  const dialogueSource = read('public/story-ad/views/briefDialoguePanel.js');
  const appSource = read('public/story-ad/app.js');
  const projectStoreSource = read('public/story-ad/store/projectStore.js');
  const plotSource = read('public/story-ad/views/plotRoomView.js');
  const referenceProjection = require('../src/services/storyAdWorkspace/referenceDraftProjectionService');

  assert.match(briefViewSource, /data-brief-settings-modal/, '手动设置必须挂载到独立 modal');
  assert.match(briefViewSource, /data-brief-settings-close/, 'modal 必须提供稳定的关闭入口');
  assert.doesNotMatch(briefViewSource, /<details[^>]*data-brief-settings/, '手动设置不得继续作为内联 details 占用页面高度');
  assert.doesNotMatch(appSource, /新增\s*\/\s*修改内容/, '历史步骤不得再注入冗余“新增 / 修改内容”入口');
  assert.match(dialogueSource, /data-dialogue-reference/, '对话中的参考材料入口必须保留');
  assert.match(projectStoreSource, /if \(data\.blueprint\) next\.story = \{[^\n]*reference_draft: null/, '正式蓝图写回必须清除旧参考草稿');
  assert.match(plotSource, /const blueprint = savedBlueprint \|\| referenceDraft;/, '剧情页必须优先使用正式蓝图');
  assert.match(plotSource, /const isReferenceDraft = !savedBlueprint && !!referenceDraft;/, '只有没有正式蓝图时才能标记参考草稿来源');
  assert.equal(referenceProjection.referenceReady({ status: 'completed', analysis_quality: { valid: true } }), false, '没有当前 analysis id 的旧完成态不得视为有效参考');
  assert.equal(referenceProjection.referenceBlueprintDraft({ story_seed: { title: '旧项目故事', logline: '旧内容' } }), null, '没有当前参考分析时不得把普通 story_seed 投影成参考草稿');
  assert.equal(referenceProjection.referenceReady({ analysis_id: 'current-analysis', status: 'running', analysis_quality: { valid: true } }), false, '未完成的当前参考不得提前标记为参考草稿');
  assert.equal(referenceProjection.referenceReady({ analysis_id: 'current-analysis', status: 'completed', analysis_quality: { valid: true } }), true, '只有具备 id、完成态和有效质量的当前参考才可投影');

  assert.ok(chrome, 'modal 与自动剧情回归需要可用的 Chrome/Chromium');
  const browser = await puppeteer.launch({ headless: true, executablePath: chrome });
  let stubbedStageCalls = 0;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1000 });
    await page.goto(`http://localhost:3007/story-ad/release.js?qa=${Date.now()}`, { waitUntil: 'domcontentloaded' });
    for (const relative of ['public/story-ad/styles.css', 'public/story-ad/workspace.css', 'public/story-ad/dialogue-theme.css', 'public/story-ad/workspace-ux.css', 'public/story-ad/platform-responsive.css']) {
      await page.addStyleTag({ content: read(relative) });
    }

    const mountBrief = async ({ failFirst = false } = {}) => page.evaluate(async ({ build, failFirst }) => {
      document.body.innerHTML = '<main class="view-host" id="qa-host"></main>';
      const host = document.querySelector('#qa-host');
      const bundle = {
        project: { id: 'qa-project', title: 'QA 项目', status: 'draft', stage: 'brief' },
        brief: {
          project_name: 'QA 项目', text: '一条完整的现代剧情短片，人物在雨夜重逢。',
          content_mode: 'narrative_story', content_mode_source: 'user',
          target_duration: 30, output_ratio: '16:9', video_resolution: '1080p',
          world_setting: { profiles: [{}] },
        },
        reference: {}, story: {}, revisions: { content: 1 },
        navigation: { steps: { brief: { completed: false } } },
      };
      const qa = window.__briefQa = {
        stageCalls: 0, stageOptions: [], realModelCalls: 0, navigateCalls: [], refClicks: 0,
        failFirst, subscribers: [],
      };
      const store = {
        state: { bundle },
        subscribe(callback) { qa.subscribers.push(callback); return () => {}; },
        async runStage(stage, options = {}) {
          qa.stageCalls += 1;
          qa.stageOptions.push(options);
          if (stage !== 'blueprint') throw new Error(`unexpected stage ${stage}`);
          await new Promise(resolve => setTimeout(resolve, 60));
          if (qa.failFirst && qa.stageCalls === 1) throw new Error('stubbed blueprint failure');
          store.state.bundle.story = {
            blueprint: { story_title: '已生成剧情', logline: '测试', beats: [{ title: '开场', visual: '雨夜重逢', spoken_line: '你来了', duration: 3 }] },
            reference_draft: null,
          };
          return store.state.bundle;
        },
        async updateRequest() { return store.state.bundle; },
        async createProject() { return { id: 'qa-project' }; },
        async loadBundle() { return store.state.bundle; },
      };
      qa.store = store;
      const module = await import(`/story-ad/views/briefView.js?v=${build}&qa=${Date.now()}`);
      qa.cleanup = await module.mount(host, {
        route: { isNew: false, taskId: 'qa-project', view: 'brief' }, store,
        navigate(url, options) { qa.navigateCalls.push({ url, options }); },
      });
      const file = host.querySelector('[data-material-file="reference"]');
      if (file) file.click = () => { qa.refClicks += 1; };
      return true;
    }, { build: BUILD, failFirst });

    await mountBrief();
    await page.waitForSelector('[data-reference-question]');
    const initial = await page.evaluate(() => {
      const modal = document.querySelector('[data-brief-settings-modal]');
      const form = document.querySelector('[data-brief-form]');
      const dialogue = document.querySelector('[data-brief-dialogue]');
      const host = document.querySelector('#qa-host');
      const visible = element => Boolean(element && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
      return {
        modalVisible: visible(modal), formVisible: visible(form),
        tailGap: Math.max(0, host.getBoundingClientRect().bottom - dialogue.getBoundingClientRect().bottom),
        referenceChoices: [...document.querySelectorAll('[data-reference-choice]')].map(item => item.dataset.referenceChoice).sort(),
        redundantText: document.body.innerText.includes('新增 / 修改内容'),
      };
    });
    assert.equal(initial.modalVisible, false, '初始状态 modal 必须关闭');
    assert.equal(initial.formVisible, false, '关闭的 modal 表单不得参与页面布局');
    assert.ok(initial.tailGap <= 160, `对话下方出现 ${initial.tailGap}px 大空白`);
    assert.deepEqual(initial.referenceChoices, ['link', 'none', 'upload'], '对话必须提供上传、链接、无参考三条路径');
    assert.equal(initial.redundantText, false, '页面不得出现冗余“新增 / 修改内容”入口');

    // 双栏工作台必须随可用高度伸缩：右侧确认单不能把左侧撑出空白，
    // 低高度视口也必须始终保留完整输入区。
    const responsiveViewports = [
      { width: 1920, height: 1080, mode: 'split' },
      { width: 1600, height: 900, mode: 'split' },
      { width: 1440, height: 760, mode: 'split' },
      { width: 1366, height: 680, mode: 'split' },
      { width: 1280, height: 640, mode: 'split' },
      { width: 1080, height: 720, mode: 'split' },
    ];
    for (const viewport of responsiveViewports) {
      await page.setViewport(viewport);
      const geometry = await page.evaluate(() => {
        const rect = selector => {
          const value = document.querySelector(selector)?.getBoundingClientRect();
          return value ? { top: value.top, right: value.right, bottom: value.bottom, left: value.left, width: value.width, height: value.height } : null;
        };
        return {
          viewport: { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
          pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          pageOverflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
          overflowElements: [...document.querySelectorAll('body *')].map(element => {
            const value = element.getBoundingClientRect();
            return { tag: element.tagName, cls: element.className, right: Math.round(value.right), width: Math.round(value.width) };
          }).filter(value => value.right > document.documentElement.clientWidth + 1).slice(0, 6),
          dialogue: rect('[data-brief-dialogue]'),
          conversation: rect('.brief-conversation-panel'),
          scroll: rect('.brief-conversation-scroll'),
          composer: rect('.brief-composer'),
          contract: rect('.brief-contract-panel'),
        };
      });
      const label = `${viewport.width}x${viewport.height}`;
      assert.ok(geometry.dialogue && geometry.conversation && geometry.composer && geometry.scroll && geometry.contract, `${label} 必须渲染完整立项布局`);
      assert.ok(geometry.pageOverflowX <= 1, `${label} 页面不得横向溢出，实际 ${geometry.pageOverflowX}px：${JSON.stringify(geometry.overflowElements)}`);
      assert.ok(geometry.pageOverflowY <= 1, `${label} 立项工作台不得制造空白页面滚动，实际 ${geometry.pageOverflowY}px`);
      assert.ok(geometry.dialogue.right <= geometry.viewport.width + 1, `${label} 工作台不得越过右边界`);
      if (viewport.mode === 'split') {
        assert.ok(geometry.dialogue.bottom <= geometry.viewport.height + 1, `${label} 双栏工作台不得越过可视高度`);
        assert.ok(Math.abs(geometry.conversation.bottom - geometry.dialogue.bottom) <= 1, `${label} 左侧对话必须随右侧等高，不得留下底部空白`);
        assert.ok(Math.abs(geometry.composer.bottom - geometry.dialogue.bottom) <= 1, `${label} 输入区必须固定在工作台底部`);
      } else {
        assert.ok(geometry.contract.top >= geometry.conversation.bottom - 1, `${label} 单栏确认单必须排在对话区之后`);
        assert.ok(geometry.conversation.width <= geometry.dialogue.width + 1, `${label} 单栏对话不得横向越界`);
        assert.ok(geometry.contract.width <= geometry.dialogue.width + 1, `${label} 单栏确认单不得横向越界`);
      }
      assert.ok(geometry.composer.top >= geometry.dialogue.top && geometry.composer.bottom <= geometry.viewport.height + 1, `${label} 输入区必须完整可见`);
      assert.ok(geometry.scroll.height >= 120, `${label} 对话记录仍需保留可用滚动高度，实际 ${geometry.scroll.height}px`);
    }
    await page.setViewport({ width: 1920, height: 1000 });

    const composerControls = await page.evaluate(() => ({
      resize: getComputedStyle(document.querySelector('[data-dialogue-input]')).resize,
      initialHeight: document.querySelector('[data-dialogue-input]').getBoundingClientRect().height,
      assistantMessages: document.querySelectorAll('.brief-message.is-assistant').length,
    }));
    assert.equal(composerControls.resize, 'vertical', '长文本输入框必须允许用户纵向拖动');
    await page.click('[data-dialogue-expand]');
    const expandedHeight = await page.$eval('[data-dialogue-input]', element => element.getBoundingClientRect().height);
    assert.ok(expandedHeight > composerControls.initialHeight + 30, '展开输入必须明显增加可见文本高度');
    await page.click('[data-dialogue-expand]');

    await page.click('[data-dialogue-reference]');
    assert.equal(await page.evaluate(() => window.__briefQa.refClicks), 1, '对话参考按钮必须触发隐藏上传入口');

    await page.click('[data-dialogue-professional]');
    await page.waitForFunction(() => document.querySelector('[data-brief-settings-modal]')?.getClientRects().length > 0);
    const modalFocus = await page.evaluate(() => {
      const modal = document.querySelector('[data-brief-settings-modal]');
      return modal.contains(document.activeElement);
    });
    assert.equal(modalFocus, true, '打开 modal 后焦点必须进入 modal');
    await page.click('[data-brief-form] [name="project_name"]');
    await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
    await page.keyboard.type('QA modal 同步名');
    assert.equal(await page.$eval('[data-contract-name]', element => element.textContent.trim()), 'QA modal 同步名', 'modal 表单修改必须同步到对话确认单');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-brief-settings-modal]')?.getClientRects().length);
    assert.equal(await page.evaluate(() => document.activeElement?.matches('[data-dialogue-professional]')), true, 'ESC 关闭后必须恢复触发器焦点');
    await page.click('[data-dialogue-professional]');
    assert.equal(await page.$eval('[data-brief-form] [name="project_name"]', element => element.value), 'QA modal 同步名', '关闭再打开不得丢失表单数据');
    await page.click('[data-brief-settings-close]');
    await page.waitForFunction(() => !document.querySelector('[data-brief-settings-modal]')?.getClientRects().length);
    assert.equal(await page.evaluate(() => document.activeElement?.matches('[data-dialogue-professional]')), true, '关闭按钮必须恢复触发器焦点');

    // 无参考确认：连续点击只能提交一次，并且成功后只导航一次到 plot。
    await page.click('[data-reference-choice="none"]');
    await page.waitForFunction(() => !document.querySelector('[data-dialogue-confirm]').disabled);
    await page.evaluate(() => {
      const button = document.querySelector('[data-dialogue-confirm]');
      button.click(); button.click();
    });
    await page.waitForFunction(() => window.__briefQa.navigateCalls.length === 1);
    const successful = await page.evaluate(() => ({
      stageCalls: window.__briefQa.stageCalls,
      stageOptions: window.__briefQa.stageOptions,
      navigateCalls: window.__briefQa.navigateCalls,
      realModelCalls: window.__briefQa.realModelCalls,
    }));
    stubbedStageCalls += successful.stageCalls;
    assert.equal(successful.stageCalls, 1, '连续确认不得重复提交 blueprint');
    assert.deepEqual(successful.stageOptions, [{ expected_content_revision: 1, idempotency_key: 'qa-project:blueprint:brief-confirm:r1' }], '自动生成必须带稳定内容版本和幂等键');
    assert.equal(successful.navigateCalls.length, 1, '成功后只能导航一次');
    assert.match(successful.navigateCalls[0].url, /\?view=plot$/, '成功后必须进入 plot');
    assert.equal(successful.realModelCalls, 0);

    // 重挂载仅恢复 UI，不得自行再次调用生成。
    await mountBrief();
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(await page.evaluate(() => window.__briefQa.stageCalls), 0, '刷新/重挂载不得自动重复生成');

    // 首次失败必须恢复可操作状态；第二次用户确认才允许重试一次。
    await mountBrief({ failFirst: true });
    await page.waitForSelector('[data-reference-question]');
    await page.click('[data-reference-choice="none"]');
    await page.waitForFunction(() => !document.querySelector('[data-dialogue-confirm]').disabled);
    await page.click('[data-dialogue-confirm]');
    await page.waitForFunction(() => window.__briefQa.stageCalls === 1 && !document.querySelector('[data-dialogue-confirm]').disabled);
    assert.equal(await page.evaluate(() => window.__briefQa.navigateCalls.length), 0, '失败时不得提前进入 plot');
    await page.click('[data-dialogue-confirm]');
    await page.waitForFunction(() => window.__briefQa.stageCalls === 2 && window.__briefQa.navigateCalls.length === 1);
    const recovered = await page.evaluate(() => ({ stageCalls: window.__briefQa.stageCalls, stageOptions: window.__briefQa.stageOptions, realModelCalls: window.__briefQa.realModelCalls }));
    stubbedStageCalls += recovered.stageCalls;
    assert.equal(recovered.stageCalls, 2, '失败恢复必须恰好一次失败加一次显式重试');
    assert.equal(recovered.stageOptions[0].idempotency_key, recovered.stageOptions[1].idempotency_key, '失败后的显式重试必须复用同一内容版本幂等键');
    assert.equal(recovered.realModelCalls, 0);

    // 新项目必须由用户先发起；智能回复使用当前内容并逐字呈现，测试只用 stub，不调用真实模型。
    await page.evaluate(async build => {
      document.body.innerHTML = `<main class="view-host" id="qa-dialogue"></main><form id="qa-dialogue-form">
        <input name="project_name"><select name="content_mode"><option value=""></option><option value="narrative_story">剧情</option><option value="commercial_subject">广告</option></select>
        <textarea name="brief"></textarea><input name="target_duration" value="30"><input name="output_ratio" value="9:16"><input name="video_resolution" value="1080p">
      </form>`;
      const module = await import(`/story-ad/views/briefDialoguePanel.js?v=${build}&qa=${Date.now()}`);
      const host = document.querySelector('#qa-dialogue');
      host.innerHTML = module.briefDialogueMarkup({ brief: {} }, { isNew: true });
      window.__dialogueQa = { modelCalls: 0, cleanup: module.bindBriefDialogue(host, {
        form: document.querySelector('#qa-dialogue-form'), requireUserInitiation: true,
        async onAssist(payload) {
          window.__dialogueQa.modelCalls += 1;
          window.__dialogueQa.payload = payload;
          await new Promise(resolve => setTimeout(resolve, 40));
          return { idea_ready: true, dialogue_reply: '我理解这是林夏与周远在雨夜车站重逢、最终彼此释然的克制爱情故事。接下来先确认成片时长、画幅和清晰度。' };
        },
      }) };
    }, BUILD);
    assert.equal(await page.$$eval('.brief-message.is-assistant', items => items.length), 0, '新项目不得预置助手对话，必须由用户先发起');
    await page.type('[data-dialogue-input]', '林夏与周远在雨夜车站重逢，两人最终没有复合，而是在遗憾中彼此释然。');
    await page.click('[data-dialogue-send]');
    await page.waitForSelector('.brief-message.is-streaming');
    await new Promise(resolve => setTimeout(resolve, 180));
    const partialReply = await page.$eval('.brief-message.is-assistant .brief-bubble p', element => element.textContent);
    assert.ok(partialReply.length > 0 && partialReply.length < 49, `逐字阶段必须是部分回复，实际 ${partialReply.length} 字`);
    await page.waitForFunction(() => {
      const message = document.querySelector('.brief-message.is-assistant');
      return message && !message.classList.contains('is-streaming') && message.textContent.includes('成片时长');
    });
    const dialogueQa = await page.evaluate(() => ({
      modelCalls: window.__dialogueQa.modelCalls,
      payload: window.__dialogueQa.payload,
      progress: document.querySelector('[data-dialogue-progress-text]').textContent,
      specificationQuestion: Boolean(document.querySelector('[data-specification-question]')),
      referenceQuestion: Boolean(document.querySelector('[data-reference-question]')),
    }));
    assert.equal(dialogueQa.modelCalls, 1, '每条用户消息只能触发一次导演助理调用');
    assert.match(dialogueQa.payload.accumulated_idea, /雨夜车站重逢/);
    assert.equal(dialogueQa.progress, '60%', '内容完整、名称已建议但规格未确认时准备度必须为 60%');
    assert.equal(dialogueQa.specificationQuestion, true, '内容完整后必须先整体确认成片规格');
    assert.equal(dialogueQa.referenceQuestion, false, '规格未确认前不得提前进入参考材料决定');
    await page.click('[data-specification-choice="confirm"]');
    await page.waitForSelector('[data-reference-question]');
    await page.type('[data-dialogue-input]', '没有');
    await page.click('[data-dialogue-send]');
    await page.waitForFunction(() => document.querySelector('[data-dialogue-progress-text]')?.textContent === '90%');
    const fastReferenceDecision = await page.evaluate(() => ({
      modelCalls: window.__dialogueQa.modelCalls,
      idea: document.querySelector('[name="brief"]').value,
      confirmDisabled: document.querySelector('[data-dialogue-confirm]').disabled,
    }));
    assert.equal(fastReferenceDecision.modelCalls, 1, '参考阶段回答“没有”不得再次调用模型');
    assert.doesNotMatch(fastReferenceDecision.idea, /(?:^|\n)没有(?:$|\n)/, '参考决定不得写入核心创意');
    assert.equal(fastReferenceDecision.confirmDisabled, false, '规格和参考均明确后才允许整体确认');

    // 正式蓝图与历史 reference_draft 并存时，正式蓝图必须胜出且不得误标参考来源。
    const plotResult = await page.evaluate(async build => {
      document.body.innerHTML = '<main class="view-host" id="qa-plot"></main>';
      const blueprint = { story_title: '正式剧情', logline: '正式内容', beats: [{ title: '正式段落', visual: '正式画面', spoken_line: '正式对白', duration: 3 }] };
      const referenceDraft = { story_title: '旧参考草稿', logline: '旧内容', beats: [{ title: '旧段落', visual: '', spoken_line: '', duration: 3 }] };
      const module = await import(`/story-ad/views/plotRoomView.js?v=${build}&qa=${Date.now()}`);
      const host = document.querySelector('#qa-plot');
      await module.mount(host, {
        bundle: { project: { id: 'qa-project' }, brief: { content_mode: 'narrative_story' }, story: { blueprint, reference_draft: referenceDraft } },
        store: { async runStage() { throw new Error('不得调用'); }, async updateRequest() {}, async saveBlueprint() {} },
        async refreshShell() {}, navigate() {},
      });
      return { text: host.innerText, title: host.querySelector('[name="story_title"]')?.value };
    }, BUILD);
    assert.equal(plotResult.title, '正式剧情', '剧情页必须显示正式蓝图');
    assert.doesNotMatch(plotResult.text, /来自参考视频分析|参考视频提取草稿/, '旧 reference 分析不得误标正式蓝图来源');
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify({
    passed: true,
    checks: 88,
    scope: 'story-ad-brief-modal-auto-blueprint-v103',
    stubbed_blueprint_stage_calls: stubbedStageCalls,
    real_model_calls: 0,
  }));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
