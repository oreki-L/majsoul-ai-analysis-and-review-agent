'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { read } = require('../mortal-teaching/runner.cjs');
const { sha256 } = require('../mortal-teaching/prompts.cjs');
const { stableHash } = require('../core.cjs');
const { openBudget } = require('../mortal-teaching/budget.cjs');

function terms(output, cap, pricing) {
  const cents = Math.round(cap * 100);
  assert.ok(Number.isSafeInteger(cents) && cents > 0 && cents / 100 === cap, 'Specify a positive CNY budget in yuan, with at most two decimals');
  const full = (pricing.inputBound * Math.max(pricing.rates.cachedInput, pricing.rates.uncachedInput) + pricing.maxOutputTokens * pricing.rates.output) / 1e6;
  assert.ok(pricing.currency === 'CNY' && full > 0 && Math.abs(full - pricing.fullContextReservationCny) <= 1e-12);
  return { scope: 'independent-round', currency: 'CNY', cap, fullContextReservationCny: full, directory: path.resolve(output, 'budget') };
}

function bindings(source, manifest) {
  const filename = path.join(source, 'authorization.local.json'), historical = read(filename);
  assert.equal(sha256(fs.readFileSync(filename)), read(path.join(source, 'contract.json')).files['authorization.local.json']);
  assert.ok(historical.approved === true && Array.isArray(historical.allowedReferences) && historical.allowedReferences.length > 0);
  const { cap, currency, directory } = manifest.budget;
  assert.notEqual(path.resolve(historical.budgetDirectory), directory);
  return { directory, expectedCap: cap, pricing: read(path.join(source, 'pricing.json')),
    authorization: { manifestId: stableHash(manifest), approved: true, cap, currency, budgetDirectory: directory,
      scope: 'independent-round', credentialsFile: historical.credentialsFile, allowedReferences: historical.allowedReferences,
      ...(historical.excludedGroups ? { excludedGroups: historical.excludedGroups } : {}) } };
}

function initialize(options) {
  const ledger = openBudget(options);
  try { return ledger.snapshot(); } finally { ledger.close(); }
}

module.exports = { terms, bindings, initialize };
