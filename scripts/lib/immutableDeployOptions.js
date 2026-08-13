'use strict';

const KNOWN_FLAGS = new Set(['--candidate-only']);

function assertKnownDeployArgs(argv = process.argv.slice(2)) {
  const unknown = (Array.isArray(argv) ? argv : []).filter(arg => String(arg).startsWith('--') && !KNOWN_FLAGS.has(String(arg)));
  if (unknown.length) throw new Error(`未知不可变部署参数：${unknown.join(', ')}`);
}

function candidateOnlyRequested(argv = process.argv.slice(2), env = process.env) {
  return env.VIDO_IMMUTABLE_CANDIDATE_ONLY === '1'
    || (Array.isArray(argv) && argv.includes('--candidate-only'));
}

module.exports = { assertKnownDeployArgs, candidateOnlyRequested };
