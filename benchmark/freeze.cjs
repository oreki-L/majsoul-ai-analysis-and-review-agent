'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { builtinModules } = require('node:module');
const { stableHash, compileSuite, validateSuite } = require('./core.cjs');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function dependencyGraph(entries) {
  const files = new Map();
  function visit(filename) {
    filename = fs.realpathSync(filename);
    if (files.has(filename)) return;
    const bytes = fs.readFileSync(filename), dependencies = [];
    files.set(filename, { bytes, dependencies });
    if (!/\.(?:c?js|mjs)$/.test(filename)) return;
    const source = bytes.toString('utf8');
    for (const match of source.matchAll(/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g)) {
      if (builtinModules.includes(match[2]) || match[2].startsWith('node:')) continue;
      const resolved = require.resolve(match[2], { paths: [path.dirname(filename)] }); dependencies.push({ specifier: match[2], target: resolved }); visit(resolved);
    }
    // The one runtime import is explicitly enumerated from frozen suite.context.module.
    const dynamic = source.replace(/\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g, '');
    if (/\brequire\s*\(/.test(dynamic) && !['context.cjs', 'autonomous.cjs'].some(f => filename === fs.realpathSync(path.join(__dirname, f)))) throw new Error('Dynamic dependencies require an explicit static adapter: ' + path.basename(filename));
    if (/\bimport\s*\(/.test(source)) throw new Error('Dynamic import is not freezeable');
  }
  entries.forEach(visit); return files;
}
function freezeRun(suiteFile, output, policy = {}, execution = {}) {
  const root = path.resolve(output), bundle = path.join(root, 'bundle');
  if (fs.existsSync(bundle) || fs.existsSync(path.join(root, 'checkpoint.json'))) throw new Error('Run already exists; use autonomous-resume');
  fs.mkdirSync(path.dirname(root), { recursive: true });
  const suite = compileSuite(suiteFile), raw = JSON.parse(fs.readFileSync(suiteFile, 'utf8'));
  validateSuite(raw); require('./runtime.cjs').validateModelProofs(suite.models, policy);
  const capacity = fs.statfsSync(path.dirname(root)); if (Number(capacity.bavail) * Number(capacity.bsize) < 16 * 1024 * 1024) throw new Error('Insufficient free disk space to freeze durable run');
  const entries = fs.readdirSync(__dirname).filter(f => f.endsWith('.cjs')).map(f => path.join(__dirname, f));
  const plugins = suite.schemes.filter(s => s.context.module).map(s => path.resolve(suite.baseDir, s.context.module));
  const graph = dependencyGraph([...entries, ...plugins]);
  const workspace = path.dirname(__dirname), destinations = new Map();
  // Preserve project-relative paths. External graphs get one independent module per hash;
  // literal requires are rewritten, so dependencies never resolve into the active workspace.
  for (const filename of graph.keys()) destinations.set(filename, filename.startsWith(workspace + path.sep) ? path.relative(workspace, filename) : path.join('external', digest(Buffer.from(filename)), path.basename(filename)));
  fs.mkdirSync(bundle, { recursive: true });
  const manifest = { schemaVersion: 1, createdAt: new Date().toISOString(), runtime: { nodeMajor: Number(process.versions.node.split('.')[0]) }, policy, files: {}, suite: 'suite.json', entry: 'benchmark/autonomous.cjs' };
  function write(relative, bytes) { const target = path.join(bundle, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o400 }); manifest.files[relative.replaceAll('\\', '/')] = digest(bytes); }
  for (const [filename, item] of graph) {
    let bytes = item.bytes;
    if (item.dependencies.length) { let source = bytes.toString('utf8'); for (const dependency of item.dependencies) {
      let relative = path.relative(path.dirname(destinations.get(filename)), destinations.get(fs.realpathSync(dependency.target))).replaceAll('\\', '/'); if (!relative.startsWith('.')) relative = './' + relative;
      source = source.replace(new RegExp(`(\\brequire\\s*\\(\\s*['"])${dependency.specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(['"]\\s*\\))`, 'g'), (_, a, b) => a + relative + b);
    } bytes = Buffer.from(source); }
    write(destinations.get(filename), bytes);
  }
  if (suite.labelsPath && fs.existsSync(suite.labelsPath)) { const labels = fs.readFileSync(suite.labelsPath); require('./scoring.cjs').validateLabels(JSON.parse(labels)); fs.mkdirSync(path.join(root, 'evaluation'), { recursive: true }); fs.writeFileSync(path.join(root, 'evaluation', 'labels.json'), labels, { flag: 'wx', mode: 0o400 }); manifest.evaluation = { path: 'evaluation/labels.json', hash: digest(labels) }; }
  const rules = execution.reviewRules ?? require('./review.cjs').RULES; require('./review.cjs').validateReviewRules(rules);
  const rulesBytes = Buffer.from(JSON.stringify(rules)); fs.mkdirSync(path.join(root, 'evaluation'), { recursive: true }); fs.writeFileSync(path.join(root, 'evaluation', 'review-rules.json'), rulesBytes, { flag: 'wx', mode: 0o400 }); manifest.reviewRules = { path: 'evaluation/review-rules.json', hash: digest(rulesBytes) };
  delete raw.labels; raw.dataset = 'dataset.json';
  for (const scheme of raw.schemes) if (scheme.context?.module) scheme.context.module = './' + destinations.get(fs.realpathSync(path.resolve(suite.baseDir, scheme.context.module))).replaceAll('\\', '/');
  const dataset = structuredClone(suite.dataset); for (const round of dataset.rounds) delete round.sessionId;
  write('dataset.json', Buffer.from(JSON.stringify(dataset)));
  write('suite.json', Buffer.from(JSON.stringify(raw)));
  write('execution.json', Buffer.from(JSON.stringify(execution)));
  const contract = { ...manifest, hash: stableHash(manifest) }; fs.writeFileSync(path.join(root, 'run.contract.json'), JSON.stringify(contract, null, 2) + '\n', { flag: 'wx', mode: 0o400 });
  verifyRun(root); return contract;
}
function verifyRun(root) {
  const contract = JSON.parse(fs.readFileSync(path.join(root, 'run.contract.json'), 'utf8')), { hash, ...body } = contract;
  if (stableHash(body) !== hash || contract.runtime.nodeMajor !== Number(process.versions.node.split('.')[0])) throw new Error('Run contract/runtime mismatch');
  for (const [file, expected] of Object.entries(contract.files)) {
    const target = path.resolve(root, 'bundle', file);
    if (!target.startsWith(path.resolve(root, 'bundle') + path.sep) || digest(fs.readFileSync(target)) !== expected) throw new Error('Frozen file mismatch: ' + file);
  }
  if (contract.reviewRules && digest(fs.readFileSync(path.join(root, contract.reviewRules.path))) !== contract.reviewRules.hash) throw new Error('Frozen review rules mismatch');
  if (contract.evaluation && digest(fs.readFileSync(path.join(root, contract.evaluation.path))) !== contract.evaluation.hash) throw new Error('Frozen independent evaluation labels mismatch');
  return contract;
}
module.exports = { dependencyGraph, freezeRun, verifyRun };
