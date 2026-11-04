# Majsoul Agent

**Understand each trade-off. Keep asking about the same decision.**

Current version: **0.14.0**

[简体中文](README.md) | **English** | [日本語](README.ja.md)

An AI analysis assistant for the Mahjong Soul web client. Connect your own LLM API, review a recommendation and its alternatives, then ask “Why not discard another tile?” or “Should I slow down here?” Each decision keeps its frozen position and separate discussion, so you can return to it after new advice arrives.

[**Download v0.14.0**](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/tag/v0.14.0) · [Quick start](#quick-start) · [Local model manager](docs/MODEL_MANAGER.md)

![Floating analysis card with a synthetic position and simulated model response](docs/images/agent-floating-preview.png)

## Learn from a specific position

| What you want to do | What the assistant provides |
| --- | --- |
| Understand the current choice | A recommendation, alternatives and explanations grounded in local shanten, tile-efficiency and per-opponent danger evidence |
| Ask follow-up questions | The hand, table and original advice stay frozen in a separate discussion that can survive a page refresh |
| Revisit an earlier turn | Open a recorded decision and continue its discussion without mixing in the new live position |
| Let an engine choose first | An optional local engine supplies a validated action; an LLM explains it, with independent explanation retries |
| Record without model calls | A standalone Collector for observation, display, settlement history and export |

**The normal LLM workflow runs independently: no Mortal download, Python or native toolkit is required.** The browser extension collects game data directly, without configuring CDP, remote debugging or a system proxy. Model calls and automatic analysis are off by default; local calculations work without an API. The project does not play automatically.

## Quick start

1. Download and extract the [full Agent](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/download/v0.14.0/majsoul-ai-analysis-and-review-agent-0.14.0.zip). Enable Developer mode at `edge://extensions` or `chrome://extensions`, then load the extracted folder containing `manifest.json`.
2. Refresh `https://game.maj-soul.com/` so the extension loads before the game connection, then enter a game. Open the analysis card’s settings and model configuration.
3. Enter an **OpenAI Chat Completions compatible endpoint with tools support**, a model ID and your API key. Enable model analysis, save and grant the endpoint permission. Example: `https://api.openai.com/v1/chat/completions`.
4. Confirm your seat and data authorization in the game panel, enable model calls, and analyze the current position manually. Enable automatic analysis separately if needed. Send a follow-up question to retain that decision’s discussion.

Use a cloud API, compatible gateway or local Chat Completions service of your choice. Magpie and CC Switch are optional integrations. See [model configuration](docs/MODEL_CONFIGURATION.md) for settings, thinking parameters, costs and connection diagnostics. Calls may incur charges, and inputs are sent to your configured service.

Only `game.maj-soul.com` is currently supported, and the extension UI is Simplified Chinese. Other regional domains, Firefox, Safari and the Steam desktop client are not adapted. Translated READMEs do not imply support for other game regions. Enable either Agent or Collector on the same game page, not both.

## Downloads

| Package | Use it for |
| --- | --- |
| [Full Agent · v0.14.0](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/download/v0.14.0/majsoul-ai-analysis-and-review-agent-0.14.0.zip) | Analysis, follow-up questions, hand hints and model settings; includes collection |
| [Standalone Collector · v0.14.0](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/download/v0.14.0/majsoul-collector-0.14.0.zip) | Observation, display, history and export only; no model code or model-host permissions |
| [Local model manager · Windows x64 · v0.14.0](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/download/v0.14.0/majsoul-model-manager-windows-x64-0.14.0.zip) | Optional local mahjong engines; unnecessary for the normal LLM workflow |
| [Source · v0.14.0](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/download/v0.14.0/majsoul-ai-analysis-and-review-agent-source-0.14.0.zip) | Development, checks, builds and offline review |

[Release page and SHA-256 checksums](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/tag/v0.14.0). Neither extension package includes weights, Python or native model libraries. Collector and Agent use separate local storage with no automatic migration.

## v0.14.0: install local models when you need them

The optional local engines now have a separate management page: install on demand, explicitly start or stop, keep installed models for switching, and delete unwanted weights. **Zero installed models is a valid setup. Installation does not start inference; only one model runs at a time.** An installed model can be switched to and started in one action.

| Model | Scope in this release |
| --- | --- |
| Akagi v2 weak Mortal example | Existing starter and regression path |
| [VoidShine/mortal-298k](https://huggingface.co/VoidShine/mortal-298k) | Experimental community Mortal v4 for four-player hanchan; its author advises against ranked play |
| [Yuchen1457/mortal-582500](https://huggingface.co/Yuchen1457/mortal-582500) | Experimental community Mortal v4, conservatively limited to four-player hanchan |

For local engines, download the separate manager toolkit, install Node.js 22.19+, run its `start.cmd`, and open the local address shown in the terminal. Enter the management token, install your chosen model and explicitly start it. Copy the resulting analysis endpoint and **analysis token** into the matching extension profile. Management and analysis tokens serve different purposes. [Complete steps](docs/MODEL_MANAGER.md)

The default toolkit contains neither weights nor a full Python environment. Only clicking Install prepares the selected weights and required runtime. VoidShine does not require Akagi; the two v4 models share a validated CPU runtime. Switching extension profiles disables analysis while retaining installed assets. The extension cannot launch native programs directly and does not configure automatic startup.

Use a local engine alone or choose “local Mortal decision + automatic LLM explanation.” The validated action appears first; the LLM adds explanations without changing it, and follow-up questions use the frozen position without rerunning the engine. Both v4 models currently require **manual confirmation of four-player hanchan for every analysis**; automatic analysis is not supported for them. [Engine and explanation setup](docs/MJAI.md) · [v4 runtime guide](docs/MORTAL_V4.md)

## Data and validation limits

Authorized inputs include your hand, public table information and collected round history. Opponents’ hidden hands, account credentials and future events are not sent to the analysis service. API keys, discussions and usage records remain in extension storage. Discussions have a storage limit, with no cloud sync or permanent-retention guarantee. Disabling model calls leaves only local calculations. See [security and permissions](SECURITY.md) and [sessions and usage](docs/AGENT_SESSIONS.md).

Complete live-protocol coverage, reconnection recovery and real-game advice quality remain unverified. Community v4 validation covers fixed-weight strict loading, synthetic four-seat positions, synthetic HTTP→Agent requests and key-action comparisons. This is not proof of full-game compatibility or playing strength, and the Mortal v4 architecture is not official Mortal 4.1. [Validation overview](VALIDATION.md) · [v4 evidence](docs/MORTAL_V4_VALIDATION.md)

The historical 45-decision LLM fact-quality review and 39-decision cost / MAKA comparison remain in [fact-enhancement validation](docs/XF_VALIDATION.md) and [model experiments](docs/MODEL_BENCHMARK.md). Their earlier conditions do not establish quality, latency or cost promises for v0.14.0 or the new community models. Agreement with a reference choice is not accuracy or win rate.

## Development and documentation

Development requires Node.js 22.19+. Loading an extension ZIP does not.

```sh
npm ci
npm run check
npm test
npm run build
```

Agent uses the Pi Agent runtime adapted for Manifest V3; Collector remains independent. A standard data contract connects collection to analysis. See the documentation for implementation details, offline review, optional memory learning and the NAGA export workflow.

[Documentation](docs/README.md) · [Architecture](ARCHITECTURE.md) · [Module separation](docs/DECOUPLING.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [References](docs/REFERENCES.md)

Supplementary documentation is currently in Simplified Chinese. Project code and 37 original SVG tile faces are [MIT licensed](LICENSE). Optional models, native components and upstream code retain their own licenses; the project’s MIT license does not replace them. [Third-party notices](THIRD_PARTY_NOTICES.md) · [License sources](licenses/SOURCES.md)
