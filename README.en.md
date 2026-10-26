# Majsoul AI Analysis & Review Agent

**Live advice · Follow-up questions · Bring your own model API**

[简体中文](README.md) | **English** | [日本語](README.ja.md)

A live analysis assistant for the Mahjong Soul web client, centered on a pure LLM runtime using your own model API. Get advice at the current decision point, then ask “Why not discard another tile?” or “Should I push or defend now?” Replay review and match records are supporting features.

**Choose your own model and API.** Set the endpoint, model ID, and API key for an **OpenAI Chat Completions-compatible API with tools support**: a cloud model, third-party gateway, or local service. Requests go directly to your configured service. [LLM setup](#llm-setup)

**You can try DeepSeek-V4.1-Flash first:** in a small real-API experiment across 39 decision points, strategy B had a median summed HTTP time of **5.6 s per analysis**, at an estimated **CNY 0.024 per analysis** using peak cache-aware rates. MAKA first-choice agreement was **16/39 (41%)**. This non-thinking context experiment does not measure playing strength; costs are estimates, not account bills. [Setup and test conditions](docs/MODEL_BENCHMARK.md)

The pure LLM path needs no specialist decision engine such as Mortal. Local shanten, tile-efficiency calculations, and danger evidence support validation and explanation. Specialist engines are optional backends, disabled by default. No claim is made that pure LLM playing strength matches MAKA, Mortal, or other specialist engines.

- **Full Agent:** live analysis, follow-up questions, hand hints, model settings, and traces, including collection and review features.
- **Standalone collector:** collection, display, history, and export only; no model code or model host permissions.
- **Opt in:** model calls and automatic analysis start disabled. Local calculations work without an API. Built with Manifest V3, a bundled MV3-adapted Pi Agent, and no telemetry.

| Status | Scope |
| --- | --- |
| Verified | Synthetic positions, simulated model responses, offline UI behavior, and local regressions, plus the small DeepSeek real-API experiment above; see [VALIDATION.md](VALIDATION.md) and [benchmark notes](docs/MODEL_BENCHMARK.md) |
| Experimental / unverified | Full live protocol coverage for the current Unity client, reconnection recovery, broader model compatibility and live advice quality; local mjai has only been tested with the Akagi v2 small Mortal example on the Windows CPU combination below |
| Planned | Broader real-game and model-quality evaluation; this is not a delivered capability |

The descriptions below cover current source. Packaged contents of [stable release **0.9.0**](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/tag/v0.9.0) are specific to that release. Earlier profiles passed synthetic-game checks in isolated Edge and Chrome environments. In 0.6.0, Edge passed an actual extension flow with simulated responses and Chrome passed offline UI checks; these do not establish complete current Chrome MV3 loading or live protocol validation.

Language links switch documentation only. The extension UI is currently Simplified Chinese; English and Japanese pages do not imply support for other regional game domains.

![Floating analysis card with synthetic game data and model output](docs/images/agent-floating-preview.png)

## Features

**New in 0.9.0: decision discussions.** The current result stays at the top as `最新分析`. `发送追问并保留讨论` sends a question and automatically retains that decision when new advice arrives. Each decision uses its own frozen position, original advice, and chat context, separate from the live round's main session. Collapse it, remove it from the panel while keeping history, or use `查询决策历史` to filter by match, round, turn, or event, show only discussions with questions, and reopen one. Questions require a configured and enabled `chat` LLM. This feature is included in the 0.9.0 packages.

Discussions and panel state are stored locally in the extension and restored after reload. An interrupted question is marked failed on restart and can be retried. There is no preset question-count limit, but request budgets, API costs, and local limits of **6 MB / 400 decisions** apply. Only old analyses without questions or retention are evicted; writes fail when space cannot safely be freed. Clearing local sessions and usage also clears discussions. There is no cloud sync or permanent-storage guarantee. Configure per-million-token prices and export the latest 100 numeric usage records; missing usage stays unknown.

**Review and question earlier turns:** `切换已记录分析` provides a `巡目 / 决策点` selector. Before the whole live match ends, it lists analyzed decisions from the current round only and hides match/round selectors, including during round settlement. Those selectors appear only after an explicit whole-match end signal or in history/replay modes. Selecting a decision displays its captured hand and original advice at the top as `历史决策`; ask further questions and retain the discussion. Collection continues while hand annotations pause; `回到当前` returns to the current position. Only retained analysis records are available, including those without questions. Unanalyzed, uncollected, or evicted turns cannot be recovered automatically. Unreliable turn numbers show as unknown, distinguished by event identifiers. Reloading restores retained discussions without treating an old decision as the latest current analysis; old analyses without questions remain accessible through the selector or history.

- **Bring your own model API:** customize the endpoint, model ID, and API key. Data is prepared for danger, hand, and push/fold analysis; enable model calls to request advice manually or automatically by turn. With model calls disabled, analysis stays local.
- **Floating analysis card:** a separate, persistent result card with a draggable title and saved position. Click candidate tiles to compare explanations; hand details, local efficiency tables, and traces stay folded. The collector starts collapsed and opens independently for discards, dora, and history.
- **Hand annotations:** after manual calibration, recommendations and high-risk tiles appear over the current live hand, including matching copies. Normal annotations let game clicks pass through. A changed state clears old markers immediately; delayed results cannot annotate a newer state.
- **Dora display:** indicators and corresponding dora shown side by side, including honor-tile cycles, red fives, and three-player manzu rules. Hidden ura-dora is not inferred.
- **Match history:** browse wins, draws, final hand scores, and score changes by match, hand, and honba. Collection continues while viewing an older hand.
- **Replay inspection:** parse an already downloaded replay and inspect it with an independent event cursor, including all four hands when present in the replay.

Local history retains up to 20 matches and 100 hands per match, evicting the oldest matches at roughly 4 MiB total. Records are end-of-hand snapshots, not event-by-event replays. Refreshes or disconnects may split a match into separate records. Tiles are sorted by suit; manually rearranging tiles in the game is not mirrored.

## Installation

[Download v0.9.0, source, and SHA256 checksums](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/tag/v0.9.0)

| Package | Capabilities |
| --- | --- |
| [majsoul-ai-analysis-and-review-agent-0.9.0.zip](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/download/v0.9.0/majsoul-ai-analysis-and-review-agent-0.9.0.zip) | Collector, panel, match history, Agent, model settings, and harness traces |
| [majsoul-collector-0.9.0.zip](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/download/v0.9.0/majsoul-collector-0.9.0.zip) | Collection, display, history, and export only; no model code, settings page, or model host permissions |

Enable only one profile on a game page. The collector works independently and can export records for offline review. The profiles have separate local storage and do not migrate data automatically. The source `extension/` directory is the full edition; `npm run build` generates both loadable directories.

The independent `extension/profiles/agent.json` and `collector.json` profiles select `apps/agent-app.js` and `apps/collector-app.js` as composition entries. Building follows each profile's dependency closure to produce `dist/majsoul-ai-analysis-and-review-agent-<version>/` and `dist/majsoul-collector-<version>/`; load either directory directly. The collector package contains only the files needed for collection, display, history, and export.

1. Download and extract the source ZIP, or clone the repository. For a source checkout, use the **`extension/` directory**.
2. Open `edge://extensions` in Edge or `chrome://extensions` in Chrome, and enable Developer mode.
3. Choose **Load unpacked** and select that directory. For the dedicated extension ZIP, select the extracted directory that directly contains `manifest.json`.
4. Refresh the Mahjong Soul page so the collector loads before the game connection is established, then enter a game or reopen a replay.
5. The full edition shows a separate `Majsoul Agent` card on the right and a collapsed `牌局` collector entry on the left. The collector-only edition shows the left entry. Drag either title to move it; positions are saved independently. Recent events and collection status start collapsed.

After updating, reload the extension in the browser’s extension manager, then refresh the game. Refreshing resets your replay position. Existing connections and previously downloaded replay data cannot be read retroactively.

Only **`https://game.maj-soul.com/*`** is currently matched. Other regional domains, Firefox, Safari, and the Steam desktop client are not supported. Architectural compatibility with Chrome or Brave is not a substitute for testing.

## Agent and harness

The collector controller owns table state, replay cursors, history, and exports; the UI interacts through views and commands. A separate adapter maps the user's selection to the standard `mj-analysis-v1` DTO. The Agent depends on the pure data contract without reading collector state layouts, so another collector can supply the same DTO. The analysis panel receives only a snapshot function and display inputs. Composition entries connect these components; see [decoupling design](docs/DECOUPLING.md) and [architecture](ARCHITECTURE.md) (Chinese).

The worker runs the real upstream `@earendil-works/pi-agent-core` / `pi-ai` 1.4.0 lightweight Agent loop, adapted and bundled for MV3. Networking still uses the existing OpenAI-compatible transport; this does not add all providers' native SDKs. The harness retains snapshot validation, local preparation, model execution, strict result validation, cancellation, and traces. The API must support tools. Manual reviews allow at most 3 model requests, live analysis at most 2, with up to 4 tool calls each. DeepSeek Harness is a design reference, not a dependency. See [round sessions and usage](docs/AGENT_SESSIONS.md) (Chinese).

Review a collector `mj-observer-v1` JSON export locally with Node.js 22.19+:

```sh
npm run review -- observation.json --seat 0 --hand --cursor 12
npm run eval
```

`--seat` is a protocol seat ID from 0 to 3. `--hand` explicitly includes your own hand, which is excluded by default. For replays, `--cursor` applies only the first N events and never uses future states. Omit it for live exports, which use the exported snapshot. The CLI performs local analysis without a model request. The built-in evaluation contains three synthetic shanten regressions; it does not measure model quality or playing strength. See [Agent and harness](docs/AGENT.md) (Chinese).

## LLM setup

Suggested starting configuration: model ID **`deepseek-flash`**, endpoint **`https://api.deepseek.com/chat/completions`**, and your own API key. Entering just `https://api.deepseek.com` also works; settings append the path. As checked on 2026-10-26, the official version is **DeepSeek-V4.1-Flash-1017**. Disable thinking to approach the reported test conditions; the experiment capped each HTTP output at 2048 tokens, so its timing and cost do not describe default settings. See [setup and benchmark notes](docs/MODEL_BENCHMARK.md) for peak/off-peak CNY prices and full sample results, and the [official pricing page](https://api-docs.deepseek.com/quick_start/pricing/) for current prices.

The per-analysis model-request budget includes the final answer and is a limit, not a required call count. The conditional memory tool `get_user_memory` does not increase the total tool-call budget.

Every analysis proactively sends the full frozen authorized snapshot: your current hand, drawn tile, public table, and discards. Current facts override old answers. `round` retains captured authorized events and successful exchanges interleaved in time within the current round, branch, and discussion group; mid-round starts and coverage gaps are explicit. Six default read-only tools expose your hand, public table, selected players' discards, round events, local discard comparisons, and danger evidence, reading only frozen authorized input. Local safety limits fail explicitly and preserve history without silent cropping. Chat Completions still retransmits history; cache hits and cost savings are not promised. Missing usage remains unknown. See [authorization and caching](docs/AGENT_SESSIONS.md) (Chinese).

The full edition accepts your own model API; no project-specific service or account is required. LLM analysis and explanation remain the main use. The default provider is `chat`, with analysis disabled. One `chat` and one optional `mjai` configuration are retained separately; only the selected provider runs per request.

| Service type | How to connect |
| --- | --- |
| Cloud model or compatible third-party gateway | Enter the full HTTPS Chat Completions endpoint, model ID, and your API key |
| Local model service | Enable its Chat Completions-compatible API and enter a localhost or 127.0.0.1 address with its port; leave the key empty if authentication is not required |
| Service offering only another native protocol | Use a gateway that exposes a Chat Completions-compatible API, then configure the gateway endpoint |

Local analysis is available without an API. The card offers danger, hand-efficiency and offense/defense switches, with a combined preset. Model calls and automatic analysis are both off by default.

The manual analysis button ignores automatic feature and turn thresholds while respecting the model-call switch. Successful results appear as `最新分析`; decisions with questions are retained separately. Failures and cancellation keep the previous result. Each discussion identifies its captured position and supports further questions about that decision. Only automatic results annotate live tiles.

1. To use a model, open `分析设置`, configure your service in `模型设置`, and grant its host permission.
2. The configuration page explains data sharing and possible fees. Enable `调用模型` to send public table information and your own hand. Your seat must be known; opponents' hidden tiles and account credentials are excluded.
3. For `自动分析`, choose every turn or from turn N onward (initially turn 7, adjustable from 2–18). Earlier turns use local calculations. The collector tracks each player’s next discard number from a continuously observed opening; calls, kans, north extractions and replacement draws alone do not increment it. Missing events, disconnections or absent sequence numbers make it unknown. From-turn-N mode then stays local until a new complete opening; every-turn mode requires no turn threshold.
4. Automatic calls run only at your own discard decisions, combining enabled modules in one request. The default minimum interval is 8 seconds, with 20 automatic model calls per round; both are adjustable. Replays remain manual. Position changes invalidate automatic results and cancel pending automatic requests. Round counters reset when the panel is reloaded.

With model calls disabled, local shanten, improving tiles and genbutsu/suji/kabe evidence require no model request. Integrated strategic explanations require a model. You can inspect analysis data in settings and disable `调用模型` to stop sending data.

To annotate game tiles, open `分析设置 → 校准手牌提示` at the table. Position the frame over 13 concealed slots, the gap, and the drawn slot, then confirm. Calibration is saved relative to a single visible game Canvas. It assumes manzu, pinzu, souzu, and honors in that order, with shorter hands aligned left after calls; it does not detect individual tile coordinates or follow manual rearrangements. Recalibrate after layout changes or misalignment. Unknown hands, multiple canvases, replays, and historical views receive no markers. Current output shows recommendations and qualitative risk, not fabricated probabilities derived from preferences or unseen-tile upper bounds.

The three analysis tasks use separate data contracts and modular prompts. Danger analysis retains selected players’ ordered discards, discard-from-hand/draw distinctions, riichi, and melds. Tile-efficiency analysis sends only your hand, melds, rules, and authorized visible-tile counts, excluding full discard histories. Combined offense/defense analysis uses both modules in one request.

The extension computes shape-based shanten and improving tiles locally for standard hands, seven pairs, and thirteen orphans. The model explains these results and weighs offense against defense. The table’s unseen-tile counts are upper bounds, not counts of tiles remaining in the wall; zero means all copies have been seen. For high-shanten hands, the calculation compares shape improvements rather than exhaustively searching every future draw/discard sequence. A 13-tile hand shows only its current shanten and improving tiles. After riichi, only the confirmed newly drawn tile can be recommended for discard; if it is unknown, no specific discard is suggested. Completed hands are analyzed only as mathematical reviews.

Model output must follow a JSON Schema; JSON code fences are accepted. The extension rejects discard suggestions outside your hand or unsupported by locally legal candidates. Claims that a tile is genbutsu require local evidence from the relevant opponent’s discards. Shanten and improving-tile counts come from local calculations; model-provided numeric fields outside the contract are rejected. The preview shows current-position and local-analysis data. Round sessions also send authorized round history and the current question; the preview is not the complete request body. Local calculations run within the extension.

The endpoint must support non-streaming `POST /chat/completions` with string content in `choices[0].message.content`; provider-side `response_format` support is not required. Native Anthropic, Gemini, and Responses API formats require a compatible gateway. Both request and response formats must be compatible, and the model must follow the JSON Schema described above. Requests time out after 25 seconds, with one concurrent request per tab.

Advice may be wrong or late, calls may incur charges, and the configured provider processes the input. The small DeepSeek experiment does not establish other providers' compatibility or live advice quality. The API key stays in extension-local storage, is read only by the background component, and is excluded from game exports and the page bridge. See [SECURITY.md](SECURITY.md) for details.

## Optional local mjai engine

Local mjai is an optional backend, disabled by default; LLM analysis remains the main workflow. **Current source adds a beginner setup** using a pinned Akagi v2 small Mortal example model and Windows x64 runtime files. Install the Python 3.11 CPU dependencies, then download, check, and serve without writing a Bot or `runtime.json`. This is a weak example model, not Equim's online Mortal 4.1 or a model supplied by mjai-reviewer; no specialist playing-strength claim is made. The released 0.9.0 package does not include these new commands.

```powershell
npm run engine:akagi -- setup --dir research/evidence/akagi-v2
npm run engine:akagi -- check --dir research/evidence/akagi-v2 --python .venv-akagi/Scripts/python.exe
npm run engine:akagi -- serve --dir research/evidence/akagi-v2 --python .venv-akagi/Scripts/python.exe --port 17341
```

Prepare the virtual environment using the [full installation steps](docs/MJAI.md) (Chinese). After the model check succeeds, keep the bridge terminal open, select local mjai in extension settings, enter its URL and Token, and manually enable and authorize analysis. Downloads use the pinned official upstream repository and SHA-256 checks; game data is not automatically uploaded. Upstream programs and weights are not included in extension packages, and their licenses apply separately. The collector remains independent without these tools or engine permissions.

Real example weights passed HTTP → EngineAgent acceptance on Windows x64 / Python 3.11 / PyTorch 2.7.0 CPU / NumPy 1.26.2, returning different valid actions across artificial positions at all four seats in about 6.7–10 seconds. Cancellation and cleanup passed. This does not establish playing strength or full live-game compatibility. See [validation scope](VALIDATION.md).

Other trusted Bots can still use the generic adapter:

```sh
npm run engine:serve -- --config runtime.json --port 17341
npm run engine:review -- observation.json --config runtime.json --seat 0 --hand --cursor 12
```

`runtime.json` names a trusted local program. JSONL receives one complete event array and returns one action line. The generic Python `Bot.react` wrapper requires your module to initialize the bot and load its weights; arbitrary upstream `bot.py` files are not guaranteed compatible. Configured commands are not sandboxed. The browser Agent accepts only complete four-player rounds without melds, with validated discards, riichi intent, or pass actions; an own-hand 14-tile opening record is rejected. Q values are not deal-in probabilities, and play is never automatic. See the [setup, validation scope, and limits](docs/MJAI.md) (Chinese).

The 0.9.0 Python wrapper can explicitly select a `Bot(player_id)` constructor and inspect interface signatures with `--check`. The check does not construct the Bot or call `react`, though importing a module can have side effects; signature compatibility does not verify inference with real weights. See [MJAI setup](docs/MJAI.md) (Chinese) for arguments and checks.

## Optional NAGA replay export

The full edition's `牌谱复盘 · NAGA` panel is disabled by default. Open a complete replay, enable it, explicitly select East-only / South game, one red five per suit / no red fives, and four-player open tanyao rules, then confirm generation. Conversion reads the entire replay locally, independently of the cursor. Select hands, preview, copy, or download one `Tenhou URL` per hand, then sign in and submit yourself on the [official NAGA page](https://naga.dmv.nico/naga_report/order_form/). Exports include all four hands and replace player names with seat labels.

The first version supports standard four-player calls, kans, riichi, single-winner hands, and ordinary exhaustive draws. Multiple winners, responsibility payments, nagashi mangan, abortive draws, three-player games, unknown yaku, and missing data are rejected per hand. See [NAGA integration](docs/NAGA-INTEGRATION.md) for exact limits. The extension does not automatically upload, charge, read reports, or collect account credentials. Official prices and acceptance are determined on the official site. The collector-only edition contains no NAGA modules.

## History and replays

### Manual match review index

`打开整盘整理` stays collapsed until you open it manually, for example after a match or during history/replay review. It builds a local overview of retained decision samples from saved snapshots, original analyses, and questions, organized into four themes: push/fold and risk, tile efficiency, calls and riichi positions, and user questions. It makes no model calls and does not automatically generate an LLM match summary. Each source links back to its original decision, captured hand, and advice, where you can continue asking questions through your configured and enabled `chat` LLM at its usual API cost. Live collection continues; hand annotations pause while viewing a historical decision.

Coverage includes only retained analyses, excluding unanalyzed or evicted records. A missing match ID is marked as an unconfirmed scope; `刷新留存记录` refreshes the index. Advice does not establish what the player actually did: actual actions remain unknown, with no inferred error rate, overall performance, or user preferences. Questions distinguish answered, pending, and incomplete states. This feature is included in the 0.9.0 packages.

### Optional match memory learning

Disabled by default. When enabled, it saves evidence from your actual play. Only an explicit end of an East-only or South match with at least **3 reliably covered complete rounds and 20 actual self actions with complete context** triggers one match summary through your configured model API. Observations await confirmation and can be reviewed, corrected, or deleted; explicit preferences can also be saved manually. Live-source automatic analysis can query a fixed round version through read-only `get_user_memory`. Memory adjusts explanation emphasis without overriding facts, mahjong reasoning, or safety checks. Disabling learning stops collection and automatic summaries; saved memory remains until deleted or cleared. Summaries may cost extra, completion after closing the browser is not guaranteed, and real-model memory quality is unverified. See [match memory learning](docs/USER_MEMORY.md) (Chinese).

### Results and replays

Hand results show tsumo, ron, exhaustive draws, or abortive draws, along with scores and net changes from the start of the hand, including riichi payments. Missing final scores remain unknown and may be completed when the next hand begins.

Expand `整场记录`, select a match, and click `查看` for a hand to inspect its result snapshot. Click `返回当前牌局` to return to the current table. Uncollected earlier hands cannot be recovered automatically. Loading a complete replay can archive its hands; repeated loads of the same replay are deduplicated.

The replay cursor is **independent of game playback**. Use the previous/next event controls to align it manually; it does not follow playback automatically. Live collection uses only your own information and public table data already delivered to the client. Seeing four hands in a replay does not mean opponents’ concealed tiles are available during a live game.

## Limitations

- The current client protocol still needs full-match live validation. Special rules, protocol changes, and reconstruction after reconnecting are not fully covered.
- State is derived from received events. Missing frames, joining mid-hand, or late seat detection may affect the hand. Completeness markers are retained without persistent warnings.
- Seat winds rotate with the dealer and are not fixed screen positions. Your seat can be detected automatically or selected manually.
- The extension does not play automatically, alter game messages, proactively download replays, or infer the tile wall or opponents’ concealed hands.
- Read-only operation does not imply approval from the game operator. Check the platform rules. This is an unofficial project with no affiliation with the game publisher.

## Development and validation

Development, checks, and builds require Node.js 22.19 or newer and the locked dependencies below. Loading the committed `extension/` or a built package requires no Node.js:

```sh
npm ci
npm run check
npm test
npm run build
```

`check` validates static dependency boundaries, browser-free core modules, profile resources, and loading order. `build` copies each profile's dependency closure without rewriting shared UI source. These checks do not establish live protocol compatibility or model quality.

Serve `tests/preview.html` with a local static server for the offline demo. For example, with Python installed:

```sh
python -m http.server 8126 --bind 127.0.0.1
```

Open `http://127.0.0.1:8126/tests/preview.html`. Tests and demos use synthetic protocol frames, mocked browser APIs, and simulated model responses. They do not connect to an account or a real model and do not establish live capture accuracy or advice quality. See [VALIDATION.md](VALIDATION.md).

| Document | Contents |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Module responsibilities, events, and model data flow |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Local development, reproduction data, and PR requirements |
| [SECURITY.md](SECURITY.md) | Permissions, credentials, data handling, and vulnerability reports |
| [CHANGELOG.md](CHANGELOG.md) | Version history |
| [docs/HISTORY.md](docs/HISTORY.md) | Sanitization and migration of the original private development history |
| [docs/PUBLISHING.md](docs/PUBLISHING.md) | Clean snapshot packaging and publication steps |

The supporting documents above are currently in Simplified Chinese. When updating a README, keep the feature descriptions and limitations consistent across all three languages.

## License and references

Source code and 37 original SVG tile faces are available under the [MIT License](LICENSE). Tile faces are generated by this repository’s script; no game screenshots or external fonts are bundled.

[mj_helper](https://github.com/tzp1021/mj_helper) informed the collection/state-machine layering and open-source repository organization, alongside other protocol research. This project focuses on an in-browser panel, result history, and user-selected models. It does not bundle mj_helper’s Python decision engine or claim equivalent playing strength. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for references and the handling of legacy assets.
