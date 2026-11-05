# 功能与实现核查

核查日期：**2026-11-05**；源码版本：**0.16.2**。本页将用户功能与实际入口、源码和回归测试对应，供维护 README 和排查功能边界使用。安装步骤见[项目首页](../../README.md)，第三方关系先看[参考索引](../REFERENCES.md)。

本轮核查采用源码检查、人工数据离线界面检查及自动化回归；没有新增真实整场、付费 LLM 或实战牌力验收。表中测试是对应回归入口，不能据文件存在推定覆盖所有实际场景。上游 README 与[生态研究](../research/RIICHI_ECOSYSTEM_RESEARCH.md)用于参考表达与定位，功能是否存在以当前实现为准。

## 采集、状态与界面

| 功能与用户入口 | 实现依据 | 回归入口与边界 |
| --- | --- | --- |
| 雀魂网页实时采集、既有牌谱载入 | [capture.js](../../extension/capture.js)、[protocol.js](../../extension/protocol.js)、[controller.js](../../extension/collector/controller.js)；旁路读取 WebSocket 与游戏已有牌谱下载 | [capture.test.js](../../tests/capture.test.js)、[protocol.test.js](../../tests/protocol.test.js)、[collector-controller.test.js](../../tests/collector-controller.test.js)；只适配 `game.maj-soul.com`，不主动按分享 URL 抓谱，不自动打牌 |
| 自家座位、手牌、牌河、副露、立直、宝牌、分数与结算 | [state.js](../../extension/state.js) 的 `apply`、`selectSelfSeat`、`doraTile`；分开维护 live/replay 状态，记录事件缺口与未知巡目 | [state.test.js](../../tests/state.test.js)、[snapshot-contract.test.js](../../tests/snapshot-contract.test.js)；三麻含拔北与宝牌映射，不代表全部分析后端支持三麻。手动换座位会使完整性失效 |
| 断线与不完整采集提示 | [capture.js](../../extension/capture.js) 的恢复解析、[controller.js](../../extension/collector/controller.js) 的连接与诊断处理 | 接受固定协议的明文动作批次；不支持快照式完整恢复，缺失事件、换 socket 或解码异常会降低完整性。不能宣传任意重连后自动补齐整局 |
| 获取器、局面导出、独立 Collector | [overlay.js](../../extension/overlay.js)、[collector-app.js](../../extension/apps/collector-app.js)、[collector.json](../../extension/profiles/collector.json)；导出 `mj-observer-v1` 的事件、牌谱、诊断和历史 | [app-composition.test.js](../../tests/app-composition.test.js)、[build-profiles.test.js](../../tests/build-profiles.test.js)；Collector 不含模型运行时及模型主机权限，与 Agent 存储独立 |
| 明暗主题、悬浮拖动、收起、位置保存与全屏适配 | [floating-panel.js](../../extension/floating-panel.js)、[panel-theme.js](../../extension/panel-theme.js) | [floating-panel.test.js](../../tests/floating-panel.test.js)、[panel-theme.test.js](../../tests/panel-theme.test.js)；README 白天图来自人工局面的当前离线 UI，黑夜图为已有演示，含模拟模型响应 |
| 手牌区域建议与危险标记 | [hand-hints.js](../../extension/hand-hints.js)，手动校准位置并支持键盘调整 | [hand-hints.test.js](../../tests/hand-hints.test.js)；不是视觉识牌；提示不截获点击，局面过期、复盘或找不到画布时撤销／暂停 |

## 本地计算、模型分析与追问

| 功能与用户入口 | 实现依据 | 回归入口与边界 |
| --- | --- | --- |
| 无 API Key 的向听与牌效比较 | [mahjong-analysis.js](../../extension/mahjong-analysis.js)、[analysis-panel.js](../../extension/analysis-panel.js) 的 `localResponse` | [mahjong-analysis.test.js](../../tests/mahjong-analysis.test.js)、[mahjong-reference.test.js](../../tests/mahjong-reference.test.js)；普通型、七对子、国士，比较候选弃牌与有效牌，处理赤五、副露、杠及三麻牌集；剩余有效牌是按已见牌估算的上界，不是精确牌山 |
| 逐家危险依据 | [mahjong-analysis.js](../../extension/mahjong-analysis.js)、[analysis.js](../../extension/analysis.js) 的准备与结果校验 | [analysis.test.js](../../tests/analysis.test.js)；提供现物／筋／壁等证据，本地结果仅将现物标为安全，其余保留未知，不计算精准放铳率，也不独立生成综合攻守结论 |
| 手动“分析当前局面”与自动提示 | [analysis-panel.js](../../extension/analysis-panel.js) 的 `runAnalysis`、`scheduleAnalysis`；[model-analysis-worker.js](../../extension/model-analysis-worker.js) 执行模型任务 | [analysis-panel.test.js](../../tests/analysis-panel.test.js)、[model-analysis-worker.test.js](../../tests/model-analysis-worker.test.js)；自动默认关闭，仅在符合条件的实时自家可弃牌时触发。起始巡数、间隔和每局次数限制自动调用；手动全局分析固定为综合任务，不受这些限制 |
| 取消、去重、旧建议失效与分区显示 | [analysis-panel.js](../../extension/analysis-panel.js) 的局面指纹与生命周期、[model-analysis-worker.js](../../extension/model-analysis-worker.js) 的 pending/abort | 面板测试覆盖旧响应与局面切换；切换设置或权限会取消相关请求。启用某一提示分区不等于手动请求只发送该分区数据 |
| 冻结决策、多轮追问、历史重新打开 | [decision-discussions.js](../../extension/decision-discussions.js) 的 `save`、`ask`、`context`、`answer`、`recover`；worker 再读取存档快照 | [decision-discussions.test.js](../../tests/decision-discussions.test.js)、[phase1-discussions-background.test.js](../../tests/phase1-discussions-background.test.js)、[agent-session-integration.test.js](../../tests/agent-session-integration.test.js)；后续问答带原建议与已完成问答，使用原决策而非后来局面。重启后未完成请求标失败，不自动重发 |
| 讨论筛选、折叠、移出与容量保护 | 同上，以及分析面板的 discussion/history UI | 最多 400 条、约 6 MB 估算预算；优先淘汰不在面板且没有问答的旧分析，仍不足时报错。折叠／移出不删除历史，清除本地会话会删除讨论；不是永久留存或云同步 |
| Pi Agent 的只读事实工具 | [agent.js](../../extension/agent.js)、[pi-runtime.js](../../extension/pi-runtime.js)、[harness.js](../../extension/harness.js)；工具包括自家手牌、桌面、牌河、最多 64 条小局事件、弃牌比较、危险依据及可选用户记忆 | [pi-runtime.test.js](../../tests/pi-runtime.test.js)、[agent-harness.test.js](../../tests/agent-harness.test.js)；无任意文件、命令执行或未来事件读取。结构和证据校验不保证自然语言整体正确 |
| 小局上下文复用、X-F 与 NED 回退 | [round-context.js](../../extension/round-context.js)、[xf-context.js](../../extension/xf-context.js)、[model-session-transport.js](../../extension/model-session-transport.js) | [round-context.test.js](../../tests/round-context.test.js)、[agent-xf.test.js](../../tests/agent-xf.test.js)、[agent-ned.test.js](../../tests/agent-ned.test.js)；按身份、来源、座位、通道、配置与记忆版本隔离，使用基线与增量。有容量预算，不能宣传无限上下文。完整四麻且满足综合弃牌条件时才走 X-F |

## 配置、权限与用量

| 功能与用户入口 | 实现依据 | 回归入口与边界 |
| --- | --- | --- |
| 自备 LLM、多份命名配置、保存与应用 | [options.js](../../extension/options.js)、[model-profiles.js](../../extension/model-profiles.js)、[model-config-store.js](../../extension/model-config-store.js) | [model-profiles.test.js](../../tests/model-profiles.test.js)、[model-config-store.test.js](../../tests/model-config-store.test.js)；LLM 配置与本地引擎配置分开，切换配置不等于启用分析。需 Chat Completions function tools，不保证原生 Responses／Anthropic 接口兼容 |
| 手动连接诊断、服务模型目录、可选网关 | [model-diagnostics.js](../../extension/model-diagnostics.js)、[model-endpoint.js](../../extension/adapters/model-endpoint.js) | [model-diagnostics.test.js](../../tests/model-diagnostics.test.js)、[model-diagnostics-background.test.js](../../tests/model-diagnostics-background.test.js)、[cc-switch-contract.test.js](../../tests/cc-switch-contract.test.js)；测试为最多两轮固定工具 ping/pong 与 JSON，不含牌局，可能收费。Magpie 显式识别与标准目录、CC Switch 实验 Codex 目录有固定范围，不读取桌面凭据 |
| 思考参数与请求协议 | [model-endpoint.js](../../extension/adapters/model-endpoint.js)、[model-session-transport.js](../../extension/model-session-transport.js) | 使用非流式 `stream:false`；思考参数适配限定的 DeepSeek 官方域名／模型，不是任意兼容服务通用开关 |
| 模型接口权限与密钥隔离 | [background.js](../../extension/background.js)、[agent.json](../../extension/profiles/agent.json) | worker 校验消息来源、配置与权限；凭据位于 `TRUSTED_CONTEXTS` 本地存储，不回传内容脚本。分析卡当前固定选择对局信息、全部公开牌河和自家手牌，无逐字段授权 UI；开启云模型即发送相关局面 |
| 运行用量、分阶段耗时、导出与清除 | [model-usage.js](../../extension/model-usage.js)、[agent-run-store.js](../../extension/agent-run-store.js)、[options.js](../../extension/options.js) | [model-usage.test.js](../../tests/model-usage.test.js)；最多 100 条运行记录，引擎与解释分阶段，未知 token／费用不填零，不是完整服务商账单。记忆任务另有记录；清除会话和运行用量也清除讨论，用户记忆有单独清除入口 |

## 本地引擎与便携运行包

| 功能与用户入口 | 实现依据 | 回归入口与边界 |
| --- | --- | --- |
| 四个可安装模型 | [mortal-catalog.json](../../agent/mortal-catalog.json)、[engine-registry.cjs](../../agent/engine-registry.cjs) | 旧 Akagi v2 弱 Mortal 示例、两个固定社区 Mortal v4、Akagi v3 Native；均须按各自来源、许可和实验范围使用，版本号不是牌力排名，社区 v4 不是官网 4.1 |
| 解压双击、本机管理、按需安装、单模型启停／切换／删除 | [launch-model-manager.cjs](../../scripts/launch-model-manager.cjs)、[model-manager.cjs](../../agent/model-manager.cjs)、[model-installation.cjs](../../agent/model-installation.cjs)、[管理 UI](../../agent/model-manager-ui/app.js) | [model-manager.test.js](../../tests/model-manager.test.js)、[model-manager-ui.test.js](../../tests/model-manager-ui.test.js)、[portable-model-runtime.test.js](../../tests/portable-model-runtime.test.js)；Windows x64 便携包自带 Node，默认空闲，不自动安装或推理。按需下载、哈希校验与路径归属检查；两个 v4 共享运行环境，删除时保留共享依赖 |
| Akagi v3 独立 CPU 推理 | [akagi-native-local.cjs](../../agent/akagi-native-local.cjs)、[akagi-native-process.cjs](../../agent/akagi-native-process.cjs) | [native-model-installation.test.js](../../tests/native-model-installation.test.js)、[native-manager-start.test.js](../../tests/native-manager-start.test.js)、[akagi-native-process.test.js](../../tests/akagi-native-process.test.js)；约 2.64 MB 权重，独立 Rust CPU 运行包，无 Python／PyTorch，当前四人半庄实验范围 |
| 扩展与本机运行时配对 | [local-runtime-pairing.js](../../extension/local-runtime-pairing.js)、[manager-access.cjs](../../agent/manager-access.cjs) | [local-runtime-pairing.test.js](../../tests/local-runtime-pairing.test.js)；nonce、显式批准与超时，只交付对应模型的分析凭据，不交付管理 token；配对后默认不启用分析 |
| 完整事件重放、合法动作验证与 mjai 接入 | [engine-agent.js](../../extension/engine-agent.js)、[mjai.js](../../extension/adapters/mjai.js)、[engine-server.cjs](../../agent/engine-server.cjs) | [engine-agent.test.js](../../tests/engine-agent.test.js)、[engine-actions-acceptance.test.js](../../tests/engine-actions-acceptance.test.js)、[engine-integration.test.js](../../tests/engine-integration.test.js)；核对手牌、河、分数、宝牌与操作资格，支持可验证的弃牌、立直、吃碰杠和等动作。缺完整四麻事件或无法证明合法时拒绝，不执行游戏操作 |
| 引擎动作先显示、LLM 随后解释、失败单独重试 | [model-analysis-worker.js](../../extension/model-analysis-worker.js)、[engine-result.js](../../extension/contracts/engine-result.js)、[engine-explanation.js](../../extension/contracts/engine-explanation.js) | [mortal-workflow.test.js](../../tests/mortal-workflow.test.js)、[phase3-engine-acceptance.test.js](../../tests/phase3-engine-acceptance.test.js)；先保存校验后的引擎动作，LLM 不能改写首选。只看动作无需 LLM；引擎追问需配置并启用独立 LLM 解释，解释不是引擎内部思考还原 |

固定权重真实推理与安装结果应查[v3 验收](../validation/AKAGI_V3_VALIDATION.md)和[v4 验收](../validation/MORTAL_V4_VALIDATION.md)：v3 在线空目录安装已有记录，v4 完整离线安装已有记录，Hugging Face 权重完整在线下载链路尚未通过。本轮没有重复这些真实模型验收。

## 历史、外部复盘与记忆

| 功能与用户入口 | 实现依据 | 回归入口与边界 |
| --- | --- | --- |
| 对局结算历史与已采集牌谱游标 | [history.js](../../extension/history.js)、[history-storage.js](../../extension/history-storage.js)、[controller.js](../../extension/collector/controller.js) | [history.test.js](../../tests/history.test.js)、[collector-controller.test.js](../../tests/collector-controller.test.js)；最多 20 场、每场 100 小局、约 4 MiB。查看历史不停止采集；刷新／断线可能分段，手动游标不驱动游戏画面 |
| 留存分析的主题整理与来源跳转 | [postgame-review.js](../../extension/postgame-review.js)、[analysis-panel.js](../../extension/analysis-panel.js) | [postgame-review.test.js](../../tests/postgame-review.test.js)、[phase3-postgame-acceptance.test.js](../../tests/phase3-postgame-acceptance.test.js)；确定性整理攻守、牌效、鸣牌立直局面与问题，不调用模型。仅包含留存分析，实际选择为未知，不是完整整场 AI 总结、失误率或胜率统计 |
| NAGA 本地导出与官方页入口 | [naga-panel.js](../../extension/naga-panel.js)、[naga-replay.js](../../extension/adapters/naga-replay.js) | [naga-panel.test.js](../../tests/naga-panel.test.js)、[naga-replay.test.js](../../tests/naga-replay.test.js)、[naga-protocol.test.js](../../tests/naga-protocol.test.js)；默认关闭，要求完整四人喰断牌谱，用户确认东风／半庄及赤牌。支持预览、复制、下载，不自动上传、扣费或回读报告；导出含四家手牌 |
| Mortal 官网入口、旧报告本地导入与按需解释 | [official-mortal-report.js](../../extension/official-mortal-report.js)、[analysis-panel.js](../../extension/analysis-panel.js) | [official-mortal-report.test.js](../../tests/official-mortal-report.test.js)、[mortal-workflow.test.js](../../tests/mortal-workflow.test.js)；原生分享链接只预填官方页面，不自动提交。导入仅限英文 Classic 1.5.3 / Mortal 3 的有限普通弃牌条目，严格匹配本地小局与决策；不支持当前 4.1、KillerDucky 或 CLI JSON，不自动逐手付费解释 |
| 可选本人整场记忆、观察与讲解偏好管理 | [user-memory-capture.js](../../extension/user-memory-capture.js)、[user-memory.js](../../extension/user-memory.js)、[user-memory-worker.js](../../extension/user-memory-worker.js)、[options-memory.js](../../extension/options-memory.js) | [user-memory.test.js](../../tests/user-memory.test.js)、[user-memory-flow.test.js](../../tests/user-memory-flow.test.js)；默认关闭，只采集开启后的本人 live，身份取可信座位／操作事件，不把手动选择视角当本人。明确整场结束、至少 3 个可靠完整小局及 20 个实际自家动作后才请求一次总结；实际动作与 AI 建议分开 |
| 记忆输入、费用、删除与任务恢复 | 同上，以及 [user-memory-agent.js](../../extension/user-memory-agent.js) | 实时分析优先，无可用 LLM 不总结，超限不请求，未知请求不自动重试。候选观察也可供后续解释参考，可确认／修正／删除；关闭学习仅停止新采集，不移除已有记忆。本机档案不按账号隔离，换账号需处理已有记忆 |

## 开发工具与核查结果

- [review.cjs](../../agent/review.cjs)：读取 Collector 导出，按视角／游标作本地分析，不调用 LLM；[engine-review.cjs](../../agent/engine-review.cjs)：以同一事件前缀合同作引擎复盘。
- [eval.cjs](../../agent/eval.cjs)：人工向听示例回归，不是实战牌力测试。
- [benchmark/cli.cjs](../../benchmark/cli.cjs)：数据验证、dry-run、mock/live 执行、恢复、预算、评分与报告，以及自主执行／独立评审流程。属于开发工具，不是扩展内一键整场复盘；操作见[自主 benchmark](../benchmark/BENCHMARK_AUTONOMOUS.md)。
- [构建脚本](../../scripts/build-extensions.mjs)：分别打包 Agent 与 Collector；[检查脚本](../../scripts/check.mjs)：检查语法、manifest 引用、版本及 37 张原创 SVG 牌面。

本轮执行结果：

| 检查 | 结果 |
| --- | --- |
| `npm run check` | 通过：脚本语法、manifest 引用、版本与原创牌面检查 |
| `npm test` | 共 707 项，706 通过、1 跳过、0 失败；约 78.5 秒。跳过项为 Linux 进程组清理测试，本轮运行环境为 Windows |
| 白天界面截图 | 人工局面离线演示；不连接雀魂、不请求付费模型 |

### 本轮修正与仍需注意的说明

README 已移除不存在的逐字段授权步骤，区分自动限额与手动综合请求，说明引擎追问的 LLM 条件、分析整理的采样边界、记忆关闭语义以及 NAGA 导出数据范围。优势表述围绕“安装门槛、冻结讨论、模型可选、动作与解释分离、依据与费用可查”，不宣称全生态唯一、首创或牌力领先。

核查中还发现两处现有辅助入口问题，本轮未改动运行代码：设置页的本地引擎提示仍残留“授权信息／选择综合攻守”的旧步骤；`tests/preview.html` 漏载 `user-memory-capture.js`，本轮截图仅在浏览器离线响应中补载该脚本，未修改扩展或测试页面。它们不应被当作 README 当前操作步骤或正式安装路径。

真实网页整场、通用断线恢复、实战牌力与付费 LLM 教学质量仍未由本轮核查证明。历史验证样本与规则差分范围见[验证总览](../../VALIDATION.md)及[规则事件验收](../validation/RULES_EVENTS_VALIDATION.md)。
