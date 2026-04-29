// ==================== 侧边栏折叠 ====================
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('collapsed');
  document.querySelector('.main').classList.toggle('sidebar-collapsed');
}

// ==================== 页面切换 ====================
function showPage(name) {
  cleanupEventSources();
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sidebar-nav a').forEach(a => a.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  const idx = {workspace:0, assets:1, voicelib:2, ranking:3}[name];
  document.querySelectorAll('.sidebar-nav a')[idx].classList.add('active');
  if (name === 'assets') { refreshTaskHistory(); }
  if (name === 'voicelib') { refreshVoiceLib(); }
  if (name === 'ranking') { loadRankingData(); }
  if (name === 'workspace') { refreshVoicePicker(); }
}

// ==================== Toast 提示系统 ====================
(function initToast() {
  if (!document.getElementById('toastContainer')) {
    const c = document.createElement('div');
    c.id = 'toastContainer';
    c.className = 'toast-container';
    document.body.appendChild(c);
  }
})();

function toast(msg, type = 'info', duration = 3000, opts = {}) {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  let html = msg;
  if (opts.undo) html += ` <span class="toast-undo" onclick="(${opts.undo.toString()})()">撤销</span>`;
  html += ' <span class="toast-close" onclick="this.parentElement.remove()">✕</span>';
  t.innerHTML = html;
  c.appendChild(t);
  if (duration > 0) {
    setTimeout(() => { t.style.animation = 'toastOut 0.3s ease forwards'; setTimeout(() => t.remove(), 300); }, duration);
  }
  return t;
}

// ==================== 全局 ESC 键关闭弹窗 ====================
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    const qr = document.getElementById('qrcodeModal');
    if (qr && qr.style.display === 'flex') { closeQrcodeModal(); return; }
    const img = document.getElementById('imagePreviewModal');
    if (img && img.style.display === 'flex') { img.style.display = 'none'; return; }
  }
});

// ==================== 工具函数 ====================
function formatDuration(s){if(!s)return'--';const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=Math.floor(s%60);return h>0?`${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`:m>0?`${m}分${sec}秒`:`${sec}秒`;}
function formatNum(n){if(!n)return'0';if(n>=10000)return(n/10000).toFixed(1)+'w';return String(n);}
function formatDate(d){return d?new Date(d+'Z').toLocaleString('zh-CN'):'';}
function formatRelativeTime(d) {
  if (!d) return '';
  const now = Date.now(), t = new Date(d + 'Z').getTime(), diff = Math.floor((now - t) / 1000);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
  if (diff < 604800) return Math.floor(diff / 86400) + '天前';
  return new Date(t).toLocaleDateString('zh-CN');
}
function formatElapsed(s,e){const start=new Date(s+'Z').getTime(),end=e?new Date(e+'Z').getTime():Date.now(),sec=Math.max(0,Math.floor((end-start)/1000)),m=Math.floor(sec/60),ss=sec%60;return m>0?`${m}分${ss}秒`:`${ss}秒`;}
function esc(s){if(!s)return'';const d=document.createElement('div');d.textContent=s;return d.innerHTML;}
function copyText(id){
  const el=document.getElementById(id);
  const text = el.value || el.textContent || '';
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => toast('已复制到剪贴板','success',2000)).catch(() => fallbackCopy(el));
  } else { fallbackCopy(el); }
}
function fallbackCopy(el){ el.select(); document.execCommand('copy'); toast('已复制到剪贴板','success',2000); }

// 通用 fetch 包装（区分错误类型）
async function apiFetch(url, opts = {}) {
  try {
    const res = await fetch(url, opts);
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401) throw new Error('登录已过期，请重新登录抖音');
      if (res.status >= 500) throw new Error('服务器错误: ' + (data.error || res.statusText));
      throw new Error(data.error || '请求失败');
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('请求超时，请检查网络连接');
    if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) throw new Error('网络连接失败，请检查网络');
    throw err;
  }
}

// ==================== Step 1: 素材获取 ====================
let currentUser = null, currentVideos = [];
let selectedVideoIds = new Set();

// 检查 cookie 登录状态
async function checkCookieStatus() {
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5000);
    const res = await fetch('/api/douyin/cookie-status', {signal: controller.signal});
    const data = await res.json();
    const el = document.getElementById('cookieStatus');
    const btn = document.getElementById('loginBtn');
    if (data.status === 'ok') {
      el.innerHTML = '🟢 已登录抖音';
      el.style.color = '#1e8e3e';
      btn.style.display = 'none';
    } else if (data.status === 'expired') {
      el.innerHTML = '🟡 登录可能已过期';
      el.style.color = '#f9ab00';
      btn.style.display = '';
      btn.textContent = '重新登录';
    } else {
      el.innerHTML = '🔴 未登录';
      el.style.color = '#d93025';
      btn.style.display = '';
    }
  } catch {
    const el = document.getElementById('cookieStatus');
    const btn = document.getElementById('loginBtn');
    if (el) { el.innerHTML = '⚠️ 检测失败'; el.style.color = '#5f6368'; }
    if (btn) btn.style.display = '';
  }
}
checkCookieStatus();

// 登录抖音
async function doLogin() {
  const btn = document.getElementById('loginBtn');
  const msg = document.getElementById('loginMsg');
  btn.disabled = true; btn.textContent = '打开中...';
  try {
    const res = await fetch('/api/douyin/login', {method:'POST'});
    const data = await res.json();
    msg.textContent = '等待扫码...';
    msg.style.color = '#4a90d9';
    btn.textContent = '等待扫码...';
    showQrcodeModal();
    pollLoginStatus();
  } catch (err) { msg.textContent = '启动失败: ' + err.message; msg.style.color = '#dc3545'; btn.disabled = false; btn.textContent = '登录抖音'; }
}

function showQrcodeModal() {
  const modal = document.getElementById('qrcodeModal');
  modal.style.display = 'flex';
}
function closeQrcodeModal() {
  document.getElementById('qrcodeModal').style.display = 'none';
  document.getElementById('loginBtn').disabled = false;
  document.getElementById('loginBtn').textContent = '登录抖音';
  if (loginPollInterval) { clearInterval(loginPollInterval); loginPollInterval = null; }
}

let loginPollInterval = null;
function pollLoginStatus() {
  if (loginPollInterval) clearInterval(loginPollInterval);
  let pollErrors = 0;
  const iv = setInterval(async () => {
    try {
      const res = await fetch('/api/douyin/login-status');
      const data = await res.json();
      pollErrors = 0;
      const msg = document.getElementById('loginMsg');
      const qrStatus = document.getElementById('qrcodeStatus');

      if (data.status === 'ok') {
        clearInterval(iv);
        msg.textContent = '登录成功！';
        msg.style.color = '#28a745';
        document.getElementById('loginBtn').style.display = 'none';
        document.getElementById('qrcodeModal').style.display = 'none';
        toast('抖音登录成功', 'success', 3000);
        // cookie 栏闪绿
        const bar = document.getElementById('cookieBar');
        if (bar) { bar.style.transition = 'background 0.3s'; bar.style.background = '#e6f4ea'; setTimeout(() => bar.style.background = '#f8f9fa', 2000); }
        checkCookieStatus();
      } else if (data.status === 'failed') {
        clearInterval(iv);
        msg.textContent = '登录失败或超时';
        msg.style.color = '#dc3545';
        if (qrStatus) qrStatus.textContent = '登录失败或超时';
        document.getElementById('loginBtn').disabled = false;
        document.getElementById('loginBtn').textContent = '重新登录';
      } else if (data.status === 'waiting') {
        if (data.hasQrcode) {
          const img = document.getElementById('qrcodeImg');
          img.src = '/api/douyin/login-qrcode?' + Date.now();
          if (qrStatus) qrStatus.textContent = '请用抖音 APP 扫码';
        }
      }
    } catch {
      pollErrors++;
      if (pollErrors >= 5) {
        clearInterval(iv);
        loginPollInterval = null;
        const msg = document.getElementById('loginMsg');
        if (msg) { msg.textContent = '网络连接失败'; msg.style.color = '#d93025'; }
        document.getElementById('loginBtn').disabled = false;
        document.getElementById('loginBtn').textContent = '重新登录';
      }
    }
  }, 2000);
  loginPollInterval = iv;
}

// 获取作者全部视频
async function loadAuthorVideos() {
  if (!currentUser?.url) return toast('未获取到作者信息','warning');
  const btn = document.getElementById('loadAllVideosBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> 获取中（可能需要 30 秒）...';
  try {
    await loadAuthorVideosFromUrl(currentUser.url);
    renderVideoCards();
    renderAuthorFilter();
    if (currentVideos.length) toast(`已加载 ${currentVideos.length} 个视频`, 'success', 3000);
  } catch (err) {
    const msg = err.message || '未知错误';
    if (msg.includes('playwright') || msg.includes('ModuleNotFoundError')) {
      toast('服务器缺少 Playwright 模块，请在服务器执行: pip3 install playwright && playwright install chromium', 'error', 8000);
    } else {
      toast('获取失败: ' + msg.slice(0, 80), 'error', 5000);
    }
  }
  finally { btn.disabled = false; btn.textContent = '获取全部视频'; }
}

// 排序
let currentSort = 'date_desc';
function clickSort(el) {
  document.querySelectorAll('.sort-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  currentSort = el.dataset.sort;
  sortAuthorVideos();
}
function sortAuthorVideos() {
  const s = currentSort;
  currentVideos.sort((a, b) => {
    switch(s) {
      case 'date_desc': return (b.upload_date||'').localeCompare(a.upload_date||'');
      case 'date_asc': return (a.upload_date||'').localeCompare(b.upload_date||'');
      case 'likes_desc': return (b.like_count||0)-(a.like_count||0);
      case 'views_desc': return (b.view_count||0)-(a.view_count||0);
      case 'comments_desc': return (b.comment_count||0)-(a.comment_count||0);
      case 'duration_desc': return (b.duration||0)-(a.duration||0);
      case 'duration_asc': return (a.duration||0)-(b.duration||0);
      default: return 0;
    }
  });
  renderVideoCards();
}

// 全选/取消
function selectAllVideos() {
  if (selectedVideoIds.size === currentVideos.length) {
    selectedVideoIds.clear();
  } else {
    currentVideos.forEach(v => selectedVideoIds.add(v.id));
  }
  renderVideoCards();
}

let lastCheckedVideoIdx = -1;
function toggleVideoSelect(id, event) {
  const filtered = authorFilter ? currentVideos.filter(v => v.uploader === authorFilter) : currentVideos;
  const idx = filtered.findIndex(v => v.id === id);

  // Shift+Click 范围选择
  if (event && event.shiftKey && lastCheckedVideoIdx >= 0 && idx >= 0) {
    const start = Math.min(lastCheckedVideoIdx, idx);
    const end = Math.max(lastCheckedVideoIdx, idx);
    for (let i = start; i <= end; i++) {
      selectedVideoIds.add(filtered[i].id);
    }
  } else {
    if (selectedVideoIds.has(id)) selectedVideoIds.delete(id);
    else selectedVideoIds.add(id);
  }
  lastCheckedVideoIdx = idx;
  renderVideoCards();
}

// 批量下载（逐个下载，显示实时进度）
let batchDownloading = false;
async function batchDownloadSelected() {
  const selected = currentVideos.filter(v => selectedVideoIds.has(v.id));
  if (!selected.length) return toast('请先选择视频', 'warning');
  if (batchDownloading) return toast('正在下载中，请等待', 'warning');
  if (!confirm(`确定下载 ${selected.length} 个视频？`)) return;

  batchDownloading = true;
  let okCount = 0, skipCount = 0, failCount = 0;
  const startTime = Date.now();

  // 显示整体进度条
  const batchBar = document.getElementById('batchProgress');
  if (batchBar) { batchBar.style.display = 'flex'; batchBar.querySelector('.fill').style.width = '0%'; }

  for (let i = 0; i < selected.length; i++) {
    const v = selected[i];
    const statusEl = document.getElementById('vstatus-' + v.id);
    if (statusEl) statusEl.innerHTML = `<span class="spinner"></span> 下载中(${i+1}/${selected.length})...`;

    // 更新整体进度
    if (batchBar) {
      const pct = Math.round((i / selected.length) * 100);
      batchBar.querySelector('.fill').style.width = pct + '%';
      const elapsed = (Date.now() - startTime) / 1000;
      const eta = i > 0 ? Math.round(elapsed / i * (selected.length - i)) : 0;
      batchBar.querySelector('.batch-label').textContent = `${i}/${selected.length} 完成${eta > 0 ? `，预计还需 ${eta > 60 ? Math.floor(eta/60)+'分'+eta%60+'秒' : eta+'秒'}` : ''}`;
    }

    try {
      const body = {videoUrl: v.url, videoId: v.id};
      if (v.video_url) body.playUrl = v.video_url;
      const res = await fetch('/api/douyin/download', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      const taskRes = await fetch('/api/douyin/add-task', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({videoPath: data.videoPath, videoId: v.id, filename: (v.title||v.id).slice(0,30)+'.mp4'})});
      const taskData = await taskRes.json();

      if (taskData.status === 'exists') {
        if (statusEl) statusEl.innerHTML = '<span style="color:#888;">● 已存在</span>';
        skipCount++;
      } else {
        if (statusEl) statusEl.innerHTML = '<span style="color:#28a745;">✓ 已下载</span>';
        okCount++;
      }
    } catch (err) {
      if (statusEl) statusEl.innerHTML = `<span style="color:#dc3545;">✗ 失败 <button class="btn btn-outline btn-sm" style="margin-left:4px;" onclick="retryDownload('${esc(v.id)}','${esc(v.url)}','${esc(v.video_url||'')}','${esc(v.title||'')}')">重试</button></span>`;
      failCount++;
    }
  }

  batchDownloading = false;
  if (batchBar) {
    batchBar.querySelector('.fill').style.width = '100%';
    batchBar.querySelector('.batch-label').textContent = '全部完成';
    setTimeout(() => { batchBar.style.display = 'none'; }, 3000);
  }
  refreshTasks();
  let msg = `批量下载完成：${okCount} 成功`;
  if (skipCount) msg += `，${skipCount} 已存在`;
  if (failCount) msg += `，${failCount} 失败`;
  toast(msg, failCount ? 'warning' : 'success', 5000);
}

let knownAuthors = {};

async function parseShare() {
  const text = document.getElementById('shareInput').value.trim();
  if (!text) return toast('请粘贴分享文本','warning');

  const urls = text.match(/https?:\/\/[^\s]+/g) || [];
  if (!urls.length) return toast('未找到有效链接','warning');

  const btn = document.getElementById('parseBtn');
  btn.disabled = true; btn.textContent = `解析中(0/${urls.length})...`;

  let parsed = 0;
  for (const url of urls) {
    try {
      if (/douyin\.com\/user\//.test(url)) {
        btn.textContent = `检测到作者主页...`;
        currentUser = { url };
        showAuthorCard({ name: '加载中...', id: '' }, null);
        document.getElementById('loadAllVideosBtn').style.display = '';
        parsed++;
        continue;
      } else {
        btn.textContent = `解析视频(${parsed+1}/${urls.length})...`;
        const res = await fetch('/api/douyin/parse', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text: url})});
        const data = await res.json();
        if (!res.ok) { console.error('解析失败:', data.error); parsed++; continue; }

        if (data.user?.name) {
          knownAuthors[data.user.name] = data.user;
          currentUser = data.user;
        }
        showAuthorCard(data.user, data.video?.uploader_avatar);

        if (data.video && !currentVideos.find(v => v.id === data.video.id)) {
          currentVideos.unshift(data.video);
        }
      }
    } catch (err) { console.error('解析失败:', err); }
    parsed++;
  }

  renderVideoCards();
  renderAuthorFilter();
  btn.disabled = false; btn.textContent = '解析';
}

async function loadAuthorVideosFromUrl(url) {
  try {
    const res = await fetch('/api/douyin/author-videos', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({userUrl: url})});
    const data = await res.json();
    if (!res.ok) {
      if (data.needLogin) { toast('请先登录抖音','warning'); doLogin(); return; }
      console.error('获取失败:', data.error);
      return;
    }
    for (const v of data) {
      if (!currentVideos.find(existing => existing.id === v.id)) {
        currentVideos.push(v);
      }
      if (v.uploader) {
        knownAuthors[v.uploader] = { name: v.uploader, id: v.uploader_id, url };
      }
    }
    if (data.length > 0) {
      showAuthorCard({name: data[0].uploader, id: data[0].uploader_id}, null);
    }
  } catch (err) { console.error('获取作者视频失败:', err); }
}

async function showAuthorCard(user, avatar) {
  if (!user) return;
  const ac = document.getElementById('authorCard');
  document.getElementById('authorName').textContent = user.name || '未知作者';
  let meta = Object.keys(knownAuthors).length > 1
    ? `已加载 ${Object.keys(knownAuthors).length} 位作者的视频`
    : 'ID: ' + (user.id || '-');
  const userVideos = currentVideos.filter(v => v.uploader === (user.name || ''));
  if (userVideos.length > 0) {
    const totalLikes = userVideos.reduce((s, v) => s + (v.like_count || 0), 0);
    meta += ` · ${userVideos.length} 个视频 · 总赞 ${formatNum(totalLikes)}`;
  }
  document.getElementById('authorMeta').textContent = meta;
  // 无头像时从已关注博主列表获取
  let finalAvatar = avatar || currentUser?.avatar;
  if (!finalAvatar && user.name) {
    try {
      const bloggers = await (await fetch('/api/douyin/bloggers')).json();
      const match = bloggers.find(b => b.name === user.name || b.unique_id === user.id);
      if (match?.avatar) finalAvatar = match.avatar;
    } catch {}
  }
  const av = document.getElementById('authorAvatar');
  if (finalAvatar) { av.src = finalAvatar; av.style.display = ''; } else { av.style.display = 'none'; }
  ac.classList.add('show');
  if (user) {
    currentUser = { ...currentUser, ...user, avatar: finalAvatar || currentUser?.avatar };
  }
  checkFollowStatus();
}

function renderAuthorFilter() {
  const names = Object.keys(knownAuthors);
  if (names.length <= 1) return;
  let filterEl = document.getElementById('authorFilter');
  if (!filterEl) {
    filterEl = document.createElement('div');
    filterEl.id = 'authorFilter';
    filterEl.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;margin-bottom:12px;font-size:13px;align-items:center;';
    document.getElementById('sortBar').after(filterEl);
  }
  filterEl.innerHTML = '<span style="color:#888;">作者:</span>' +
    '<span class="sort-chip active" data-author="" onclick="filterByAuthor(this)">全部</span>' +
    names.map(n => `<span class="sort-chip" data-author="${esc(n)}" onclick="filterByAuthor(this)">${esc(n)}</span>`).join('');
}

let authorFilter = '';
function filterByAuthor(el) {
  document.querySelectorAll('#authorFilter .sort-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  authorFilter = el.dataset.author;
  // #23 显示当前筛选标签
  let label = document.getElementById('authorFilterLabel');
  if (!label) {
    label = document.createElement('span');
    label.id = 'authorFilterLabel';
    label.style.cssText = 'font-size:12px;color:#1a73e8;background:#e8f0fe;padding:2px 10px;border-radius:12px;';
    document.getElementById('videoCountLabel')?.after(label);
  }
  label.textContent = authorFilter ? `当前: ${authorFilter}` : '';
  label.style.display = authorFilter ? '' : 'none';
  renderVideoCards();
}

let taskStatusMap = {};
async function updateTaskStatusMap() {
  try {
    const res = await fetch('/api/tasks'); const tasks = await res.json();
    taskStatusMap = {};
    tasks.forEach(t => { taskStatusMap[t.id] = t.status; });
  } catch {}
}

async function renderVideoCards() {
  await updateTaskStatusMap();
  const c = document.getElementById('videoContainer');
  const sortBar = document.getElementById('sortBar');
  const filtered = authorFilter ? currentVideos.filter(v => v.uploader === authorFilter) : currentVideos;
  if (!currentVideos.length) { c.innerHTML = ''; sortBar.style.display = 'none'; return; }

  // #22 始终显示排序栏
  sortBar.style.display = 'flex';
  if (!filtered.length) {
    c.innerHTML = '<div class="empty-state">该作者暂无视频</div>';
    document.getElementById('videoCountLabel').textContent = authorFilter ? `${authorFilter} 无匹配视频（总 ${currentVideos.length} 个）` : '';
    return;
  }

  if (filtered.length > 0) {
    document.getElementById('videoCountLabel').textContent = authorFilter
      ? `${authorFilter} 共 ${filtered.length} 个视频（总 ${currentVideos.length} 个）`
      : `共 ${currentVideos.length} 个视频`;
    const dlBtn = document.getElementById('batchDlBtn');
    if (dlBtn) dlBtn.textContent = selectedVideoIds.size > 1 ? `批量下载选中(${selectedVideoIds.size})` : selectedVideoIds.size === 1 ? '下载选中' : '下载选中';
  }

  if (currentUser?.url) {
    document.getElementById('loadAllVideosBtn').style.display = '';
  }

  c.innerHTML = filtered.map(v => {
    const date = v.upload_date ? v.upload_date.substring(0,4)+'-'+v.upload_date.substring(4,6)+'-'+v.upload_date.substring(6,8) : '';
    const checked = selectedVideoIds.has(v.id);
    return `<div class="video-card" style="${checked ? 'border-left:3px solid #4a90d9;' : ''}">
      <input type="checkbox" class="vc-checkbox" ${checked ? 'checked' : ''} onchange="toggleVideoSelect('${v.id}',event)">
      ${v.thumbnail ? `<div class="vc-thumb-wrap"><img src="${v.thumbnail}" referrerpolicy="no-referrer" loading="lazy" style="width:90px;height:120px;object-fit:cover;border-radius:8px;"><div class="vc-hover-zoom"><img src="${v.thumbnail}" referrerpolicy="no-referrer"></div></div>` : '<div style="width:90px;height:120px;background:#eee;border-radius:8px;flex-shrink:0;"></div>'}
      <div class="vc-info">
        <div class="vc-title">${esc(v.title || v.description || '无标题')}</div>
        <div class="vc-stats">
          ${Object.keys(knownAuthors).length > 1 && v.uploader ? `<span style="color:#4a90d9;font-weight:500;">@${esc(v.uploader)}</span>` : ''}
          ${v.view_count ? `<span>${formatNum(v.view_count)} 播放</span>` : ''}
          <span>${formatNum(v.like_count)} 赞</span>
          <span>${formatNum(v.comment_count)} 评论</span>
          ${v.collect_count ? `<span>${formatNum(v.collect_count)} 收藏</span>` : ''}
          ${v.repost_count ? `<span>${formatNum(v.repost_count)} 转发</span>` : ''}
          <span>${formatDuration(v.duration)}</span>
          ${date ? `<span>${date}</span>` : ''}
        </div>
        <div class="vc-actions">
          <span class="vc-actions-inline">
            ${v.video_url ? `<button class="btn btn-outline btn-sm" onclick="togglePlay('${esc(v.id)}')">▶ 播放</button>` : ''}
            <button class="btn btn-outline btn-sm" data-url="${esc(v.url)}" data-id="${esc(v.id)}" data-play="${esc(v.video_url||'')}" onclick="downloadDouyinVideo(this)">⬇ 下载</button>
            <button class="btn btn-primary btn-sm" data-url="${esc(v.url)}" data-id="${esc(v.id)}" data-title="${esc(v.title)}" data-play="${esc(v.video_url||'')}" onclick="extractFromDouyin(this.dataset.url,this.dataset.id,this.dataset.title,this.dataset.play)">提取文案</button>
          </span>
          <button class="btn btn-outline btn-sm vc-more-toggle" style="display:none;" onclick="toggleMoreMenu(this)">...</button>
          <div class="vc-more-menu">
            ${v.video_url ? `<button onclick="togglePlay('${esc(v.id)}');this.closest('.vc-more-menu').classList.remove('show')">▶ 播放</button>` : ''}
            <button data-url="${esc(v.url)}" data-id="${esc(v.id)}" data-play="${esc(v.video_url||'')}" onclick="downloadDouyinVideo(this);this.closest('.vc-more-menu').classList.remove('show')">⬇ 下载</button>
            <button onclick="extractFromDouyin('${esc(v.url)}','${esc(v.id)}','${esc(v.title)}','${esc(v.video_url||'')}');this.closest('.vc-more-menu').classList.remove('show')">提取文案</button>
          </div>
          <span class="video-step-status" id="vstatus-${v.id}">${taskStatusMap[v.id]==='completed'?'<span style="color:#28a745;">✓ 已转录</span>':taskStatusMap[v.id]==='processing'?'<span class="spinner"></span> 转录中':taskStatusMap[v.id]==='pending'?'<span style="color:#4a90d9;">● 已下载，待转录</span>':taskStatusMap[v.id]==='failed'?'<span style="color:#dc3545;">✗ 转录失败</span>':''}</span>
        </div>
      </div>
      <div id="vpreview-${v.id}" style="margin-top:10px;display:none;position:relative;">
        <video controls playsinline style="width:100%;max-height:300px;border-radius:8px;background:#000;" data-playurl="${esc(v.video_url||'')}"></video>
        <button onclick="closePlay('${esc(v.id)}')" style="position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.6);color:#fff;border:none;border-radius:50%;width:28px;height:28px;cursor:pointer;font-size:16px;line-height:28px;text-align:center;">✕</button>
      </div>
    </div>`;
  }).join('');
}

// 重试单个下载
async function retryDownload(id, url, playUrl, title) {
  const statusEl = document.getElementById('vstatus-' + id);
  if (statusEl) statusEl.innerHTML = '<span class="spinner"></span> 重试中...';
  try {
    const body = {videoUrl: url, videoId: id};
    if (playUrl) body.playUrl = playUrl;
    const res = await fetch('/api/douyin/download', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    await fetch('/api/douyin/add-task', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({videoPath: data.videoPath, videoId: id, filename: (title||id).slice(0,30)+'.mp4'})});
    if (statusEl) statusEl.innerHTML = '<span style="color:#28a745;">✓ 已下载</span>';
    refreshTasks();
  } catch (err) {
    if (statusEl) statusEl.innerHTML = `<span style="color:#dc3545;">✗ 失败: ${esc(err.message).slice(0,30)}</span>`;
  }
}

// 播放视频
function togglePlay(id) {
  const preview = document.getElementById('vpreview-' + id);
  if (!preview) return;
  const video = preview.querySelector('video');
  if (preview.style.display === 'none') {
    preview.style.display = 'block';
    if (!video.src || video.src.includes('snssdk.com')) {
      const localUrl = `/files/douyin/${id}.mp4`;
      video.src = localUrl;
      video.onerror = function() {
        if (video.dataset.playurl) video.src = video.dataset.playurl;
      };
    }
    video.play();
  } else {
    video.pause();
    preview.style.display = 'none';
  }
}

// 移动端 ... 菜单
function toggleMoreMenu(btn) {
  const menu = btn.nextElementSibling;
  document.querySelectorAll('.vc-more-menu.show').forEach(m => { if (m !== menu) m.classList.remove('show'); });
  menu.classList.toggle('show');
}
// 点击其他地方关闭菜单
document.addEventListener('click', function(e) {
  if (!e.target.closest('.vc-more-toggle') && !e.target.closest('.vc-more-menu')) {
    document.querySelectorAll('.vc-more-menu.show').forEach(m => m.classList.remove('show'));
  }
});

function closePlay(id) {
  const preview = document.getElementById('vpreview-' + id);
  if (!preview) return;
  const video = preview.querySelector('video');
  if (video) { video.pause(); video.currentTime = 0; }
  preview.style.display = 'none';
}

// 活跃的 EventSource 追踪，页面切换时清理
let activeEventSources = [];
function cleanupEventSources() {
  activeEventSources.forEach(es => { try { es.close(); } catch {} });
  activeEventSources = [];
}

// 下载抖音视频（带进度条）
async function downloadDouyinVideo(btn) {
  const {url, id, play} = btn.dataset;
  const statusEl = document.getElementById('vstatus-' + id);
  statusEl.innerHTML = '<div style="display:flex;align-items:center;gap:8px;"><span class="spinner"></span> 下载中...<div class="progress-bar" style="max-width:150px;"><div class="fill" id="dlprog-' + id + '" style="width:0%"></div></div><span id="dlpct-' + id + '" style="font-size:11px;color:#888;">0%</span></div>';
  btn.disabled = true;

  // 启动 SSE 监听进度
  let evtSource = null;
  try {
    evtSource = new EventSource('/api/douyin/download-progress/' + id);
    activeEventSources.push(evtSource);
    evtSource.onmessage = function(e) {
      const data = JSON.parse(e.data);
      const bar = document.getElementById('dlprog-' + id);
      const pct = document.getElementById('dlpct-' + id);
      if (bar) bar.style.width = data.progress + '%';
      if (pct) {
        if (data.total > 0) {
          pct.textContent = data.progress + '% (' + (data.downloaded/1024/1024).toFixed(1) + '/' + (data.total/1024/1024).toFixed(1) + 'MB)';
        } else {
          pct.textContent = data.progress + '%';
        }
      }
      if (data.done) { evtSource.close(); activeEventSources = activeEventSources.filter(e => e !== evtSource); }
    };
    evtSource.onerror = function() { evtSource.close(); activeEventSources = activeEventSources.filter(e => e !== evtSource); };
  } catch {}

  try {
    const body = {videoUrl: url, videoId: id};
    if (play) body.playUrl = play;
    const res = await fetch('/api/douyin/download', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    const data = await res.json(); if (!res.ok) throw new Error(data.error);
    statusEl.innerHTML = '<span style="color:#28a745;">✓ 下载完成，已加入转录队列</span>';
    toast('下载完成', 'success', 2000);
    const preview = document.getElementById('vpreview-' + id);
    if (preview) { preview.style.display = 'block'; preview.querySelector('video').src = data.previewUrl; }
    try {
      await fetch('/api/douyin/add-task', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({videoPath: data.videoPath, videoId: id, filename: btn.closest('.video-card')?.querySelector('.vc-title')?.textContent?.slice(0,30) + '.mp4' || id + '.mp4'})});
      lastTaskHash = '';
      refreshTasks();
    } catch {}
  } catch (err) {
    statusEl.innerHTML = '<span style="color:#dc3545;">下载失败: ' + esc(err.message) + '</span>';
    toast('下载失败: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    if (evtSource) evtSource.close();
  }
}

// 本地上传
const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');
uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('dragover'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
uploadZone.addEventListener('drop', e => { e.preventDefault(); uploadZone.classList.remove('dragover'); if(e.dataTransfer.files[0]) uploadFile(e.dataTransfer.files[0]); });
fileInput.addEventListener('change', () => { if(fileInput.files[0]) uploadFile(fileInput.files[0]); fileInput.value=''; });

async function uploadFile(file) {
  const fd = new FormData(); fd.append('file', file);
  try {
    const res = await fetch('/api/upload', {method:'POST', body:fd});
    const data = await res.json(); if (!res.ok) throw new Error(data.error);
    refreshTasks();
  } catch (err) { toast('上传失败: ' + err.message, 'error'); }
}

// ==================== Step 2: 文案提取与 AI ====================
// 加载风格列表
async function loadStyles() {
  try {
    const res = await fetch('/api/douyin/styles');
    const styles = await res.json();
    const sel = document.getElementById('styleSelect');
    styles.forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = s; sel.appendChild(o); });
  } catch {}
}
loadStyles();

// 从抖音提取文案
async function extractFromDouyin(videoUrl, videoId, title, playUrl) {
  const statusEl = document.getElementById('vstatus-' + videoId);
  const dualPane = document.getElementById('dualPane');
  const origText = document.getElementById('originalText');
  const rewriteText = document.getElementById('rewrittenText');

  showPage('workspace');

  if (dualPane) dualPane.style.display = 'grid';
  if (origText) origText.value = '';
  if (rewriteText) rewriteText.value = '';

  try {
    if (statusEl) statusEl.innerHTML = '<span class="spinner"></span> 下载视频中...';
    if (origText) origText.value = '⏳ 步骤 1/2：正在下载视频...';
    const dlBody = {videoUrl, videoId};
    if (playUrl) dlBody.playUrl = playUrl;
    const dlRes = await fetch('/api/douyin/download', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(dlBody)});
    const dlData = await dlRes.json(); if (!dlRes.ok) throw new Error('下载失败: ' + dlData.error);

    const preview = document.getElementById('vpreview-' + videoId);
    if (preview) { preview.style.display = 'block'; preview.querySelector('video').src = dlData.previewUrl; }

    if (statusEl) statusEl.innerHTML = '<span class="spinner"></span> 转录中（可能需要几分钟）...';
    if (origText) origText.value = '⏳ 步骤 2/2：正在转录音频（可能需要几分钟）...';
    const trRes = await fetch('/api/douyin/transcribe-local', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({videoPath: dlData.videoPath, videoId, title})});
    const trData = await trRes.json(); if (!trRes.ok) throw new Error('转录失败: ' + trData.error);

    if (origText) origText.value = trData.timedText || trData.text;
    if (statusEl) statusEl.innerHTML = '<span style="color:#1e8e3e;">✓ 完成</span>';
  } catch (err) {
    if (origText) origText.value = '提取失败: ' + err.message;
    if (statusEl) statusEl.innerHTML = `<span style="color:#d93025;">✗ ${esc(err.message).slice(0,50)} <button class="btn btn-warning btn-sm" style="margin-left:4px;" onclick="extractFromDouyin('${esc(videoUrl)}','${esc(videoId)}','${esc(title)}','${esc(playUrl)}')">重试</button></span>`;
    toast('文案提取失败: ' + err.message, 'error', 5000);
  }
}

// 任务列表轮询
let taskPage = 1;
const TASKS_PER_PAGE = 10;
let allTasks = [];
let taskSearchKey = '';
let lastTaskHash = '';

async function refreshTasks() {
  try {
    const res = await fetch('/api/tasks'); const newTasks = await res.json();
    // 变化检测：只在数据变化时重绘 DOM
    const hash = JSON.stringify(newTasks.map(t => t.id + t.status + t.completed_segments));
    if (hash === lastTaskHash) return;
    lastTaskHash = hash;
    allTasks = newTasks;
    renderTaskPage();
  } catch {}
}

function goTaskPage(p) { taskPage = p; renderTaskPage(); }

// 事件委托处理翻页点击
document.addEventListener('click', function(e) {
  const pager = e.target.closest('.pager-link');
  if (pager) {
    e.preventDefault();
    goTaskPage(parseInt(pager.dataset.page));
  }
});

// #21 键盘左右箭头翻页
document.addEventListener('keydown', function(e) {
  // 只在工作台页面且不在输入框中时生效
  if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA' || document.activeElement?.tagName === 'SELECT') return;
  const pageEl = document.getElementById('page-workspace');
  if (!pageEl || !pageEl.classList.contains('active')) return;
  const totalPages = Math.ceil((taskSearchKey ? allTasks.filter(t => (t.filename||'').toLowerCase().includes(taskSearchKey)) : allTasks).length / TASKS_PER_PAGE);
  if (e.key === 'ArrowLeft' && taskPage > 1) { goTaskPage(taskPage - 1); }
  else if (e.key === 'ArrowRight' && taskPage < totalPages) { goTaskPage(taskPage + 1); }
});

function renderTaskPage() {
  const queue = document.getElementById('taskQueue');
  const emptyEl = document.getElementById('taskEmpty');
  const filteredTasks = taskSearchKey ? allTasks.filter(t => (t.filename||'').toLowerCase().includes(taskSearchKey)) : allTasks;
  if (!filteredTasks.length) {
    if (emptyEl) { emptyEl.style.display = ''; emptyEl.textContent = taskSearchKey ? `未找到包含"${taskSearchKey}"的任务` : '暂无任务，请先在上方获取素材'; }
    queue.innerHTML = (emptyEl ? '' : `<div class="empty-state">${taskSearchKey ? '未找到匹配任务' : '暂无任务'}</div>`);
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  const totalPages = Math.ceil(filteredTasks.length / TASKS_PER_PAGE);
  if (taskPage > totalPages) taskPage = totalPages;
  const start = (taskPage - 1) * TASKS_PER_PAGE;
  const pageTasks = filteredTasks.slice(start, start + TASKS_PER_PAGE);

  let html = `<div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#888;margin-bottom:6px;flex-wrap:wrap;gap:6px;">
    <span>共 ${filteredTasks.length} 个任务${taskSearchKey ? '（已过滤）' : ''}</span>
    ${totalPages > 1 ? `<span style="display:flex;align-items:center;gap:6px;">
      ${taskPage > 1 ? `<button type="button" class="pager-link" data-page="${taskPage-1}" style="cursor:pointer;color:#1a73e8;font-weight:500;background:none;border:1px solid #dadce0;border-radius:16px;padding:4px 14px;font-size:13px;">上一页</button>` : ''}
      <input type="number" min="1" max="${totalPages}" value="${taskPage}" style="width:48px;padding:3px 6px;border:1px solid #dadce0;border-radius:8px;text-align:center;font-size:13px;" onchange="goTaskPage(Math.min(${totalPages},Math.max(1,parseInt(this.value)||1)))" onkeydown="if(event.key==='Enter')this.onchange()">
      <span style="color:#5f6368;">/ ${totalPages} 页</span>
      ${taskPage < totalPages ? `<button type="button" class="pager-link" data-page="${taskPage+1}" style="cursor:pointer;color:#1a73e8;font-weight:500;background:none;border:1px solid #dadce0;border-radius:16px;padding:4px 14px;font-size:13px;">下一页</button>` : ''}
    </span>` : ''}
  </div>`;

  html += pageTasks.map(t => {
    const sl = {pending:'排队中',processing:'处理中',completed:'已完成',failed:'失败'};
    const progress = t.total_segments>0?Math.round(t.completed_segments/t.total_segments*100):0;
    const taskDate = t.created_at ? new Date(t.created_at + 'Z').toLocaleDateString('zh-CN', {year:'numeric',month:'numeric',day:'numeric'}) : '';
    return `<div class="task-item">
      ${taskDate ? `<span style="font-size:11px;color:#80868b;white-space:nowrap;min-width:70px;">${taskDate}</span>` : ''}
      <span class="ti-name">${esc(t.filename)}</span>
      ${t.duration_seconds ? `<span style="font-size:11px;color:#888;white-space:nowrap;">${formatDuration(t.duration_seconds)}</span>` : ''}
      ${t.status==='processing'?`<div class="progress-bar"><div class="fill" style="width:${progress}%"></div></div>`:''}
      ${t.status==='processing'||t.status==='pending'?`<span style="font-size:12px;color:#888;">${formatElapsed(t.created_at)}</span>`:''}
      ${t.status==='completed'?`<button class="btn btn-primary btn-sm" onclick="toggleTaskResult('${t.id}',this)">${currentTaskId===t.id?'收起':'加载文案'}</button><button class="btn btn-outline btn-sm" onclick="downloadTaskResult('${t.id}','${esc(t.filename)}')">下载</button><button class="btn btn-outline btn-sm" onclick="exportSRT('${t.id}','${esc(t.filename)}')">字幕</button>`:''}
      ${t.status==='failed'?`<button class="btn btn-warning btn-sm" onclick="retryTask('${t.id}')">重试</button>`:''}
      ${t.status==='processing'||t.status==='pending'?`<button class="btn btn-outline btn-sm" onclick="cancelTask('${t.id}')">取消</button>`:''}
      <span class="ti-status ti-${t.status}">${sl[t.status]||t.status}</span>
      <button class="btn btn-outline btn-sm" style="color:#dc3545;border-color:#dc3545;" onclick="deleteTask('${t.id}')">删除</button>
    </div>`;
  }).join('');

  queue.innerHTML = html;
}

let currentTaskId = null;

function toggleTaskResult(id, btn) {
  if (currentTaskId === id) {
    currentTaskId = null;
    const dp = document.getElementById('dualPane');
    if (dp) dp.style.display = 'none';
    if (btn) btn.textContent = '加载文案';
    renderTaskPage();
  } else {
    loadTaskResult(id);
  }
}

async function loadTaskResult(id) {
  try {
    currentTaskId = id;
    const text = await (await fetch(`/api/tasks/${id}/result`)).text();
    const dp = document.getElementById('dualPane');
    if (dp) dp.style.display = 'grid';
    const ot = document.getElementById('originalText');
    if (ot) ot.value = text;
    updateCharCount('originalText', 'charCountOriginal');
    renderTaskPage();
  } catch (err) { toast('加载失败: ' + err.message, 'error'); }
}

async function cancelTask(id){try{await fetch(`/api/tasks/${id}/cancel`,{method:'POST'});lastTaskHash='';refreshTasks();toast('任务已取消','info');}catch(e){toast('取消失败: '+e.message,'error');}}
async function retryTask(id){try{await fetch(`/api/tasks/${id}/retry`,{method:'POST'});lastTaskHash='';refreshTasks();toast('任务已重新加入队列','success');}catch(e){toast('重试失败: '+e.message,'error');}}
const pendingDeletes = new Map();
async function deleteTask(id){
  const task = allTasks.find(t => t.id === id);
  const taskName = task ? task.filename : id;
  // 取消同 id 的旧 pending delete
  if (pendingDeletes.has(id)) { clearTimeout(pendingDeletes.get(id).timer); pendingDeletes.delete(id); }
  allTasks = allTasks.filter(t => t.id !== id);
  lastTaskHash = '';
  renderTaskPage();
  let cancelled = false;
  const toastEl = toast(`已删除 "${taskName.slice(0,20)}"`, 'info', 5000, {
    undo: () => { cancelled = true; pendingDeletes.delete(id); toastEl.remove(); lastTaskHash=''; refreshTasks(); toast('已撤销删除','success',2000); }
  });
  const timer = setTimeout(async () => { pendingDeletes.delete(id); if (!cancelled) { try { await fetch(`/api/tasks/${id}`,{method:'DELETE'}); } catch {} } }, 5000);
  pendingDeletes.set(id, { timer, cancelled: () => cancelled });
}

// AI 仿写
async function doRewrite() {
  let text = document.getElementById('originalText').value.trim();
  if (!text) return toast('请先提取文案', 'warning');
  text = text.replace(/\[\d{2}:\d{2}:\d{2}\s*->\s*\d{2}:\d{2}:\d{2}\]\s*/g, '');
  // 长文案预警
  if (text.length > 1000) toast('文案较长，AI 生成可能需要 30-60 秒', 'info', 4000);
  const style = document.getElementById('styleSelect').value;
  const prompt = document.getElementById('customPrompt').value.trim();
  document.getElementById('rewriteBtn').disabled = true;
  const loadingEl = document.getElementById('rewriteLoading');
  loadingEl.style.display = '';
  loadingEl.innerHTML = '<div class="spinner"></div> AI 仿写中' + (text.length > 500 ? '（文案较长，可能需要 30-60 秒）' : '') + '...';
  document.getElementById('rewrittenText').value = 'AI 正在生成中...';
  try {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 180000);
    const res = await fetch('/api/douyin/rewrite', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text, style: style||undefined, prompt: prompt||undefined}), signal: controller.signal});
    const data = await res.json(); if (!res.ok) throw new Error(data.error);
    document.getElementById('rewrittenText').value = data.rewritten;
    document.getElementById('ttsText').value = data.rewritten;
    toast('AI 仿写完成', 'success', 2000);
  } catch (err) {
    document.getElementById('rewrittenText').value = '';
    if (err.name === 'AbortError') toast('AI 仿写超时，建议缩短文案后重试', 'error', 5000);
    else toast('AI 仿写失败: ' + err.message, 'error', 5000);
  }
  finally { document.getElementById('rewriteBtn').disabled = false; loadingEl.style.display = 'none'; }
}

// 监听 AI 文案变化同步到配音框
document.getElementById('rewrittenText').addEventListener('input', function() {
  document.getElementById('ttsText').value = this.value;
  updateCharCount('rewrittenText', 'charCountRewritten');
});

// #27 文案字数统计
function updateCharCount(textareaId, countId) {
  const el = document.getElementById(countId);
  if (!el) return;
  const text = document.getElementById(textareaId)?.value || '';
  const plain = text.replace(/\[\d{2}:\d{2}:\d{2}\s*->\s*\d{2}:\d{2}:\d{2}\]\s*/g, '');
  el.textContent = `${plain.length} 字`;
  if (plain.length > 1000) el.style.color = '#f9ab00';
  else el.style.color = '#80868b';
}
document.getElementById('originalText').addEventListener('input', function() {
  updateCharCount('originalText', 'charCountOriginal');
});


refreshTasks();
// 仅在页面可见时轮询
let taskPollInterval = setInterval(refreshTasks, 3000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearInterval(taskPollInterval); taskPollInterval = null; }
  else if (!taskPollInterval) { taskPollInterval = setInterval(refreshTasks, 3000); refreshTasks(); }
});

// ==================== Step 3: 配音 ====================
let selectedVoiceId = null;
let selectedSysVoice = 'zh-CN-YunxiNeural';

document.getElementById('speedRange').addEventListener('input', function() {
  document.getElementById('speedValue').textContent = parseFloat(this.value).toFixed(1) + 'x';
});

function selectSysVoice(el) {
  selectedVoiceId = null;
  selectedSysVoice = el.dataset.voice;
  document.querySelectorAll('#sysVoicePicker .voice-chip').forEach(c => c.classList.remove('selected'));
  document.querySelectorAll('#voicePicker .voice-chip').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
}

function selectClonedVoice(id, el) {
  selectedVoiceId = id;
  selectedSysVoice = null;
  document.querySelectorAll('#sysVoicePicker .voice-chip').forEach(c => c.classList.remove('selected'));
  document.querySelectorAll('#voicePicker .voice-chip').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
}

async function refreshVoicePicker() {
  try {
    const res = await fetch('/api/voices'); const voices = await res.json();
    const picker = document.getElementById('voicePicker');
    picker.innerHTML = voices.map(v =>
      `<span class="voice-chip ${selectedVoiceId===v.id?'selected':''}" onclick="selectClonedVoice('${v.id}',this)">${esc(v.name)}</span>`
    ).join('') + '<span class="voice-chip add-voice" onclick="showPage(\'voicelib\')">+ 添加声音</span>';
  } catch {}
}
refreshVoicePicker();

async function doSynthesize() {
  const text = document.getElementById('ttsText').value.trim();
  if (!text) return toast('请输入配音文本', 'warning');
  // 检查是否覆盖上一个结果
  const player = document.getElementById('audioPlayer');
  if (player.src && player.src !== location.href) {
    if (!confirm('将覆盖之前的合成结果，确定继续？')) return;
  }
  const speed = parseFloat(document.getElementById('speedRange').value);

  document.getElementById('synthBtn').disabled = true;
  const loadingEl = document.getElementById('synthLoading');
  loadingEl.style.display = 'flex';
  if (selectedVoiceId) {
    loadingEl.innerHTML = '<div class="spinner"></div> 正在克隆声音合成（可能需要 3-5 分钟，请不要关闭页面）...';
  } else {
    loadingEl.innerHTML = '<div class="spinner"></div> 正在合成系统声音（约 10-30 秒）...';
  }
  document.getElementById('audioResult').classList.remove('show');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 600000);
  try {
    let data;
    if (selectedVoiceId) {
      const res = await fetch('/api/voices/synthesize', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({voiceId:selectedVoiceId, text, speed}), signal: controller.signal});
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `合成失败 (${res.status})`); }
      data = await res.json();
    } else {
      const res = await fetch('/api/douyin/tts', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({text, voice: selectedSysVoice, speed}), signal: controller.signal});
      if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || `配音失败 (${res.status})`); }
      data = await res.json();
    }
    document.getElementById('audioPlayer').src = data.audioUrl;
    document.getElementById('audioDownload').href = data.audioUrl;
    document.getElementById('audioResult').classList.add('show');
    addToSynthHistory(data.audioUrl);
    toast('配音合成完成', 'success', 3000);
  } catch (err) {
    if (err.name === 'AbortError') { toast('合成超时（超过 10 分钟），请缩短文本后重试', 'error', 5000); }
    else { toast('合成失败: ' + err.message, 'error', 5000); }
  }
  finally { clearTimeout(timeoutId); document.getElementById('synthBtn').disabled = false; loadingEl.style.display = 'none'; }
}

// ==================== 龙虎榜 ====================
let currentRankSort = 'likes';

function switchRank(el) {
  document.querySelectorAll('#page-ranking .sort-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  currentRankSort = el.dataset.rank;
  loadRankingVideos();
}

async function loadRankingData() {
  loadRankingStats();
  loadRankingToday();
  loadRankingBloggers();
  loadRankingVideos();
  loadRankingSnapshots();
}

// ===== 数据概览 =====
async function loadRankingStats() {
  const c = document.getElementById('rankStatsOverview');
  try {
    const res = await fetch('/api/douyin/ranking/stats');
    const d = await res.json();

    // 概览数字卡片
    let html = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:16px;">
      <div style="text-align:center;padding:14px;background:#f8f9fa;border-radius:8px;">
        <div style="font-size:24px;font-weight:600;color:#1a73e8;">${formatNum(d.totalVideos)}</div>
        <div style="font-size:12px;color:#5f6368;margin-top:4px;">总视频数</div>
      </div>
      <div style="text-align:center;padding:14px;background:#f8f9fa;border-radius:8px;">
        <div style="font-size:24px;font-weight:600;color:#1e8e3e;">${d.totalBloggers}</div>
        <div style="font-size:12px;color:#5f6368;margin-top:4px;">博主数</div>
      </div>
      <div style="text-align:center;padding:14px;background:#f8f9fa;border-radius:8px;">
        <div style="font-size:24px;font-weight:600;color:#d93025;">${formatNum(d.totalLikes)}</div>
        <div style="font-size:12px;color:#5f6368;margin-top:4px;">总点赞</div>
      </div>
      <div style="text-align:center;padding:14px;background:#f8f9fa;border-radius:8px;">
        <div style="font-size:24px;font-weight:600;color:#f9ab00;">${formatNum(d.totalCollects)}</div>
        <div style="font-size:12px;color:#5f6368;margin-top:4px;">总收藏</div>
      </div>
      <div style="text-align:center;padding:14px;background:#f8f9fa;border-radius:8px;">
        <div style="font-size:24px;font-weight:600;color:#8430ce;">${formatNum(d.avgLikes)}</div>
        <div style="font-size:12px;color:#5f6368;margin-top:4px;">平均点赞</div>
      </div>
      <div style="text-align:center;padding:14px;background:#f8f9fa;border-radius:8px;">
        <div style="font-size:24px;font-weight:600;color:#5f6368;">${formatDuration(d.avgDuration)}</div>
        <div style="font-size:12px;color:#5f6368;margin-top:4px;">平均时长</div>
      </div>
    </div>`;

    // 时长分布
    if (d.durationDist?.length) {
      const total = d.durationDist.reduce((s, x) => s + x.count, 0);
      html += `<div style="margin-bottom:16px;"><div style="font-size:13px;font-weight:500;color:#3c4043;margin-bottom:8px;">时长分布</div>`;
      html += d.durationDist.map(x => {
        const pct = Math.round(x.count / total * 100);
        return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;font-size:12px;">
          <span style="min-width:70px;color:#5f6368;">${x.range}</span>
          <div style="flex:1;height:16px;background:#e8eaed;border-radius:4px;overflow:hidden;"><div style="height:100%;background:#1a73e8;border-radius:4px;width:${pct}%;"></div></div>
          <span style="min-width:50px;text-align:right;color:#3c4043;">${x.count} (${pct}%)</span>
        </div>`;
      }).join('');
      html += `</div>`;
    }

    // 每月发布量图表
    if (d.monthly?.length) {
      html += `<div><div style="font-size:13px;font-weight:500;color:#3c4043;margin-bottom:8px;">月度发布趋势</div>
        <div style="position:relative;height:200px;"><canvas id="chartMonthly"></canvas></div></div>`;
    }

    // 高互动率 Top 5
    if (d.highEngagement?.length) {
      html += `<div style="margin-top:16px;"><div style="font-size:13px;font-weight:500;color:#3c4043;margin-bottom:8px;">🔥 高互动率 Top 5 <span style="font-size:11px;color:#80868b;font-weight:400;">（点赞/秒）</span></div>`;
      html += d.highEngagement.slice(0, 5).map((v, i) => {
        const date = v.upload_date ? v.upload_date.substring(0,4)+'-'+v.upload_date.substring(4,6)+'-'+v.upload_date.substring(6,8) : '';
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f1f3f4;font-size:13px;">
          <span style="font-weight:600;color:#5f6368;min-width:20px;">${i+1}</span>
          ${v.thumbnail?`<div class="vc-thumb-wrap"><img src="${v.thumbnail}" referrerpolicy="no-referrer" style="width:36px;height:48px;object-fit:cover;border-radius:4px;cursor:pointer;" onclick="showImagePreview(this.src)"><div class="vc-hover-zoom"><img src="${v.thumbnail}" referrerpolicy="no-referrer"></div></div>`:''}
          <div style="flex:1;min-width:0;"><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(v.title||'无标题')}</div><div style="font-size:11px;color:#80868b;">${esc(v.uploader)} · ${date}</div></div>
          <span style="font-weight:600;color:#d93025;white-space:nowrap;">${v.likes_per_sec} 赞/秒</span>
          <span style="color:#5f6368;white-space:nowrap;">${formatNum(v.like_count)}赞 · ${formatDuration(v.duration)}</span>
        </div>`;
      }).join('');
      html += `</div>`;
    }

    c.innerHTML = html;

    // 渲染月度图表
    if (d.monthly?.length && typeof Chart !== 'undefined') {
      const months = [...d.monthly].reverse();
      const canvas = document.getElementById('chartMonthly');
      if (canvas) {
        new Chart(canvas, {
          type: 'bar',
          data: {
            labels: months.map(m => m.month.substring(0,4)+'-'+m.month.substring(4)),
            datasets: [
              { label: '发布量', data: months.map(m => m.count), backgroundColor: 'rgba(26,115,232,0.6)', borderRadius: 4, yAxisID: 'y' },
              { label: '平均点赞', data: months.map(m => Math.round(m.avg_likes)), borderColor: '#d93025', backgroundColor: 'transparent', type: 'line', tension: 0.3, yAxisID: 'y1' }
            ]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } } },
            scales: {
              y: { beginAtZero: true, position: 'left', ticks: { font: { size: 10 } } },
              y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { font: { size: 10 }, callback: v => v >= 10000 ? (v/10000).toFixed(1)+'w' : v } },
              x: { ticks: { font: { size: 10 } } }
            }
          }
        });
      }
    }
  } catch { c.innerHTML = '<div class="empty-state">加载失败</div>'; }
}

// ===== 今日新增 =====
async function loadRankingToday() {
  const c = document.getElementById('rankTodayList');
  try {
    const res = await fetch('/api/douyin/ranking/today');
    const videos = await res.json();
    if (!videos.length) {
      c.innerHTML = '<div class="empty-state">今日暂无新增视频</div>';
      return;
    }
    c.innerHTML = `<div style="font-size:12px;color:#80868b;margin-bottom:8px;">今日共 ${videos.length} 条新视频</div>` +
      videos.map(v => {
        return `<div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #f1f3f4;">
          ${v.thumbnail?`<div class="vc-thumb-wrap"><img src="${v.thumbnail}" referrerpolicy="no-referrer" style="width:48px;height:64px;object-fit:cover;border-radius:4px;cursor:pointer;" onclick="showImagePreview(this.src)"><div class="vc-hover-zoom"><img src="${v.thumbnail}" referrerpolicy="no-referrer"></div></div>`:''}
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(v.title||'无标题')}</div>
            <div style="font-size:11px;color:#5f6368;margin-top:2px;">${esc(v.uploader)} · ${formatNum(v.like_count)}赞 · ${formatNum(v.comment_count)}评 · ${formatNum(v.collect_count)}藏 · ${formatDuration(v.duration)}</div>
          </div>
        </div>`;
      }).join('');
  } catch { c.innerHTML = '<div class="empty-state">加载失败</div>'; }
}

let rankVideosCache = [];
let rankVideoPage = 1;
const RANK_VIDEO_PER_PAGE = 20;

async function loadRankingVideos() {
  const c = document.getElementById('rankVideoList');
  try {
    const res = await fetch('/api/douyin/ranking/videos?sort=' + currentRankSort);
    rankVideosCache = await res.json();
    rankVideoPage = 1;
    renderRankingVideos();
  } catch { c.innerHTML = '<div class="empty-state">加载失败</div>'; }
}

let rankVideoSortCol = '', rankVideoSortAsc = false;
function sortRankVideosBy(col) {
  if (rankVideoSortCol === col) { rankVideoSortAsc = !rankVideoSortAsc; }
  else { rankVideoSortCol = col; rankVideoSortAsc = false; }
  rankVideosCache.sort((a, b) => {
    let va = a[col] || 0, vb = b[col] || 0;
    return rankVideoSortAsc ? va - vb : vb - va;
  });
  rankVideoPage = 1;
  renderRankingVideos();
}

function goRankVideoPage(p) { rankVideoPage = p; renderRankingVideos(); }

function renderRankingVideos() {
  const c = document.getElementById('rankVideoList');
  const all = rankVideosCache;
  if (!all.length) { c.innerHTML = '<div class="empty-state">暂无数据，请先解析视频</div>'; return; }

  const totalPages = Math.ceil(all.length / RANK_VIDEO_PER_PAGE);
  if (rankVideoPage > totalPages) rankVideoPage = totalPages;
  const start = (rankVideoPage - 1) * RANK_VIDEO_PER_PAGE;
  const videos = all.slice(start, start + RANK_VIDEO_PER_PAGE);

  const arrow = (col) => rankVideoSortCol === col ? (rankVideoSortAsc ? ' ↑' : ' ↓') : '';

  let pager = '';
  if (totalPages > 1) {
    pager = `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;font-size:13px;color:#5f6368;">
      <span>共 ${all.length} 条</span>
      <span style="display:flex;align-items:center;gap:6px;">
        ${rankVideoPage > 1 ? `<button class="btn btn-outline btn-sm" onclick="goRankVideoPage(${rankVideoPage-1})">上一页</button>` : ''}
        <span>${rankVideoPage} / ${totalPages} 页</span>
        ${rankVideoPage < totalPages ? `<button class="btn btn-outline btn-sm" onclick="goRankVideoPage(${rankVideoPage+1})">下一页</button>` : ''}
      </span>
    </div>`;
  }

  c.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="border-bottom:2px solid #e8eaed;color:#5f6368;"><th style="text-align:left;padding:8px 4px;">#</th><th style="text-align:left;padding:8px;">视频</th><th style="text-align:left;padding:8px;">作者</th><th style="text-align:right;padding:8px;cursor:pointer;" onclick="sortRankVideosBy(\'like_count\')">点赞'+arrow('like_count')+'</th><th style="text-align:right;padding:8px;cursor:pointer;" onclick="sortRankVideosBy(\'comment_count\')">评论'+arrow('comment_count')+'</th><th style="text-align:right;padding:8px;cursor:pointer;" onclick="sortRankVideosBy(\'collect_count\')">收藏'+arrow('collect_count')+'</th><th style="text-align:right;padding:8px;cursor:pointer;" onclick="sortRankVideosBy(\'duration\')">时长'+arrow('duration')+'</th></tr></thead><tbody>' +
      videos.map((v, i) => {
        const rank = start + i + 1;
        const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
        const date = v.upload_date ? v.upload_date.substring(0,4)+'-'+v.upload_date.substring(4,6)+'-'+v.upload_date.substring(6,8) : '';
        return `<tr style="border-bottom:1px solid #f1f3f4;${rank<=3?'background:#fafbfc;':''}">
          <td style="padding:10px 4px;font-weight:600;text-align:center;">${medal}</td>
          <td style="padding:10px 8px;"><div style="display:flex;gap:8px;align-items:center;">
            ${v.thumbnail?`<div class="vc-thumb-wrap"><img src="${v.thumbnail}" referrerpolicy="no-referrer" style="width:40px;height:53px;object-fit:cover;border-radius:4px;cursor:pointer;" onclick="showImagePreview(this.src)"><div class="vc-hover-zoom"><img src="${v.thumbnail}" referrerpolicy="no-referrer"></div></div>`:''}
            <div style="min-width:0;"><div style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px;">${esc(v.title||'无标题')}</div><div style="font-size:11px;color:#80868b;">${date}</div></div>
          </div></td>
          <td style="padding:10px 8px;color:#5f6368;">${esc(v.uploader)}</td>
          <td style="padding:10px 8px;text-align:right;font-weight:500;color:#d93025;">${formatNum(v.like_count)}</td>
          <td style="padding:10px 8px;text-align:right;">${formatNum(v.comment_count)}</td>
          <td style="padding:10px 8px;text-align:right;">${formatNum(v.collect_count)}</td>
          <td style="padding:10px 8px;text-align:right;color:#5f6368;">${formatDuration(v.duration)}</td>
        </tr>`;
      }).join('') + '</tbody></table>' + pager;
}

let rankBloggersCache = [];
let rankBloggerSortCol = '', rankBloggerSortAsc = false;

async function loadRankingBloggers() {
  const c = document.getElementById('rankBloggerList');
  try {
    const res = await fetch('/api/douyin/ranking/bloggers');
    rankBloggersCache = await res.json();
    renderRankingBloggers();
  } catch { c.innerHTML = '<div class="empty-state">加载失败</div>'; }
}

function sortRankBloggersBy(col) {
  if (rankBloggerSortCol === col) { rankBloggerSortAsc = !rankBloggerSortAsc; }
  else { rankBloggerSortCol = col; rankBloggerSortAsc = false; }
  rankBloggersCache.sort((a, b) => {
    let va = a[col] || 0, vb = b[col] || 0;
    return rankBloggerSortAsc ? va - vb : vb - va;
  });
  renderRankingBloggers();
}

function renderRankingBloggers() {
  const c = document.getElementById('rankBloggerList');
  const bloggers = rankBloggersCache;
  if (!bloggers.length) { c.innerHTML = '<div class="empty-state">暂无数据</div>'; return; }
  const arrow = (col) => rankBloggerSortCol === col ? (rankBloggerSortAsc ? ' ↑' : ' ↓') : '';
  c.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="border-bottom:2px solid #e8eaed;color:#5f6368;"><th style="text-align:left;padding:8px 4px;">#</th><th style="text-align:left;padding:8px;">博主</th><th style="text-align:right;padding:8px;cursor:pointer;" onclick="sortRankBloggersBy(\'video_count\')">视频数'+arrow('video_count')+'</th><th style="text-align:right;padding:8px;cursor:pointer;" onclick="sortRankBloggersBy(\'total_likes\')">总点赞'+arrow('total_likes')+'</th><th style="text-align:right;padding:8px;cursor:pointer;" onclick="sortRankBloggersBy(\'total_comments\')">总评论'+arrow('total_comments')+'</th><th style="text-align:right;padding:8px;cursor:pointer;" onclick="sortRankBloggersBy(\'total_collects\')">总收藏'+arrow('total_collects')+'</th><th style="text-align:right;padding:8px;cursor:pointer;" onclick="sortRankBloggersBy(\'avg_likes\')">均赞'+arrow('avg_likes')+'</th></tr></thead><tbody>' +
    bloggers.map((b, i) => {
        const medal = i === 0 ? '👑' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i+1);
        return `<tr style="border-bottom:1px solid #f1f3f4;${i<3?'background:#fafbfc;':''}">
          <td style="padding:10px 4px;font-weight:600;text-align:center;">${medal}</td>
          <td style="padding:10px 8px;"><div style="display:flex;gap:8px;align-items:center;">
            ${b.avatar?`<img src="${b.avatar}" referrerpolicy="no-referrer" style="width:32px;height:32px;border-radius:50%;">`:''}
            <span style="font-weight:500;">${esc(b.name)}</span>
          </div></td>
          <td style="padding:10px 8px;text-align:right;">${b.video_count}</td>
          <td style="padding:10px 8px;text-align:right;font-weight:500;color:#d93025;">${formatNum(b.total_likes)}</td>
          <td style="padding:10px 8px;text-align:right;">${formatNum(b.total_comments)}</td>
          <td style="padding:10px 8px;text-align:right;">${formatNum(b.total_collects)}</td>
          <td style="padding:10px 8px;text-align:right;color:#1a73e8;">${formatNum(Math.round(b.avg_likes))}</td>
        </tr>`;
      }).join('') + '</tbody></table>';
}

let snapshotGrouped = {};
let snapshotEntries = [];
let snapshotPage = 1;
const SNAPSHOT_PER_PAGE = 5;

async function loadRankingSnapshots() {
  const c = document.getElementById('rankSnapshotList');
  try {
    const res = await fetch('/api/douyin/ranking/snapshots');
    const snapshots = await res.json();
    if (!snapshots.length) { c.innerHTML = '<div class="empty-state">暂无快照数据，每次解析视频时自动记录</div>'; return; }

    snapshotGrouped = {};
    snapshots.forEach(s => {
      if (!snapshotGrouped[s.video_id]) snapshotGrouped[s.video_id] = { title: s.title, uploader: s.uploader, records: [] };
      snapshotGrouped[s.video_id].records.push(s);
    });
    snapshotEntries = Object.entries(snapshotGrouped);
    snapshotPage = 1;
    renderSnapshots();
  } catch { c.innerHTML = '<div class="empty-state">加载失败</div>'; }
}

function goSnapshotPage(p) { snapshotPage = p; renderSnapshots(); }

function renderSnapshots() {
  const c = document.getElementById('rankSnapshotList');
  const all = snapshotEntries;
  if (!all.length) { c.innerHTML = '<div class="empty-state">暂无快照数据</div>'; return; }

  const totalPages = Math.ceil(all.length / SNAPSHOT_PER_PAGE);
  if (snapshotPage > totalPages) snapshotPage = totalPages;
  const start = (snapshotPage - 1) * SNAPSHOT_PER_PAGE;
  const pageEntries = all.slice(start, start + SNAPSHOT_PER_PAGE);

  let pager = '';
  if (totalPages > 1) {
    pager = `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;font-size:13px;color:#5f6368;">
      <span>共 ${all.length} 个视频</span>
      <span style="display:flex;align-items:center;gap:6px;">
        ${snapshotPage > 1 ? `<button class="btn btn-outline btn-sm" onclick="goSnapshotPage(${snapshotPage-1})">上一页</button>` : ''}
        <span>${snapshotPage} / ${totalPages} 页</span>
        ${snapshotPage < totalPages ? `<button class="btn btn-outline btn-sm" onclick="goSnapshotPage(${snapshotPage+1})">下一页</button>` : ''}
      </span>
    </div>`;
  }

  c.innerHTML = pageEntries.map(([vid, data]) => {
    const d = data;
    const latest = d.records[0];
    const oldest = d.records[d.records.length - 1];
    const likeDiff = latest.like_count - oldest.like_count;
    const commentDiff = latest.comment_count - oldest.comment_count;
    const collectDiff = latest.collect_count - oldest.collect_count;

    return `<div style="padding:12px;border:1px solid #e8eaed;border-radius:8px;margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-weight:500;">${esc(d.title || vid)}</div>
          <div style="font-size:12px;color:#5f6368;">${esc(d.uploader)} · ${d.records.length} 次记录</div>
        </div>
        <div style="text-align:right;font-size:12px;">
          ${likeDiff > 0 ? `<span style="color:#1e8e3e;">赞 +${formatNum(likeDiff)}</span>` : `<span style="color:#5f6368;">赞 ${formatNum(latest.like_count)}</span>`}
          ${commentDiff > 0 ? ` · <span style="color:#1e8e3e;">评 +${formatNum(commentDiff)}</span>` : ''}
          ${collectDiff > 0 ? ` · <span style="color:#1e8e3e;">藏 +${formatNum(collectDiff)}</span>` : ''}
        </div>
      </div>
      ${d.records.length > 1 ? `<div style="margin-top:8px;">
        <canvas id="chart-${vid}" height="120"></canvas>
      </div>` : ''}
    </div>`;
  }).join('') + pager;

  // 渲染当前页的 Chart.js 图表
  pageEntries.forEach(([vid, data]) => {
    if (data.records.length <= 1) return;
    const canvas = document.getElementById('chart-' + vid);
    if (!canvas || typeof Chart === 'undefined') return;
    const records = [...data.records].reverse();
    new Chart(canvas, {
      type: 'line',
      data: {
        labels: records.map(r => new Date(r.snapshot_at + 'Z').toLocaleDateString('zh-CN', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'})),
        datasets: [
          { label: '点赞', data: records.map(r => r.like_count), borderColor: '#d93025', backgroundColor: 'rgba(217,48,37,0.1)', tension: 0.3, fill: true },
          { label: '评论', data: records.map(r => r.comment_count), borderColor: '#1a73e8', backgroundColor: 'rgba(26,115,232,0.1)', tension: 0.3, fill: true },
          { label: '收藏', data: records.map(r => r.collect_count), borderColor: '#1e8e3e', backgroundColor: 'rgba(30,142,62,0.1)', tension: 0.3, fill: true },
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } } },
        scales: {
          x: { ticks: { font: { size: 10 }, maxRotation: 45 } },
          y: { beginAtZero: false, ticks: { font: { size: 10 }, callback: v => v >= 10000 ? (v/10000).toFixed(1)+'w' : v } }
        }
      }
    });
  });
}

// #30 图片大图预览（支持左右切换、滚轮缩放）
let previewImages = [];
let previewIndex = 0;
let previewZoom = 1;

function collectPreviewImages() {
  previewImages = [];
  document.querySelectorAll('img[onclick*="showImagePreview"]').forEach(img => {
    const src = img.src || img.getAttribute('src');
    if (src && !previewImages.includes(src)) previewImages.push(src);
  });
}

function showImagePreview(src) {
  collectPreviewImages();
  previewIndex = previewImages.indexOf(src);
  if (previewIndex < 0) { previewImages = [src]; previewIndex = 0; }
  previewZoom = 1;
  updatePreviewImage();
  document.getElementById('imagePreviewModal').style.display = 'flex';
}

function updatePreviewImage() {
  const img = document.getElementById('imagePreviewImg');
  img.src = previewImages[previewIndex];
  img.style.transform = `scale(${previewZoom})`;
  const counter = document.getElementById('previewCounter');
  if (counter) counter.textContent = previewImages.length > 1 ? `${previewIndex + 1} / ${previewImages.length}` : '';
  // 显示/隐藏箭头
  const prevBtn = document.getElementById('previewPrev');
  const nextBtn = document.getElementById('previewNext');
  if (prevBtn) prevBtn.style.display = previewImages.length > 1 ? '' : 'none';
  if (nextBtn) nextBtn.style.display = previewImages.length > 1 ? '' : 'none';
}

function previewNav(dir) {
  previewIndex = (previewIndex + dir + previewImages.length) % previewImages.length;
  previewZoom = 1;
  updatePreviewImage();
}

// 键盘左右切换
document.addEventListener('keydown', function(e) {
  const modal = document.getElementById('imagePreviewModal');
  if (!modal || modal.style.display !== 'flex') return;
  if (e.key === 'ArrowLeft') previewNav(-1);
  else if (e.key === 'ArrowRight') previewNav(1);
});

// 滚轮缩放
document.getElementById('imagePreviewModal')?.addEventListener('wheel', function(e) {
  e.preventDefault();
  previewZoom = Math.max(0.3, Math.min(5, previewZoom + (e.deltaY > 0 ? -0.2 : 0.2)));
  document.getElementById('imagePreviewImg').style.transform = `scale(${previewZoom})`;
}, { passive: false });

// ==================== 博主管理 ====================
async function followAuthor() {
  if (!currentUser) return;
  const btn = document.getElementById('followBtn');
  btn.disabled = true;
  try {
    const res = await fetch('/api/douyin/follow', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
      name: currentUser.name,
      uniqueId: currentUser.id,
      avatar: currentUser.avatar || '',
      secUid: currentUser.secUid || '',
      url: currentUser.url || '',
    })});
    const data = await res.json();
    if (data.status === 'already_followed') {
      btn.textContent = '已关注';
      btn.style.color = '#1e8e3e';
    } else {
      btn.textContent = '已关注';
      btn.style.color = '#1e8e3e';
      btn.style.borderColor = '#1e8e3e';
    }
    loadBloggerSelect();
  } catch (err) { toast('关注失败: ' + err.message, 'error'); }
  finally { btn.disabled = false; }
}

async function checkFollowStatus() {
  if (!currentUser?.id) return;
  try {
    const res = await fetch('/api/douyin/bloggers');
    const bloggers = await res.json();
    const btn = document.getElementById('followBtn');
    btn.style.display = '';
    const isFollowed = bloggers.some(b => b.id === currentUser.id || b.unique_id === currentUser.id);
    if (isFollowed) {
      btn.textContent = '已关注';
      btn.style.color = '#1e8e3e';
      btn.style.borderColor = '#1e8e3e';
    } else {
      btn.textContent = '+ 关注';
      btn.style.color = '';
      btn.style.borderColor = '';
    }
  } catch {}
}

const BLOGGER_CHIPS_MAX = 5;
let allBloggersCache = [];

async function loadBloggerSelect() {
  try {
    const res = await fetch('/api/douyin/bloggers');
    allBloggersCache = await res.json();
    renderBloggerChips();
  } catch {}
}

function renderBloggerChips() {
  const container = document.getElementById('bloggerChips');
  if (!container) return;
  const bloggers = allBloggersCache;
  if (!bloggers.length) {
    container.innerHTML = '<span style="font-size:12px;color:#aaa;">关注博主后显示</span>';
    return;
  }
  const show = bloggers.slice(0, BLOGGER_CHIPS_MAX);
  const rest = bloggers.length - show.length;
  container.innerHTML = show.map(b =>
    `<span onclick="selectBloggerChip('${esc(b.url)}','${esc(b.name)}','${esc(b.unique_id)}')" style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border:1px solid #dadce0;border-radius:16px;cursor:pointer;font-size:12px;background:#fff;transition:all 0.2s;" onmouseover="this.style.borderColor='#1a73e8';this.style.background='#e8f0fe'" onmouseout="this.style.borderColor='#dadce0';this.style.background='#fff'">
      ${b.avatar ? `<img src="${b.avatar}" referrerpolicy="no-referrer" style="width:18px;height:18px;border-radius:50%;">` : ''}
      ${esc(b.name)}
    </span>`
  ).join('') +
  (rest > 0 ? `<span onclick="showAllBloggerChips()" style="padding:3px 10px;border:1px dashed #dadce0;border-radius:16px;cursor:pointer;font-size:12px;color:#80868b;">+${rest} 更多</span>` : '');
}

function showAllBloggerChips() {
  const container = document.getElementById('bloggerChips');
  const bloggers = allBloggersCache;
  container.innerHTML = bloggers.map(b =>
    `<span onclick="selectBloggerChip('${esc(b.url)}','${esc(b.name)}','${esc(b.unique_id)}')" style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border:1px solid #dadce0;border-radius:16px;cursor:pointer;font-size:12px;background:#fff;transition:all 0.2s;" onmouseover="this.style.borderColor='#1a73e8';this.style.background='#e8f0fe'" onmouseout="this.style.borderColor='#dadce0';this.style.background='#fff'">
      ${b.avatar ? `<img src="${b.avatar}" referrerpolicy="no-referrer" style="width:18px;height:18px;border-radius:50%;">` : ''}
      ${esc(b.name)}
    </span>`
  ).join('') +
  `<span onclick="renderBloggerChips()" style="padding:3px 10px;border:1px dashed #dadce0;border-radius:16px;cursor:pointer;font-size:12px;color:#80868b;">收起</span>`;
}

function selectBloggerChip(url, name, id) {
  if (!url) return;
  document.getElementById('shareInput').value = url;
  currentUser = { name, id, url };
  showAuthorCard({ name, id }, null);
  document.getElementById('loadAllVideosBtn').style.display = '';
  loadAuthorVideos();
}

loadBloggerSelect();

async function loadBloggers(container) {
  try {
    const res = await fetch('/api/douyin/bloggers');
    const bloggers = await res.json();
    if (!bloggers.length) { container.innerHTML = '<div class="empty-state">暂无关注的博主</div>'; return; }

    // 定时抓取控制栏（独立 try，不影响博主列表渲染）
    let schedHtml = '';
    try {
      const schedRes = await fetch('/api/douyin/scheduler/status');
      const schedData = await schedRes.json();
      const stopped = !schedData.running && schedData.stopReason;
      const hasAutoFetch = bloggers.some(b => b.auto_fetch_enabled);
      schedHtml = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;padding:10px 14px;background:${stopped?'#fce8e6':'#f8f9fa'};border-radius:8px;font-size:13px;flex-wrap:wrap;">
        <span>定时抓取:</span>
        <span id="schedStatus" style="color:${schedData.running?'#1e8e3e':stopped?'#d93025':'#888'};">${schedData.running?'运行中':stopped?'已停止':'未启动'}</span>
        ${stopped ? `<span style="font-size:12px;color:#d93025;">${esc(schedData.stopReason)}</span>` : ''}
        ${schedData.running
          ? `<button class="btn btn-outline btn-sm" onclick="toggleScheduler(false)">停止</button>`
          : `<button class="btn btn-primary btn-sm" onclick="toggleScheduler(true)">启动(每小时)</button>`}
        <span id="fetchMsg" style="font-size:12px;color:#888;"></span>
      </div>`;
    } catch { /* scheduler endpoint not available, skip */ }

    let html = schedHtml;
    html += bloggers.map(b => `<div class="asset-list-item" style="gap:14px;background:${b.auto_fetch_enabled ? '#e8f0fe' : '#fff'};transition:background 0.3s;">
      ${b.avatar ? `<img src="${b.avatar}" referrerpolicy="no-referrer" style="width:44px;height:44px;border-radius:50%;">` : '<div style="width:44px;height:44px;border-radius:50%;background:#e8eaed;"></div>'}
      <div class="ali-info">
        <div class="ali-title">${esc(b.name)}</div>
        <div class="ali-meta">ID: ${esc(b.unique_id)} · 关注于 ${formatRelativeTime(b.created_at)}${b.last_fetched_at ? ` · 上次抓取: ${formatRelativeTime(b.last_fetched_at)}` : ''}</div>
      </div>
      <label style="font-size:12px;display:flex;align-items:center;gap:4px;cursor:pointer;">
        <input type="checkbox" ${b.auto_fetch_enabled ? 'checked' : ''} onchange="toggleAutoFetch('${esc(b.id)}',this.checked)"> 自动抓取
      </label>
      <span style="color:#1e8e3e;font-size:12px;font-weight:500;">已关注</span>
      <button class="btn btn-primary btn-sm" onclick="loadBloggerVideos('${esc(b.url)}','${esc(b.name)}','${esc(b.unique_id)}')">查看视频</button>
      <button class="btn btn-outline btn-sm" style="color:#d93025;" onclick="unfollowBlogger('${esc(b.id)}')">取关</button>
    </div>`).join('');
    container.innerHTML = html;
  } catch (err) { container.innerHTML = '<div class="empty-state">加载失败: ' + esc(err.message) + '</div>'; }
}

async function checkDouyinLogin() {
  try {
    const res = await fetch('/api/douyin/cookie-status');
    const data = await res.json();
    return data.status === 'ok';
  } catch { return false; }
}

async function toggleScheduler(start) {
  if (start && !(await checkDouyinLogin())) {
    toast('请先登录抖音，否则无法抓取数据', 'warning', 4000);
    return;
  }
  try {
    if (start) {
      await fetch('/api/douyin/scheduler/start', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({interval: 60})});
      toast('定时抓取已启动', 'success', 2000);
    } else {
      await fetch('/api/douyin/scheduler/stop', {method:'POST'});
      toast('定时抓取已停止', 'info', 2000);
    }
    refreshTaskHistory();
  } catch {}
}

async function fetchNow() {
  if (!(await checkDouyinLogin())) {
    toast('请先登录抖音，否则无法抓取数据', 'warning', 4000);
    return;
  }
  const msg = document.getElementById('fetchMsg');
  if (msg) { msg.textContent = '抓取中...'; msg.style.color = '#1a73e8'; }
  try {
    const res = await fetch('/api/douyin/scheduler/fetch-now', {method:'POST'});
    const data = await res.json();
    if (msg) { msg.textContent = `完成: ${data.ok} 成功, ${data.fail} 失败`; msg.style.color = '#1e8e3e'; }
  } catch (err) {
    if (msg) { msg.textContent = '抓取失败'; msg.style.color = '#d93025'; }
  }
}

async function toggleAutoFetch(id, enabled) {
  if (enabled) {
    // 检查是否已登录抖音
    try {
      const cookieRes = await fetch('/api/douyin/cookie-status');
      const cookieData = await cookieRes.json();
      if (cookieData.status !== 'ok') {
        toast('请先登录抖音，否则无法抓取数据', 'warning', 4000);
        // 恢复 checkbox 状态
        const cb = document.querySelector(`input[onchange*="toggleAutoFetch('${id}'"]`);
        if (cb) cb.checked = false;
        return;
      }
    } catch {}
  }
  try {
    await fetch(`/api/douyin/bloggers/${encodeURIComponent(id)}/auto-fetch`, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({enabled})});
    toast(enabled ? '已开启自动抓取' : '已关闭自动抓取', 'success', 2000);
    // 高亮选中行
    const row = document.querySelector(`input[onchange*="toggleAutoFetch('${id}'"]`)?.closest('.asset-list-item');
    if (row) row.style.background = enabled ? '#e8f0fe' : '#fff';
    if (enabled) {
      try {
        // 自动启动定时抓取（不立即执行，由"立即抓取一次"手动触发）
        const schedRes = await fetch('/api/douyin/scheduler/status');
        const schedData = await schedRes.json();
        if (!schedData.running) {
          await fetch('/api/douyin/scheduler/start', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({interval: 60})});
          toast('定时抓取已自动启动（每小时）', 'info', 3000);
        }
      } catch {}
    }
  } catch { toast('设置失败', 'error'); }
}

function loadBloggerVideos(url, name, id) {
  showPage('workspace');
  document.getElementById('shareInput').value = url;
  currentUser = { name, id, url };
  document.getElementById('authorCard').classList.add('show');
  document.getElementById('authorName').textContent = name;
  document.getElementById('authorMeta').textContent = 'ID: ' + id;
  loadAuthorVideos();
}

async function unfollowBlogger(id) {
  if (!confirm('确定取消关注？')) return;
  try { await fetch('/api/douyin/follow/' + encodeURIComponent(id), {method:'DELETE'}); refreshTaskHistory(); loadBloggerSelect(); toast('已取消关注','info',2000); } catch { toast('操作失败','error'); }
}

let dlRecordsCache = [], dlRecordPage = 1;
const DL_PER_PAGE = 10;

async function loadDownloadRecords(container) {
  try {
    const res = await fetch('/api/douyin/downloads'); dlRecordsCache = await res.json();
    if (!dlRecordsCache.length) { container.innerHTML = '<div class="empty-state">暂无下载记录</div>'; return; }
    renderDownloadRecords(container);
  } catch { container.innerHTML = '<div class="empty-state">加载失败</div>'; }
}

function goDlPage(p) { dlRecordPage = p; renderDownloadRecords(document.getElementById('assetContainer')); }

function renderDownloadRecords(container) {
  const all = dlRecordsCache;
  const totalPages = Math.ceil(all.length / DL_PER_PAGE);
  if (dlRecordPage > totalPages) dlRecordPage = totalPages;
  const start = (dlRecordPage - 1) * DL_PER_PAGE;
  const files = all.slice(start, start + DL_PER_PAGE);

  let pager = '';
  if (totalPages > 1) {
    pager = `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;font-size:13px;color:#5f6368;">
      <span>共 ${all.length} 条</span>
      <span style="display:flex;align-items:center;gap:6px;">
        ${dlRecordPage > 1 ? `<button class="btn btn-outline btn-sm" onclick="goDlPage(${dlRecordPage-1})">上一页</button>` : ''}
        <span>${dlRecordPage} / ${totalPages} 页</span>
        ${dlRecordPage < totalPages ? `<button class="btn btn-outline btn-sm" onclick="goDlPage(${dlRecordPage+1})">下一页</button>` : ''}
      </span>
    </div>`;
  }

  container.innerHTML = files.map(f => {
    const size = (f.size / 1024 / 1024).toFixed(1) + 'MB';
    const date = new Date(f.downloaded_at).toLocaleString('zh-CN');
    return `<div class="asset-list-item" style="gap:14px;">
      ${f.thumbnail ? `<div class="vc-thumb-wrap"><img src="${f.thumbnail}" referrerpolicy="no-referrer" style="width:60px;height:80px;object-fit:cover;border-radius:6px;cursor:pointer;" onclick="showImagePreview(this.src)"><div class="vc-hover-zoom"><img src="${f.thumbnail}" referrerpolicy="no-referrer"></div></div>` : '<div style="width:60px;height:80px;background:#e8eaed;border-radius:6px;"></div>'}
      <div class="ali-info">
        <div class="ali-title">${esc(f.title)}</div>
        <div class="ali-meta">${esc(f.uploader)} · ${formatDuration(f.duration)} · ${size} · 下载于 ${date}</div>
      </div>
      <a href="${f.previewUrl}" target="_blank" class="btn btn-outline btn-sm">播放</a>
      <button class="btn btn-primary btn-sm" onclick="showPage('workspace');loadTaskResult('${esc(f.id)}')">加载文案</button>
    </div>`;
  }).join('') + pager;
}

let historyCache = [], historyPage = 1;
const HISTORY_PER_PAGE = 10;

async function loadDouyinHistory(container) {
  try {
    const res = await fetch('/api/douyin/history'); historyCache = await res.json();
    if (!historyCache.length) { container.innerHTML = '<div class="empty-state">暂无解析记录</div>'; return; }
    renderDouyinHistory(container);
  } catch { container.innerHTML = '<div class="empty-state">加载失败</div>'; }
}

function goHistoryPage(p) { historyPage = p; renderDouyinHistory(document.getElementById('assetContainer')); }

function renderDouyinHistory(container) {
  const all = historyCache;
  const totalPages = Math.ceil(all.length / HISTORY_PER_PAGE);
  if (historyPage > totalPages) historyPage = totalPages;
  const start = (historyPage - 1) * HISTORY_PER_PAGE;
  const videos = all.slice(start, start + HISTORY_PER_PAGE);

  let pager = '';
  if (totalPages > 1) {
    pager = `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;font-size:13px;color:#5f6368;">
      <span>共 ${all.length} 条</span>
      <span style="display:flex;align-items:center;gap:6px;">
        ${historyPage > 1 ? `<button class="btn btn-outline btn-sm" onclick="goHistoryPage(${historyPage-1})">上一页</button>` : ''}
        <span>${historyPage} / ${totalPages} 页</span>
        ${historyPage < totalPages ? `<button class="btn btn-outline btn-sm" onclick="goHistoryPage(${historyPage+1})">下一页</button>` : ''}
      </span>
    </div>`;
  }

  container.innerHTML = videos.map(v => {
    const date = v.upload_date ? v.upload_date.substring(0,4)+'-'+v.upload_date.substring(4,6)+'-'+v.upload_date.substring(6,8) : '';
    return `<div class="asset-list-item" style="gap:14px;">
      ${v.thumbnail ? `<div class="vc-thumb-wrap"><img src="${v.thumbnail}" referrerpolicy="no-referrer" style="width:60px;height:80px;object-fit:cover;border-radius:6px;cursor:pointer;" onclick="showImagePreview(this.src)"><div class="vc-hover-zoom"><img src="${v.thumbnail}" referrerpolicy="no-referrer"></div></div>` : ''}
      <div class="ali-info">
        <div class="ali-title">${esc(v.title || '无标题')}</div>
        <div class="ali-meta">${esc(v.uploader)} · ${formatNum(v.like_count)}赞 · ${formatDuration(v.duration)} · ${date} · 解析于${formatRelativeTime(v.created_at)}</div>
      </div>
      <button class="btn btn-primary btn-sm" onclick="showPage('workspace');extractFromDouyin('${esc(v.url)}','${esc(v.id)}','${esc(v.title)}','${esc(v.video_url||'')}')">提取文案</button>
      <button class="btn btn-outline btn-sm" style="color:#dc3545;" onclick="deleteDouyinHistory('${esc(v.id)}')">删除</button>
    </div>`;
  }).join('') + pager;
}

async function deleteDouyinHistory(id) {
  if (!confirm('确定删除？')) return;
  try { await fetch('/api/douyin/history/' + id, {method:'DELETE'}); refreshTaskHistory(); toast('已删除','info',2000); } catch { toast('删除失败','error'); }
}

async function loadTtsFiles(container) {
  try {
    const res = await fetch('/api/tts-files'); const files = await res.json();
    if (!files.length) { container.innerHTML = '<div class="empty-state">暂无合成的配音</div>'; return; }
    container.innerHTML = files.map(f => {
      const size = (f.size / 1024).toFixed(0) + 'KB';
      const date = new Date(f.created_at).toLocaleString('zh-CN');
      return `<div class="asset-list-item">
        <div class="ali-info">
          <div class="ali-title">${esc(f.name)}</div>
          <div class="ali-meta">${size} · ${date}</div>
        </div>
        <audio controls src="${f.url}" style="height:32px;"></audio>
        <a href="${f.url}" download class="btn btn-outline btn-sm">下载</a>
        <button class="btn btn-outline btn-sm" style="color:#dc3545;border-color:#dc3545;" onclick="deleteTtsFile('${esc(f.name)}')">删除</button>
      </div>`;
    }).join('');
  } catch { container.innerHTML = '<div class="empty-state">加载失败</div>'; }
}

async function deleteTtsFile(name) {
  if (!confirm('确定删除？')) return;
  try { await fetch('/api/tts-files/' + encodeURIComponent(name), {method:'DELETE'}); refreshTaskHistory(); toast('已删除','info',2000); } catch { toast('删除失败','error'); }
}

// #28 配音历史（最近 3 条）
let synthHistory = [];
function addToSynthHistory(url) {
  synthHistory.unshift({ url, time: new Date().toLocaleTimeString('zh-CN') });
  if (synthHistory.length > 3) synthHistory.pop();
  renderSynthHistory();
}
function renderSynthHistory() {
  const c = document.getElementById('synthHistoryList');
  if (!c) return;
  if (!synthHistory.length) { c.innerHTML = ''; return; }
  c.innerHTML = '<div style="font-size:12px;color:#80868b;margin-bottom:4px;">最近合成</div>' +
    synthHistory.map((h, i) => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
      <audio controls src="${h.url}" style="height:28px;flex:1;"></audio>
      <span style="font-size:11px;color:#80868b;white-space:nowrap;">${h.time}</span>
      <a href="${h.url}" download class="btn btn-outline btn-sm" style="padding:2px 8px;font-size:11px;">下载</a>
    </div>`).join('');
}

function clearAudioResult() {
  const player = document.getElementById('audioPlayer');
  player.pause(); player.src = '';
  document.getElementById('audioResult').classList.remove('show');
}

// ==================== 素材库 ====================
let assetTab = 'all';
function switchAssetTab(tab, el) {
  assetTab = tab;
  document.querySelectorAll('#page-assets .tab-bar a').forEach(a => a.classList.remove('active'));
  el.classList.add('active');
  refreshTaskHistory();
}

async function refreshTaskHistory() {
  try {
    const res = await fetch('/api/tasks'); let tasks = await res.json();
    const c = document.getElementById('taskHistoryContainer');
    const ac = document.getElementById('assetContainer');

    const searchEl = document.getElementById('assetSearch');
    const keyword = searchEl ? searchEl.value.trim().toLowerCase() : '';
    if (keyword) {
      tasks = tasks.filter(t => (t.filename || '').toLowerCase().includes(keyword));
    }

    if (assetTab === 'all' || assetTab === 'text') {
      const completed = tasks.filter(t => t.status === 'completed');
      if (completed.length) {
        ac.innerHTML = completed.map(t => `<div class="asset-list-item">
          <div class="ali-info">
            <div class="ali-title">${esc(t.filename)}</div>
            <div class="ali-meta">时长: ${formatDuration(t.duration_seconds)} · ${formatDate(t.created_at)} · 耗时: ${formatElapsed(t.created_at, t.updated_at)}</div>
          </div>
          <span class="ali-tag tag-original">原始提取</span>
          <button class="btn btn-primary btn-sm" onclick="showPage('workspace');loadTaskResult('${t.id}')">加载文案</button>
          <button class="btn btn-outline btn-sm" onclick="downloadTaskResult('${t.id}','${esc(t.filename)}')">下载</button>
        </div>`).join('');
      } else {
        ac.innerHTML = '<div class="empty-state">暂无已完成的文案</div>';
      }
    } else if (assetTab === 'blogger') {
      await loadBloggers(ac);
    } else if (assetTab === 'video') {
      await loadDouyinHistory(ac);
    } else if (assetTab === 'downloaded') {
      await loadDownloadRecords(ac);
    } else if (assetTab === 'audio') {
      await loadTtsFiles(ac);
    }

    if (!tasks.length) { c.innerHTML = '<div class="empty-state">暂无历史任务</div>'; return; }
    c.innerHTML = tasks.map(t => {
      const sl = {pending:'排队中',processing:'处理中',completed:'已完成',failed:'失败'};
      return `<div class="asset-list-item">
        <div class="ali-info">
          <div class="ali-title">${esc(t.filename)}</div>
          <div class="ali-meta">时长: ${formatDuration(t.duration_seconds)} · ${formatDate(t.created_at)} ${t.status==='completed'?`· 耗时: ${formatElapsed(t.created_at,t.updated_at)}`:''}</div>
        </div>
        <span class="ali-tag ti-${t.status}">${sl[t.status]||t.status}</span>
        ${t.status==='completed'?`<button class="btn btn-primary btn-sm" onclick="showPage('workspace');loadTaskResult('${t.id}')">加载文案</button>
        <button class="btn btn-outline btn-sm" onclick="downloadTaskResult('${t.id}','${esc(t.filename)}')">下载</button>`:''}
        <button class="btn btn-outline btn-sm" style="color:#dc3545;" onclick="deleteTask('${t.id}');refreshTaskHistory();">删除</button>
      </div>`;
    }).join('');
  } catch {}
}

async function downloadTaskResult(id, fn) {
  try {
    const t = await (await fetch(`/api/tasks/${id}/result`)).text();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([t],{type:'text/plain;charset=utf-8'}));
    a.download = fn.replace(/\.[^.]+$/,'')+'.txt'; a.click();
  } catch(e) { toast('下载失败: '+e.message, 'error'); }
}

// ==================== SRT 字幕导出 ====================
async function exportSRT(taskId, filename) {
  try {
    const text = await (await fetch(`/api/tasks/${taskId}/result`)).text();
    const srt = convertToSRT(text);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([srt], {type:'text/plain;charset=utf-8'}));
    a.download = filename.replace(/\.[^.]+$/, '') + '.srt';
    a.click();
  } catch(e) { toast('导出失败: ' + e.message, 'error'); }
}

function convertToSRT(text) {
  // 解析 [HH:MM:SS -> HH:MM:SS] 格式的时间戳文本
  const lines = text.split('\n');
  const segments = [];
  const timeRegex = /\[(\d{2}:\d{2}:\d{2})\s*->\s*(\d{2}:\d{2}:\d{2})\]\s*(.*)/;

  for (const line of lines) {
    const match = line.match(timeRegex);
    if (match) {
      segments.push({ start: match[1], end: match[2], text: match[3].trim() });
    }
  }

  if (!segments.length) {
    // 没有时间戳，按句子自动分段（每句约3秒）
    const plainText = text.replace(/\[\d{2}:\d{2}:\d{2}\s*->\s*\d{2}:\d{2}:\d{2}\]\s*/g, '');
    const sentences = plainText.split(/[。！？\n]+/).filter(s => s.trim());
    let time = 0;
    sentences.forEach((s, i) => {
      const duration = Math.max(2, Math.ceil(s.length / 5));
      const startH = Math.floor(time / 3600);
      const startM = Math.floor((time % 3600) / 60);
      const startS = time % 60;
      time += duration;
      const endH = Math.floor(time / 3600);
      const endM = Math.floor((time % 3600) / 60);
      const endS = time % 60;
      segments.push({
        start: `${String(startH).padStart(2,'0')}:${String(startM).padStart(2,'0')}:${String(startS).padStart(2,'0')}`,
        end: `${String(endH).padStart(2,'0')}:${String(endM).padStart(2,'0')}:${String(endS).padStart(2,'0')}`,
        text: s.trim()
      });
    });
  }

  return segments.map((seg, i) =>
    `${i + 1}\n${seg.start},000 --> ${seg.end},000\n${seg.text}\n`
  ).join('\n');
}

// ==================== 音色库 ====================
function toggleVoiceForm() {
  const f = document.getElementById('voiceForm');
  f.classList.toggle('show');
}

async function uploadVoice() {
  const fi = document.getElementById('voiceFileInput');
  if (!fi.files[0]) return toast('请选择音频文件','warning');
  const name = document.getElementById('voiceName').value.trim();
  if (!name) return toast('请输入声音名称','warning');
  const fd = new FormData();
  fd.append('audio', fi.files[0]);
  const refText = document.getElementById('refText').value.trim();
  if (name) fd.append('name', name);
  if (refText) fd.append('ref_text', refText);
  try {
    const res = await fetch('/api/voices/upload', {method:'POST', body:fd});
    const data = await res.json(); if (!res.ok) throw new Error(data.error);
    document.getElementById('voiceName').value = '';
    document.getElementById('refText').value = '';
    fi.value = '';
    toggleVoiceForm();
    refreshVoiceLib();
  } catch (err) { toast('上传失败: ' + err.message, 'error'); }
}

async function refreshVoiceLib() {
  try {
    const res = await fetch('/api/voices'); const voices = await res.json();
    const c = document.getElementById('voiceLibContainer');
    if (!voices.length) { c.innerHTML = '<div class="empty-state">暂无声音样本，点击上方添加</div>'; return; }
    c.innerHTML = voices.map(v => `<div class="voice-lib-card" style="flex-wrap:wrap;">
      <div style="font-size:28px;">🎙️</div>
      <div class="vlc-info">
        <div class="vlc-name">${esc(v.name)}</div>
        <div class="vlc-meta">时长: ${formatDuration(v.duration_seconds)} · ${v.ref_text?'已填参考文本':'无参考文本'} · ${v.cosyvoice_id ? '✅ ' + v.cosyvoice_id : '⚠️ 未注册云端'} · ${formatDate(v.created_at)}</div>
      </div>
      <audio controls src="${v.audioUrl}" style="height:32px;"></audio>
      ${!v.cosyvoice_id ? `<button class="btn btn-primary btn-sm" onclick="enrollVoice('${v.id}',this)">注册到云端</button>` : ''}
      <button class="btn btn-outline btn-sm" onclick="toggleRefText('${v.id}')">${v.ref_text ? '编辑参考文本' : '添加参考文本'}</button>
      <button class="btn btn-outline btn-sm" style="color:#dc3545;" onclick="deleteVoice('${v.id}')">删除</button>
      <div id="reftext-${v.id}" style="display:none;width:100%;margin-top:10px;">
        <textarea id="reftext-edit-${v.id}" style="width:100%;min-height:80px;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:13px;line-height:1.8;font-family:inherit;">${esc(v.ref_text||'')}</textarea>
        <div style="margin-top:6px;display:flex;gap:8px;">
          <button class="btn btn-success btn-sm" onclick="saveRefText('${v.id}')">保存</button>
          <span id="reftext-msg-${v.id}" style="font-size:12px;color:#888;line-height:28px;"></span>
        </div>
      </div>
    </div>`).join('');
  } catch {}
}

function toggleRefText(id) {
  const el = document.getElementById('reftext-' + id);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

async function saveRefText(id) {
  const text = document.getElementById('reftext-edit-' + id).value.trim();
  const msg = document.getElementById('reftext-msg-' + id);
  try {
    const res = await fetch(`/api/voices/${id}/ref-text`, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({refText: text})});
    if (!res.ok) throw new Error('保存失败');
    msg.textContent = '已保存';
    msg.style.color = '#28a745';
    setTimeout(() => { msg.textContent = ''; }, 2000);
  } catch (err) { msg.textContent = '保存失败'; msg.style.color = '#dc3545'; }
}

async function enrollVoice(id, btn) {
  btn.disabled = true; btn.textContent = '注册中...';
  try {
    const res = await fetch(`/api/voices/${id}/enroll`, {method:'POST'});
    const data = await res.json(); if (!res.ok) throw new Error(data.error);
    toast('注册成功！','success');
    refreshVoiceLib();
  } catch (err) { toast('注册失败: ' + err.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = '注册到云端'; }
}

async function deleteVoice(id) {
  if (!confirm('确定删除？')) return;
  try { await fetch(`/api/voices/${id}`, {method:'DELETE'}); refreshVoiceLib(); toast('已删除','info',2000); } catch { toast('删除失败','error'); }
}

// ==================== 模型设置 ====================
async function loadCurrentModel() {
  try {
    const res=await fetch('/api/config/model'); const d=await res.json();
    const mp = d.modelPath;
    const shortName = mp.includes('medium') ? 'medium' : mp.includes('small') ? 'small' : mp.includes('large') ? 'large-v3' : mp;
    document.getElementById('currentModel').textContent = shortName;
    const sel = document.getElementById('modelSelect');
    let matched = false;
    for (const opt of sel.options) { if (mp.includes(opt.value) || opt.value === mp) { sel.value = opt.value; matched = true; break; } }
    if (!matched) { const opt = document.createElement('option'); opt.value = mp; opt.textContent = shortName; sel.appendChild(opt); sel.value = mp; }
  } catch {}
}
async function switchModel() {
  const mp = document.getElementById('modelSelect').value;
  const btn = document.querySelector('[onclick="switchModel()"]');
  if (btn) { btn.disabled = true; btn.textContent = '切换中...'; }
  try { const res=await fetch('/api/config/model',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({modelPath:mp})}); const d=await res.json(); if(!res.ok)throw new Error(d.error); document.getElementById('currentModel').textContent=mp; toast('模型已切换','success'); } catch(e){ toast('切换失败: '+e.message, 'error'); }
  finally { if (btn) { btn.disabled = false; btn.textContent = '切换'; } }
}
loadCurrentModel();
