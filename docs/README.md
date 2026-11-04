# 文档导航

本文按用途整理当前 v0.15.0 的公开文档。首次使用从[项目介绍与安装](../README.md)开始；查文件位置看[项目目录结构](PROJECT_STRUCTURE.md)，查组件关系看[项目架构](../ARCHITECTURE.md)。补充技术文档目前以简体中文维护。

## 使用与配置

| 文档 | 适合解决的问题 |
| --- | --- |
| [模型配置与手动诊断](MODEL_CONFIGURATION.md) | 保存与切换 Chat 配置、接口诊断、可选 Magpie / CC Switch 网关 |
| [小局会话、工具与用量](AGENT_SESSIONS.md) | 授权范围、实时与手动历史、调用预算、缓存和未知费用 |
| [X-F 实时输入](XF_CONTEXT.md) | 当前完整四麻自动综合分析发送哪些事实、何时回退 |
| [NED 回退输入](NED_CONTEXT.md) | 其他实时任务保留的导航、效率与防守输入 |
| [整场记忆学习](USER_MEMORY.md) | 默认关闭的学习开关、可靠覆盖门槛与本机记忆 |
| [可选 mjai 本地引擎](MJAI.md) | 自备引擎、Akagi 弱示例、HTTP 桥接和 Mortal 教学模式 |
| [本机模型管理](MODEL_MANAGER.md) · [社区 Mortal v4](MORTAL_V4.md) | 可选便携运行包、免复制连接、三模型按需安装／删除与单模型启停；v4仅用于四人半庄；v0.15.0 提供便携流程 |
| [可选 NAGA 导出](NAGA-INTEGRATION.md) | 牌谱本地转换、规则确认与用户自行提交 |

## 开发与维护

| 文档 | 内容 |
| --- | --- |
| [项目目录结构](PROJECT_STRUCTURE.md) | 源码、脚本、测试、文档和本地生成目录的职责与归属 |
| [贡献指南](../CONTRIBUTING.md) | 环境准备、修改入口、验证命令与多语言维护 |
| [项目架构](../ARCHITECTURE.md) | 模块职责和采集、Chat、引擎数据流 |
| [Agent 与 harness](AGENT.md) | 获取器、任务计划、有界执行与离线复盘 |
| [可执行的模块边界](DECOUPLING.md) | 两种 profile、组合入口、依赖与资源闭包检查 |
| [Pi 浏览器运行时](pi-runtime.md) | 固定上游、MV3 适配、bundle 生成与升级检查 |
| [发布与打包](PUBLISHING.md) | 干净提交快照、源码及安装 ZIP、发布核对 |
| [安全与数据处理](../SECURITY.md) | 凭据、授权、存储和漏洞报告 |
| [第三方来源](../THIRD_PARTY_NOTICES.md) · [运行库来源](../licenses/SOURCES.md) · [牌面来源](../extension/tiles/SOURCE.md) | 许可证、固定来源与素材边界 |

## 基准测试与结果

社区v4的真实权重、官方对照、性能、许可和未测范围见 [MORTAL_V4_VALIDATION.md](MORTAL_V4_VALIDATION.md)。

| 文档 | 内容与适用范围 |
| --- | --- |
| [自主 benchmark](BENCHMARK_AUTONOMOUS.md) | 新实验的冻结、监督、持久化、预算与独立评审流程 |
| [benchmark 基础说明](BENCHMARK.md) | 数据合同、合成示例及保留的旧 run/resume 流程 |
| [X-F 公开汇总与移植验证](XF_VALIDATION.md) | 同一牌谱四局45点的同期比较、局限及发布移植来源；[来源锁](xf-provenance.json) |
| [早期 DeepSeek 小样本](MODEL_BENCHMARK.md) | 历史39点记录，不能与后续不同输入或标签的批次直接排名 |
| [执行器改进计划与实施记录](BENCHMARK_EXECUTION_IMPROVEMENT_PLAN.md) | 2026-10-30 至 31 的计划及完成状态；操作以自主 benchmark 文档为入口 |

真实局面、回答、私有配置、费用账本与冻结原始证据放在本地忽略目录，不是公开复现素材。公开示例使用人工数据；结构有效、参考首选一致和质量通过分别报告，均不等于胜率或跨牌谱牌力。

## 验证与兼容范围

| 文档 | 已记录的验证 |
| --- | --- |
| [项目验证记录](../VALIDATION.md) | 按版本记录测试、浏览器与未验证范围 |
| [社区 Mortal v4 真实验收](MORTAL_V4_VALIDATION.md) | v0.14.0固定权重、严格加载、人工HTTP／官方对照与三模型离线管理；在线下载全链路、真实整场及牌力未验证 |
| [Mortal 工作流验收](MORTAL_WORKFLOW_VALIDATION.md) | v0.13.0 动作与解释分离、限定本地推理及旧报告导入 |
| [Magpie 联调](MAGPIE_VALIDATION.md) · [机器可读记录](validation/magpie-v0.1.2204.json) | 固定官方程序与本地人工上游，未验证真实云模型质量 |
| [CC Switch 联调](CC_SWITCH_VALIDATION.md) · [机器可读记录](validation/cc-switch-v4.0.22.json) | 固定版本的网关、目录与路由边界 |

## 研究与历史

| 文档 | 阅读时的状态 |
| --- | --- |
| [参考项目与已确认边界](REFERENCES.md) | 第三方对标、兼容与模型选型的统一入口；研究线索不等于已接入 |
| [雀魂与立直麻将生态调研](RIICHI_ECOSYSTEM_RESEARCH.md) | 2026-11-04 的同类助手、LLM 教学、规则库、引擎、模拟器与评测研究；附元数据和来源索引 |
| [五个日麻助手的对标与差异化](RIICHI_FIVE_PROJECTS_COMPARISON.md) | 五个重点项目的能力、优势、可借鉴方向和本项目优先级 |
| [追问与对话能力核查](RIICHI_CHAT_SUPPORT_RESEARCH.md) | 固定提交核对聊天 UI、问答接口、历史传递、QQ 教学与外部提示词导出 |
| [网关接入研究](MODEL_GATEWAY_RESEARCH.md) | Magpie / CC Switch 的研究依据；实际配置见上方使用文档 |
| [Mortal 后端研究](MORTAL_INTEGRATION_RESEARCH.md) | 保留调研时点结论，当前能力以工作流验收为准 |
| [VoidShine Mortal v4 接入方案](VOIDSHINE_MORTAL_V4_IMPLEMENTATION_PLAN.md) | 历史设计与实施范围；已实现的两个社区v4及保留v2以当前使用文档和验收记录为准 |
| [Akagi v3 模型接入方案](AKAGI_V3_MODEL_IMPLEMENTATION_PLAN.md) | 按 v0.14.0 重审的第四可选项计划；统一管理、独立按需 native runtime；仅文档，未接入或完成真实推理验收 |
| [Mortal + LLM 产品适配研究](MORTAL_LLM_PRODUCT_ADAPTATION.md) | 历史方案建议，不作为当前实现清单 |
| [官网 Mortal 复盘研究](OFFICIAL_MORTAL_REPLAY_RESEARCH.md) | 官网入口与报告适配可行性；未验证范围保留 |
| [版本变更](../CHANGELOG.md) | 逐版本功能变化 |
| [开发历史迁移](HISTORY.md) | 2026-10-23 的仓库迁移与历史净化记录 |

## 文档维护约定

- 安装和功能概述在三语 README 中维护；细节链接到对应专题，不在多个入口复制完整合同。
- 新增专题补入本索引；目录职责变化同步目录结构，模块关系变化同步架构。现有专题路径保留，便于旧链接继续使用。
- 研究、计划和验证文档写明日期、实现状态及验证范围；历史结果保留原样，通过链接指向当前说明。
- `docs/images/` 存放公开文档图片，`docs/validation/` 存放可公开验证记录；真实牌谱、私有需求和模型资产不移入文档目录。
