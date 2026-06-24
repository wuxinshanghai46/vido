(function () {
  const STORAGE_KEY = 'vido-theme';
  const VALID_THEMES = new Set([
    'purple',
    'light-mist',
  ]);

  function normalizeTheme(theme) {
    if (VALID_THEMES.has(theme)) return theme;
    return String(theme || '').startsWith('light') ? 'light-mist' : 'purple';
  }

  function applyTheme(theme) {
    const nextTheme = normalizeTheme(theme);
    document.documentElement.setAttribute('data-theme', nextTheme);
    return true;
  }

  function getStoredTheme() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (_) {
      return null;
    }
  }

  function setStoredTheme(theme) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (_) {}
  }

  function persistServerTheme(theme) {
    const token = getAccessToken();
    if (!token) return Promise.resolve(false);
    return fetch('/api/user/theme', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ theme }),
    }).then(res => res.ok).catch(() => false);
  }

  function setTheme(theme) {
    const nextTheme = normalizeTheme(theme);
    applyTheme(nextTheme);
    setStoredTheme(nextTheme);
    persistServerTheme(nextTheme);
    return nextTheme;
  }

  function getAccessToken() {
    try {
      return (
        localStorage.getItem('vido-token') ||
        localStorage.getItem('vido_token') ||
        localStorage.getItem('token') ||
        sessionStorage.getItem('vido-token') ||
        sessionStorage.getItem('vido_token') ||
        ''
      );
    } catch (_) {
      return '';
    }
  }

  const storedTheme = getStoredTheme();
  if (storedTheme) {
    applyTheme(storedTheme);
    setStoredTheme(normalizeTheme(storedTheme));
  }

  const accessToken = getAccessToken();
  if (accessToken) {
    fetch('/api/user/theme', { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (data && data.success && applyTheme(data.theme)) setStoredTheme(normalizeTheme(data.theme));
      })
      .catch(() => {});
  }

  window.vidoTheme = {
    storageKey: STORAGE_KEY,
    isValid: theme => VALID_THEMES.has(theme),
    normalize: normalizeTheme,
    apply: applyTheme,
    store: setTheme,
    set: setTheme,
    saveServer: persistServerTheme,
    current: () => document.documentElement.getAttribute('data-theme') || 'purple',
  };
})();
