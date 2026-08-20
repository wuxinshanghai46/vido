(function () {
  'use strict';

  const state = {
    unfinished: [],
    videos: [],
    videoFilter: 'all',
    videoLimit: 8
  };
  const modulePermission = { create: 'create', avatar: 'avatar', 'new-story-ad': 'dashboard' };
  const typeLabels = { 'new-story-ad': '剧情广告', avatar: '数字人', create: '视频动漫', i2v: '图生视频' };
  const safe = value => typeof esc === 'function'
    ? esc(String(value ?? ''))
    : String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));

  function canUse(module) {
    if (typeof canSeeModule !== 'function' || typeof getCurrentUser !== 'function') return true;
    const user = getCurrentUser();
    return !user || canSeeModule(user, modulePermission[module] || module);
  }

  function currentName() {
    const user = typeof getCurrentUser === 'function' ? (getCurrentUser() || {}) : {};
    const label = document.getElementById('user-name-label')?.textContent?.trim();
    return user.nickname || user.name || user.username || label || '创作者';
  }

  function greeting() {
    const hour = new Date().getHours();
    if (hour < 6) return '夜深了';
    if (hour < 12) return '上午好';
    if (hour < 18) return '下午好';
    return '晚上好';
  }

  function formatDuration(seconds) {
    const value = Math.max(0, Math.round(Number(seconds) || 0));
    if (!value) return '';
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const remain = value % 60;
    return hours
      ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remain).padStart(2, '0')}`
      : `${String(minutes).padStart(2, '0')}:${String(remain).padStart(2, '0')}`;
  }

  function go(url) {
    if (url) window.location.href = url;
  }

  function shell() {
    const page = document.getElementById('page-dashboard');
    if (!page) return null;
    page.classList.add('dashboard-workbench-page');
    page.innerHTML = `
      <div class="wb-consumer-head">
        <div><h1><span id="wb-greeting"></span>，<span id="wb-user-name"></span></h1><p>从未完成的任务继续，或者查看你已经做好的视频。</p></div>
        <button class="wb-new-button" id="wb-open-creator">＋ 新建作品</button>
      </div>
      <section class="wb-resume-section">
        <div class="wb-section-head"><div><h2>当前任务</h2><p id="wb-unfinished-count">正在读取当前任务</p></div></div>
        <div class="wb-resume-list" id="wb-unfinished"><div class="wb-empty">正在加载任务…</div></div>
      </section>
      <section class="wb-video-section">
        <div class="wb-section-head"><div><h2>我的视频</h2><p>查看和播放你已经制作完成的视频</p></div><div class="wb-video-filters" id="wb-video-filters"></div></div>
        <div class="wb-video-grid" id="wb-videos"><div class="wb-empty">正在加载视频…</div></div>
        <div class="wb-more-wrap"><button class="wb-more-button" id="wb-more-videos" hidden>加载更多视频</button></div>
      </section>
      <div class="wb-modal" id="wb-player-modal" hidden><div class="wb-modal-backdrop" data-close-modal="player"></div><div class="wb-player-panel" role="dialog" aria-modal="true" aria-labelledby="wb-player-title"><div class="wb-player-head"><div><small id="wb-player-type"></small><h3 id="wb-player-title">视频播放</h3></div><button aria-label="关闭视频" data-close-modal="player">×</button></div><video id="wb-player" controls playsinline></video></div></div>
      <div class="wb-modal" id="wb-creator-modal" hidden><div class="wb-modal-backdrop" data-close-modal="creator"></div><div class="wb-creator-panel" role="dialog" aria-modal="true" aria-labelledby="wb-creator-title"><div class="wb-player-head"><div><small>选择创作类型</small><h3 id="wb-creator-title">新建作品</h3></div><button aria-label="关闭新建作品" data-close-modal="creator">×</button></div><div class="wb-creator-grid" id="wb-creator-grid"></div></div></div>
      <div class="wb-toast" id="wb-toast" role="status"></div>`;
    document.getElementById('wb-greeting').textContent = greeting();
    document.getElementById('wb-user-name').textContent = currentName();
    bind();
    renderCreator();
    return page;
  }

  function renderCreator() {
    const entries = [
      ['new-story-ad', '剧', '剧情广告', '创意、资产、分镜与成片一体制作', '/story-ad/'],
      ['avatar', '🧑‍💼', '数字人口播', '真人感讲解视频', '/digital-human'],
      ['create', '🎬', '视频动漫', '文字生成动画短片', '/?page=create'],
      ['comic', '📚', '漫画', '故事生成漫画', '/?page=comic'],
      ['novel', '✍️', '小说', '长篇内容创作', '/ai-novel']
    ];
    const box = document.getElementById('wb-creator-grid');
    if (!box) return;
    box.innerHTML = entries.filter(item => canUse(item[0])).map(item => `
      <button data-resume="${safe(item[4])}"><i>${item[1]}</i><span><b>${safe(item[2])}</b><small>${safe(item[3])}</small></span><em>→</em></button>`).join('');
  }

  function taskCard(task) {
    const failed = task.status_group === 'failed';
    return `<article class="wb-resume-card ${failed ? 'is-failed' : ''}">
      <div class="wb-resume-icon">${safe(task.icon || '📁')}</div>
      <div class="wb-resume-info"><small>${safe(task.type)} · ${safe(task.time_ago || '')}</small><b title="${safe(task.title)}">${safe(task.title)}</b><span><i></i>${safe(task.stage_label || (failed ? '需要处理' : '等待继续'))}</span></div>
      <button class="wb-continue-button" data-resume="${safe(task.resume_url)}">${failed ? '处理' : '继续'}</button>
    </article>`;
  }

  function renderUnfinished() {
    const target = document.getElementById('wb-unfinished');
    const count = document.getElementById('wb-unfinished-count');
    if (!target || !count) return;
    const rows = state.unfinished.slice(0, 3);
    count.textContent = rows.length
      ? '按最近更新时间显示 3 个任务'
      : '当前没有未完成任务';
    target.innerHTML = rows.length ? rows.map(taskCard).join('') : '<div class="wb-empty wb-empty-resume"><b>所有任务都已完成</b><span>可以新建作品，开始下一次创作。</span><button id="wb-empty-create">新建作品</button></div>';
    const emptyCreate = document.getElementById('wb-empty-create');
    if (emptyCreate) emptyCreate.onclick = openCreator;
  }

  function filterOptions() {
    const available = new Set(state.videos.map(video => video.module));
    return [['all', '全部'], ...Object.entries(typeLabels).filter(([key]) => available.has(key))];
  }

  function videoCard(video, index) {
    const duration = formatDuration(video.duration);
    const classes = index === 0 ? 'wb-video-card is-featured' : 'wb-video-card';
    return `<article class="${classes}" data-video-id="${safe(video.id)}" role="button" tabindex="0" aria-label="预览${safe(video.title)}，点击打开视频">
      <div class="wb-video-media">
        ${video.thumbnail_url ? `<img class="wb-video-backdrop" src="${safe(video.thumbnail_url)}" alt="" loading="lazy" decoding="async" aria-hidden="true">` : ''}
        <video class="wb-video-thumb" muted playsinline loop preload="metadata" data-video-src="${safe(video.video_url)}" aria-hidden="true"></video>
        <div class="wb-video-fallback wb-video-placeholder">VIDO</div>
        ${video.thumbnail_url ? `<img class="wb-video-fallback wb-video-fallback-image" src="${safe(video.thumbnail_url)}" alt="${safe(video.title)}缩略图" loading="lazy" decoding="async">` : ''}
        <span class="wb-video-type">${safe(video.type)}</span>${duration ? `<span class="wb-video-duration">${duration}</span>` : ''}
        <div class="wb-video-copy"><b>${safe(video.title)}</b><small>${safe(video.time_ago || '')}</small></div>
      </div>
    </article>`;
  }

  function filteredVideos() {
    return state.videos.filter(video => state.videoFilter === 'all' || video.module === state.videoFilter);
  }

  function renderVideos() {
    const filters = document.getElementById('wb-video-filters');
    const grid = document.getElementById('wb-videos');
    const more = document.getElementById('wb-more-videos');
    if (!filters || !grid || !more) return;
    filters.innerHTML = filterOptions().map(([key, label]) => `<button class="${state.videoFilter === key ? 'active' : ''}" data-video-filter="${safe(key)}">${safe(label)}</button>`).join('');
    const rows = filteredVideos();
    const visible = rows.slice(0, state.videoLimit);
    grid.innerHTML = visible.length ? visible.map(videoCard).join('') : '<div class="wb-empty wb-empty-videos"><b>还没有已完成的视频</b><span>视频生成完成后会自动出现在这里。</span></div>';
    more.hidden = rows.length <= visible.length;
    hydrateVideoFrames();
  }

  function hydrateVideoFrames() {
    const videos = [...document.querySelectorAll('.wb-video-thumb[data-video-src]')];
    document.querySelectorAll('.wb-video-fallback-image').forEach(image => image.addEventListener('error', () => {
      image.hidden = true;
      const backdrop = image.closest('.wb-video-media')?.querySelector('.wb-video-backdrop');
      if (backdrop) backdrop.hidden = true;
    }, { once: true }));
    const load = video => {
      if (video.dataset.loaded) return;
      video.dataset.loaded = '1';
      const source = video.dataset.videoSrc;
      video.addEventListener('loadedmetadata', () => {
        try { video.currentTime = Math.min(0.08, Math.max(0, (video.duration || 1) / 2)); } catch {}
      }, { once: true });
      video.addEventListener('loadeddata', () => video.closest('.wb-video-card')?.classList.add('has-frame'), { once: true });
      video.addEventListener('error', () => video.closest('.wb-video-card')?.classList.add('frame-error'), { once: true });
      video.src = `${source}${source.includes('#') ? '' : '#t=0.08'}`;
      video.load();
    };
    videos.forEach(video => {
      const card = video.closest('.wb-video-card');
      if (!card || card.dataset.previewBound === '1') return;
      card.dataset.previewBound = '1';
      const play = () => {
        load(video);
        video.muted = true;
        video.loop = true;
        card.classList.add('is-previewing');
        video.play().catch(() => card.classList.remove('is-previewing'));
      };
      const stop = () => {
        video.pause();
        card.classList.remove('is-previewing');
        try { video.currentTime = Math.min(0.08, Math.max(0, (video.duration || 1) / 2)); } catch {}
      };
      card.addEventListener('pointerenter', play);
      card.addEventListener('pointerleave', stop);
      card.addEventListener('focus', play);
      card.addEventListener('blur', stop);
    });
    if (!('IntersectionObserver' in window)) return videos.forEach(load);
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      load(entry.target);
      observer.unobserve(entry.target);
    }), { rootMargin: '300px 0px' });
    videos.forEach(video => observer.observe(video));
  }

  function openVideo(id) {
    const video = state.videos.find(item => item.id === id);
    if (!video) return;
    const modal = document.getElementById('wb-player-modal');
    const player = document.getElementById('wb-player');
    document.getElementById('wb-player-title').textContent = video.title;
    document.getElementById('wb-player-type').textContent = video.type;
    modal.hidden = false;
    document.body.classList.add('wb-modal-open');
    player.src = video.video_url;
    player.play().catch(() => {});
  }

  function closePlayer() {
    const modal = document.getElementById('wb-player-modal');
    const player = document.getElementById('wb-player');
    player.pause();
    player.removeAttribute('src');
    player.load();
    modal.hidden = true;
    document.body.classList.remove('wb-modal-open');
  }

  function openCreator() {
    document.getElementById('wb-creator-modal').hidden = false;
    document.body.classList.add('wb-modal-open');
  }

  function closeCreator() {
    document.getElementById('wb-creator-modal').hidden = true;
    document.body.classList.remove('wb-modal-open');
  }

  function showLoadError() {
    document.getElementById('wb-unfinished').innerHTML = '<div class="wb-empty"><b>任务暂时无法加载</b><span>请稍后刷新页面重试。</span></div>';
    document.getElementById('wb-videos').innerHTML = '<div class="wb-empty"><b>视频暂时无法加载</b><span>请稍后刷新页面重试。</span></div>';
    document.getElementById('wb-unfinished-count').textContent = '数据加载失败';
  }

  function bind() {
    const page = document.getElementById('page-dashboard');
    document.getElementById('wb-open-creator').onclick = openCreator;
    document.getElementById('wb-more-videos').onclick = () => { state.videoLimit += 8; renderVideos(); };
    page.onclick = event => {
      const resume = event.target.closest('[data-resume]');
      if (resume) return go(resume.dataset.resume);
      const videoCard = event.target.closest('.wb-video-card[data-video-id]');
      if (videoCard) return openVideo(videoCard.dataset.videoId);
      const filter = event.target.closest('[data-video-filter]');
      if (filter) { state.videoFilter = filter.dataset.videoFilter; state.videoLimit = 8; return renderVideos(); }
      const close = event.target.closest('[data-close-modal]');
      if (close?.dataset.closeModal === 'player') return closePlayer();
      if (close?.dataset.closeModal === 'creator') return closeCreator();
    };
    document.addEventListener('keydown', event => {
      const videoCard = event.target.closest?.('.wb-video-card[data-video-id]');
      if (videoCard && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        return openVideo(videoCard.dataset.videoId);
      }
      if (event.key !== 'Escape') return;
      if (!document.getElementById('wb-player-modal')?.hidden) closePlayer();
      if (!document.getElementById('wb-creator-modal')?.hidden) closeCreator();
    });
  }

  async function load() {
    if (!document.getElementById('wb-unfinished') && !shell()) return;
    const result = await authFetch('/api/dashboard/summary').then(response => response.json()).catch(() => null);
    if (!result?.success) return showLoadError();
    document.getElementById('wb-user-name').textContent = currentName();
    state.unfinished = (result.unfinished_tasks || result.continue_tasks || []).filter(task => canUse(task.module));
    state.videos = (result.videos || []).filter(video => canUse(video.module));
    renderUnfinished();
    renderVideos();
  }

  window.loadDashboard = load;
  shell();
  const start = () => window.setTimeout(load, 120);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
