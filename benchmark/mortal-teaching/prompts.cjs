'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { stableHash } = require('../core.cjs');
const directory = path.resolve(__dirname, '../prompts/mortal-teaching-20261105');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function loadPrompts() {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json')));
  const variants = manifest.variants.map(entry => {
    if (path.basename(entry.file) !== entry.file) throw new Error('Invalid prompt filename');
    const bytes = fs.readFileSync(path.join(directory, entry.file));
    if (sha256(bytes) !== entry.sha256 || bytes.length !== entry.utf8Bytes) throw new Error('Frozen prompt hash mismatch');
    return { ...entry, text: bytes.toString('utf8') };
  });
  if (variants[0].text !== require('../../extension/contracts/engine-explanation.js').prompt) throw new Error('P0 differs from released prompt');
  return { manifest, variants, manifestHash: stableHash(manifest) };
}
module.exports = { loadPrompts, sha256 };
