/**
 * VIDO drama-studio.js — 真实 API 集成层
 *
 * 替代原型里的 mock data，连接现有 /api/drama/* 端点。
 *
 * 流程：
 *   1. 进入页面：?pid=xxx 加载项目 + episodes，或回首页选项目
 *   2. 选剧集：加载 scenes，渲染分镜列表 + 中央编辑区
 *   3. 选分镜：显示当前 scene 的 prompt + dialogue
 *   4. 单分镜操作：编辑、生图、生视频
 *   5. 全局：图片快速合成、全部生成视频、视频高质量合成
 *   6. 创建剧集：POST /episodes 触发 6-step pipeline + SSE 进度
 */

'use strict';

// ═════════ STATE ═════════
let currentProject = null;     // 当前项目
let currentEpisode = null;     // 当前剧集
let currentSceneIdx = -1;      // 当前选中的分镜
let projectId = null;          // URL ?pid 解析
let allEpisodes = [];          // 项目下所有剧集
let progressSSE = null;        // SSE 连接

// ═════════ INIT ═════════
async function initStudio() {
  // 1. 解析 URL ?pid=xxx
  const url = new URL(location.href);
  projectId = url.searchParams.get('pid');

  if (!projectId) {
    // 没有 pid → 加载用户的第一个项目，或显示空状态
    try {
      const r = await authFetch('/api/drama/projects');
      const j = await r.json();
      if (j.success && j.data?.length) {
        projectId = j.data[0].id;
        history.replaceState(null, '', `?pid=${projectId}`);
      } else {
        showEmptyState('暂无网剧项目，去 Studio 创建一个');
        return;
      }
    } catch (e) {
      showEmptyState('加载失败：' + e.message);
      return;
    }
  }

  // 2. 加载项目详情
  try {
    const r = await authFetch(`/api/drama/projects/${projectId}`);
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    currentProject = j.data;
    allEpisodes = j.data.episodes || [];
    renderProjectHeader();
    renderEpisodes();

    // 3. 自动选第一个已完成 episode（或第一个）
    const firstDone = allEpisodes.find(e => e.status === 'done');
    const target = firstDone || allEpisodes[0];
    if (target) {
      await loadEpisode(target.id);
    } else {
      showEmptyEpisode();
    }
  } catch (e) {
    console.error('[drama-studio] init failed:', e);
    showEmptyState('加载项目失败：' + e.message);
  }
}

// ═════════ RENDERERS ═════════
function renderProjectHeader() {
  // 顶栏项目名
  const projPill = document.querySelector('.tb-pill');
  if (projPill && currentProject) {
    projPill.innerHTML = `📁 ${escapeHtml(currentProject.title)} <span class="arrow">⌄</span>`;
  }
}

function renderEpisodes() {
  const track = document.getElementById('eps-track');
  const ddList = document.getElementById('eps-dd-list');
  const ddTitle = document.querySelector('.eps-dd-title');
  if (ddTitle) ddTitle.textContent = `📺 全部剧集 (${allEpisodes.length})`;

  if (track) {
    track.innerHTML = allEpisodes.map(e => {
      const isActive = currentEpisode && e.id === currentEpisode.id;
      const dur = e.result?.duration ? formatDur(e.result.duration) : '--:--';
      const name = (e.title || `第${e.episode_index}集`).replace(/^第\d+集[：:]?/, '') || `第${e.episode_index}集`;
      return `
        <div class="eps-chip ${isActive ? 'active' : ''}" onclick="loadEpisode('${e.id}')" ondblclick="event.stopPropagation();renameEpisode('${e.id}',this)">
          <span class="eps-num">EP ${String(e.episode_index).padStart(2,'0')}</span>
          <span class="eps-name">${escapeHtml(name)}</span>
          <span class="eps-dur">${dur}</span>
        </div>
      `;
    }).join('') || '<div style="font-size:11px;color:var(--c-text-3);padding:8px;">暂无剧集</div>';
  }

  if (ddList) {
    ddList.innerHTML = allEpisodes.map(e => {
      const isActive = currentEpisode && e.id === currentEpisode.id;
      const statusMap = { done: '已完成', processing: '生成中', error: '失败', empty: '未开始', draft: '草稿' };
      const statusCls = { done: 'done', processing: 'draft', error: 'empty', empty: 'empty', draft: 'draft' };
      const name = e.title || `第${e.episode_index}集`;
      const sceneCount = e.result?.scenes?.length || 0;
      const dur = e.result?.duration ? formatDur(e.result.duration) : '--:--';
      // 已生成成片时显示下载按钮
      const hasFinal = e.result?.final_video_url;
      const downloadBtn = hasFinal
        ? `<button class="eps-dd-download" onclick="event.stopPropagation();downloadEpisode('${e.id}','${escapeHtml(name)}')" title="下载本集成片"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16"/></svg></button>`
        : '';
      return `
        <div class="eps-dd-item ${isActive ? 'active' : ''}" onclick="loadEpisode('${e.id}');closeEpsDropdown();">
          <div class="eps-dd-thumb"></div>
          <div class="eps-dd-info">
            <div class="eps-dd-name">${escapeHtml(name)}</div>
            <div class="eps-dd-meta"><b>${dur}</b> · ${sceneCount} 个分镜</div>
          </div>
          <span class="eps-dd-status ${statusCls[e.status] || 'empty'}">${statusMap[e.status] || e.status}</span>
          ${downloadBtn}
        </div>
      `;
    }).join('') || '<div style="padding:14px;color:var(--c-text-3);font-size:11px;text-align:center;">暂无剧集</div>';
  }
}

// v15 fix #2: 下载本集成片
async function downloadEpisode(eid, name) {
  try {
    showToast('下载中…', 'info');
    const r = await authFetch(`/api/drama/tasks/${eid}/final/download`);
    if (!r.ok) throw new Error('下载失败 HTTP ' + r.status);
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (name || 'episode') + '.mp4';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('✓ 已下载', 'ok');
  } catch (e) {
    showToast('下载失败: ' + e.message, 'error');
  }
}
window.downloadEpisode = downloadEpisode;

// v15 fix #3: 上传 .txt/.md 剧本文件（支持 GBK/GB2312/Big5 自动检测）
function onScriptFileChosen(input) {
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    showToast('文件过大 (最大 5MB)', 'error');
    return;
  }

  // 先用 ArrayBuffer 读取，自动检测编码
  const reader = new FileReader();
  reader.onload = (e) => {
    const buf = e.target.result;
    const bytes = new Uint8Array(buf);

    // 尝试 UTF-8 解码，检查是否有乱码（replacement char U+FFFD）
    let text = new TextDecoder('utf-8').decode(bytes);
    const hasGarble = text.includes('\uFFFD') || /[\x80-\xFF]{4,}/.test(text.slice(0, 200));

    if (hasGarble) {
      // 尝试 GBK（覆盖 GB2312）
      try {
        const gbkText = new TextDecoder('gbk').decode(bytes);
        if (!gbkText.includes('\uFFFD')) {
          text = gbkText;
        }
      } catch {
        // GBK 不支持时尝试 gb18030
        try {
          text = new TextDecoder('gb18030').decode(bytes);
        } catch {}
      }
    }

    // 去除 BOM
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

    const ta = document.querySelector('.center-body .section-card:first-child .prompt-ta');
    if (ta) {
      ta.value = text;
      showToast(`✓ 已导入 ${file.name} (${text.length} 字)`, 'ok');
    }
  };
  reader.onerror = () => showToast('读取失败', 'error');
  reader.readAsArrayBuffer(file);
  input.value = '';
}
window.onScriptFileChosen = onScriptFileChosen;

// v15 fix #3: 平台小说选择器（修复：章节选择 + 内容显示）
let _novelCache = {};  // 缓存已加载的小说详情
async function openNovelPicker() {
  const modal = document.getElementById('novel-picker-modal');
  const list = document.getElementById('novel-picker-list');
  if (!modal || !list) return;
  modal.classList.add('show');
  list.innerHTML = '<div style="padding:30px;text-align:center;color:var(--c-text-3);">加载中...</div>';
  try {
    const r = await authFetch('/api/novel/');
    const j = await r.json();
    const novels = j.novels || j.data || [];
    const items = Array.isArray(novels) ? novels : [];
    if (!items.length) {
      list.innerHTML = '<div style="padding:30px;text-align:center;color:var(--c-text-3);font-size:12px;">暂无小说<br/><span style="font-size:10px;">先去 AI 小说创建一部</span></div>';
      return;
    }
    list.innerHTML = items.map(n => {
      const wordCount = n.total_words || n.word_count || (n.chapters || []).reduce((s, c) => s + (c.content?.length || 0), 0);
      const chapCount = (n.chapters || []).length;
      const statusMap = { draft: '草稿', outline_done: '大纲完成', generating: '生成中', done: '已完成' };
      const statusText = statusMap[n.status] || n.status || '未知';
      const hasContent = chapCount > 0 && (n.chapters || []).some(c => c.content?.length > 0);
      return `
        <div class="novel-pick-item" onclick="pickNovel('${n.id}')" style="padding:14px;border:1px solid var(--c-border-2);border-radius:8px;margin-bottom:8px;cursor:pointer;transition:all .2s;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <span style="font-weight:600;font-size:13px;color:var(--c-text);">${escapeHtml(n.title || '未命名')}</span>
            <span style="font-size:9px;padding:2px 6px;border-radius:4px;background:${hasContent ? 'rgba(16,185,129,.15)' : 'rgba(245,158,11,.15)'};color:${hasContent ? '#34d399' : '#fbbf24'};">${statusText}</span>
          </div>
          <div style="font-size:10px;color:var(--c-text-3);">${chapCount} 章 · ${wordCount} 字 · ${n.genre || n.type || '短篇'}</div>
          <div style="font-size:10px;color:var(--c-text-2);margin-top:4px;line-height:1.5;">${escapeHtml((n.description || n.synopsis || '').slice(0, 120))}${(n.description || n.synopsis || '').length > 120 ? '...' : ''}</div>
        </div>
      `;
    }).join('');
  } catch (e) {
    list.innerHTML = `<div style="padding:30px;text-align:center;color:#f87171;font-size:12px;">加载失败: ${e.message}</div>`;
  }
}
window.openNovelPicker = openNovelPicker;

function closeNovelPicker() {
  document.getElementById('novel-picker-modal')?.classList.remove('show');
}
window.closeNovelPicker = closeNovelPicker;

async function pickNovel(novelId) {
  const list = document.getElementById('novel-picker-list');
  try {
    // 显示加载状态
    if (list) list.innerHTML = '<div style="padding:30px;text-align:center;color:var(--c-text-3);">加载小说详情...</div>';

    const r = await authFetch('/api/novel/' + novelId);
    const j = await r.json();
    const novel = j.novel || j.data || j;
    if (!novel) throw new Error('小说数据为空');
    const title = novel.title || '未命名小说';
    _novelCache[novelId] = novel;

    const chapters = novel.chapters || [];
    const outline = novel.outline;
    const hasChapterContent = chapters.some(c => c.content?.length > 0);

    if (chapters.length > 0 && hasChapterContent) {
      // 显示章节选择界面，让用户选择导入哪些章节
      if (list) {
        list.innerHTML = `
          <div style="padding:10px 14px;">
            <div style="font-weight:700;font-size:14px;color:var(--c-text);margin-bottom:10px;">📖 《${escapeHtml(title)}》 共 ${chapters.length} 章</div>
            <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
              <button class="mini-btn primary" onclick="importAndGenerate('${novelId}')" title="导入章节后自动用编剧Agent将小说转换为影视脚本">导入并生成影视脚本</button>
              <button class="mini-btn" onclick="importAllChapters('${novelId}')">仅导入原文</button>
              <button class="mini-btn" onclick="openNovelPicker()">← 返回列表</button>
            </div>
            <div style="font-size:9px;color:var(--c-cyan);margin-bottom:8px;line-height:1.5;">提示：「导入并生成影视脚本」会自动将小说内容交给编剧Agent转换为专业分镜脚本</div>
            <div style="font-size:10px;color:var(--c-text-3);margin-bottom:8px;">点击章节可单独导入到当前剧集：</div>
            <div style="max-height:40vh;overflow-y:auto;">
              ${chapters.map((c, i) => {
                const wordCount = (c.content || '').length;
                const preview = (c.content || '').slice(0, 60).replace(/\n/g, ' ');
                return `
                  <div onclick="importSingleChapter('${novelId}',${i})" style="padding:10px;border:1px solid var(--c-border);border-radius:6px;margin-bottom:6px;cursor:pointer;transition:all .2s;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                      <span style="font-weight:600;font-size:12px;color:var(--c-text);">${escapeHtml(c.title || '第' + (i + 1) + '章')}</span>
                      <span style="font-size:9px;color:${wordCount > 0 ? 'var(--c-text-3)' : '#f87171'};">${wordCount > 0 ? wordCount + '字' : '无内容'}</span>
                    </div>
                    ${preview ? `<div style="font-size:10px;color:var(--c-text-2);margin-top:4px;line-height:1.4;">${escapeHtml(preview)}...</div>` : ''}
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      }
      return; // 不关闭 modal，等用户选择
    } else if (outline) {
      // 有大纲但无章节内容
      const outlineText = typeof outline === 'string' ? outline : JSON.stringify(outline, null, 2);
      const ta = document.querySelector('.center-body .section-card:first-child .prompt-ta');
      if (ta) ta.value = outlineText;
      showToast(`✓ 已导入《${title}》大纲`, 'ok');
    } else {
      // 只有描述
      const ta = document.querySelector('.center-body .section-card:first-child .prompt-ta');
      if (ta) ta.value = novel.description || title;
      showToast(`✓ 已导入《${title}》(无章节内容，请先在小说模块生成章节)`, 'info');
    }

    closeNovelPicker();
    if (currentEpisode) await loadEpisode(currentEpisode.id);
  } catch (e) {
    showToast('导入失败: ' + e.message, 'error');
  }
}
window.pickNovel = pickNovel;

// 全部章节导入到对应剧集
async function importAllChapters(novelId, autoGenerate = false) {
  const novel = _novelCache[novelId];
  if (!novel) return showToast('请重新选择小说', 'error');
  const chapters = novel.chapters || [];
  const eps = allEpisodes || [];
  let importedCount = 0;
  showToast('正在导入章节...', 'info');
  for (let i = 0; i < chapters.length && i < eps.length; i++) {
    const chap = chapters[i];
    if (!chap.content || chap.content.trim().length < 5) continue;
    const epText = `## ${chap.title || '第' + (i + 1) + '章'}\n\n${chap.content}`;
    try {
      await authFetch(`/api/drama/projects/${projectId}/episodes/${eps[i].id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: epText }),
      });
      importedCount++;
    } catch {}
  }
  // 当前集也更新 textarea
  if (currentEpisode) {
    const curIdx = eps.findIndex(e => e.id === currentEpisode.id);
    const curChap = curIdx >= 0 && curIdx < chapters.length ? chapters[curIdx] : null;
    if (curChap?.content) {
      const ta = document.querySelector('.center-body .section-card:first-child .prompt-ta');
      if (ta) ta.value = `## ${curChap.title || '章节'}\n\n${curChap.content}`;
    }
  }
  closeNovelPicker();
  showToast(`✓ 已导入《${novel.title || '小说'}》${importedCount} 集章节`, 'ok');
  if (currentEpisode) await loadEpisode(currentEpisode.id);

  // 导入后自动触发当前集的编剧 AI 创作
  if (autoGenerate && currentEpisode) {
    showToast('正在自动将小说内容转换为影视脚本...', 'info');
    setTimeout(() => generateCurrentEpisode(), 500);
  }
}
window.importAllChapters = importAllChapters;

// 导入并自动生成剧本
async function importAndGenerate(novelId) {
  await importAllChapters(novelId, true);
}
window.importAndGenerate = importAndGenerate;

// 单个章节导入到当前剧集
async function importSingleChapter(novelId, chapterIdx) {
  const novel = _novelCache[novelId];
  if (!novel) return showToast('请重新选择小说', 'error');
  const chap = novel.chapters?.[chapterIdx];
  if (!chap) return showToast('章节不存在', 'error');
  if (!chap.content || chap.content.trim().length < 2) return showToast('该章节无内容', 'info');

  const epText = `## ${chap.title || '第' + (chapterIdx + 1) + '章'}\n\n${chap.content}`;
  const ta = document.querySelector('.center-body .section-card:first-child .prompt-ta');
  if (ta) ta.value = epText;

  // 保存到当前 episode
  if (currentEpisode) {
    try {
      await authFetch(`/api/drama/projects/${projectId}/episodes/${currentEpisode.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: epText }),
      });
    } catch {}
  }
  closeNovelPicker();
  showToast(`✓ 已导入《${chap.title || '章节'}》到当前集`, 'ok');
}
window.importSingleChapter = importSingleChapter;

async function loadEpisode(eid) {
  try {
    const r = await authFetch(`/api/drama/projects/${projectId}/episodes/${eid}`);
    const j = await r.json();
    if (!j.success) throw new Error(j.error);
    currentEpisode = j.data;
    currentSceneIdx = 0;
    renderEpisodes();      // 更新顶栏 active
    renderShots();         // 渲染分镜列表
    renderCurrentScene();  // 渲染中央编辑区
    renderRightPanel();    // 渲染右侧角色/场景/物品/视频
    // 滚动到当前 active 的 eps-chip
    scrollActiveChipIntoView();
  } catch (e) {
    console.error('[loadEpisode] failed:', e);
    showToast('加载剧集失败: ' + e.message, 'error');
  }
}
window.loadEpisode = loadEpisode;

function scrollActiveChipIntoView() {
  requestAnimationFrame(() => {
    const active = document.querySelector('.eps-chip.active');
    if (active) active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  });
}

async function renameEpisode(eid, chipEl) {
  const ep = allEpisodes.find(e => e.id === eid);
  if (!ep) return;
  const nameSpan = chipEl.querySelector('.eps-name');
  if (!nameSpan) return;
  const oldName = ep.title || `第${ep.episode_index}集`;
  const input = document.createElement('input');
  input.type = 'text';
  input.value = oldName;
  input.style.cssText = 'width:80px;background:var(--c-bg);border:1px solid var(--c-cyan);border-radius:4px;color:var(--c-text);font-size:11px;padding:2px 4px;outline:none;';
  nameSpan.textContent = '';
  nameSpan.appendChild(input);
  input.focus();
  input.select();
  const commit = async () => {
    const newName = input.value.trim() || oldName;
    nameSpan.textContent = newName;
    if (newName !== oldName) {
      try {
        await authFetch(`/api/drama/projects/${projectId}/episodes/${eid}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: newName }),
        });
        ep.title = newName;
        if (currentEpisode?.id === eid) currentEpisode.title = newName;
        renderEpisodes();
      } catch (e) {
        showToast('重命名失败: ' + e.message, 'error');
        nameSpan.textContent = oldName;
      }
    }
  };
  input.addEventListener('blur', commit, { once: true });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = oldName; input.blur(); }
  });
}
window.renameEpisode = renameEpisode;

function renderShots() {
  const list = document.getElementById('shots-list');
  if (!list) return;
  const scenes = currentEpisode?.result?.scenes || [];
  const epTitle = currentEpisode?.title || '第?集';

  // 更新分镜数 badge
  const countEl = document.querySelector('.shots-count');
  if (countEl) countEl.textContent = `${scenes.length} 个`;

  if (!scenes.length) {
    list.innerHTML = `<div style="padding:30px 12px;text-align:center;color:var(--c-text-3);font-size:11px;">本集还没有分镜<br/><button class="mini-btn primary" style="margin-top:12px;" onclick="generateCurrentEpisode()">✨ AI 智能创作</button></div>`;
    return;
  }

  list.innerHTML = scenes.map((s, i) => {
    const hasImg = !!s.image_url;
    const hasVideo = !!s.video_url;
    const isActive = i === currentSceneIdx;
    const desc = (s.description || s.visual_prompt || '').slice(0, 40);
    return `
      <div class="shot-item ${isActive ? 'active' : ''}" onclick="selectScene(${i})">
        <div class="shot-num">${i + 1}</div>
        <div>
          <div class="shot-thumb ${hasImg ? 'has-img' : ''}" ${hasImg ? `style="background-image:url(${s.image_url});background-size:cover;background-position:center;"` : ''}>
            ${hasImg ? '' : '<div class="shot-thumb-ph">+</div>'}
          </div>
          <div class="shot-text">${escapeHtml(desc)}${desc.length >= 40 ? '...' : ''}</div>
          ${hasVideo ? '<div style="font-size:9px;color:var(--c-emerald,#34d399);margin-top:2px;">▶ 视频已生成</div>' : ''}
        </div>
      </div>
    `;
  }).join('');
}

function renderCurrentScene() {
  const scenes = currentEpisode?.result?.scenes || [];
  const scene = scenes[currentSceneIdx];

  // 中央标题
  const titleEl = document.querySelector('.center-title');
  if (titleEl) {
    if (scene) {
      const desc = (scene.description || '').slice(0, 30);
      titleEl.innerHTML = `分镜 #${currentSceneIdx + 1} · ${escapeHtml(desc)}<span class="ratio">${currentEpisode.result?.aspect_ratio || '16:9'} · ${scene.duration || 5}s</span>`;
    } else {
      titleEl.innerHTML = '请选择分镜 →<span class="ratio">--</span>';
    }
  }

  // 4 个画面 grid (首帧/通用/变体/尾帧)
  const frameGrid = document.querySelector('.frame-grid');
  if (frameGrid && !scene) {
    frameGrid.innerHTML = ['主图','变体 1','变体 2','尾帧'].map(l =>
      `<div class="frame"><span class="frame-label">${l}</span><span class="frame-icon">+</span></div>`
    ).join('');
  }
  if (frameGrid && scene) {
    const imgUrl = scene.image_url;
    frameGrid.innerHTML = `
      <div class="frame ${imgUrl ? 'has-img' : ''}" ${imgUrl ? `style="background-image:url(${imgUrl});background-size:cover;background-position:center;"` : ''} onclick="generateSingleImage()">
        <span class="frame-label">主图</span>
        ${imgUrl ? '' : '<span class="frame-icon">+</span>'}
      </div>
      <div class="frame" onclick="generateSingleImage('variant')">
        <span class="frame-label">变体 1</span>
        <span class="frame-icon">+</span>
      </div>
      <div class="frame" onclick="generateSingleImage('variant')">
        <span class="frame-label">变体 2</span>
        <span class="frame-icon">+</span>
      </div>
      <div class="frame" onclick="generateSingleImage('end')">
        <span class="frame-label">尾帧</span>
        <span class="frame-icon">+</span>
      </div>
    `;
  }

  // 提示词 textarea
  const promptTa = document.querySelectorAll('.prompt-ta')[0];
  if (promptTa) {
    if (scene) {
      promptTa.value = scene.full_prompt_cn || scene.visual_prompt || scene.description || '';
      promptTa.onchange = () => savePrompt(promptTa.value);
    } else {
      promptTa.value = '';
      promptTa.onchange = null;
    }
  }

  // 本集剧本 (第二个 textarea，如果存在)
  const epScriptTa = document.querySelectorAll('.prompt-ta')[1];
  if (epScriptTa) {
    epScriptTa.value = currentEpisode?.theme || '';
  }

  // 对话列表
  renderDialogues(scene);
}

function renderDialogues(scene) {
  const list = document.getElementById('dialogue-list');
  if (!list) return;
  if (!scene) { list.innerHTML = ''; return; }

  // 从场景中提取对话
  const items = [];
  if (scene.dialogue) items.push({ type: 'dialogue', time: '00:00', name: scene.speaker || '角色', tag: scene.emotion || '', text: scene.dialogue });
  if (scene.narrator) items.push({ type: 'narrator', time: '00:03', name: '旁白', tag: '叙述', text: scene.narrator });
  if (scene.sfx) items.push({ type: 'sfx', time: '00:05', name: '音效', tag: 'SFX', text: scene.sfx });

  // 检查本分镜是否有已生成的语音
  const hasVoice = scene.voice_url;

  if (!items.length) {
    list.innerHTML = '<div style="padding:14px;text-align:center;color:var(--c-text-3);font-size:11px;">本镜头无台词，点击下方添加</div>';
    return;
  }

  list.innerHTML = items.map((d, i) => `
    <div class="dialogue-row ${i === 0 ? 'active' : ''}">
      <span class="dlg-time">${d.time}</span>
      <div class="dlg-avatar a${(i % 4) + 1}"></div>
      <div>
        <div class="dlg-name">${escapeHtml(d.name)}</div>
        <div class="dlg-name-tag">${escapeHtml(d.tag)}</div>
      </div>
      <textarea class="dlg-text" rows="1" onchange="onDialogueEdit(${i},'${d.type}',this.value)">${escapeHtml(d.text)}</textarea>
      <button class="dlg-play" title="试听" onclick="previewVoice(${i},'${d.type}')">
        <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21"/></svg>
      </button>
      <button class="dlg-del" title="删除" onclick="this.closest('.dialogue-row').remove()">×</button>
    </div>
  `).join('');

  // 如果有已生成语音，显示全段播放按钮
  if (hasVoice) {
    list.insertAdjacentHTML('afterbegin', `
      <div style="display:flex;align-items:center;gap:6px;padding:4px 8px;margin-bottom:6px;background:rgba(16,185,129,.08);border-radius:6px;">
        <button class="mini-btn" onclick="playSceneVoice()" style="font-size:10px;">▶ 播放本镜配音</button>
        <span style="font-size:9px;color:var(--c-text-3);">已生成语音</span>
      </div>
    `);
  }
}

// 试听单条对话/旁白 TTS
let _previewAudio = null;
async function previewVoice(idx, type) {
  const scenes = currentEpisode?.result?.scenes || [];
  const scene = scenes[currentSceneIdx];
  if (!scene) return showToast('请先选择分镜', 'error');

  const text = type === 'dialogue' ? scene.dialogue : type === 'narrator' ? scene.narrator : scene.sfx;
  if (!text) return showToast('无文本可试听', 'info');

  // 如果已有生成的语音文件，直接播放
  if (scene.voice_url) {
    if (_previewAudio) { _previewAudio.pause(); _previewAudio = null; }
    _previewAudio = new Audio(scene.voice_url);
    _previewAudio.play().catch(() => showToast('播放失败', 'error'));
    return;
  }

  // 否则调用 TTS 即时预览
  showToast('生成试听语音中...', 'info');
  try {
    const r = await authFetch(`/api/drama/projects/${projectId}/episodes/${currentEpisode.id}/preview-voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, scene_idx: currentSceneIdx }),
    });
    if (r.ok) {
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      if (_previewAudio) { _previewAudio.pause(); _previewAudio = null; }
      _previewAudio = new Audio(url);
      _previewAudio.play().catch(() => showToast('播放失败', 'error'));
      _previewAudio.onended = () => URL.revokeObjectURL(url);
      showToast('▶ 播放中', 'ok');
    } else {
      showToast('试听生成失败', 'error');
    }
  } catch (e) {
    showToast('试听失败: ' + e.message, 'error');
  }
}
window.previewVoice = previewVoice;

// 播放整个分镜的语音
function playSceneVoice() {
  const scene = (currentEpisode?.result?.scenes || [])[currentSceneIdx];
  if (!scene?.voice_url) return showToast('该分镜尚未生成语音', 'info');
  if (_previewAudio) { _previewAudio.pause(); _previewAudio = null; }
  _previewAudio = new Audio(scene.voice_url);
  _previewAudio.play().catch(() => showToast('播放失败', 'error'));
}
window.playSceneVoice = playSceneVoice;

// 编辑对话内容
function onDialogueEdit(idx, type, value) {
  const scene = (currentEpisode?.result?.scenes || [])[currentSceneIdx];
  if (!scene) return;
  if (type === 'dialogue') scene.dialogue = value;
  else if (type === 'narrator') scene.narrator = value;
  else if (type === 'sfx') scene.sfx = value;
  // 自动保存
  authFetch(`/api/drama/projects/${projectId}/episodes/${currentEpisode.id}/scenes/${currentSceneIdx}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [type]: value }),
  }).catch(() => {});
}
window.onDialogueEdit = onDialogueEdit;

function renderRightPanel() {
  // 角色 → 用 project.characters
  const charGrid = document.getElementById('char-grid');
  const charTitle = document.getElementById('char-title');
  const chars = currentProject?.characters || [];
  if (charTitle) charTitle.textContent = `角色 (${chars.length})`;
  if (charGrid) {
    if (!chars.length) {
      charGrid.innerHTML = '<div style="font-size:10px;color:var(--c-text-3);padding:8px;">暂无角色</div>';
    } else {
      charGrid.innerHTML = chars.map((c, i) => `
        <div class="char-card" onclick="selectChar(this)">
          <div class="char-portrait a${(i % 4) + 1}"></div>
          <div class="char-name">${escapeHtml(c.name || '角色'+(i+1))}</div>
        </div>
      `).join('');
    }
  }

  // 场景 → 从当前 episode 的 scenes 提取 location
  const sceneGrid = document.getElementById('scene-grid');
  const sceneTitle = document.getElementById('scene-title');
  const sceneSet = new Set();
  (currentEpisode?.result?.scenes || []).forEach(s => {
    if (s.location) sceneSet.add(s.location);
  });
  const sceneList = Array.from(sceneSet);
  if (sceneTitle) sceneTitle.textContent = `场景 (${sceneList.length})`;
  if (sceneGrid) {
    if (!sceneList.length) {
      sceneGrid.innerHTML = '<div style="font-size:10px;color:var(--c-text-3);padding:8px;">暂无场景</div>';
    } else {
      sceneGrid.innerHTML = sceneList.map((name, i) => `
        <div class="scene-card s${(i % 4) + 1}">
          <div class="scene-name">${escapeHtml(name)}</div>
        </div>
      `).join('');
    }
  }

  // 物品 → 占位（暂用项目元数据）
  const itemGrid = document.getElementById('item-grid');
  const itemTitle = document.getElementById('item-title');
  if (itemTitle) itemTitle.textContent = `物品 (0)`;
  if (itemGrid) {
    itemGrid.innerHTML = '<div style="font-size:10px;color:var(--c-text-3);padding:8px;">暂无物品</div>';
  }

  // 已生成视频 → 本集成片 (final_video_url) + 所有分镜 video_url
  const vidGrid = document.getElementById('video-grid');
  const vidTitle = document.getElementById('vid-title');
  const sceneVideos = (currentEpisode?.result?.scenes || []).filter(s => s.video_url);
  const finalUrl = currentEpisode?.result?.final_video_url;
  const totalCount = sceneVideos.length + (finalUrl ? 1 : 0);
  if (vidTitle) vidTitle.textContent = `已生成视频 (${totalCount})`;
  if (vidGrid) {
    if (!totalCount) {
      vidGrid.innerHTML = '<div style="font-size:10px;color:var(--c-text-3);padding:14px;text-align:center;grid-column:1/-1;">暂无成片视频<br/><span style="font-size:9px;">点击底部「全部生成视频」或「图片快速合成」开始</span></div>';
    } else {
      let html = '';
      // 成片放最前
      if (finalUrl) {
        html += `
          <div class="video-card v1" style="grid-column:1/-1;aspect-ratio:16/9;border:2px solid var(--c-cyan);box-shadow:0 0 18px var(--c-glow-cyan,rgba(33,212,253,.4));" onclick="openVideoLightboxReal('${finalUrl}','本集成片','${currentEpisode?.result?.composed_clips || 0} 镜')">
            <div class="video-card-thumb" style="background:linear-gradient(135deg,#0099d4,#8b5cf6,#ec4899);"></div>
            <div class="video-card-fade"></div>
            <div class="video-card-play" style="width:40px;height:40px;font-size:14px;">▶</div>
            <div class="video-card-info">
              <h5>📺 本集成片</h5>
              <span>${currentEpisode?.result?.composed_clips || 0} 镜 · ${currentEpisode?.result?.composed_mode || 'images'}</span>
            </div>
          </div>
        `;
      }
      html += sceneVideos.map((s, i) => `
        <div class="video-card v${(i % 4) + 1}" onclick="openVideoLightboxReal('${s.video_url}','分镜 ${(currentEpisode.result.scenes.indexOf(s) + 1)}','${s.duration || 5}s')">
          <div class="video-card-thumb"></div>
          <div class="video-card-fade"></div>
          <div class="video-card-play">▶</div>
          <div class="video-card-info">
            <h5>分镜 #${currentEpisode.result.scenes.indexOf(s) + 1}</h5>
            <span>00:0${s.duration || 5}</span>
          </div>
        </div>
      `).join('');
      vidGrid.innerHTML = html;
    }
  }
}

function selectScene(idx) {
  currentSceneIdx = idx;
  renderShots();
  renderCurrentScene();
}
window.selectScene = selectScene;

// ═════════ ACTIONS ═════════
async function savePrompt(text) {
  if (!currentEpisode || currentSceneIdx < 0) return;
  try {
    await authFetch(`/api/drama/projects/${projectId}/episodes/${currentEpisode.id}/scenes/${currentSceneIdx}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visual_prompt: text }),
    });
    showToast('✓ 已保存', 'ok');
  } catch (e) {
    showToast('保存失败: ' + e.message, 'error');
  }
}

async function generateSingleImage() {
  if (!currentEpisode || currentSceneIdx < 0) return;
  showToast('生成图片中...', 'info');
  try {
    const r = await authFetch(`/api/drama/projects/${projectId}/episodes/${currentEpisode.id}/scenes/${currentSceneIdx}/generate-video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const j = await r.json();
    if (j.success) {
      // 重新加载 episode 拿最新 image_url
      await loadEpisode(currentEpisode.id);
      showToast('✓ 图片已生成', 'ok');
    } else {
      throw new Error(j.error);
    }
  } catch (e) {
    showToast('生图失败: ' + e.message, 'error');
  }
}
window.generateSingleImage = generateSingleImage;

// ═══ AI 生成提示词 — 将当前分镜的小说描述转换为影视脚本提示词 ═══
async function aiGeneratePrompt() {
  if (!currentEpisode?.result?.scenes) return showToast('请先生成分镜', 'error');
  const scene = currentEpisode.result.scenes[currentSceneIdx];
  if (!scene) return showToast('请先选择一个分镜', 'error');

  showToast('AI 正在生成影视提示词...', 'info');
  try {
    const r = await authFetch(`/api/drama/projects/${projectId}/episodes/${currentEpisode.id}/scenes/${currentSceneIdx}/generate-prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: scene.description, dialogue: scene.dialogue, narrator: scene.narrator }),
    });
    const j = await r.json();
    if (j.success) {
      // 更新本地数据
      scene.full_prompt_cn = j.data.prompt_cn;
      scene.full_prompt_en = j.data.prompt_en;
      renderCurrentScene();
      showToast('✓ 提示词已生成', 'ok');
    } else {
      throw new Error(j.error);
    }
  } catch (e) {
    showToast('生成失败: ' + e.message, 'error');
  }
}
window.aiGeneratePrompt = aiGeneratePrompt;

// ═══ 重置提示词 — 恢复到原始生成内容 ═══
function resetPrompt() {
  if (!currentEpisode?.result?.scenes) return showToast('请先生成分镜', 'error');
  const scene = currentEpisode.result.scenes[currentSceneIdx];
  if (!scene) return showToast('请先选择一个分镜', 'error');
  const promptTa = document.querySelectorAll('.prompt-ta')[0];
  if (promptTa) {
    promptTa.value = scene.full_prompt_cn || scene.visual_prompt || scene.description || '';
    showToast('已重置为原始提示词', 'info');
  }
}
window.resetPrompt = resetPrompt;

// ═══ 提示词模板 ═══
function showPromptTemplate() {
  const templates = [
    { name: '电影级画面', text: '电影级画质，浅景深，柔和自然光，色彩丰富，4K超清，' },
    { name: '动漫风格', text: '日系动漫风格，赛璐珞上色，线条流畅，色彩鲜明，' },
    { name: '水墨中国风', text: '中国水墨画风格，留白意境，淡雅色调，东方美学，' },
    { name: '赛博朋克', text: '赛博朋克风格，霓虹灯光，暗色调，高对比度，未来都市，' },
  ];
  const choice = prompt('选择模板编号:\n' + templates.map((t, i) => `${i + 1}. ${t.name}`).join('\n'));
  if (!choice) return;
  const idx = parseInt(choice) - 1;
  if (idx >= 0 && idx < templates.length) {
    const promptTa = document.querySelectorAll('.prompt-ta')[0];
    if (promptTa) {
      promptTa.value = templates[idx].text + (promptTa.value || '');
      savePrompt(promptTa.value);
      showToast(`已应用模板: ${templates[idx].name}`, 'ok');
    }
  }
}
window.showPromptTemplate = showPromptTemplate;

// ═══ AI 改写对话 — 优化台词使其更适合影视表达 ═══
async function aiRewriteDialogue() {
  if (!currentEpisode?.result?.scenes) return showToast('请先生成分镜', 'error');
  const scene = currentEpisode.result.scenes[currentSceneIdx];
  if (!scene) return showToast('请先选择一个分镜', 'error');
  if (!scene.dialogue && !scene.narrator) return showToast('当前分镜没有对话/旁白', 'info');

  showToast('AI 改写中...', 'info');
  try {
    const r = await authFetch(`/api/drama/projects/${projectId}/episodes/${currentEpisode.id}/scenes/${currentSceneIdx}/rewrite-dialogue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dialogue: scene.dialogue,
        narrator: scene.narrator,
        speaker: scene.speaker,
        description: scene.description,
      }),
    });
    const j = await r.json();
    if (j.success) {
      if (j.data.dialogue) scene.dialogue = j.data.dialogue;
      if (j.data.narrator) scene.narrator = j.data.narrator;
      renderCurrentScene();
      showToast('✓ 对话已改写', 'ok');
    } else {
      throw new Error(j.error);
    }
  } catch (e) {
    showToast('改写失败: ' + e.message, 'error');
  }
}
window.aiRewriteDialogue = aiRewriteDialogue;

// ═══ 一键配音 ═══
async function oneClickVoice() {
  if (!currentEpisode) return showToast('请先选择剧集', 'error');
  showToast('配音生成中...', 'info');
  try {
    const r = await authFetch(`/api/drama/projects/${projectId}/episodes/${currentEpisode.id}/generate-voice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const j = await r.json();
    if (j.success) {
      showToast(`✓ 配音完成: ${j.data.count || 0} 段语音`, 'ok');
      await loadEpisode(currentEpisode.id);
    } else {
      throw new Error(j.error);
    }
  } catch (e) {
    showToast('配音失败: ' + e.message, 'error');
  }
}
window.oneClickVoice = oneClickVoice;

async function generateAllVideos() {
  if (!currentEpisode) return showToast('请先选择剧集', 'error');
  if (!confirm('为本集所有分镜批量生成视频？')) return;
  showToast('已开始批量生成，可能需要几分钟...', 'info');
  try {
    const r = await authFetch(`/api/drama/projects/${projectId}/episodes/${currentEpisode.id}/generate-all-videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const j = await r.json();
    if (j.success) {
      showToast(`✓ 已开始为 ${j.data.total} 个分镜生视频`, 'ok');
      // 轮询检查
      pollEpisodeStatus();
    } else {
      throw new Error(j.error);
    }
  } catch (e) {
    showToast('启动失败: ' + e.message, 'error');
  }
}
window.generateAllVideos = generateAllVideos;

async function fastImageCompose() {
  if (!currentEpisode) return showToast('请先选择剧集', 'error');
  showToast('快速合成中（仅图片+静态视频）...', 'info');
  try {
    const r = await authFetch(`/api/drama/projects/${projectId}/episodes/${currentEpisode.id}/compose-from-images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const j = await r.json();
    if (j.success) {
      showToast(`✓ 快速合成完成：${j.data.composed_clips} 个分镜`, 'ok');
      // 立即拉一次最新数据 + 显示成片
      await loadEpisode(currentEpisode.id);
      // 弹出 final 视频 lightbox
      if (j.data.final_video_url) {
        setTimeout(() => {
          openVideoLightboxReal(j.data.final_video_url, '本集成片 (快速合成)', `${j.data.composed_clips} 个分镜`);
        }, 600);
      }
    } else {
      throw new Error(j.error);
    }
  } catch (e) {
    showToast('合成失败: ' + e.message, 'error');
  }
}
window.fastImageCompose = fastImageCompose;

async function hiQualityCompose() {
  if (!currentEpisode) return showToast('请先选择剧集', 'error');
  if (!confirm('执行高质量合成（含配音 + 字幕 + BGM）？耗时较长')) return;
  showToast('高质量合成中，请耐心等待...', 'info');
  try {
    const r = await authFetch(`/api/drama/projects/${projectId}/episodes/${currentEpisode.id}/compose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const j = await r.json();
    if (j.success) {
      showToast('✓ 已开始高质量合成', 'ok');
      pollEpisodeStatus();
    } else {
      throw new Error(j.error);
    }
  } catch (e) {
    showToast('合成失败: ' + e.message, 'error');
  }
}
window.hiQualityCompose = hiQualityCompose;

// v15 fix: 在【已存在的空 episode】上触发生成 (调用 orchestrator drama workflow + dramaService)
async function generateCurrentEpisode() {
  if (!projectId) return showToast('错误：URL 缺少 ?pid 参数', 'error');
  if (!currentProject) return showToast('项目未加载，请刷新页面重试', 'error');
  if (!currentEpisode) {
    // 没选择剧集 → 自动选第一个 empty 集
    const empty = allEpisodes.find(e => e.status === 'empty' || e.status === 'draft');
    if (empty) await loadEpisode(empty.id);
    if (!currentEpisode) return showToast('请先选择一个剧集', 'error');
  }
  if (currentEpisode.status === 'processing') {
    return showToast('本集正在生成中，请等待...', 'info');
  }
  if (currentEpisode.status === 'done') {
    if (!confirm('本集已生成，确定要重新生成吗？')) return;
  }

  // 取本集剧本（textarea 中用户输入的）
  const scriptInput = document.querySelector('.center-body .section-card:first-child .prompt-ta');
  const customScript = scriptInput?.value?.trim() || '';

  showToast('🎭 启动漫剧工作流 (6 阶段 12 agent + 6 步出图)...', 'info');
  console.log('[生成本集]', { eid: currentEpisode.id, script: customScript.slice(0,60) });

  try {
    const r = await authFetch(`/api/drama/projects/${projectId}/episodes/${currentEpisode.id}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: customScript }),
    });
    const j = await r.json();
    console.log('[生成本集] response:', j);
    if (j.success) {
      showToast(`✓ 启动成功，工作流执行中... (1-5 分钟)`, 'ok');
      subscribeProgress(currentEpisode.id);
      // 标记本地 episode 状态
      currentEpisode.status = 'processing';
      renderEpisodes();
      renderShots();
    } else {
      throw new Error(j.error || '后端返回失败');
    }
  } catch (e) {
    console.error('[生成本集] failed:', e);
    showToast('启动失败: ' + e.message, 'error');
  }
}
window.generateCurrentEpisode = generateCurrentEpisode;
window.runWorkflow = generateCurrentEpisode;  // 一键生成分镜按钮
window.generateNewEpisode = generateCurrentEpisode;  // 兼容

function subscribeProgress(eid) {
  if (progressSSE) progressSSE.close();
  // EventSource 无法发 Authorization header，把 token 加在 query 上 (后端 streamAuth 已支持)
  let token = '';
  try { token = sessionStorage.getItem('vido_token') || localStorage.getItem('vido-token') || ''; } catch {}
  const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';
  progressSSE = new EventSource(`/api/drama/projects/${projectId}/episodes/${eid}/progress${tokenParam}`);
  progressSSE.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      updatePipelineUI(data);
      if (data.step === 'done') {
        progressSSE.close();
        progressSSE = null;
        refreshProject().then(() => loadEpisode(eid));
        showToast('✓ 剧集生成完成', 'ok');
      } else if (data.step === 'error') {
        progressSSE.close();
        progressSSE = null;
        showToast('生成失败: ' + data.message, 'error');
      }
    } catch {}
  };
  progressSSE.onerror = () => {
    if (progressSSE) progressSSE.close();
    progressSSE = null;
  };
}

function updatePipelineUI(data) {
  // 后端实际 step 名 (来自 dramaService.js)
  const stepMap = {
    screenwriter: 0, // 编剧
    director:     1, // 导演
    consistency:  2, // 一致性
    motion:       3, // 运镜
    prompt:       4, // 提示词
    imagegen:     5, // 分镜图
    done:         6, // 完成
  };
  const idx = stepMap[data.step] ?? -1;
  const steps = document.querySelectorAll('.pipe-step');
  steps.forEach((s, i) => {
    s.classList.remove('active');
    if (i < idx) s.classList.add('done');
    else if (i === idx && idx < 6) s.classList.add('active');
    else if (idx >= 6) s.classList.add('done');
  });
  // 更新 status bar
  const messageEl = document.querySelector('.statusbar .stat-item:nth-child(2) b');
  if (messageEl && data.progress != null) messageEl.textContent = data.progress + '%';
  // 显示进度信息 toast
  if (data.message) {
    showToast(data.message, 'info');
  }
}

async function pollEpisodeStatus() {
  if (!currentEpisode) return;
  const interval = setInterval(async () => {
    try {
      const r = await authFetch(`/api/drama/projects/${projectId}/episodes/${currentEpisode.id}`);
      const j = await r.json();
      if (j.success) {
        currentEpisode = j.data;
        renderCurrentScene();
        renderRightPanel();
        if (j.data.status === 'done' || j.data.message?.includes('完成')) {
          clearInterval(interval);
        }
      }
    } catch {}
  }, 3000);
  // 最多 10 分钟
  setTimeout(() => clearInterval(interval), 600000);
}

async function refreshProject() {
  if (!projectId) return;
  try {
    const r = await authFetch(`/api/drama/projects/${projectId}`);
    const j = await r.json();
    if (j.success) {
      currentProject = j.data;
      allEpisodes = j.data.episodes || [];
      renderEpisodes();
    }
  } catch {}
}

// 设置弹窗保存 → PUT /projects/:pid
async function saveSettings() {
  if (!currentProject) return;
  try {
    const inputs = document.querySelectorAll('#settings-modal .set-select, #settings-modal .set-input');
    // 简化:按位置取值
    const fields = {
      style:         inputs[0]?.value,
      motion_preset: motionToId(inputs[1]?.value),
      aspect_ratio:  aspectToVal(inputs[2]?.value),
      // inputs[3]= 集时长 (暂忽略)
      scene_count:   parseInt(inputs[4]?.value) || 6,
      shot_duration: parseInt(inputs[5]?.value) || 8,
      image_model:   inputs[6]?.value,
      video_model:   inputs[7]?.value,
    };
    const r = await authFetch(`/api/drama/projects/${projectId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    const j = await r.json();
    if (j.success) {
      showToast('✓ 设置已保存', 'ok');
      currentProject = { ...currentProject, ...fields };
    }
  } catch (e) {
    showToast('保存失败: ' + e.message, 'error');
  }
  closeSettings();
}
window.saveSettings = saveSettings;

function motionToId(label) {
  const map = { '电影感': 'cinematic', '动作冲击': 'action', '纪实风格': 'documentary', '慢镜头': 'mv', 'POV 第一人称': 'romance' };
  return map[label] || 'cinematic';
}
function aspectToVal(label) {
  if (!label) return '9:16';
  return label.split(' ')[0];
}

async function saveProject() {
  if (!currentProject) return showToast('无项目', 'error');
  try {
    await authFetch(`/api/drama/projects/${projectId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: currentProject.title }),
    });
    showToast('✓ 项目已保存', 'ok');
  } catch (e) {
    showToast('保存失败: ' + e.message, 'error');
  }
}
window.saveProject = saveProject;

// ═════════ HELPERS ═════════
function showEmptyState(msg) {
  const list = document.getElementById('shots-list');
  if (list) list.innerHTML = `<div style="padding:40px 20px;text-align:center;color:var(--c-text-3);font-size:12px;">${escapeHtml(msg)}</div>`;
}
function showEmptyEpisode() {
  const list = document.getElementById('shots-list');
  if (list) {
    list.innerHTML = `
      <div style="padding:30px 12px;text-align:center;color:var(--c-text-3);font-size:11px;">
        请从顶部选择一个剧集<br/>
        <span style="font-size:10px;opacity:.7;">点击 EP01 / EP02... 后再点 ✨ AI 智能创作</span>
      </div>
    `;
  }
}
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}
function formatDur(s) {
  s = parseInt(s) || 0;
  return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
}

function showToast(msg, type) {
  let el = document.getElementById('drama-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'drama-toast';
    el.style.cssText = 'position:fixed;top:80px;left:50%;transform:translateX(-50%);background:rgba(17,18,42,.96);backdrop-filter:blur(20px);border:1px solid var(--c-border-2);padding:10px 22px;border-radius:8px;font-size:12px;z-index:5000;display:none;box-shadow:0 8px 24px rgba(0,0,0,.6);font-weight:600;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.display = 'block';
  el.style.color = type === 'error' ? '#f87171' : type === 'ok' ? '#34d399' : 'var(--c-cyan)';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.display = 'none'; }, 3500);
}

function openVideoLightboxReal(url, title, dur) {
  const inner = document.getElementById('video-lightbox-inner');
  if (!inner) return;
  inner.innerHTML = `
    <button class="video-lightbox-close" onclick="event.stopPropagation();closeVideoLightbox()">×</button>
    <video src="${url}" controls autoplay loop style="width:100%;height:100%;object-fit:cover;background:#000;"></video>
    <div class="video-card-info" style="left:20px;right:20px;bottom:18px;background:rgba(0,0,0,.55);padding:8px 12px;border-radius:8px;">
      <h5 style="font-size:14px;">${escapeHtml(title)}</h5>
      <span style="font-size:11px;">${escapeHtml(dur)}</span>
    </div>
  `;
  document.getElementById('video-lightbox').classList.add('show');
}
window.openVideoLightboxReal = openVideoLightboxReal;

// 启动
document.addEventListener('DOMContentLoaded', initStudio);
