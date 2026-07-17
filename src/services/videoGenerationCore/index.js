const domain = require('./domainContract');
const planner = require('./executionPlanner');
const costGuard = require('./costGuard');
const chineseError = require('./chineseError');

// 统一导出通用视频核心；业务模块只能通过此入口使用稳定合同。
module.exports = {
  domain,
  planner,
  costGuard,
  chineseError,
};
