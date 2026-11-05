# Majsoul Agent

**让麻将建议变成可以追问的学习过程。**

当前发布版本：**0.16.2**

[简体中文](README.md) | [English](README.en.md) | [日本語](README.ja.md)

雀魂网页版 AI 分析助手。可以直接用你自己的 LLM 分析局面，也可以让本地 Mortal 或 Akagi 引擎先给出动作，再由 LLM 讲解。围绕“为什么打这张？”“换一张会损失什么？”继续追问，每个决策都有自己的局面和讨论。

[**下载**](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/tag/v0.16.2) · [普通使用](#普通使用) · [本地模型使用](#本地模型使用) · [详细文档](docs/README.md)

![自由悬浮分析卡，使用人工局面与模拟模型响应](docs/images/agent-floating-preview.png)

## 从给出答案，到理解取舍

**本地引擎负责决策，LLM 负责讲解，你可以接着问。** 本地引擎动作通过合法性与已知模型身份校验后先显示；LLM 随后结合当时局面、本地计算与原动作补充解释，不能修改引擎首选或立直配套弃牌。解释失败时，已校验的动作仍保留，可以只重试解释。

讨论绑定当时的手牌、桌面、原建议和此前问答。新的一巡继续推进时，仍能回到旧决策追问，不混入后来的牌；追问和重试解释无需重新运行引擎。历史保留原模型来源，切换模型不会改写旧建议的身份。

| 功能 | 使用体验 |
| --- | --- |
| 本地事实辅助 | 向听、进张与逐家危险证据，配合 LLM 只读工具，帮助解释具体取舍 |
| 实时分析与决策回看 | 看当前局面，也可回到已记录决策继续讨论；讨论可在刷新后恢复，受本地容量限制 |
| 分阶段用量 | 分开查看引擎调用／耗时与 LLM token／费用，支持导出；未知费用保持未知 |
| 按需选择模型 | LLM 可独立使用；本地引擎可单独使用，也可接 LLM 讲解。权重按需下载、保留或删除 |
| 浏览器直接采集 | 不用配置 CDP、远程调试或系统代理；只想记录时可使用独立 Collector |

**模型调用、本地推理和自动分析默认关闭，不自动打牌。** 不使用本地引擎，可以一个权重都不下载；只用扩展的本地计算，也无需配置 API。

## 下载

| 安装内容 | 用途 |
| --- | --- |
| [完整 Agent · v0.16.2](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/download/v0.16.2/majsoul-ai-analysis-and-review-agent-0.16.2.zip) | 普通使用和本地模型使用都先安装这个；包含采集、分析、追问与设置 |
| [独立 Collector · v0.16.2](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/download/v0.16.2/majsoul-collector-0.16.2.zip) | 只采集、展示、结算历史与导出，不含模型代码和模型主机权限 |
| [可选本地模型运行包 · Windows x64 · v0.16.2](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/download/v0.16.2/majsoul-model-manager-windows-x64-0.16.2.zip) | 自带 Node，解压双击启动；模型权重与必要依赖按需安装。普通使用无需下载 |
| [源码 · v0.16.2](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/download/v0.16.2/majsoul-ai-analysis-and-review-agent-source-0.16.2.zip) | 开发、构建与离线复盘 |

[发布页与 SHA-256 校验文件](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/tag/v0.16.2)。扩展包不包含权重、Python 或原生模型库。Agent 与 Collector 的本地存储独立，不自动迁移；同一游戏页面只启用其中一个。

## 快速开始

### 普通使用

适合直接用 LLM 分析与追问的用户。**只需完整 Agent 和自己的模型接口，无需 Node.js、Python 或本地模型工具包。**

1. 解压完整 Agent。在 Chrome 的 `chrome://extensions` 或 Edge 的 `edge://extensions` 开启开发者模式，选择“加载已解压的扩展程序”，加载直接包含 `manifest.json` 的文件夹。
2. 刷新 `https://game.maj-soul.com/`，让扩展在游戏连接建立前加载，再进入牌局。
3. 打开分析卡的“分析设置 → 模型管理”，填写支持 tools 的 Chat Completions 接口、模型名称和自己的 API Key。例如接口可填 `https://api.openai.com/v1/chat/completions`。
4. 勾选“开启模型分析”，保存设置并授予接口权限。
5. 回到牌局，确认自家座位，授权对局信息、牌河和自家手牌，开启“调用模型”，点击分析当前局面。需要连续提示时，再自行开启自动分析。
6. 对建议发送追问，或打开已记录决策继续讨论。

可以配置云端 API、兼容网关或本机 Chat Completions 服务；支持保存多个 LLM 配置。Magpie 和实验性 CC Switch 是可选入口，详见 [模型配置](docs/guides/MODEL_CONFIGURATION.md)。调用会把授权局面发给所配置服务，可能产生费用。

### 本地模型使用

适合用 Mortal 或 Akagi 给出动作，或进一步配合 LLM 讲解的用户。**扩展独立安装；需要本地模型时，再下载 Windows x64 便携运行包，解压后双击启动。不用自行安装 Node.js、Python 或 Rust。**

1. 按“普通使用”的第 1–2 步加载完整 Agent、刷新游戏。若需要 **Mortal＋LLM**，先按第 3–4 步保存一个 OpenAI 兼容 LLM 配置作为解释服务；只用本地引擎可跳过。
2. 完整解压便携运行包到可写目录，双击 `start.cmd`。它使用自带运行环境校验文件，并自动打开模型管理页；保持运行窗口开启。
3. 选择想用的模型，点击“安装”，完成后点击“启动分析”。仅下载所选权重和必要模型依赖，不必安装其他模型；安装本身不会启动推理。
4. 回到扩展“本地麻将模型”，选择对应模型，点击“连接所选模型”并授予本机接口权限。在管理页批准连接后，扩展自动填入该模型的分析配置，**无需复制 Token**。
5. 要开启 **Mortal＋LLM**，勾选“本地引擎决策 + LLM 自动解释”；只要引擎动作则不勾选。连接完成仍保持分析关闭，需自行勾选“开启模型分析”并保存。LLM 与本地引擎配置分别保存。
6. 回到牌局，确认座位并授权对局信息、四家牌河及自家手牌，开启“调用模型”，选择“综合攻守”，分析当前局面。两个社区 v4 及 Akagi v3 的本项目支持范围为**四人半庄**，请在符合范围的牌局中使用。

v0.15.0 起无需逐次确认半庄，适用范围在设置中提前说明；自动分析仍需主动开启，触发限自家出牌决策点。从 v0.14.0 升级时，请同时更新扩展和本地运行包；旧包内安装目录不会自动迁移。

运行包自带管理所需的 Node，Python／PyTorch 等模型依赖由安装流程按需准备；首次安装仍需联网，失败会明确报错。可以不安装任何模型，也可保留多个已下载模型，**一次只运行一个**。资产默认保存在 `%LOCALAPPDATA%\MajsoulAgent\models`，以后重新解压运行包可复用；旧版包内安装目录不会自动搬迁。VoidShine 无需先下载 Akagi，两个 v4 共用已验证的 CPU 环境。Akagi v3 使用独立的轻量原生运行包，不下载 Python／PyTorch。切换模型后重新连接对应配置，再自行开启分析。

用完在管理页点击“停止分析服务”，或退出运行窗口。仅关闭扩展“调用模型”会停止请求，不会退出本地服务。本地推理在本机完成；开启 LLM 讲解或追问时，授权局面仍会发给你配置的 LLM。自备 mjai 服务仍可在高级配置中手填接口与分析 Token。

[模型管理完整步骤与故障排查](docs/guides/MODEL_MANAGER.md) · [引擎与 LLM 解释](docs/guides/MJAI.md) · [社区 v4 运行说明](docs/guides/MORTAL_V4.md)

## 可选本地模型

| 模型 | 当前定位与范围 |
| --- | --- |
| Akagi v2 附带的旧 Mortal 弱示例 | 保留旧版起步与回归路径 |
| [VoidShine/mortal-298k](https://huggingface.co/VoidShine/mortal-298k) | 社区 Mortal v4，四人半庄；作者不推荐排位 |
| [Yuchen1457/mortal-582500](https://huggingface.co/Yuchen1457/mortal-582500) | 社区 Mortal v4，本项目支持范围为四人半庄 |
| Akagi v3 原生模型 | 实验可选，四人半庄；约 2.64 MB 权重，独立 CPU 运行包，无需 Python |

前三项不是官网 Mortal 4.1。Akagi v3 是另一套行为克隆模型，采用 Rust 本地推理，不能因版本号更新就推断牌力更强。详细范围与规则适配见 [v3 验收](docs/validation/AKAGI_V3_VALIDATION.md)。

## 支持范围与数据

目前适配 `game.maj-soul.com`，扩展界面为简体中文。其他地区域名、Firefox、Safari 与 Steam 桌面端尚未适配；英文、日文 README 不代表相应游戏服已受支持。

模型输入限于授权的自家手牌、公开桌面与已采集历史，不发送对手暗牌、账号凭据或未来事件。API Key、讨论和用量保存在扩展本地；讨论受容量限制，不提供云同步或永久保存保证。项目没有中转服务器或遥测上传。[数据与权限](SECURITY.md) · [会话与用量](docs/guides/AGENT_SESSIONS.md)

Akagi v3 已完成固定权重与专用运行包的在线空目录安装、真实推理及四模型切换；浏览器人工局面的手动／自动分析与模拟 LLM 解释联调通过。两个社区 v4 已完成真实固定权重加载、四座位人工局面、合成 HTTP→Agent 和关键动作对照。本机已验证官方 Python 与固定依赖下载，但 Hugging Face 权重在线下载未完成；完整模型离线安装已验证。真实网页整场、断线恢复、实战牌力及付费 LLM 教学质量仍待验证。LLM 讲解是基于局面与结果的解释，不是模型内部思考的还原。[验证总览](VALIDATION.md) · [v4 验收](docs/validation/MORTAL_V4_VALIDATION.md)

历史 LLM 事实质量与费用实验保留在 [事实增强验收](docs/benchmark/XF_VALIDATION.md) 和 [模型实验](docs/benchmark/MODEL_BENCHMARK.md)，不代表新社区模型的牌力或收益承诺。

## 开发与文档

开发需要 Node.js 22.19+；只加载普通扩展 ZIP 不需要。

```sh
npm ci
npm run check
npm test
npm run build
```

Agent 使用适配 Manifest V3 的 Pi Agent 运行时，通过只读工具读取冻结的授权局面；采集与分析以标准合同分层，Collector 保持独立。

[文档入口](docs/README.md) · [架构](ARCHITECTURE.md) · [模块解耦](docs/development/DECOUPLING.md) · [贡献](CONTRIBUTING.md) · [更新记录](CHANGELOG.md) · [参考索引](docs/REFERENCES.md)

项目源码与 37 张原创 SVG 牌面采用 [MIT 许可证](LICENSE)。可选模型、原生组件和上游源码分别适用自身许可。[第三方公告](THIRD_PARTY_NOTICES.md) · [许可来源](licenses/SOURCES.md)
