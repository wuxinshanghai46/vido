#!/usr/bin/env node
'use strict';

const audit = require('../src/services/newStoryAd/taskStateAuditService');

function main() {
  const report = audit.auditCurrent();
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) main();

module.exports = { main };
