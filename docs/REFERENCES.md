# 参考项目与已确认边界

参考关系记录于 2026-10-26；发布版本标识于 2026-10-30 同步为 **v0.11.0**。本文件集中保留用户提及的参考对象、后续补充研究与项目取舍，供其他会话接续；它不是第三方背书、兼容认证或模型能力排名。下列“已接入”仅指明确描述的范围，不表示所有上游版本、模型和线上服务均可用。

## 产品方向与共同边界

项目以**纯 LLM 运行时和可追问的实时建议**为重心，复盘为辅助，独立获取器保持独立。这里的“纯 LLM”不排斥本地向听、进张与危险证据工具，但不要求 Mortal 等专业引擎才能运行。

Pi 是当前实际运行依赖；DeepSeek Harness 是设计参考。mjai 专业引擎和 NAGA 均为默认关闭的可选能力。当前每次分析在 `chat` 与 `mjai` 中二选一，尚无“专业引擎决策 + LLM 联合解释”的自动管线。已保存的引擎决策可切回 `chat` 后追问，不等于同时调用两个后端。

不能把框架开源等同于权重、在线 API 或服务额度开放；不能把本地人工局面验证等同于真实整场协议兼容或实战牌力；不能把与线上参考首选一致称为建议正确率。

## 用户提及的参考对象

| 对象与可靠入口 | 定位及借鉴点 | 当前接入状态 | 未核实事项与限制 |
| --- | --- | --- | --- |
| [牌谱屋](https://amae-koromo.sapk.ch/) | 用户提供的雀魂牌谱／统计参考入口；可研究牌谱检索、样本组织与统计展示 | 未作为本项目采集器、数据源或运行依赖接入 | 未确认完整覆盖范围、批量获取接口、采集权限及再分发条件；不能据“公开可见”推定可批量采集或用于训练 |
| [shinkuan/Akagi](https://github.com/shinkuan/Akagi) | 本地专业引擎与游戏协议桥接参考；借鉴运行准备、事件到 mjai 的边界和模型接入方式 | v0.10.0 提供固定 v2 弱 Mortal 示例的下载校验、真实推理检查和本地桥接起步路径 | 已测仅固定提交 [`91cc2993e4e3682248d33d73d93afe055040e700`](https://github.com/shinkuan/Akagi/tree/91cc2993e4e3682248d33d73d93afe055040e700)、Windows x64／Python 3.11 组合；不是线上 Mortal 4.1，不证明其他版本或牌力。上游程序与权重不随扩展分发；该提交为 AGPLv3 加 Commons Clause，具体文件及环境见 [MJAI.md](MJAI.md) |
| [Equim-chan/mjai-reviewer](https://github.com/Equim-chan/mjai-reviewer) | mjai 牌谱分析与专业模型生态参考；可研究复盘输入、动作结果及报告组织 | 未作为依赖或在线后端接入；不提供其模型或权重 | 在线接口、当前模型可用性、调用授权、费用和权重取得条件未确认；不把其支持模型清单当作本项目兼容清单 |
| [Equim-chan/Mortal](https://github.com/Equim-chan/Mortal)；[issue #116](https://github.com/Equim-chan/Mortal/issues/116) | 专业日麻模型框架与上游讨论参考；用于厘清框架、权重与可用接口的区别 | 本项目的可选 mjai 合同可承接满足协议和合法性校验的用户引擎；限定真实验证使用 Akagi 的弱示例，不是任意 Mortal 权重 | 开源框架不等于可自由取得全部权重或公共 API。issue 是讨论线索，不当作永久服务承诺；其他权重、版本、运行环境及许可需分别确认 |
| [tzp1021/mj_helper](https://github.com/tzp1021/mj_helper) | 采集、CDP／WebSocket、协议解析与状态机分层，以及开源仓库组织参考 | 本项目采用浏览器扩展采集与独立 Agent／collector 分层；未捆绑其 Python 决策引擎、训练数据或报告 | 未宣称与其客户端适配、决策实现或牌力等价；其代码许可不能被本项目 MIT 声明覆盖 |
| 开源 Pi：[earendil-works/pi](https://github.com/earendil-works/pi)，固定 [v1.4.0](https://github.com/earendil-works/pi/tree/v1.4.0) | 轻量 Agent loop、工具声明、参数校验、工具执行与事件运行时 | 实际分发 `@earendil-works/pi-agent-core@1.4.0` 和 `@earendil-works/pi-ai@1.4.0` 的审计后浏览器代码；作 MV3／CSP 适配，collector 不含 Pi | 不等于接入 Pi 全部原生 provider SDK。当前 canonical 依据 npm 与许可证来源使用 earendil-works/pi；不将未经核对的旧 pi-mono 地址当唯一来源。固定来源与许可见 [licenses/SOURCES.md](../licenses/SOURCES.md)，实现见 [pi-runtime.md](pi-runtime.md) |
| DeepSeek Harness：确切仓库／文章 URL **待定位** | 用户提及的 harness 设计参考：把输入准备、工具、运行轨迹与结果校验组织起来 | 仅设计参考，不是运行依赖；本项目自己的有界 harness 配合实际 Pi loop | 当前上下文没有足够可靠的 canonical URL，不编造地址；也不将它等同于 DeepSeek 模型 API 或声称移植其实现 |
| 独立 NAGA：[官方提交页](https://naga.dmv.nico/naga_report/order_form/) | 外部专业复盘服务；借鉴牌谱导出、选局预览和用户自行提交的工作流 | 默认关闭，仅完整版提供本地转换、预览、复制／下载与官方页入口 | 没有接入账号、自动上传、扣费、任务轮询或报告回读；导出成功不代表官方受理。当前模型、额度、价格和服务条件以官方页面为准，见 [NAGA-INTEGRATION.md](NAGA-INTEGRATION.md) |
| 雀魂内置 MAKA：本文件未确认独立 canonical URL | 游戏内首选建议参考，用于对照 LLM 输出；与独立 NAGA 是不同对象 | 已有同一场牌谱 39 个决策点的小样本对照；MAKA 首选一致 16/39，仅作参考 | 历史沟通曾使用 nano／nago／naga 称呼，**本次基准实际为 MAKA**，不能把这些名称混用。39 点统计保留当时未全量人工核验的标签快照，未按后续更正标签重评分；一致率不是正确率、胜率或牌力。没有 MAKA API 接入，详见 [MODEL_BENCHMARK.md](MODEL_BENCHMARK.md) |
| 用户提及的“mjai bot 在线服务”：确切 URL **待定位** | 可能的托管专业引擎入口线索 | 未确认身份，未接入或作为产品依赖 | 不根据名称猜测网站，不编造当前模型列表；需先确认具体服务、协议、授权、费用与数据处理边界 |

## 后续研究补充资料

以下由助手在研究中补充，不全部归为用户亲自提供，也不因此视为已获许可或已接入。

| 对象与入口 | 定位及借鉴点 | 当前接入状态 | 未核实事项与限制 |
| --- | --- | --- | --- |
| [honvl/Majsoul-to-NAGA](https://github.com/honvl/Majsoul-to-NAGA) | 雀魂到 NAGA 的导出流程与输出边界参考 | 本项目独立实现转换器，未移植其转换／提交代码，不作运行依赖 | 不保证参考项目当前客户端兼容或官方服务受理；其许可与本项目分开处理 |
| [AsaChiri/majsoul-naga](https://github.com/AsaChiri/majsoul-naga) | 雀魂牌谱转为 NAGA 所需输入的流程参考 | 仅研究流程与输出边界，未引入其实现或账号素材 | 不据其历史功能推定本项目已有自动提交或报告读取 |
| [Avenshy/mahjong-helper-majsoul-mitmproxy](https://github.com/Avenshy/mahjong-helper-majsoul-mitmproxy) | Liqi 消息封装和字段定义研究 | 本项目使用独立最小 wire reader，未捆绑其代码、proto 文件或生成代码 | GPL-3.0 代码不纳入本项目 MIT 授权；字段线索不证明当前 Unity 全协议兼容 |
| [Avenshy/MajsoulMax](https://github.com/Avenshy/MajsoulMax) | 网页及桌面采集可行性线索 | 未捆绑客户端修改逻辑，不作为运行依赖 | 不把其采集方法或兼容性直接等同于本项目浏览器扩展能力 |
| [matttang27/majsoul-vision](https://github.com/matttang27/majsoul-vision) | 私密早期原型曾使用其中游戏牌面截图，后续用于追踪素材来源 | 公开历史全部提交已移除旧 PNG／ZIP，替换为本项目原创 SVG；不分发其旧素材 | 原素材授权范围未确认，不能将历史使用记录视为再授权；详见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) |

## 可选 Magpie 接入（2026-10-30）

- [yetone/magpie](https://github.com/yetone/magpie)：v0.11.0 提供可选预设、手动身份识别和模型目录，沿用通用 Chat Completions transport；不要求安装，不读取桌面设置或账号。
- 协议参考固定 v0.1.2183、commit `0414bbeddbfc2028508b610fd1e7c194143454a0` 的 [接入规范](https://github.com/yetone/magpie/blob/0414bbeddbfc2028508b610fd1e7c194143454a0/docs/integrating.md) 和 gateway 路由。未完成真实 Magpie／模型端到端验收，不是全面兼容认证；工具诊断、别名、费用和思考参数限制见 [配置与诊断](MODEL_CONFIGURATION.md)。
- 未提供 Magpie 插件或 Agents 注册。

## 可选实验 CC Switch 接入（2026-10-30）

- [farion1231/cc-switch](https://github.com/farion1231/cc-switch)：新增可选实验预设与显式 Codex 目录解析，仅核对正式 v4.0.22、commit `b76426741ef93069e2f374ac01ca7ef5760e1d0e`。共用 Codex 供应商、切换和统计，目录依赖受管理 Codex 配置，不能把其他协议的转换能力直接套用到 Chat 入口。
- 已用官方 v4.0.22 portable 程序与两个本地人工上游完成真实网关链路验证；项目模块使用真实 HTTP 和合成权限。真实云模型、OAuth／订阅和故障转移仍未验证，不作官方适配或全面兼容声明。支持条件、证据与未验证范围见 [配置文档](MODEL_CONFIGURATION.md) 和 [研究记录](MODEL_GATEWAY_RESEARCH.md)。

## 使用此索引时

本文件只保存参考关系与已确认边界，不替代 [第三方公告](../THIRD_PARTY_NOTICES.md)、[许可证来源](../licenses/SOURCES.md)、[验证记录](../VALIDATION.md)，也不替代 [mjai 接入](MJAI.md)、[NAGA 接入](NAGA-INTEGRATION.md) 与 [Pi 运行时说明](pi-runtime.md)。涉及“当前可用”“兼容”“已测”时，以这些详细记录所限定的版本与条件为准。待定位服务和未确认事项在取得可靠来源前继续保留为未知。
