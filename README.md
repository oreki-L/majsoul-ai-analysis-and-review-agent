# Majsoul Agent

**看懂每一次取舍，围绕同一个决策继续追问。**

当前版本：**0.14.0**

[简体中文](README.md) | [English](README.en.md) | [日本語](README.ja.md)

面向雀魂网页版的 AI 分析助手。接入你自己的 LLM API，查看建议、候选与攻守依据，再问“为什么不打另一张？”“这巡该不该降速？”。每个决策保留冻结局面与独立讨论；新建议到来后，仍能回到原来的问题继续聊。

[**下载 v0.14.0**](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/tag/v0.14.0) · [快速开始](#快速开始) · [本地模型管理](docs/MODEL_MANAGER.md)

![自由悬浮分析卡，使用人工局面与模拟模型响应](docs/images/agent-floating-preview.png)

## 用具体局面理解麻将

| 你想做什么 | 助手提供什么 |
| --- | --- |
| 看懂当下的选择 | 首选、候选与解释，结合本地向听、进张和逐家危险证据 |
| 连续追问一个决策 | 固定当时的手牌、桌面与原建议，保留独立讨论，刷新后可恢复 |
| 回到之前那一巡 | 打开已记录决策，查看当时局面并继续问，不混入新的实时局面 |
| 让专业引擎先决策 | 可选本地引擎给出经校验动作，再由 LLM 解释；解释失败可单独重试 |
| 只记录、不调用模型 | 独立获取器提供采集、展示、结算历史与导出 |

**普通 LLM 流程可独立运行，无需下载 Mortal、Python 或原生工具包。** 采集直接由浏览器扩展完成，不用配置 CDP、远程调试或系统代理。模型与自动分析默认关闭；不接 API 也可使用本地计算。项目不自动打牌。

## 快速开始

1. 下载并解压 [完整 Agent](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/download/v0.14.0/majsoul-ai-analysis-and-review-agent-0.14.0.zip)。在 Edge 的 `edge://extensions` 或 Chrome 的 `chrome://extensions` 开启开发者模式，加载解压后直接包含 `manifest.json` 的文件夹。
2. 刷新 `https://game.maj-soul.com/`，让扩展在游戏连接建立前加载，再进入牌局。打开分析卡的“分析设置 → 模型设置”。
3. 填写支持 tools 的 **OpenAI Chat Completions 兼容接口**、模型 ID 和自己的 API Key，开启模型分析、保存并授予接口权限。例如接口可填 `https://api.openai.com/v1/chat/completions`。
4. 在牌局面板确认自家座位与信息授权，开启“调用模型”，手动分析当前局面。需要时再开启自动分析；对某个建议发送追问，即可保留该决策的讨论。

云端 API、兼容网关和本机 Chat Completions 服务均可自配；Magpie 与 CC Switch 是可选入口。配置、思考参数、费用和连接诊断见 [模型配置](docs/MODEL_CONFIGURATION.md)。模型调用可能收费，内容会发送到你配置的服务。

当前游戏域名仅适配 `game.maj-soul.com`，界面为简体中文。其他地区域名、Firefox、Safari 与 Steam 桌面端未适配；英文、日文 README 不代表相应游戏服已受支持。同一游戏页面只启用 Agent 或 Collector 其中一个。

## 下载

| 安装内容 | 适合谁 |
| --- | --- |
| [完整 Agent · v0.14.0](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/download/v0.14.0/majsoul-ai-analysis-and-review-agent-0.14.0.zip) | 分析、追问、手牌提示、模型设置；包含获取器 |
| [独立 Collector · v0.14.0](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/download/v0.14.0/majsoul-collector-0.14.0.zip) | 只采集、展示、历史与导出；不含模型代码和模型主机权限 |
| [本地模型管理工具包 · Windows x64 · v0.14.0](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/download/v0.14.0/majsoul-model-manager-windows-x64-0.14.0.zip) | 选择使用本地麻将引擎的用户；普通 LLM 流程不需要 |
| [源码 · v0.14.0](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/download/v0.14.0/majsoul-ai-analysis-and-review-agent-source-0.14.0.zip) | 开发、检查、构建与离线复盘 |

[发布页与 SHA-256 校验文件](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/tag/v0.14.0)。两个扩展包不包含权重、Python 或原生模型库。Collector 与 Agent 的本地存储独立，不自动迁移。

## v0.14.0：按需管理本地模型

可选本地引擎现在有独立管理页：按需安装、显式启停，保留已安装模型以便切换，也可删除不再需要的权重。**可以保持零模型；安装不会启动推理，一次只运行一个模型。** 已安装模型可直接切换并启动。

| 模型 | 本期定位 |
| --- | --- |
| Akagi v2 Mortal 弱示例 | 保留旧版起步与回归路径 |
| [VoidShine/mortal-298k](https://huggingface.co/VoidShine/mortal-298k) | 实验社区 Mortal v4，四人半庄；作者不推荐排位 |
| [Yuchen1457/mortal-582500](https://huggingface.co/Yuchen1457/mortal-582500) | 实验社区 Mortal v4，保守限制四人半庄 |

需要本地引擎时，另下载管理工具包，准备 Node.js 22.19+，运行包内 `start.cmd`，再在浏览器打开终端显示的本机地址。输入管理 Token、安装所选模型、明确启动，然后将生成的分析接口与**分析 Token** 填入扩展对应配置。管理 Token 与分析 Token 分开使用。[完整步骤](docs/MODEL_MANAGER.md)

工具包默认不含权重或完整 Python；用户点击安装后才准备所选权重与必要环境。VoidShine 无需先安装 Akagi，两个 v4 模型共享已验证的 CPU 环境。切换扩展配置会关闭分析，其他已安装资产保留。扩展不能直接启动本机程序，也不设置自启。

本地引擎可单独给出动作，也可使用“本地 Mortal 决策 + LLM 自动解释”：动作先经校验显示，LLM 只附加解释，冻结追问无需重跑引擎。两个 v4 模型当前仅支持**逐次手动确认四人半庄**，暂不支持自动分析。[引擎与解释配置](docs/MJAI.md) · [v4 运行说明](docs/MORTAL_V4.md)

## 数据与验证边界

授权输入包括自家手牌、公开桌面与已采集的小局历史，不把对手暗牌、账号凭据或未来事件发给分析服务。API Key、讨论与用量保存在扩展本地；讨论有容量上限，不提供云同步或永久保存保证。关闭模型调用后仅运行本地计算。详见 [数据与权限](SECURITY.md)、[会话与用量](docs/AGENT_SESSIONS.md)。

当前完整实时协议、断线恢复及实战建议质量仍待验证。社区 v4 已完成固定权重严格加载、四座位人工局面、合成 HTTP→Agent 与关键动作对照；这些不是整场实战或牌力证明，Mortal v4 架构也不等于官网 Mortal 4.1。[验证总览](VALIDATION.md) · [v4 验收](docs/MORTAL_V4_VALIDATION.md)

历史 LLM 的 45 点事实质量评审和 39 点费用／MAKA 对照分别保留在 [事实增强验收](docs/XF_VALIDATION.md) 与 [模型实验](docs/MODEL_BENCHMARK.md)。它们采用旧实验条件，不是 v0.14.0 或新社区模型的效果、速度、费用承诺；首选一致率不等于正确率或胜率。

## 开发与文档

开发需要 Node.js 22.19+；只加载扩展 ZIP 不需要 Node.js。

```sh
npm ci
npm run check
npm test
npm run build
```

Agent 使用适配 Manifest V3 的 Pi Agent 运行时，Collector 保持独立；采集数据经标准合同交给分析层。详细实现、离线复盘、记忆学习与可选 NAGA 流程见文档。

[文档入口](docs/README.md) · [架构](ARCHITECTURE.md) · [模块解耦](docs/DECOUPLING.md) · [贡献](CONTRIBUTING.md) · [更新记录](CHANGELOG.md) · [参考索引](docs/REFERENCES.md)

项目源码与 37 张原创 SVG 牌面采用 [MIT 许可证](LICENSE)。可选模型、原生组件和上游源码分别适用其自身许可，不能由本项目 MIT 声明覆盖。[第三方公告](THIRD_PARTY_NOTICES.md) · [许可来源](licenses/SOURCES.md)
