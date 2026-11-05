# 文档导航

发布入口已对齐 **v0.16.2（2026-11-05）**；源码版本以所在检出的 `package.json` 为准。本文区分使用说明、固定范围的验收、历史研究和实施方案。专题文档以简体中文维护，三语安装入口见[项目首页](../README.md)。

## 目录与兼容入口

| 目录／文件 | 内容 |
| --- | --- |
| `guides/` | 配置、会话、输入、记忆及本地引擎的使用说明 |
| `development/` | 目录结构、架构补充、模块边界、运行时与发布 |
| `benchmark/` | 实验操作、数据合同、执行器实施记录与历史结果 |
| `research/` | 生态研究、选型调查、实施方案与开发历史 |
| `validation/` | 专项验收正文与现有机器可读记录 |
| `images/` | 公开文档图片，保持原路径 |
| `REFERENCES.md` | 持续维护的参考关系与接入边界索引 |

旧版平铺的 Markdown 路径仅保留跳转和原章节锚点，当前正文以本文链接的新目录为准。原研究 CSV／JSON 与来源锁保持原路径，避免破坏外部数据链接；本地私有研究仍在仓库根目录的 `research/`，与公开的 `docs/research/` 分开管理。

## 按任务开始

| 你要做什么 | 从这里开始 | 接着看 |
| --- | --- | --- |
| 安装扩展、使用自己的 LLM | [项目介绍与安装](../README.md) | [模型配置与诊断](guides/MODEL_CONFIGURATION.md) |
| 安装本地模型、连接扩展 | [本机模型管理](guides/MODEL_MANAGER.md) | [社区 Mortal v4](guides/MORTAL_V4.md)；自备引擎看 [mjai 接入](guides/MJAI.md) |
| 理解实时分析与历史追问 | [会话、工具与用量](guides/AGENT_SESSIONS.md) | [X-F 主路径](guides/XF_CONTEXT.md) → [NED 回退](guides/NED_CONTEXT.md) |
| 确认哪些功能真正测过 | [项目验证记录](../VALIDATION.md) | 下方“验证与兼容范围”的专项记录 |
| 开始新的模型／上下文实验 | [自主 benchmark](benchmark/BENCHMARK_AUTONOMOUS.md) | [数据合同与旧命令](benchmark/BENCHMARK.md) |
| 修改源码、检查模块职责 | [贡献指南](../CONTRIBUTING.md) | [目录结构](development/PROJECT_STRUCTURE.md) → [项目架构](../ARCHITECTURE.md) |
| 查同类产品、模型来源和选型 | [参考项目与接入边界](REFERENCES.md) | [生态综合研究](research/RIICHI_ECOSYSTEM_RESEARCH.md) |

## 文档状态与版本口径

| 类型 | 阅读规则 |
| --- | --- |
| 使用说明 | 当前流程的操作入口；旧版本号可能表示功能引入时间，安装下载统一从项目首页进入 |
| 验收记录 | 仅证明所列提交、资产、平台和样本范围；后续补充保留原失败与未验证项 |
| 历史研究 | 保留调研日期和当时结论；“尚未实现”不能直接作为当前功能状态 |
| 实施方案 | 保留设计依据、阶段目标与实施更新；完成情况查关联验收，操作查使用说明 |
| 跳转入口 | 保留旧链接，正文仅在目标文档维护 |

当前发布记录见 [CHANGELOG](../CHANGELOG.md)，本地开发与已发布结果通过[验证总览](../VALIDATION.md)区分。专业引擎、真实 LLM 教学、真实整场与断线恢复分别验收，不能互相替代。

## 使用与配置

| 文档 | 职责 |
| --- | --- |
| [模型配置与手动诊断](guides/MODEL_CONFIGURATION.md) | Chat 配置、接口诊断、Magpie／CC Switch 可选网关 |
| [小局会话、工具与用量](guides/AGENT_SESSIONS.md) | 授权、实时与手动通道、冻结追问、预算及未知费用；上下文关系总入口 |
| [X-F 实时输入](guides/XF_CONTEXT.md) | 完整四麻自动综合分析的事实投影、确定性比较和适用门槛 |
| [NED 回退输入](guides/NED_CONTEXT.md) | 其他任务及不满足 X-F 条件的实时输入合同 |
| [整场记忆学习](guides/USER_MEMORY.md) | 默认关闭的用户记忆、覆盖要求与学习边界 |
| [本机模型管理](guides/MODEL_MANAGER.md) | 四模型便携包的安装、配对、单模型启停、切换和删除；普通用户本地引擎入口 |
| [社区 Mortal v4](guides/MORTAL_V4.md) | 两个社区 v4 的固定来源、范围与开发命令；通用管理操作以上一篇为准 |
| [可选 mjai 本地引擎](guides/MJAI.md) | 自备引擎 HTTP／mjai 接入、动作与解释合同；保留固定 v2 旧命令路径 |
| [可选 NAGA 导出](guides/NAGA-INTEGRATION.md) | 本地转换、规则确认及用户自行提交 |

## 开发与维护

| 文档 | 职责 |
| --- | --- |
| [项目目录结构](development/PROJECT_STRUCTURE.md) | 文件位置、新增文件归属、本地数据与构建产物 |
| [贡献指南](../CONTRIBUTING.md) | 环境准备、修改入口、检查命令和多语言维护 |
| [项目架构](../ARCHITECTURE.md) | 模块职责与采集、Chat、引擎数据流 |
| [Agent 与 harness](development/AGENT.md) | 获取器、任务计划、有界执行与离线复盘 |
| [可执行的模块边界](development/DECOUPLING.md) | 两种 profile、组合入口与依赖／资源闭包 |
| [Pi 浏览器运行时](development/pi-runtime.md) | 固定上游、MV3 适配、bundle 构建与升级 |
| [发布与打包](development/PUBLISHING.md) | 干净提交快照、安装包、源码包与发布核对 |
| [安全与数据处理](../SECURITY.md) | 凭据、授权、存储与漏洞报告 |
| [第三方公告](../THIRD_PARTY_NOTICES.md) · [运行库来源](../licenses/SOURCES.md) · [牌面来源](../extension/tiles/SOURCE.md) | 许可、固定来源与素材边界 |
| [Akagi native 源码](../engines/akagi-native/README.md) · [补丁说明](../engines/akagi-native/PATCHES.md) | 独立原生推理的构建与本地修改 |

## 基准测试与历史结果

| 文档 | 类型与范围 |
| --- | --- |
| [自主 benchmark](benchmark/BENCHMARK_AUTONOMOUS.md) | **使用说明**：新实验的启动、冻结、监督、恢复、预算与独立评审 |
| [benchmark 基础说明](benchmark/BENCHMARK.md) | **合同参考**：数据结构、人工示例及旧 `run/resume`；不替代新实验入口 |
| [执行器改进计划与实施记录](benchmark/BENCHMARK_EXECUTION_IMPROVEMENT_PLAN.md) | **实施记录**：2026-10-30 至 31 的设计与完成状态 |
| [X-F 公开汇总与移植验证](benchmark/XF_VALIDATION.md) | **历史结果**：同一牌谱四局 45 点的比较与局限；附[来源锁](xf-provenance.json) |
| [早期 DeepSeek 小样本](benchmark/MODEL_BENCHMARK.md) | **历史结果**：39 点记录；模型与价格不作当前推荐，不与其他批次直接排名 |

真实牌谱、私有配置、费用账本和冻结原始证据留在本地忽略目录；公开示例为人工数据。执行完成、质量评审与账单核对分别报告，参考首选一致不等于胜率或牌力。

## 验证与兼容范围

| 文档 | 固定范围与主要限制 |
| --- | --- |
| [项目验证记录](../VALIDATION.md) | 各版本结果及开发期补充的总入口 |
| [规则差分与事件核查](validation/RULES_EVENTS_VALIDATION.md) | 2026-11-05：1,012 组规则样本与固定协议合成回归；真实事件／整场重连暂缓，快照恢复不支持 |
| [Akagi v3 验收](validation/AKAGI_V3_VALIDATION.md) | v0.16.0：固定原生模型、在线空目录安装、共有样本与浏览器人工联调；未验真实整场与牌力 |
| [社区 Mortal v4 验收](validation/MORTAL_V4_VALIDATION.md) | v0.14.0 起的固定权重、人工 HTTP／动作对照与管理补充；社区权重在线安装全链路未通，真实整场与牌力未验 |
| [Mortal 工作流验收](validation/MORTAL_WORKFLOW_VALIDATION.md) | v0.13.0：动作／解释分离、固定 v2 人工推理与有限旧报告导入；后续模型另查上述专项 |
| [Magpie 联调](validation/MAGPIE_VALIDATION.md) · [机器记录](validation/magpie-v0.1.2204.json) | 固定官方程序＋本地人工上游，不证明真实云模型质量 |
| [CC Switch 联调](validation/CC_SWITCH_VALIDATION.md) · [机器记录](validation/cc-switch-v4.0.22.json) | 固定版本的目录与路由，不构成全面兼容认证 |

## 研究、方案与历史

| 文档 | 状态及当前入口 |
| --- | --- |
| [参考项目与已确认边界](REFERENCES.md) | **持续维护索引**：第三方关系与接入范围，详细结论回到专项验收 |
| [生态综合研究](research/RIICHI_ECOSYSTEM_RESEARCH.md) | **历史研究**：2026-11-04、v0.13.0 对照；已合并五项目对标与追问源码证据 |
| [模型网关研究](research/MODEL_GATEWAY_RESEARCH.md) | **研究与实施记录**：固定版本协议依据；操作见模型配置，结果见网关验收 |
| [Mortal 后端研究](research/MORTAL_INTEGRATION_RESEARCH.md) | **历史研究**：2026-10-30；后续已提供有限工作流与社区模型，操作见模型管理／mjai |
| [Mortal＋LLM 产品适配](research/MORTAL_LLM_PRODUCT_ADAPTATION.md) | **历史方案**：部分目标已在 v0.13.0 落地，原缺口表不能当当前待办 |
| [官方 Mortal 复盘研究](research/OFFICIAL_MORTAL_REPLAY_RESEARCH.md) | **历史研究**：官方入口与有限旧报告适配，不表示支持当前全部线上报告 |
| [VoidShine Mortal v4 方案](research/VOIDSHINE_MORTAL_V4_IMPLEMENTATION_PLAN.md) | **实施方案与记录**：v0.14.0 起已提供实验能力；操作与结果见模型管理／v4 验收 |
| [Akagi v3 方案](research/AKAGI_V3_MODEL_IMPLEMENTATION_PLAN.md) | **实施前快照＋完成说明**：v0.16.0 已提供第四模型，结果见 v3 验收 |
| [版本变更](../CHANGELOG.md) | **发布历史**：逐版本变化 |
| [开发历史迁移](research/HISTORY.md) | **历史记录**：2026-10-23 仓库迁移与历史净化 |

[五项目对标旧入口](RIICHI_FIVE_PROJECTS_COMPARISON.md)与[追问专项旧入口](RIICHI_CHAT_SUPPORT_RESEARCH.md)仅保留跳转，正文在生态综合研究维护。本地研究目录、浏览器测试目录及旧发布副本不作为当前文档入口。

## 文档维护约定

- 安装与功能概述在三语 README 维护；专题保留各自合同与操作，其他位置用链接引用。
- 新增专题按用途放入对应分类并补入本文；目录职责变化同步目录结构，模块关系变化同步架构。
- 研究、方案、验收写清日期、基线、状态和未验证范围；后续实现通过顶部状态说明更新，保留历史结果与失败证据。
- 发布版本、源码版本、功能引入版本与固定验收版本分别表述；更新安装入口同步三语首页，历史样本与旧发布链接不批量替换。
- 新实验从自主 benchmark 进入；旧实验沿冻结合同恢复，不因文档整理改变重试、评分或预算。
- 公开图片与机器记录放入 `docs/images/` 和 `docs/validation/`；真实牌谱、私有需求与模型资产不移入公开文档。
- 旧路径尽量保留；合并后只维护一份正文，检查文件链接、标题锚点与导航覆盖。
