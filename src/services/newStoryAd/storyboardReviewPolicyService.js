'use strict';

function unique(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean)));
}

/** 只有会破坏主体、场景或叙事结构的硬问题才允许触发付费重写。 */
function blockingRewriteIssues(review = {}) {
  return unique(review.blocking_issues);
}

/** 软性建议随可用合同发布，不得成为出图前的串行模型门禁。 */
function publishableReview(review = {}) {
  const soft = unique(review.rewrite_issues);
  if (unique(review.blocking_issues).length) return review;
  if (!soft.length) return { ...review, pass: review.pass !== false, passed: review.pass !== false };
  return {
    ...review,
    pass: true,
    passed: true,
    rewrite_issues: [],
    warnings: unique([
      ...(Array.isArray(review.warnings) ? review.warnings : []),
      ...soft.map(issue => `已发布的非阻断优化建议：${issue}`),
    ]),
    deferred_rewrite_issues: soft,
  };
}

module.exports = { blockingRewriteIssues, publishableReview };
