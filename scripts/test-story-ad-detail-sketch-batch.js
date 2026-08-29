#!/usr/bin/env node
'use strict';

// 旧 V279 夹具已迁移：它不再要求恢复“剧情流向生图”。
// 当前测试的唯一职责是执行 V280 新合同回归，并证明旧付费入口被永久禁用。
require('./test-story-ad-zero-cost-flow-contract-v280');
