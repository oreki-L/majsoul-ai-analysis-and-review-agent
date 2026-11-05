# 参考项目与已确认边界

参考关系始记于 2026-10-26；本索引于 **2026-11-05** 按 v0.16.2 发布记录与本地专项补充整理。源码版本以所在检出的 `package.json` 为准。“已接入”仅限关联验收中的版本、平台与样本，不是全面兼容或牌力认证。

本页只维护**参考对象、接入状态、关键边界和详细记录入口**。项目比较、源码证据与选型建议见[生态综合研究](research/RIICHI_ECOSYSTEM_RESEARCH.md)；固定提交、资产哈希、环境、样本数和失败记录在专项验收维护。

## 产品方向与共同边界

项目以**纯 LLM 运行时和可追问的实时建议**为重心，复盘为辅助，独立获取器保持独立。纯 LLM 路径可使用本地事实工具，不要求专业引擎；Pi 是实际运行依赖，DeepSeek Harness 仅作设计参考。

本地引擎与 NAGA 默认关闭；引擎动作和 LLM 解释分别校验、保存，追问绑定原冻结决策。当前安装、配对与单模型启停统一见[模型管理](guides/MODEL_MANAGER.md)，动作／解释合同见[mjai 接入](guides/MJAI.md)。

开源框架不等于权重或公共 API 开放；人工局面与合成协议验证不等于真实整场兼容；参考首选一致不等于正确率、胜率或牌力。代码、模型、数据、服务与素材的来源和许可分别核查。

## 用户提及的参考对象

| 对象与可靠入口 | 参考关系与当前状态 | 关键边界／详细记录 |
| --- | --- | --- |
| [牌谱屋](https://amae-koromo.sapk.ch/) | 牌谱检索与统计参考；未作为采集器、数据源或运行依赖接入 | 公开可见不代表获得批量采集或再利用授权；真实仓库与覆盖说明见[研究](research/RIICHI_ECOSYSTEM_RESEARCH.md#采集转换牌谱与统计) |
| [shinkuan/Akagi](https://github.com/shinkuan/Akagi) | 本地引擎与协议桥接参考；保留固定 V2 弱 Mortal 示例，v0.16.0 提供独立 V3 Native 实验选项 | V2 与 V3 的模型、环境、许可分别处理；V3 不是 Mortal，未接入上游 Tauri／CDP／系统代理。见[V2 路径](guides/MJAI.md)、[V3 验收](validation/AKAGI_V3_VALIDATION.md) |
| [Equim-chan/mjai-reviewer](https://github.com/Equim-chan/mjai-reviewer) | 复盘与报告组织参考；未作为依赖或在线后端接入，仅支持有限旧版离线报告 | 不提供其模型／权重，不据此宣称支持当前线上全部报告或开放 API；版本范围见[工作流验收](validation/MORTAL_WORKFLOW_VALIDATION.md) |
| [Equim-chan/Mortal](https://github.com/Equim-chan/Mortal)及[issue #116](https://github.com/Equim-chan/Mortal/issues/116) | 专业框架参考；可选 mjai 支持满足合同的用户引擎，已有限接入两个固定社区 v4 | 社区权重不是官网 Mortal 4.1；issue 不是服务承诺。来源与许可见[v4 运行说明](guides/MORTAL_V4.md)，已测范围见[v4 验收](validation/MORTAL_V4_VALIDATION.md) |
| [tzp1021/mj_helper](https://github.com/tzp1021/mj_helper) | 采集与状态机分层参考；未捆绑其 Python 引擎、数据或报告 | 不宣称协议、实现或牌力等价；产品对照见[研究](research/RIICHI_ECOSYSTEM_RESEARCH.md#直接同类与相近产品) |
| [earendil-works/pi](https://github.com/earendil-works/pi) | 实际分发固定 1.4.0 的 `pi-agent-core`／`pi-ai` 审计后浏览器代码，作 MV3／CSP 适配；collector 不含 Pi | 不代表支持全部原生 provider SDK；canonical 来源、版本与许可见[运行库来源](../licenses/SOURCES.md)，实现见[Pi 运行时](development/pi-runtime.md) |
| DeepSeek Harness：确切仓库／文章 URL **待定位** | 有界执行与轨迹校验的设计参考；不是运行依赖 | 不编造 canonical URL，不等同于 DeepSeek 模型 API，也不宣称移植其实现 |
| 独立 NAGA：[官方提交页](https://naga.dmv.nico/naga_report/order_form/) | 默认关闭；仅提供本地转换、预览、复制／下载与官方页入口 | 无账号接入、自动上传、扣费、轮询或报告回读；导出不代表官方受理。见[NAGA 接入](guides/NAGA-INTEGRATION.md)及[报告用途限制](research/RIICHI_ECOSYSTEM_RESEARCH.md#github-之外的公开产品与研究资料) |
| 雀魂内置 MAKA：未确认独立 canonical URL | 历史小样本的游戏内首选参照；无 API 接入 | 与独立 NAGA 不同，不混用历史 nano／nago／naga 称呼；原标签与一致率局限见[历史测试](benchmark/MODEL_BENCHMARK.md) |
| “mjai bot 在线服务”：确切 URL **待定位** | 未确认身份，未接入 | 不按名称猜服务；需确认协议、授权、费用与数据处理边界 |

## 后续研究补充资料

以下为研究中补充的来源，不全部归为用户亲自提供，也不表示已获许可或已接入。

| 对象与入口 | 参考关系与当前状态 | 关键边界／详细记录 |
| --- | --- | --- |
| [honvl/Majsoul-to-NAGA](https://github.com/honvl/Majsoul-to-NAGA)／[AsaChiri/majsoul-naga](https://github.com/AsaChiri/majsoul-naga) | 导出流程参考；本项目独立实现，未移植转换／提交代码或账号素材 | 不能据历史功能推定自动提交或报告读取；见[NAGA 接入](guides/NAGA-INTEGRATION.md) |
| [Avenshy/mahjong-helper-majsoul-mitmproxy](https://github.com/Avenshy/mahjong-helper-majsoul-mitmproxy) | Liqi 字段研究；未捆绑其代码、proto 或生成代码 | 本项目独立 wire reader；不将其 GPL-3.0 代码纳入本项目 MIT 授权，不据旧字段声明当前全协议兼容 |
| [Avenshy/MajsoulMax](https://github.com/Avenshy/MajsoulMax) | 网页与桌面采集线索；未引入客户端修改逻辑或运行依赖 | 其采集能力不能直接等同于本项目浏览器扩展能力 |
| [matttang27/majsoul-vision](https://github.com/matttang27/majsoul-vision) | 私密早期原型素材来源追踪；公开历史已移除旧 PNG／ZIP，现用原创 SVG | 原素材授权未确认，不分发旧素材；见[第三方公告](../THIRD_PARTY_NOTICES.md)与[牌面来源](../extension/tiles/SOURCE.md) |

## 可选 Magpie 接入（2026-10-30）

[yetone/magpie](https://github.com/yetone/magpie)：已提供可选预设、手动身份识别与模型目录，沿用 Chat Completions；不要求安装、不读取桌面设置或账号，未提供 Magpie 插件／Agents 注册。固定官方程序＋本地人工上游已有限联调，真实云模型与完整 MV3 链路未验。操作见[模型配置](guides/MODEL_CONFIGURATION.md)，协议依据见[网关研究](research/MODEL_GATEWAY_RESEARCH.md)，固定版本与结果见[Magpie 验收](validation/MAGPIE_VALIDATION.md)。

## 可选实验 CC Switch 接入（2026-10-30）

[farion1231/cc-switch](https://github.com/farion1231/cc-switch)：已提供可选实验预设与显式 Codex 目录解析，目录与请求沿 Codex 供应商／统计路径。固定 v4.0.22 程序＋本地人工上游已有限联调，不代表其他协议全面转换、真实云模型、OAuth／订阅或故障转移已验。操作见[模型配置](guides/MODEL_CONFIGURATION.md)，依据见[网关研究](research/MODEL_GATEWAY_RESEARCH.md)，结果见[CC Switch 验收](validation/CC_SWITCH_VALIDATION.md)。

## 2026-11-04 生态调研补充

以下仅列参考结论，均未因本次研究新增运行依赖。完整比较、固定提交、聊天历史传递和许可证据见[生态综合研究](research/RIICHI_ECOSYSTEM_RESEARCH.md)，附[仓库元数据](riichi-ecosystem-2026-11-04.csv)与[来源索引](riichi-ecosystem-sources-2026-11-04.json)。

| 对象 | 本项目的参考用途与状态 |
| --- | --- |
| [xMahjong](https://github.com/ponder-j/xMahjong)／[Mahjong Paipu Assistant](https://github.com/AwakeFantasy/mahjong-paipu-assistant) | 证据解释与复盘工作台参考；均未接入。前者核查版本传最近问答，后者不传聊天历史，详见[对话核查](research/RIICHI_ECOSYSTEM_RESEARCH.md#追问与对话能力核查) |
| [小肥鱼](https://github.com/nanashi77777/xiaofeiyu-mahjong-llm) | 纯 LLM 输入合同参考；未复用，明确再授权未确认。QQ 查询／管理员教学不等同于内置逐决策追问 |
| [MahjongCopilot](https://github.com/latorc/MahjongCopilot)／[FlyAgent](https://github.com/FlyA-official/FlyAgent) | 实时 HUD 产品对标；未接入。前者 GPL-3.0，后者闭源专有；自由追问未确认 |
| [kobalab/majiang-core](https://github.com/kobalab/majiang-core)／[majiang-ai](https://github.com/kobalab/majiang-ai)／[majiang-ui](https://github.com/kobalab/majiang-ui) | 规则、传统 AI 与回放参考；未引入，未验 MV3 打包与协议适配 |
| [MahjongRepository/mahjong](https://github.com/MahjongRepository/mahjong) | 已用固定版本作开发期独立规则差分参照，未引入扩展运行依赖；范围见[规则验收](validation/RULES_EVENTS_VALIDATION.md) |
| [RiichiEnv](https://github.com/smly/RiichiEnv)／[jev-mahjong-bench](https://github.com/hamakyo/jev-mahjong-bench) | 规则固定、整场模拟与同状态评测参考；未运行或接入 |
| [SAPikachu/amae-koromo](https://github.com/SAPikachu/amae-koromo)／[scripts](https://github.com/SAPikachu/amae-koromo-scripts) | 牌谱屋真实仓库与统计参考；未取得批量采集或数据再利用授权 |

以上未确认另一个同形态完整实现，不构成全生态唯一或首创证明。各项目代码、引擎、权重及素材的许可分别处理，详见[许可研究](research/RIICHI_ECOSYSTEM_RESEARCH.md#许可与维护状态会影响选型的几处细节)。

## 小肥鱼参考来源补充（2026-11-05）

固定第三方声明、上游链接、协议／视觉方案及许可调查统一见[综合研究中的来源补充](research/RIICHI_ECOSYSTEM_RESEARCH.md#小肥鱼参考来源补充2026-11-05)。其中 Python mahjong 与固定 Akagi／mahjong_soul_api 已用于有限开发核查，其余列出的历史桥接、视觉与策略项目未引入；第三方使用记录不等于本项目已使用或取得授权。

## 使用此索引时

| 要确认的内容 | 详细记录与当前边界 |
| --- | --- |
| 可选引擎的安装、连接与运行 | [模型管理](guides/MODEL_MANAGER.md)：四模型按需安装，一次只运行一个；模型／推理默认关闭，自动分析须主动开启，普通扩展不下载本机运行时 |
| 两个社区 Mortal v4 | [运行说明](guides/MORTAL_V4.md)与[v4 验收](validation/MORTAL_V4_VALIDATION.md)：固定权重人工推理与动作对照已验；社区权重在线完整安装链路未通，真实整场／牌力／真实 LLM 教学未验 |
| Akagi v3 Native | [v3 验收](validation/AKAGI_V3_VALIDATION.md)：独立 Rust CPU、Windows x64、四人半庄；在线空目录安装与人工浏览器联调已验，原生权限弹窗／真实整场／牌力未验 |
| 规则与采集修复 | [规则／事件验收](validation/RULES_EVENTS_VALIDATION.md)：有限离线规则差分与合成事件回归已验；真实事件／整场重连暂缓，快照恢复不支持 |
| 官方报告与动作后解释 | [工作流验收](validation/MORTAL_WORKFLOW_VALIDATION.md)：固定旧版报告有限适配，动作先保存、解释可重试；不代表当前官网全部报告或真实教学质量已验 |
| 便携运行包的运行时与配对 | [模型管理](guides/MODEL_MANAGER.md)与[验证总览](../VALIDATION.md)：自带固定 Node，模型依赖按需准备；配对仅交付获准模型的分析配置，连接后分析保持关闭；来源见[Node 锁](../scripts/node-runtime-lock.json) |

本页不替代[第三方公告](../THIRD_PARTY_NOTICES.md)、[运行库来源](../licenses/SOURCES.md)或各专项验收。涉及“当前可用”“兼容”“已测”，回到对应记录的固定版本与条件；待定位服务在取得可靠来源前继续保留为未知。
