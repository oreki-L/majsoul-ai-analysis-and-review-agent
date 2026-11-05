# Majsoul Agent

**Turn mahjong advice into a conversation you can learn from.**

Current release: **0.16.2**

[简体中文](README.md) | **English** | [日本語](README.ja.md)

An AI analysis assistant for the Mahjong Soul web client. Use your own LLM to analyze a position, or let a local Mortal or Akagi engine choose an action and an LLM explain it. Ask “Why this discard?” or “What would another choice lose?” Each decision keeps its own position and discussion.

[**Download**](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/tag/v0.16.2) · [Standard use](#standard-use) · [Using local models](#using-local-models) · [Documentation](docs/README.md)

![Floating analysis card with a synthetic position and simulated model response](docs/images/agent-floating-preview.png)

## Understand the choice behind the answer

**The local engine chooses, the LLM explains, and you can keep asking.** The engine action appears after local legality and known-model identity checks. The LLM then explains it using the frozen position and local calculations; it cannot change the engine's first choice or the discard paired with riichi. If explanation fails, the validated action remains, and you can retry just the explanation.

A discussion retains the original hand, table, recommendation and previous exchanges. Return to an earlier decision while live play continues, without mixing in later tiles. Follow-up questions and explanation retries do not rerun the engine. Saved decisions retain their model source when you switch models.

| Feature | What it provides |
| --- | --- |
| Local facts | Shanten, tile efficiency and per-opponent danger evidence, available through LLM read-only tools |
| Live analysis and decision review | Analyze the current position or revisit recorded decisions; discussions can survive refreshes, within local storage limits |
| Separate usage records | Engine calls / time and LLM tokens / cost, with export; unavailable costs remain unknown |
| Models on demand | Use an LLM alone, an engine alone, or both. Download, keep or delete individual weights |
| Direct browser collection | No CDP, remote-debugging or system-proxy setup; a separate Collector is available for recording only |

**Model calls, local inference and automatic analysis are off by default. There is no automatic play.** You can use the project without downloading any Mortal weights; local calculations also work without an API.

## Downloads

| Package | Purpose |
| --- | --- |
| [Full Agent · v0.16.2](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/download/v0.16.2/majsoul-ai-analysis-and-review-agent-0.16.2.zip) | Start here for either workflow: collection, analysis, follow-up questions and settings |
| [Standalone Collector · v0.16.2](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/download/v0.16.2/majsoul-collector-0.16.2.zip) | Collection, display, settlement history and export; no model code or model-host permissions |
| [Optional local model runtime · Windows x64 · v0.16.2](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/download/v0.16.2/majsoul-model-manager-windows-x64-0.16.2.zip) | Bundled Node; extract and double-click to start. Model weights and dependencies install on demand. Not needed for standard use |
| [Source · v0.16.2](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/download/v0.16.2/majsoul-ai-analysis-and-review-agent-source-0.16.2.zip) | Development, builds and offline review |

[Release page and SHA-256 checksums](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/tag/v0.16.2). Extension packages contain no weights, Python or native model libraries. Agent and Collector use separate storage with no automatic migration; enable only one on the same game page.

## Quick start

### Standard use

For LLM analysis and follow-up questions. **You need only the full Agent and your model API; no Node.js, Python or local model toolkit.** The UI labels below are Simplified Chinese.

1. Extract the full Agent. Enable Developer mode at Chrome's `chrome://extensions` or Edge's `edge://extensions`, choose Load unpacked, and select the folder directly containing `manifest.json`.
2. Refresh `https://game.maj-soul.com/` so the extension loads before the game connection, then enter a game.
3. Open “分析设置 → 模型管理”. Enter a Chat Completions endpoint with tools support, a model ID and your API key. Example endpoint: `https://api.openai.com/v1/chat/completions`.
4. Check “开启模型分析”, save and grant endpoint permission.
5. Back in the game, confirm your seat, authorize game information, discards and your hand, enable “调用模型”, and analyze the current position. Enable automatic analysis separately if you want ongoing hints.
6. Ask a follow-up question on the recommendation, or reopen a recorded decision to continue its discussion.

Cloud APIs, compatible gateways and local Chat Completions services are configurable, with multiple saved LLM profiles. Magpie and experimental CC Switch are optional integrations. See [model configuration](docs/MODEL_CONFIGURATION.md). Calls send authorized position data to your configured service and may incur charges.

### Using local models

For local Mortal or Akagi actions, optionally with LLM explanations. **Install the extension independently. When you want local models, download the optional Windows x64 portable package, extract it and double-click to start. No separate Node.js, Python or Rust installation is needed.**

1. Follow standard-use steps 1–2 to load the Agent and refresh the game. For **Mortal + LLM**, first save an OpenAI-compatible explanation service using steps 3–4; skip this for engine-only use.
2. Fully extract the portable package into a writable folder and double-click `start.cmd`. It uses its bundled runtime to verify files and opens the manager automatically. Keep the runtime window open.
3. Select the model you want, click “安装”, then “启动分析” when ready. Only the chosen weights and required model dependencies are downloaded. Installation itself does not start inference.
4. In extension settings, open “本地麻将模型”, choose the matching model and click “连接所选模型”. Grant local-endpoint permission, then approve the connection in the manager. The extension fills the model's analysis configuration automatically, **without copying tokens**.
5. For **Mortal + LLM**, check “本地引擎决策 + LLM 自动解释”; leave it unchecked for engine-only actions. Connecting leaves analysis off: explicitly check “开启模型分析” and save. The LLM and engine configurations are saved separately.
6. In the game, confirm your seat and authorize game information, all four discard rivers and your hand. Enable “调用模型”, select “综合攻守”, and analyze. Both community v4 models and Akagi v3 are supported here only in **four-player hanchan**; use them in games matching that scope.

Starting with v0.15.0, repeated hanchan confirmation is removed; the supported scope is stated in settings. Automatic analysis remains opt-in and limited to your own discard decisions. When upgrading from v0.14.0, update both the extension and local runtime package; installations inside an old package are not migrated automatically.

Node is bundled; model dependencies such as Python / PyTorch are prepared automatically on demand. First installation still needs network access, and failures are reported. Keep zero models or several downloaded models; **only one runs at a time**. Assets default to `%LOCALAPPDATA%\MajsoulAgent\models`, so later extractions can reuse them; old package-local installations are not moved automatically. VoidShine does not require Akagi, and the two v4 models share a validated CPU runtime. Akagi v3 uses a separate lightweight native runtime without Python / PyTorch. After switching models, reconnect the matching profile and explicitly enable analysis.

When finished, click “停止分析服务” or close the runtime window. Disabling extension calls stops requests but leaves the local service running. Engine inference is local; LLM explanations and follow-up questions still send authorized position data to your configured LLM. Advanced configuration still accepts a manually entered endpoint and analysis token for your own mjai service.

[Manager instructions and troubleshooting](docs/MODEL_MANAGER.md) · [Engine and LLM setup](docs/MJAI.md) · [Community v4 runtime](docs/MORTAL_V4.md)

## Optional local models

| Model | Current scope |
| --- | --- |
| Old weak Mortal example bundled with Akagi v2 | Existing starter and regression path |
| [VoidShine/mortal-298k](https://huggingface.co/VoidShine/mortal-298k) | Community Mortal v4, four-player hanchan; its author advises against ranked play |
| [Yuchen1457/mortal-582500](https://huggingface.co/Yuchen1457/mortal-582500) | Community Mortal v4, supported here for four-player hanchan |
| Akagi v3 native model | Experimental opt-in, four-player hanchan; ~2.64 MB weights and a separate CPU runtime, without Python |

The first three entries are not official Mortal 4.1. Akagi v3 is a separate behavior-cloning model using native Rust inference; its version number does not establish stronger play. See [v3 validation](docs/AKAGI_V3_VALIDATION.md) for the tested scope and rule adaptations.

## Support and data

Currently adapted for `game.maj-soul.com`, with a Simplified Chinese extension UI. Other regional domains, Firefox, Safari and the Steam desktop client are not adapted; translated READMEs do not imply support for other game regions.

Model inputs are limited to your authorized hand, public table and collected history, excluding opponents' hidden hands, account credentials and future events. API keys, discussions and usage records stay in extension storage. Discussions have capacity limits, with no cloud sync or permanent-retention guarantee. The project has no relay server or telemetry uploads. [Security and permissions](SECURITY.md) · [Sessions and usage](docs/AGENT_SESSIONS.md)

Both community v4 models have passed real fixed-weight loading, synthetic four-seat positions, synthetic HTTP→Agent requests and key-action comparisons. Official Python and pinned dependency downloads were verified locally, but the Hugging Face weight download did not complete; full offline model installation was verified. Full live games, reconnection recovery, playing strength and paid LLM teaching quality remain unverified. LLM explanations interpret positions and results; they do not expose the engine's internal reasoning. [Validation overview](VALIDATION.md) · [v4 evidence](docs/MORTAL_V4_VALIDATION.md)

Historical LLM fact-quality and cost experiments are in [fact-enhancement validation](docs/XF_VALIDATION.md) and [model experiments](docs/MODEL_BENCHMARK.md); they do not establish playing strength or gains for the new community models.

## Development and documentation

Development requires Node.js 22.19+. Loading the standard extension ZIP does not.

```sh
npm ci
npm run check
npm test
npm run build
```

Agent uses the Pi Agent runtime adapted for Manifest V3, with read-only tools accessing frozen authorized positions. Standard data contracts separate collection from analysis, and Collector stays independent.

[Documentation](docs/README.md) · [Architecture](ARCHITECTURE.md) · [Module separation](docs/DECOUPLING.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [References](docs/REFERENCES.md)

Supplementary documentation is in Simplified Chinese. Project code and 37 original SVG tile faces are [MIT licensed](LICENSE). Optional models, native components and upstream code retain their own licenses. [Third-party notices](THIRD_PARTY_NOTICES.md) · [License sources](licenses/SOURCES.md)
