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

const viewports = [
  [1920, 1080], [1600, 900], [1440, 760],
  [1366, 680], [1280, 640], [1080, 720],
];

const projectCenterMarkup = `
  <header class="platform-topbar"><button class="platform-brand"><span>V</span><b>VIDO</b></button><div class="module-context"><b>剧情广告</b><span>任务中心</span></div><div class="top-actions"><button class="btn">返回工作台</button><button class="icon-btn">⚙</button><span class="avatar">U</span></div></header>
  <main class="center-shell"><div class="center-layout"><aside class="center-filter"><button class="filter active">全部项目 <b>8</b></button><button class="filter">进行中 <b>3</b></button><button class="filter">已完成 <b>5</b></button></aside><section class="center-content">
    <div class="create-banner"><div><h1>从一个想法开始制作剧情广告</h1><p>视频、人物、商品、场景和脚本均为可选材料。</p></div><button class="btn primary">开始创作</button></div>
    <div class="stat-grid">${Array.from({ length: 4 }, (_, index) => `<article class="stat-card"><span>统计 ${index + 1}</span><b>${index + 2}</b><small>实时数据</small></article>`).join('')}</div>
    <section class="project-table-card"><div class="table-toolbar"><div><h2>项目</h2><p>当前账号真实任务</p></div><button class="btn">刷新</button></div><div class="project-query"><label><span>项目名称</span><input class="input"></label><label><span>任务类型</span><select class="select"><option>全部</option></select></label><label><span>当前阶段</span><select class="select"><option>全部</option></select></label></div><div class="project-table">
      <div class="project-row project-head"><span>任务编号</span><span>项目名称</span><span>任务类型</span><span>当前阶段</span><span>镜头</span><span>最近更新</span><span>操作</span></div>
      ${Array.from({ length: 10 }, (_, index) => `<div class="project-row"><code>SA-20260821-${String(index + 1).padStart(2, '0')}</code><span class="project-copy"><b>多分辨率剧情广告项目</b><small>这是一段很长的项目描述，用来验证内容不会撑破页面宽度。</small></span><span class="project-mode is-story">剧情短片</span><span class="status-tag is-info">人物资产</span><span>18</span><time>08-21 14:20</time><span class="project-actions"><button class="btn small">打开</button><button class="btn small danger">删除</button></span></div>`).join('')}
    </div></section>
  </section></div></main>`;

const workspaceMarkup = `
  <main class="project-shell"><header class="project-topbar"><button class="wordmark">VIDO</button><b class="crumb">剧情广告</b><span class="crumb-separator">/</span><span class="project-title">多分辨率适配项目</span><span class="save-state">已保存</span><div class="top-actions"><button class="btn">任务中心</button><button class="btn">工作台</button><button class="icon-btn">⚙</button></div></header>
  <aside class="workspace-sidebar"><div class="side-label">剧情广告制作</div><nav>${['对话立项','剧情与对白','人物资产','场景世界','线稿与分镜','镜头与合成'].map((label,index)=>`<button class="workspace-nav${index===1?' active':''}"><span class="nav-number">${index+1}</span><span>${label}</span><small>${index===0?'完成':''}</small></button>`).join('')}<button class="workspace-nav workflow"><span class="nav-number">⌘</span><span>工作流画布</span></button></nav></aside>
  <section class="workspace-main"><div class="view-host"><header class="view-head"><div><h1>剧情与对白</h1><p>根据已确认的立项内容生成剧情结构，并保留人工编辑入口。</p></div><div class="view-actions"><button class="btn">重新生成</button><button class="btn">保存修改</button><button class="btn primary">下一步</button></div></header><p class="guide">页面内容会随真实数据增长，纵向滚动属于有效内容滚动。</p>
    <div class="two-column"><section class="card"><header class="card-head"><div><h2>剧情结构</h2><p>跨分辨率主内容区</p></div><button class="btn">添加情节</button></header><div class="card-body"><div class="plot-workspace"><div class="story-overview-card"><div class="card-body"><label class="field"><span>标题</span><input class="input"></label><label class="field"><span>梗概</span><textarea class="textarea"></textarea></label><label class="field"><span>基调</span><select class="select"><option>温暖</option></select></label></div></div></div><div class="shot-table"><div class="shot-table-scroll"><div class="shot-row" style="min-width:760px"><span>01</span><span>人物在雨夜重逢</span><span>中景</span><span>环境声</span><button class="btn">编辑</button></div></div></div></div></section><aside class="card"><header class="card-head"><div><h2>信息摘要</h2><p>侧栏内容</p></div></header><div class="card-body"><p>项目名称、规格和参考材料状态。</p></div></aside></div>
  </div></section></main>`;

async function geometry(page, marker) {
  return page.evaluate(marker => {
    const viewportWidth = document.documentElement.clientWidth;
    const visible = element => element && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden';
    const escaped = [...document.querySelectorAll('body *')].filter(visible).map(element => {
      const rect = element.getBoundingClientRect();
      return { tag: element.tagName, cls: String(element.className || ''), left: Math.round(rect.left), right: Math.round(rect.right) };
    }).filter(item => item.left < -1 || item.right > viewportWidth + 1).slice(0, 8);
    const actions = [...document.querySelectorAll('.top-actions .btn, .view-actions .btn, .project-actions .btn')].filter(visible).map(element => {
      const rect = element.getBoundingClientRect();
      return { text: element.textContent.trim(), left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    });
    return {
      marker,
      overflowX: document.documentElement.scrollWidth - viewportWidth,
      escaped,
      actions,
      sidebarRight: document.querySelector('.workspace-sidebar')?.getBoundingClientRect().right || 0,
      mainLeft: document.querySelector('.workspace-main')?.getBoundingClientRect().left || 0,
      internalTable: (() => { const el = document.querySelector('.shot-table-scroll'); return el ? { overflowX: getComputedStyle(el).overflowX, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth } : null; })(),
    };
  }, marker);
}

async function main() {
  assert.ok(chrome, '平台多分辨率回归需要 Chrome/Chromium');
  const browser = await puppeteer.launch({ headless: true, executablePath: chrome });
  let checks = 0;
  try {
    const page = await browser.newPage();
    await page.goto(`http://localhost:3007/story-ad/release.js?responsive=${Date.now()}`, { waitUntil: 'domcontentloaded' });
    for (const file of ['public/story-ad/styles.css','public/story-ad/workspace.css','public/story-ad/workspace-ux.css','public/story-ad/platform-responsive.css','public/story-ad/workflow.css']) await page.addStyleTag({ content: read(file) });
    for (const [width, height] of viewports) {
      await page.setViewport({ width, height });
      for (const [name, markup] of [['任务中心', projectCenterMarkup], ['六步工作区', workspaceMarkup]]) {
        await page.evaluate(markup => { document.body.innerHTML = markup; }, markup);
        const result = await geometry(page, name);
        const label = `${name} ${width}x${height}`;
        assert.ok(result.overflowX <= 1, `${label} 不得出现页面横向溢出：${result.overflowX}px ${JSON.stringify(result.escaped)}`); checks += 1;
        assert.ok(result.actions.every(action => action.left >= -1 && action.right <= width + 1 && action.top >= -1), `${label} 关键操作必须在视口内：${JSON.stringify(result.actions)}`); checks += 1;
        if (name === '六步工作区') {
          assert.ok(Math.abs(result.sidebarRight - result.mainLeft) <= 1, `${label} 侧栏与内容区不得重叠或留缝`); checks += 1;
          assert.ok(result.internalTable && ['auto', 'scroll'].includes(result.internalTable.overflowX), `${label} 宽表必须由自己的容器接管横向滚动：${JSON.stringify(result.internalTable)}`); checks += 1;
        }
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`story-ad platform responsive v108: ${checks} checks passed across ${viewports.length} viewports; model calls 0`);
}

main().catch(error => { console.error(error); process.exit(1); });
