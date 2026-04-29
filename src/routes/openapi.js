/**
 * OpenAPI 转发路由
 * 签名已由 apiAuth 中间件校验通过，这里把请求转发到对应内部路由
 * 通过直接 require 内部 router 并用 "reroute" 技巧
 */
const express = require('express');
const router = express.Router();

// 为了复用内部路由但绕开 /api/* 的登录中间件，采用"假装已认证"方式：
// 在 req.user 注入一个系统级虚拟用户，再分发给各业务 router。
router.use((req, res, next) => {
  const acc = req.apiAccount;
  req.user = {
    id: 'api:' + (acc?.id || 'unknown'),
    username: 'openapi:' + (acc?.name || acc?.app_id || ''),
    role: 'admin', // 以高权限通过内部路由的权限判断；真实权限由 apiAuth 在中间件层按 catalog key 已做过滤
    credits: acc?.credits ?? 0,
    allowed_models: acc?.allowed_models || ['*'],
  };
  next();
});

// 挂载与 /api/* 同样的业务路由（只保留 catalog 里会用到的）
router.use('/drama',     require('./drama'));
router.use('/story',     require('./story'));
router.use('/i2v',       require('./i2v'));
router.use('/avatar',    require('./avatar'));
router.use('/comic',     require('./comic'));
router.use('/workbench', require('./workbench'));

module.exports = router;
