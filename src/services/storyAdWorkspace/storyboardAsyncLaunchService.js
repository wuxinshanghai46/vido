'use strict';

async function resolve(execution, readState = () => ({})) {
  const outcome = await Promise.race([
    Promise.resolve(execution).then(result => ({ result }), error => ({ error })),
    new Promise(done => setImmediate(() => done({ pending: true }))),
  ]);
  if (outcome.error) throw outcome.error;
  if (outcome.result) return { accepted: false, completed: true, result: outcome.result };
  return { accepted: true, completed: false, result: readState() };
}

module.exports = { resolve };
