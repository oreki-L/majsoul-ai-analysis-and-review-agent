'use strict';
// Fixed drivers only. Unknown profiles never fall through to another engine.
const drivers = Object.freeze({
  'akagi-v2': { runtimeKind: 'python', runnerKind: 'akagi-v2', defaultPort: 17341, weightAsset: 'mortal.pth', sourceUrl: 'https://github.com/shinkuan/Akagi' },
  'voidshine-298k': { runtimeKind: 'python', runnerKind: 'mortal-v4', defaultPort: 17342, weightAsset: 'mortal_298k.pth', sourceUrl: 'https://huggingface.co/VoidShine/mortal-298k' },
  'yuchen-582500': { runtimeKind: 'python', runnerKind: 'mortal-v4', defaultPort: 17344, weightAsset: 'mortal_582500.pth', sourceUrl: 'https://huggingface.co/Yuchen1457/mortal-582500' },
  'akagi-v3-native': { runtimeKind: 'native', runnerKind: 'akagi-native', defaultPort: 17345, weightAsset: 'akagi4p.safetensors', sourceUrl: 'https://github.com/shinkuan/Akagi' }
});
for (const driver of Object.values(drivers)) Object.freeze(driver);
function driverFor(id) {
  if (!Object.hasOwn(drivers, id)) throw Object.assign(new Error('UNKNOWN_PROFILE'), { code: 'UNKNOWN_PROFILE' });
  return drivers[id];
}
function sourceFor(id) {
  const driver = driverFor(id);
  if (driver.runnerKind === 'akagi-native') return require('./akagi-native-source.json');
  if (driver.runnerKind === 'akagi-v2') {
    const source = require('./akagi-source.json');
    return { ...source, files: source.files.map(file => ({ ...file, url: `https://raw.githubusercontent.com/shinkuan/Akagi/${source.commit}/${file.path}` })) };
  }
  if (driver.runnerKind === 'mortal-v4') {
    const source = require('./mortal-profile.cjs').sourceForProfile(id);
    return { ...source, files: source.files.map(file => ({ ...file, url: file.url || `https://raw.githubusercontent.com/Equim-chan/Mortal/${source.sourceCommit}/${file.upstream}` })) };
  }
  throw Object.assign(new Error('UNSUPPORTED_ENGINE_DRIVER'), { code: 'UNSUPPORTED_ENGINE_DRIVER' });
}
module.exports = { driverFor, sourceFor };
