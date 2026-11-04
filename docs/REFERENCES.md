# 参考项目与已确认边界

参考关系始记于 2026-10-26；当前源码版本于 2026-11-04 同步为 **v0.16.0**，历史版本范围保留。本文件集中保留用户提及的参考对象、后续补充研究与项目取舍，供其他会话接续；它不是第三方背书、兼容认证或模型能力排名。下列“已接入”仅指明确描述的范围，不表示所有上游版本、模型和线上服务均可用。

## 产品方向与共同边界

项目以**纯 LLM 运行时和可追问的实时建议**为重心，复盘为辅助，独立获取器保持独立。这里的“纯 LLM”不排斥本地向听、进张与危险证据工具，但不要求 Mortal 等专业引擎才能运行。

Pi 是当前实际运行依赖；DeepSeek Harness 是设计参考。mjai 专业引擎和 NAGA 均为默认关闭的可选能力。v0.13.0 引入的 `mortal-explain` 工作流沿用独立本地 mjai 和 Chat 配置，先校验／保存引擎动作，再通过 Pi 自动解释；动作与解释合同分离，冻结追问及解释重试无需切换后端。v0.14.0 新增默认关闭的三模型按需本机管理：保留 Akagi v2 弱示例，固定 VoidShine298k 与 Yuchen582500 两个社区 v4 已通过真实权重、人工HTTP与官方动作对照；两个v4共享已验环境，限定四人半庄；v0.14.0发布包逐次手动确认，当前源码按用户要求改为提前声明范围、取消逐次勾选，自动仍须主动开启。管理服务启动不下载或推理，详见 [模型管理](MODEL_MANAGER.md) 与 [当前验收](MORTAL_V4_VALIDATION.md)。默认bootstrap实测官方Python及全部固定wheel下载与环境安装成功，随后固定HF权重URL在本机连接失败，在线完整安装链路未通；离线成功不替代在线结果。解释HTTP仍为mock，真实游戏整场、牌力与付费教学质量未验证。官网入口及报告导入继续按版本限定，历史工作流范围见 [v0.13.0验收](MORTAL_WORKFLOW_VALIDATION.md)。

不能把框架开源等同于权重、在线 API 或服务额度开放；不能把本地人工局面验证等同于真实整场协议兼容或实战牌力；不能把与线上参考首选一致称为建议正确率。

## 用户提及的参考对象

| 对象与可靠入口 | 定位及借鉴点 | 当前接入状态 | 未核实事项与限制 |
| --- | --- | --- | --- |
| [牌谱屋](https://amae-koromo.sapk.ch/) | 用户提供的雀魂牌谱／统计参考入口；可研究牌谱检索、样本组织与统计展示 | 未作为本项目采集器、数据源或运行依赖接入 | 未确认完整覆盖范围、批量获取接口、采集权限及再分发条件；不能据“公开可见”推定可批量采集或用于训练 |
| [shinkuan/Akagi](https://github.com/shinkuan/Akagi) | 本地专业引擎与游戏协议桥接参考；借鉴运行准备、事件到 mjai 的边界和模型接入方式 | v0.10.0 提供固定 v2 弱 Mortal 示例的下载校验、真实推理检查和本地桥接起步路径 | 已测仅固定提交 [`91cc2993e4e3682248d33d73d93afe055040e700`](https://github.com/shinkuan/Akagi/tree/91cc2993e4e3682248d33d73d93afe055040e700)、Windows x64／Python 3.11 组合；不是线上 Mortal 4.1，不证明其他版本或牌力。上游程序与权重不随扩展分发；该提交为 AGPLv3 加 Commons Clause，具体文件及环境见 [MJAI.md](MJAI.md) |
| [Equim-chan/mjai-reviewer](https://github.com/Equim-chan/mjai-reviewer) | mjai 牌谱分析与专业模型生态参考；可研究复盘输入、动作结果及报告组织 | 未作为依赖或在线后端接入；仅离线适配公开旧版英文 Classic 1.5.3 / Mortal 3 报告中的有限普通弃牌，不提供其模型或权重 | 在线接口、当前模型可用性、调用授权、费用和权重取得条件未确认；不把其支持模型清单当作本项目兼容清单 |
| [Equim-chan/Mortal](https://github.com/Equim-chan/Mortal)；[issue #116](https://github.com/Equim-chan/Mortal/issues/116) | 专业日麻模型框架与上游讨论参考；用于厘清框架、权重与可用接口的区别 | 可选mjai合同可承接满足协议和合法性校验的用户引擎；v0.14.0限定接入固定VoidShine298k／Yuchen582500社区v4，并保留Akagi v2弱示例，固定源码及人工验收见[Mortal v4记录](MORTAL_V4_VALIDATION.md) | 开源框架不等于可自由取得全部权重或公共 API；这些社区权重不是官网4.1。issue是讨论线索，不是永久服务承诺；其他权重、版本、运行环境及许可需分别确认 |
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
- 协议参考固定 v0.1.2183、commit `0414bbeddbfc2028508b610fd1e7c194143454a0` 的 [接入规范](https://github.com/yetone/magpie/blob/0414bbeddbfc2028508b610fd1e7c194143454a0/docs/integrating.md) 和 gateway 路由。后续使用真实官方 Windows v0.1.2204 与本地人工上游完成限定范围联调，见 [安装校验及实测记录](MAGPIE_VALIDATION.md)；未验证真实模型、牌局或 Chrome 授权 UI，不是全面兼容认证。工具诊断、别名、费用和思考参数限制见 [配置与诊断](MODEL_CONFIGURATION.md)。
- 未提供 Magpie 插件或 Agents 注册。

## 可选实验 CC Switch 接入（2026-10-30）

- [farion1231/cc-switch](https://github.com/farion1231/cc-switch)：新增可选实验预设与显式 Codex 目录解析，仅核对正式 v4.0.22、commit `b76426741ef93069e2f374ac01ca7ef5760e1d0e`。共用 Codex 供应商、切换和统计，目录依赖受管理 Codex 配置，不能把其他协议的转换能力直接套用到 Chat 入口。
- 已用官方 v4.0.22 portable 程序与两个本地人工上游完成真实网关链路验证；项目模块使用真实 HTTP 和合成权限。真实云模型、OAuth／订阅和故障转移仍未验证，不作官方适配或全面兼容声明。支持条件、证据与未验证范围见 [配置文档](MODEL_CONFIGURATION.md) 和 [研究记录](MODEL_GATEWAY_RESEARCH.md)。

## 2026-11-04 生态调研补充

完整结论见[雀魂助手与立直麻将生态调研](RIICHI_ECOSYSTEM_RESEARCH.md)，附[41 个已确认仓库及两个失败地址的元数据](riichi-ecosystem-2026-11-04.csv)与[来源索引](riichi-ecosystem-sources-2026-11-04.json)。这是公开文档和部分源码研究，不是安装、牌力或兼容验收；本轮未新增运行依赖。

对话专项见[固定提交核查](RIICHI_CHAT_SUPPORT_RESEARCH.md)：xMahjong 明确传入最近问答；Mahjong Paipu Assistant 有问答 UI，但当前不传聊天历史；小肥鱼的 QQ 查询与管理员教学不等同于内置逐决策连续追问。尚未确认上述实时助手中另一个与本项目形态相同的完整实现，不据此宣称全生态唯一。

| 新确认对象 | 借鉴点与边界 |
| --- | --- |
| [ponder-j/xMahjong](https://github.com/ponder-j/xMahjong) | 离线双引擎证据、逐候选中文解释与追问；抽查解释和证据模块。主项目 LICENSE 为 MIT，Mortal／Akochan 等组件许可另计；未接入 |
| [AwakeFantasy/mahjong-paipu-assistant](https://github.com/AwakeFantasy/mahjong-paipu-assistant) | 本地优先多平台牌谱回放、Mortal sidecar、可选 LLM 追问；未验证其下载或引擎兼容，未接入 |
| [nanashi77777/xiaofeiyu-mahjong-llm](https://github.com/nanashi77777/xiaofeiyu-mahjong-llm) | 纯 LLM 实时决策、完整合法动作与紧凑输入设计；含自动操作目标，仍在开发，明确再授权未确认；未复用 |
| [latorc/MahjongCopilot](https://github.com/latorc/MahjongCopilot) | Mortal／mjai 实时助手、三四麻、HUD；GPL-3.0，未确认持久 LLM 局面追问；未接入 |
| [FlyA-official/FlyAgent](https://github.com/FlyA-official/FlyAgent) | 商业实时教学与 HUD 产品对标；LICENSE 明确闭源专有，不能因 GitHub 公开就视为可复用开源源码 |
| [kobalab/majiang-core](https://github.com/kobalab/majiang-core)／[majiang-ai](https://github.com/kobalab/majiang-ai)／[majiang-ui](https://github.com/kobalab/majiang-ui) | MIT JavaScript 规则、AI 和回放生态；优先考虑离线规则对照，未做 MV3 打包或协议适配验证 |
| [MahjongRepository/mahjong](https://github.com/MahjongRepository/mahjong) | MIT Python 向听与计分库，适合作独立差分参照；未引入浏览器或认定全规则等价 |
| [smly/RiichiEnv](https://github.com/smly/RiichiEnv)／[hamakyo/jev-mahjong-bench](https://github.com/hamakyo/jev-mahjong-bench) | 规则固定、合法动作、整场模拟、同状态比较与用量／延迟评测；前者 Apache-2.0，后者实读 LICENSE 为 MIT；未运行 |
| [SAPikachu/amae-koromo](https://github.com/SAPikachu/amae-koromo)／[scripts](https://github.com/SAPikachu/amae-koromo-scripts) | 补充定位牌谱屋的真实仓库；公开页说明金／玉／王座段位战覆盖和非实时延迟。未获取批量采集或数据再利用授权 |

版本补充：Akagi 当前默认分支为 Rust＋Tauri 的 **V3**，主项目 [LICENSE.txt](https://github.com/shinkuan/Akagi/blob/v3/LICENSE.txt) 为 Apache-2.0，第三方来源另见 [NOTICE](https://github.com/shinkuan/Akagi/blob/v3/NOTICE)。本项目已验证的固定 **V2** 提交与其许可、模型和环境记录保持原范围，不能据 V3 README 扩大现有兼容声明。

用途补充：本轮访问的 NAGA 官方公开页明确限制将其解析报告用于开发／应用竞争产品。暂只作公开产品交互研究，不据此引入报告为训练或批量评测数据；本轮没有登录、提交牌谱或评审完整条款。

## 使用此索引时

2026-11-04 补充：用户提供社区模型 [VoidShine/mortal-298k](https://huggingface.co/VoidShine/mortal-298k)，已核对固定 revision `dbbea7e3d34f99ec43fc4834ab7f2aaaed70b6ee` 的 model card、配置、许可和文件元数据：公开的四麻半庄 checkpoint，配置 Mortal version=4、192通道／40 blocks，模型仓库声明 AGPL-3.0。作者自报相似度／MAKA 表现且明确不推荐排位，本项目已完成固定真实权重严格加载、四座位和100个合成HTTP→Agent请求、19组关键／官方动作对照；完整实战与牌力未测，见 [验收记录](MORTAL_V4_VALIDATION.md)。实现方案及已完成范围见 [VoidShine Mortal v4 接入方案](VOIDSHINE_MORTAL_V4_IMPLEMENTATION_PLAN.md)，保留 v2，模型及推理进程均默认关闭。它不是已取得官网 Mortal 4.1 权重的证明。

同日新增 [Yuchen1457/mortal-582500](https://huggingface.co/Yuchen1457/mortal-582500)，固定 revision `7386c9f5c751a3ea75efea99737cef5a5ef950f1`。本地校验130786031字节及SHA256 `738e0d6e3c0ce9671629554ad39abd147d2ffbac676e80b194c83f2acc0fea20`，受限加载核对v4／192／40、steps582500，与298k同runtime严格推理、四座位、100个合成HTTP→Agent和19关键／官方对照通过；限定四人半庄（v0.14.0发布包仍需逐次手动确认；当前源码已取消逐次确认）。仓库声明AGPL-3.0/upstream AGPL-3.0-or-later，作者历史比较不当作本项目牌力证据，详见 [验收记录](MORTAL_V4_VALIDATION.md)。

同日完成 Akagi v3 固定提交 `1fb16453ae0b7b0a820510ea1d3dbd01b6939082` 的第四可选引擎接入（v0.16.0）：四麻 `akagi4p.safetensors` 2,641,816 字节，SHA-256 `33c20aaba3f349ef689df73b726224804dc4aaff99922093d8f30cc38d709a1d`。这是行为克隆 CNN，不是 Mortal；固定源码采用 Apache-2.0，第三方许可另计。使用独立外载权重的 Rust CPU 常驻进程，未接入 Tauri、CDP 或系统代理，不复用 Mortal Python；专用运行包及权重只在用户选择安装后下载，模型／推理／自动分析仍默认关闭。固定权重及正式工件在线空目录安装、100 个人工 HTTP→EngineAgent 请求、119 组共有样本特征／logits／mask对照和四模型切换通过；本地补丁修正公开事件重放的振听及部分役资格，保留具体差异。浏览器手动／主动自动分析和冻结动作后模拟 LLM 解释已联调，测试副本预授本机权限，不代表原生权限弹窗或真实整场通过。首期实验范围为 Windows x64 CPU、四人半庄，提前声明且不逐巡确认；不宣称牌力或稳定推荐。详见 [修订方案](AKAGI_V3_MODEL_IMPLEMENTATION_PLAN.md)、[验收记录](AKAGI_V3_VALIDATION.md) 与 [模型管理](MODEL_MANAGER.md)。

本文件只保存参考关系与已确认边界，不替代 [第三方公告](../THIRD_PARTY_NOTICES.md)、[许可证来源](../licenses/SOURCES.md)、[验证记录](../VALIDATION.md)，也不替代 [mjai 接入](MJAI.md)、[NAGA 接入](NAGA-INTEGRATION.md) 与 [Pi 运行时说明](pi-runtime.md)。涉及“当前可用”“兼容”“已测”时，以这些详细记录所限定的版本与条件为准。待定位服务和未确认事项在取得可靠来源前继续保留为未知。

当前源码另按用户要求将本地模型管理改为可选便携包：固定官方 Node.js v22.19.0 Windows x64 随包提供，模型权重和 Python／PyTorch 仍按需准备；普通扩展不下载本机运行时。官方归档 SHA-256 已与 Node SHASUMS 核对，固定来源见 [Node 锁](../scripts/node-runtime-lock.json)。配对替代普通用户复制 Token，管理页批准后只交付所选模型的分析配置，分析保持关闭。便携流程从 v0.15.0 提供，旧 v0.14.0 的安装前提保持原记录，见 [模型管理](MODEL_MANAGER.md)。
