#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const asModule = source => import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const chrome = [
  process.env.CHROME_PATH,
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome',
].find(file => file && fs.existsSync(file));

async function main() {
  const ui = await asModule(read('public/story-ad/components/ui.js'));
  const failedBundle = stage => ({
    project: {
      id: 'ux-regression-project',
      status: 'failed',
      stage,
      error: 'provider content audit rejected',
      error_code: 'PROVIDER_CONTENT_AUDIT',
    },
    generation: {
      progress: {
        status: 'failed',
        stage,
        error_code: 'PROVIDER_CONTENT_AUDIT',
        message: 'provider content audit rejected',
        total: 1,
      },
    },
  });

  assert.equal(ui.generationProgressOwningView('subject_assets'), 'assets');
  assert.equal(ui.generationProgressOwningView('visual_assets'), 'assets');
  assert.equal(ui.generationProgressOwningView('scene_asset'), 'scene');
  assert.equal(ui.generationProgressOwningView('blueprint'), 'plot');
  assert.equal(ui.generationProgressOwningView('storyboard'), 'storyboard');
  assert.equal(ui.generationProgressOwningView('video'), 'final');
  assert.equal(ui.generationProgressOwningView('scene_asset_failed'), 'scene', '终态后缀不能破坏步骤归属');
  assert.equal(ui.generationProgressOwningView('blueprint_queued'), 'plot', '运行态后缀不能破坏步骤归属');

  const subjectFailure = failedBundle('subject_assets');
  assert.equal(ui.generationProgressPanel(subjectFailure, 'brief'), '', '人物终态错误不得跨到立项页');
  assert.match(ui.generationProgressPanel(subjectFailure, 'assets'), /人物与动物资产内容审核未通过/, '人物终态错误必须留在人物资产页');

  const checkpointFailure = failedBundle('visual_assets');
  checkpointFailure.assets = {
    people: [{
      name: '测试人物',
      checkpoint_recovery_summary: {
        completed_units: 2,
        total_units: 3,
        missing_units: [{ label: '侧面', reason: '内容审核未通过', error_code: 'PROVIDER_CONTENT_AUDIT' }],
      },
    }],
  };
  assert.equal(ui.generationProgressPanel(checkpointFailure, 'brief'), '', '视觉资产恢复错误不得跨到立项页');
  assert.equal(ui.generationProgressPanel(checkpointFailure, 'assets'), '', '人物页已有专用恢复卡时不得重复全局横幅');

  const sceneFailure = failedBundle('scene_asset');
  assert.equal(ui.generationProgressPanel(sceneFailure, 'assets'), '', '场景错误不得跨到人物页');
  assert.match(ui.generationProgressPanel(sceneFailure, 'scene'), /场景视图内容审核未通过/, '场景错误必须显示在场景页');

  [
    ['subject_assets', 'assets'],
    ['scene_asset_failed', 'scene'],
    ['blueprint_failed', 'plot'],
    ['storyboard_failed', 'storyboard'],
    ['video_failed', 'final'],
  ].forEach(([stage, owner]) => {
    const failure = failedBundle(stage);
    ['brief', 'assets', 'scene', 'plot', 'storyboard', 'final'].forEach(view => {
      const rendered = ui.generationProgressPanel(failure, view);
      if (view === owner) assert.notEqual(rendered, '', `${stage} 必须在 ${owner} 显示`);
      else assert.equal(rendered, '', `${stage} 错误正文不得从 ${owner} 跨到 ${view}`);
    });
  });
  assert.equal(ui.generationProgressPanel(failedBundle('unknown_business_stage'), 'brief'), '', '未知业务错误也不得退化为全局正文');

  const editorSource = read('public/story-ad/views/plotBeatEditor.js')
    .replace(/^import[^\n]+\n/, 'const escapeHtml = value => String(value ?? "");\n');
  const editor = await asModule(editorSource);
  const beat = editor.beatEditor({ title: '开场钩子', visual: '人物推门进入', spoken_line: '开始吧', duration: 6 }, 0);
  assert.match(beat, /beat-visual-cell"><strong class="beat-title-summary"[^>]*>开场钩子<\/strong><span class="beat-visual-summary"[^>]*>人物推门进入<\/span><\/span>/, '标题必须并入画面列，而不是另起一条错位行');
  assert(beat.indexOf('beat-duration-summary') < beat.indexOf('beat-visual-cell'), '情节点 DOM 必须与段落、时长、画面、对白、操作列顺序一致');
  assert(beat.indexOf('beat-visual-cell') < beat.indexOf('beat-spoken-summary'));
  assert(beat.indexOf('beat-spoken-summary') < beat.indexOf('beat-actions'));

  const css = read('public/story-ad/workspace-ux.css');
  const desktopColumns = css.match(/\.beat-table-head,\.beat-overview\{[^}]*grid-template-columns:54px 70px minmax\(320px,1\.55fr\) minmax\(220px,1fr\) (\d+)px/);
  assert(desktopColumns, '桌面表头与数据行必须共用同一列轨');
  const actionColumn = Number(desktopColumns[1]);
  const requiredActionWidth = (3 * 78) + (2 * 7);
  assert(actionColumn >= requiredActionWidth, `操作列 ${actionColumn}px 必须容纳三个按钮所需的 ${requiredActionWidth}px`);
  assert.doesNotMatch(css, /\.beat-title-summary\{[^}]*grid-column:1\/-1/, '标题不得再次跨越整行制造隐式行');
  assert.match(css, /@media\(max-width:1320px\)\{[\s\S]*?\.beat-table-head\{display:none\}/, '窄屏必须切换卡片布局并隐藏表头');
  assert.match(css, /@media\(max-width:1320px\)[\s\S]*?\.beat-overview \.beat-actions\{grid-column:2\/4;grid-row:3;[^}]*flex-wrap:wrap/, '窄屏操作必须独占卡片行且允许换行');

  assert.ok(chrome, '剧情表几何回归需要可用的 Chrome/Chromium');
  const browser = await puppeteer.launch({ headless: true, executablePath: chrome });
  try {
    const page = await browser.newPage();
    const allCss = ['public/story-ad/styles.css', 'public/story-ad/workspace.css', 'public/story-ad/workspace-ux.css']
      .map(read).join('\n');
    await page.setContent(`<style>${allCss}</style><div class="project-shell"><header class="project-topbar"></header><aside class="workspace-sidebar"></aside><main class="workspace-main"><div class="view-host"><div class="plot-workspace"><section class="card plot-sequence-card"><div class="beat-table-head"><span>段落</span><span>时长</span><span>画面与剧情动作</span><span>对白 / 旁白</span><span>操作</span></div><div class="card-body beat-list">${beat}</div></section></div></div></main></div>`);
    const snapshot = () => page.evaluate(() => {
      const rect = selector => {
        const value = document.querySelector(selector).getBoundingClientRect();
        return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width };
      };
      const card = rect('.plot-sequence-card');
      const actions = rect('.beat-actions');
      const visual = rect('.beat-visual-cell');
      const spoken = rect('.beat-spoken-summary');
      const headVisual = rect('.beat-table-head span:nth-child(3)');
      return {
        card, actions, visual, spoken, headVisual,
        headerDisplay: getComputedStyle(document.querySelector('.beat-table-head')).display,
        cardScrollWidth: document.querySelector('.plot-sequence-card').scrollWidth,
        cardClientWidth: document.querySelector('.plot-sequence-card').clientWidth,
      };
    });

    await page.setViewport({ width: 1920, height: 900 });
    const wide = await snapshot();
    assert.equal(wide.headerDisplay, 'grid', '宽屏必须保留同列轨表头');
    assert.ok(Math.abs(wide.headVisual.left - wide.visual.left) <= 1, `宽屏画面列未对齐：${wide.headVisual.left} / ${wide.visual.left}`);
    assert.ok(wide.actions.right <= wide.card.right + 1, '宽屏操作按钮不得被卡片右侧裁切');
    assert.ok(wide.cardScrollWidth <= wide.cardClientWidth + 1, '宽屏剧情卡不得产生隐藏横向溢出');

    await page.setViewport({ width: 1280, height: 900 });
    const narrow = await snapshot();
    assert.equal(narrow.headerDisplay, 'none', '1280px 必须切换为卡片布局');
    assert.ok(narrow.actions.top >= narrow.spoken.bottom, '卡片布局操作区必须位于对白区下方');
    assert.ok(narrow.actions.right <= narrow.card.right + 1, '卡片布局操作按钮不得被裁切');
    assert.ok(narrow.cardScrollWidth <= narrow.cardClientWidth + 1, '卡片布局不得产生隐藏横向溢出');
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify({ passed: true, checks: 64, scope: 'story-ad-workspace-ux-v100-regressions', model_calls: 0 }));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
