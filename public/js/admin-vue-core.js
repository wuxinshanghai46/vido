(() => {
  if (window.AdminVueApi) return;

  const cache = new Map();
  const inflight = new Map();
  const DEFAULT_TTL = 12000;

  function stableKey(url, opts = {}) {
    const method = String(opts.method || 'GET').toUpperCase();
    const body = typeof opts.body === 'string' ? opts.body : '';
    return `${method} ${url} ${body}`;
  }

  function now() {
    return Date.now();
  }

  async function parseJsonResponse(res) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || data.message || `HTTP ${res.status}`);
    }
    if (data && data.success === false) {
      throw new Error(data.error || data.message || '请求失败');
    }
    return data && Object.prototype.hasOwnProperty.call(data, 'data') ? data.data : data;
  }

  async function request(url, opts = {}) {
    const method = String(opts.method || 'GET').toUpperCase();
    const ttl = Number.isFinite(opts.ttl) ? opts.ttl : DEFAULT_TTL;
    const dedupe = opts.dedupe !== false;
    const useCache = method === 'GET' && opts.cache !== false;
    const key = stableKey(url, opts);

    if (useCache) {
      const cached = cache.get(key);
      if (cached && cached.expires > now()) return cached.value;
    }

    if (dedupe && inflight.has(key)) return inflight.get(key);

    const cleanOpts = { ...opts };
    delete cleanOpts.ttl;
    delete cleanOpts.cache;
    delete cleanOpts.dedupe;

    const task = authFetch(url, cleanOpts)
      .then(parseJsonResponse)
      .then(value => {
        if (useCache && ttl > 0) cache.set(key, { value, expires: now() + ttl });
        if (method !== 'GET') clearCache();
        return value;
      })
      .finally(() => inflight.delete(key));

    if (dedupe) inflight.set(key, task);
    return task;
  }

  function clearCache(prefix = '') {
    if (!prefix) {
      cache.clear();
      return;
    }
    [...cache.keys()].forEach(key => {
      if (key.includes(prefix)) cache.delete(key);
    });
  }

  function prefetch(urls, opts = {}) {
    return Promise.allSettled(urls.map(url => request(url, { ...opts, cache: true })));
  }

  function post(url, body, opts = {}) {
    return request(url, {
      ...opts,
      method: 'POST',
      body: body instanceof FormData ? body : JSON.stringify(body || {})
    });
  }

  function put(url, body, opts = {}) {
    return request(url, {
      ...opts,
      method: 'PUT',
      body: body instanceof FormData ? body : JSON.stringify(body || {})
    });
  }

  function del(url, opts = {}) {
    return request(url, { ...opts, method: 'DELETE' });
  }

  window.AdminVueApi = {
    request,
    get: request,
    post,
    put,
    delete: del,
    clearCache,
    prefetch,
    cache
  };

  window.AdminVueModules = window.AdminVueModules || {
    modules: new Map(),
    register(id, definition) {
      this.modules.set(id, definition);
    },
    get(id) {
      return this.modules.get(id);
    },
    async load(id) {
      const definition = this.modules.get(id);
      if (definition && typeof definition.load === 'function') return definition.load();
      return null;
    }
  };
})();
