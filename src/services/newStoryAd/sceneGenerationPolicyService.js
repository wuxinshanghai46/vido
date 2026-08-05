const sceneBinding = require('./sceneBindingService');

function contractVersion(asset = {}) {
  return Math.max(0, Number(
    asset.generation_contract_version
    || asset.view_acquisition?.generation_contract_version
    || 0,
  ) || 0);
}

function upgradeRequired(asset = {}, minimumVersion = 0) {
  // A verified five-view lock is stronger than missing transition metadata.
  return !sceneBinding.completeSpaceLock(asset)
    && contractVersion(asset) < Math.max(0, Number(minimumVersion || 0));
}

function fullUpgradePlan({ version = 1, viewKeys = [], viewLabels = [] } = {}) {
  return {
    version,
    action: 'regenerate_full_scene',
    view_keys: [...viewKeys],
    view_labels: [...viewLabels],
    count: viewKeys.length,
    reasons: ['场景图片生成于旧版空间合同，不能通过重复审核升级'],
    issue_codes: ['GENERATION_CONTRACT_UPGRADE_REQUIRED'],
    message: '系统将先重新补齐当前空间设定，再用 2 次图片调用生成 5 张新版参考（2×2 母图本地裁切 4 张 + 1 张俯视布局）并自动验收。',
  };
}

module.exports = { contractVersion, upgradeRequired, fullUpgradePlan };
