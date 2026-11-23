'use strict';
const { run } = require('../current-teaching-v17/regression.cjs');

run(process.argv.slice(2), { prompt: 18, facts: 13 });
