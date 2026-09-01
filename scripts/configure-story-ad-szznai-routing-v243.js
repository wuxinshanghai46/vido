#!/usr/bin/env node
'use strict';

// Compatibility shell: v243 enabled SZ for text, vision and image. The current
// contract only permits the explicitly requested Seedance 2.0 video route.
const migration = require('./configure-story-ad-szznai-seedance-v368');

if (require.main === module) migration.main();

module.exports = migration;
