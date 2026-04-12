/**
 * VIDO 首页 v18 — 精简版
 *   - 加载真实生成视频 (1 大方块 + 2 小方块 + 1 宽矩形)
 *   - 示例 chip 点击 → 填入 composer
 *   - "开始创作" 提交 → 跳转 studio (附带 prompt 参数)
 */
(async function loadCases() {
  try {
    const r = await fetch('/api/showcase/videos');
    const j = await r.json();
    if (!j.success || !j.videos?.length) return;

    const titles = [
      { title: '《重生之复仇千金》', author: '@剧场AI · Kling 2.1' },
      { title: '《赛博古风志》',     author: '@像素老鬼 · Sora-2' },
      { title: '《虚拟主播·小语》',  author: '@MiroBeauty · Runway' },
      { title: '《一分钟漫剧》',     author: '@速更剧场 · Veo' },
    ];

    // 方形组合: 1 大方块 + 2 小方块 + 1 宽矩形
    const shapes = ['case--big', 'case--sq', 'case--rect', 'case--wide'];
    const grid = document.getElementById('cases-grid');
    if (!grid) return;

    const html = j.videos.slice(0, 4).map((v, i) => {
      const meta = titles[i] || titles[0];
      const shape = shapes[i] || 'case--big';
      return `
        <div class="case ${shape}">
          <video src="/api/showcase/stream/${encodeURIComponent(v.id)}#t=0.5"
                 muted loop playsinline preload="metadata"></video>
          <div class="case-fade"></div>
          <div class="case-play">▶</div>
          <div class="case-meta">
            <h4>${meta.title}</h4>
            <span>${meta.author}</span>
          </div>
        </div>`;
    }).join('');
    grid.innerHTML = html;

    // IntersectionObserver - 进入视野才播
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        const v = e.target.querySelector('video');
        if (!v) return;
        if (e.isIntersecting) v.play().catch(() => {});
        else v.pause();
      });
    }, { threshold: 0.25 });
    grid.querySelectorAll('.case').forEach(c => io.observe(c));
  } catch (e) {
    console.error('[home] cases load failed', e);
  }
})();

// 示例 chip → 填入 composer
document.querySelectorAll('.example').forEach(el => {
  el.addEventListener('click', () => {
    const input = document.getElementById('composer-input');
    if (input) {
      input.value = el.textContent.trim();
      input.focus();
    }
  });
});

// composer 提交 → 已登录直接进 studio，未登录弹窗
function goCreate(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('composer-input');
  const theme = (input?.value || '').trim();
  if (theme) {
    sessionStorage.setItem('vido-prefill-theme', theme);
  }
  // 检查是否已登录
  if (sessionStorage.getItem('vido_token')) {
    location.href = '/index.html';
  } else {
    openAuthModal('login');
  }
  return false;
}
window.goCreate = goCreate;

// ═══════════════════════════════════════
// AUTH MODAL: 登录 / 注册
// ═══════════════════════════════════════
function openAuthModal(tab) {
  const modal = document.getElementById('auth-modal');
  if (!modal) return;
  modal.classList.add('show');
  switchAuthTab(tab || 'login');
  // 自动聚焦第一个输入框
  setTimeout(() => {
    const id = (tab === 'register') ? 'reg-username' : 'login-username';
    document.getElementById(id)?.focus();
  }, 100);
  // 锁定 body 滚动
  document.body.style.overflow = 'hidden';
}

function closeAuthModal() {
  const modal = document.getElementById('auth-modal');
  if (!modal) return;
  modal.classList.remove('show');
  document.body.style.overflow = '';
  hideAuthErr();
}

function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.getElementById('auth-form-login').style.display    = (tab === 'login')    ? '' : 'none';
  document.getElementById('auth-form-register').style.display = (tab === 'register') ? '' : 'none';
  hideAuthErr();
}

function showAuthErr(msg) {
  const el = document.getElementById('auth-err');
  if (el) {
    el.textContent = msg;
    el.classList.add('show');
  }
}
function hideAuthErr() {
  const el = document.getElementById('auth-err');
  if (el) el.classList.remove('show');
}

async function doLogin(e) {
  if (e) e.preventDefault();
  hideAuthErr();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  if (!username || !password) {
    showAuthErr('请输入用户名和密码');
    return false;
  }
  const btn = e?.submitter || document.querySelector('#auth-form-login .auth-submit');
  if (btn) { btn.disabled = true; btn.textContent = '登录中...'; }
  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error || '登录失败');
    sessionStorage.setItem('vido_token', j.data.access_token);
    localStorage.setItem('vido_token', j.data.access_token);
    if (j.data.user) {
      sessionStorage.setItem('vido_user', JSON.stringify(j.data.user));
      localStorage.setItem('vido_user', JSON.stringify(j.data.user));
    }
    location.href = '/index.html';
  } catch (err) {
    showAuthErr(err.message);
    if (btn) { btn.disabled = false; btn.textContent = '登录并进入工作室'; }
  }
  return false;
}
window.doLogin = doLogin;

async function doRegister(e) {
  if (e) e.preventDefault();
  hideAuthErr();
  const username = document.getElementById('reg-username').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  if (!username || !password) {
    showAuthErr('用户名和密码必填');
    return false;
  }
  if (username.length < 3 || username.length > 20) {
    showAuthErr('用户名长度需 3-20 位');
    return false;
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    showAuthErr('用户名只允许字母、数字、下划线');
    return false;
  }
  if (password.length < 6) {
    showAuthErr('密码至少 6 位');
    return false;
  }
  const btn = e?.submitter || document.querySelector('#auth-form-register .auth-submit');
  if (btn) { btn.disabled = true; btn.textContent = '注册中...'; }
  try {
    const r = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, email, password }),
    });
    const j = await r.json();
    if (!j.success) throw new Error(j.error || '注册失败');
    sessionStorage.setItem('vido_token', j.data.access_token);
    localStorage.setItem('vido_token', j.data.access_token);
    if (j.data.user) {
      sessionStorage.setItem('vido_user', JSON.stringify(j.data.user));
      localStorage.setItem('vido_user', JSON.stringify(j.data.user));
    }
    location.href = '/index.html';
  } catch (err) {
    showAuthErr(err.message);
    if (btn) { btn.disabled = false; btn.textContent = '注册并开始创作'; }
  }
  return false;
}
window.doRegister = doRegister;
window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;
window.switchAuthTab = switchAuthTab;

// 点击遮罩层关闭
document.addEventListener('click', (e) => {
  if (e.target.id === 'auth-modal') closeAuthModal();
});

// ═══════════════════════════════════════
// 检查登录状态 — 已登录则更新顶栏按钮
// ═══════════════════════════════════════
(function checkLoginState() {
  // 从 sessionStorage 或 localStorage 恢复 token（支持跨 tab、关闭浏览器后保持登录）
  let token = sessionStorage.getItem('vido_token');
  if (!token) {
    token = localStorage.getItem('vido_token');
    if (token) {
      // 从 localStorage 恢复到 sessionStorage（供 authFetch 使用）
      sessionStorage.setItem('vido_token', token);
      const user = localStorage.getItem('vido_user');
      if (user) sessionStorage.setItem('vido_user', user);
    }
  }

  const loginBtn = document.getElementById('tb-login-btn');
  const ctaBtn = document.getElementById('tb-cta-btn');
  if (token && loginBtn && ctaBtn) {
    // 已登录：显示用户名 + 进入工作台
    const user = (() => { try { return JSON.parse(sessionStorage.getItem('vido_user') || localStorage.getItem('vido_user') || '{}'); } catch { return {}; } })();
    loginBtn.textContent = user.username || '我的账号';
    loginBtn.onclick = () => { location.href = '/index.html'; };
    ctaBtn.textContent = '进入工作台';
    ctaBtn.onclick = () => { location.href = '/index.html'; };
  }
})();
// ESC 关闭
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeAuthModal();
});

