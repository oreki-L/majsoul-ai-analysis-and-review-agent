'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { stableHash } = require('../core.cjs');
const directory = path.resolve(__dirname, '../prompts/mortal-teaching-20261105');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function loadPrompts(promptDirectory = directory) {
  const directory = promptDirectory;
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json')));
  const variants = manifest.variants.map(entry => {
    if (path.basename(entry.file) !== entry.file) throw new Error('Invalid prompt filename');
    const bytes = fs.readFileSync(path.join(directory, entry.file));
    if (sha256(bytes) !== entry.sha256 || bytes.length !== entry.utf8Bytes) throw new Error('Frozen prompt hash mismatch');
    return { ...entry, text: bytes.toString('utf8') };
  });
  // Historical baselines stay pinned to their manifest after the product prompt evolves.
  if (!variants.length || variants[0].sha256 !== manifest.baselineSource?.sha256) throw new Error('P0 differs from frozen release baseline');
  return { manifest, variants, manifestHash: stableHash(manifest) };
}
module.exports = { loadPrompts, sha256 };
