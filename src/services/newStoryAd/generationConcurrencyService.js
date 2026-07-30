const pools = new Map();

function normalizedLimit(value, fallback = 2) {
  return Math.max(1, Math.min(8, Number(value) || fallback));
}

function pool(name = 'default', limit = 2) {
  const key = String(name || 'default');
  const wanted = normalizedLimit(limit);
  const current = pools.get(key);
  if (current && current.limit === wanted) return current;
  if (current && (current.active > 0 || current.queue.length > 0)) return current;
  const created = { name: key, limit: wanted, active: 0, queue: [], peak: 0, completed: 0 };
  pools.set(key, created);
  return created;
}

function drain(target) {
  while (target.active < target.limit && target.queue.length) {
    const item = target.queue.shift();
    target.active += 1;
    target.peak = Math.max(target.peak, target.active);
    Promise.resolve()
      .then(item.run)
      .then(item.resolve, item.reject)
      .finally(() => {
        target.active -= 1;
        target.completed += 1;
        drain(target);
      });
  }
}

function schedule(name, limit, run) {
  if (typeof run !== 'function') throw new Error('generation concurrency task must be a function');
  const target = pool(name, limit);
  return new Promise((resolve, reject) => {
    target.queue.push({ run, resolve, reject });
    drain(target);
  });
}

async function map(name, values = [], limit = 2, mapper) {
  return Promise.all((Array.isArray(values) ? values : []).map((value, index) => (
    schedule(name, limit, () => mapper(value, index))
  )));
}

function snapshot(name = '') {
  const selected = name ? [pools.get(String(name))].filter(Boolean) : [...pools.values()];
  return selected.map(item => ({
    name: item.name,
    limit: item.limit,
    active: item.active,
    queued: item.queue.length,
    peak: item.peak,
    completed: item.completed,
  }));
}

function resetForTests() {
  if ([...pools.values()].some(item => item.active || item.queue.length)) {
    throw new Error('cannot reset active generation concurrency pools');
  }
  pools.clear();
}

module.exports = {
  normalizedLimit,
  schedule,
  map,
  snapshot,
  resetForTests,
};
