import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, posix } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { dependencies, checkBoundaries, workerImports, agentOnlyModules } from './check-boundaries.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const chatResources = ['background-chat.js', 'chat/delivery.js', 'chat/integrations.js', 'chat/options.css', 'chat/options.js', 'chat/panel.js'];
function safePath(file) {
  if (file.includes('\\') || file.startsWith('/') || file.includes(':') || file.split('/').includes('..')) throw new Error('Unsafe extension resource: ' + file);
  return file;
}
function htmlScripts(text) { return [...text.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(m => m[1]); }
function htmlResources(text) { return [...text.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)].map(m => m[1]); }
export function validateProfile(source, manifest, generated = {}) {
  const files = new Set(), read = file => generated[file] ?? readFileSync(join(source, safePath(file)), 'utf8');
  const add = file => {
    safePath(file);
    if (files.has(file)) return;
    if (!existsSync(join(source, file))) throw new Error('Missing resource: ' + file);
    files.add(file);
    if (file.endsWith('.js')) for (const dep of dependencies(file, read(file))) add(dep);
    if (file.endsWith('.html')) for (const resource of htmlResources(read(file))) add(posix.join(posix.dirname(file), resource));
  };
  const verifyOrder = (ordered, label) => {
    const loaded = new Set();
    for (const file of ordered) {
      add(file);
      for (const dep of dependencies(file, read(file))) if (!loaded.has(dep)) throw new Error(`${label}: ${file} requires ${dep} before it`);
      loaded.add(file);
    }
  };
  for (const [i, group] of manifest.content_scripts.entries()) verifyOrder(group.js, 'content_scripts[' + i + ']');
  // Classic workers execute each literal importScripts call synchronously, in listed order.
  const loaded = new Set();
  const visitWorker = file => {
    if (loaded.has(file)) return;
    add(file);
    const text = read(file);
    for (const imported of workerImports(text)) visitWorker(posix.join(posix.dirname(file), imported));
    for (const dep of dependencies(file, text)) if (!loaded.has(dep)) throw new Error(`${file}: worker dependency ${dep} must be imported first`);
    loaded.add(file);
  };
  if (manifest.background?.service_worker) visitWorker(manifest.background.service_worker);
  if (manifest.options_ui) {
    const page = manifest.options_ui.page; add(page);
    verifyOrder(htmlScripts(read(page)).map(p => posix.join(posix.dirname(page), p)), page);
  }
  for (const group of manifest.web_accessible_resources || []) for (const resource of group.resources) {
    safePath(resource);
    if (resource.includes('*')) {
      const directory = posix.dirname(resource), pattern = new RegExp('^' + posix.basename(resource).split('*').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
      const matches = readdirSync(join(source, directory)).filter(name => pattern.test(name));
      if (!matches.length) throw new Error('Empty resource pattern: ' + resource);
      for (const name of matches) add(posix.join(directory, name));
    } else add(resource);
  }
  return [...files].sort();
}
export function checkProfiles(source = join(root, 'extension')) {
  checkBoundaries(source);
  const profiles = ['agent', 'collector'].map(name => ({ name, manifest: json(join(source, 'profiles', name + '.json')) }));
  if (!isDeepStrictEqual(json(join(source, 'manifest.json')), profiles[0].manifest)) throw new Error('Default manifest differs from explicit agent profile');
  const chat = structuredClone(profiles[0].manifest);
  chat.name += ' (Chat)';
  chat.permissions.push('alarms');
  chat.background.service_worker = 'background-chat.js';
  const isolated = chat.content_scripts.find(group => group.js.includes('apps/agent-app.js'));
  isolated.js.splice(isolated.js.indexOf('apps/agent-app.js'), 0, 'chat/panel.js');
  const options = readFileSync(join(source, 'options.html'), 'utf8');
  const fragment = readFileSync(join(source, 'chat/options-fragment.html'), 'utf8');
  const slots = [
    ['</head>', '<link rel="stylesheet" href="chat/options.css"></head>'],
    ['</nav>', '<button type="button" id="navChannels">聊天分享</button></nav>'],
    ['</main>', '</main>' + fragment],
    ['</body>', '<script src="chat/options.js"></script></body>'],
  ];
  const chatOptions = slots.reduce((html, [slot, markup]) => {
    if (html.split(slot).length !== 2) throw new Error('Expected one chat options slot: ' + slot);
    return html.replace(slot, () => markup);
  }, options);
  profiles.push({ name: 'chat', manifest: chat, generated: { 'options.html': chatOptions } });
  const version = json(join(root, 'package.json')).version;
  for (const profile of profiles) {
    if (profile.manifest.version !== version) throw new Error('Profile version differs: ' + profile.name);
    profile.files = validateProfile(source, profile.manifest, profile.generated);
    const chatFiles = profile.files.filter(file => file.startsWith('chat/') || file === 'background-chat.js');
    if (profile.name !== 'chat' && (chatFiles.length || profile.manifest.permissions.includes('alarms'))) throw new Error('Chat resources escaped the optional profile');
    if (profile.name === 'chat' && !isDeepStrictEqual(chatFiles, chatResources)) throw new Error('Optional chat profile has unexpected resources');
    if (profile.manifest.content_scripts.some(group => group.js.some(file => /^chat\//.test(file) && (file !== 'chat/panel.js' || group.world !== 'ISOLATED'))) ||
      profile.manifest.web_accessible_resources?.some(group => group.resources.some(file => /^(?:chat\/|\*|background-chat)/.test(file)))) throw new Error('Chat resources exposed to the game page');
    if (profile.name === 'collector' && profile.files.some(file => agentOnlyModules.includes(file) || /^(?:analysis(?:-panel)?\.(?:js|css)|naga-panel\.(?:js|css)|hand-hints\.js|mahjong-analysis\.js|agent\.js|engine-agent\.js|harness\.js|adapters\/(?:model-endpoint|engine-endpoint|mjai|naga-replay)\.js|contracts\/engine-result\.js|options\.)/.test(file))) throw new Error('Collector dependency closure contains analysis/model files');
  }
  return profiles;
}
export function buildExtensions(destination = join(root, 'dist')) {
  const source = join(root, 'extension'), profiles = checkProfiles(source), outputs = [];
  mkdirSync(destination, { recursive: true });
  const project = json(join(root, 'package.json')).name;
  const names = { agent: project, collector: 'majsoul-collector', chat: 'majsoul-agent-chat' };
  for (const { name, manifest, files, generated = {} } of profiles) {
    const directory = join(destination, `${names[name]}-${manifest.version}`);
    if (existsSync(directory)) renameSync(directory, directory + '.previous-' + Date.now());
    mkdirSync(directory);
    for (const file of files) {
      const target = join(directory, file);
      mkdirSync(join(directory, posix.dirname(file)), { recursive: true });
      if (Object.hasOwn(generated, file)) writeFileSync(target, generated[file]);
      else cpSync(join(source, file), target);
    }
    writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) cpSync(join(root, name), join(directory, name));
    cpSync(join(root, 'licenses'), join(directory, 'licenses'), { recursive: true });
    validateProfile(directory, manifest);
    outputs.push(directory);
  }
  return outputs;
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { bundlePiRuntime } = await import('./bundle-pi-runtime.mjs');
  await bundlePiRuntime();
  for (const path of buildExtensions(process.argv[2])) console.log(path);
}
