'use strict';

const resolver = require('../src/services/newStoryAd/visualAssetBillingReviewResolverService');

function arg(name) {
  const prefix = `--${name}=`;
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length) || '';
}

const input = {
  taskId: arg('task'), reviewKey: arg('review-key'), state: arg('state'),
  evidence: arg('evidence'), reviewer: arg('reviewer'), expectedRevision: Number(arg('revision') || 0),
};
if (!input.taskId || !input.reviewKey || !input.state || !input.evidence || !input.reviewer) {
  console.error('用法: node scripts/resolve-story-ad-visual-billing-review-v75.js --task=<id> --review-key=<key> --state=<not_billed|unverifiable|completed> --evidence=<证据> --reviewer=<核对人> [--revision=<n>] [--apply]');
  process.exit(2);
}
const result = resolver.apply(input, { apply: process.argv.includes('--apply') });
console.log(JSON.stringify(result, null, 2));
