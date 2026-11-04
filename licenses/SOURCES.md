# Bundled dependency license sources

Reviewed on 2026-10-24. The complete license files in this directory accompany the distributed extension archives.

Optional native model toolkits are separate from the extension archives. Their pinned Mortal/model/Python/wheel sources and hashes are in [agent/mortal-source.json](../agent/mortal-source.json) and [agent/mortal-runtime-lock.json](../agent/mortal-runtime-lock.json); see [MORTAL_V4.md](../docs/MORTAL_V4.md) for corresponding source, crate vendor, build and notice packaging. Upstream AGPL/model/runtime licenses are retained under their own terms and are not re-licensed as project MIT.

## Optional portable Node.js runtime

- Distributed only in the optional Windows x64 local-model package, not in either extension ZIP.
- Fixed official archive: [Node.js v22.19.0 Windows x64](https://nodejs.org/dist/v22.19.0/node-v22.19.0-win-x64.zip), SHA-256 `ea3fad0e67a991d8477d8c01344b56e69c676ccb733f065b22436994b1253f86`, checked against the official [SHASUMS256.txt](https://nodejs.org/dist/v22.19.0/SHASUMS256.txt).
- The package retains `runtime/node.exe`, the complete upstream `runtime/LICENSE` (including dependency notices), and official `runtime/SHASUMS256.txt`. The LICENSE file SHA-256 is `339c50294da6a84322dcbe7285b57b248123bd4d9e37a2f72d68d5abf2574783`.
- Versions, URLs and file hashes are fixed in [scripts/node-runtime-lock.json](../scripts/node-runtime-lock.json). The maintainer explicitly runs `prepare-node-runtime.cjs`; normal extension builds, tests and installation do not download this runtime.

## Pi 1.4.0

- Packages: `@earendil-works/pi-agent-core@1.4.0`, `@earendil-works/pi-ai@1.4.0`.
- npm repository: `https://github.com/earendil-works/pi`, directories `packages/agent` and `packages/ai`.
- Fixed release tag: [`v1.4.0`](https://github.com/earendil-works/pi/releases/tag/v1.4.0).
- Release commit: [`4a080252f06caf63a525d7873c5d94d3c23887e0`](https://github.com/earendil-works/pi/commit/4a080252f06caf63a525d7873c5d94d3c23887e0), linked by that release. Both package manifests at this commit declare version `1.4.0` and license `MIT`. npm metadata does not expose `gitHead`; no npm-to-commit attestation is claimed.
- The npm packages omit a separate LICENSE file, so `pi-LICENSE.txt` is copied verbatim from [the repository root LICENSE at the fixed commit](https://raw.githubusercontent.com/earendil-works/pi/4a080252f06caf63a525d7873c5d94d3c23887e0/LICENSE).
- Copyright: `Copyright (c) 2025 Mario Zechner`.
- SHA-256 of `pi-LICENSE.txt`: `0457f5bcec3b3b211605dfb5d1a49042fd638f3686a410fe099c24a25af13c48`.

## TypeBox 1.3.27

- Package: `typebox@1.3.27`, installed and integrity-locked by `package-lock.json`.
- Source: <https://github.com/sinclairzx81/typebox>.
- `typebox-LICENSE.txt` is copied verbatim from the npm package's `license` file (`node_modules/typebox/license`).
- Copyright: `Copyright (c) 2017-2026 Haydn Paterson`.
- SHA-256 of `typebox-LICENSE.txt`: `e8a7cc256941a26ba8234f04390165243a4d42f74fd6491934140605bf7eae2d`.

`bundlePiRuntime()` audits `metafile.outputs[*].inputs[*].bytesInOutput`: only the two Pi packages and TypeBox contribute third-party code. Parsed but eliminated modules, such as `partial-json`, are not distributed in `pi-runtime.js`. Any additional contributing package causes the build to fail pending a license review.
