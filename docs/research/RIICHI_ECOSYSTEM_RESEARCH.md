# 雀魂与立直麻将生态综合研究

原始生态调研与对话核查日期：**2026-11-04（北京时间）**；参考来源补充与整合日期：**2026-11-05**。本文合并生态调研、五项目对标和追问专项，统一保留结论、项目比较、固定提交证据、许可边界与后续建议。整合仅整理已有材料，没有重新联网核查或运行第三方产品。

**版本口径：** 文中本项目的能力对照和建议基于调研时的 **v0.13.0**：Manifest V3 扩展、独立获取器、用户自配 LLM、实时建议、冻结决策追问，以及默认关闭的 mjai／Mortal 教学路径。当前接入状态以[参考边界](../REFERENCES.md)、[模型管理](../guides/MODEL_MANAGER.md)、[Mortal v4 验收](../validation/MORTAL_V4_VALIDATION.md)、[Akagi v3 验收](../validation/AKAGI_V3_VALIDATION.md)和[规则／事件核查](../validation/RULES_EVENTS_VALIDATION.md)为准。历史建议不代表当前仍未实施，也不构成已立项计划。

## 主要结论

1. **实时 AI 助手已有直接同类。** Akagi、MahjongCopilot、FlyAgent 已覆盖实时建议、HUD 或历史统计等；FlyAgent 是闭源商业产品。
2. **解释、问答和多轮对话必须分开比较。** xMahjong 明确传入最近 6 条消息，支持离线同一决策的连续追问；Mahjong Paipu Assistant 有问答界面，但核查版本不传聊天历史；小肥鱼依赖 QQ 宿主的查询和管理员教学，不能等同于内置逐决策追问。
3. **五个重点项目各有可借鉴之处。** 分别是证据化解释、复盘工作台、纯 LLM 输入合同、实时呈现、教学摘要与外部咨询，不宜按功能数量或宣传牌力排名。
4. **本项目值得建设的组合是实时辅助、保留决策上下文、历史回看与连续追问。** 配合确定性事实工具、用户自配模型和独立获取器，纯 LLM 可独立运行，专业引擎按需启用。本轮未确认同形态的完整第三方实现，不能据此宣称唯一或首创。
5. **优先证明可靠性和解释质量。** 重点是事件与规则验证、证据化候选比较、追问质量和可重复评测；新增模型名称本身不能证明教学效果。
6. **框架、权重、服务和许可分别核对。** Akagi V3 与固定 V2 是不同对象；开源框架不等于官方权重或公共 API 开放，上游宣传不等于本项目验收。

## 阅读导航

- [研究方法与证据范围](#研究方法与证据范围)
- [直接同类与相近产品](#直接同类与相近产品)
- [五个重点项目与本项目对照](#五个重点项目与本项目对照)
- [追问与对话能力核查](#追问与对话能力核查)
- [小肥鱼参考来源补充](#小肥鱼参考来源补充2026-11-05)
- [专业 AI、训练框架与复盘引擎](#专业-ai训练框架与复盘引擎)
- [规则、向听、计分与 JavaScript 生态](#规则向听计分与-javascript-生态)
- [模拟器、协议与评测平台](#模拟器协议与评测平台)
- [建议的产品方向与优先级](#建议的产品方向与优先级)

## 研究方法与证据范围

- GitHub 使用 **21 组检索**，返回 191 个条目，去重后 **173 个仓库候选**；这是有相关性与分页上限的候选池，不是生态总量。查询包括 `majsoul AI`、`mahjong LLM`、`riichi mahjong AI`、`majsoul helper`、`mjai`、`riichi mahjong analysis`、`雀魂 插件`、`立直 麻将`、`majsoul llm in:readme`、`mahjong coaching`、`mahjong shanten` 等。
- 通过 GitHub 仓库 API 核对 **41 个仓库**的默认分支、推送时间、归档状态与许可证识别结果，见[元数据清单](../riichi-ecosystem-2026-11-04.csv)。清单还保留两个错误地址和明确的 404，避免把猜测当作有效来源。[来源索引](../riichi-ecosystem-sources-2026-11-04.json)记录查询、74 个页面／文件摘录条目及本地提取文本哈希；条目包含访问失败和重复来源，不代表 74 个独立项目。
- 重点阅读相关 README、官网、目录与部分源码，包含 xMahjong 的解释／证据模块、小肥鱼的模型客户端、牌谱助手的 sidecar、benchmark 的类型合同、kobalab 的向听实现，以及 Akagi 的 LICENSE／NOTICE。
- GitHub 匿名 API 限流后，使用浏览器读取 GitHub 页面及原始文件继续核对。另访问 Mortal 文档、牌谱屋、MahjongCopilot 官网、FlyAgent 官网和 NAGA 官方公开页。通用搜索提供补充线索；部分搜索触发验证码，未绕过。**没有充分覆盖 Gitee／GitLab，不能据此声称这些平台没有同类。**
- 证据分为 **C：源码／许可文件抽查**、**D：README／官方文档核对**、**M：仅元数据／仓库简介**。C 不是全面代码审计；上游运行结果、速度、段位和评测数字均是作者自述，本轮没有独立复现。
- 没有运行第三方程序、下载模型权重、登录第三方服务、提交真实牌谱或付费调用。记录时点的分支内容可能继续变化；`pushed_at` 是仓库推送活动，不等于功能发布、默认分支最近提交或当前可用性。
- 原始检索和页面摘录仅保留在本地忽略目录 `research/evidence/ecosystem-2026-11-04/`；公开报告提供原始链接及元数据清单，不将第三方源码打包为本项目内容。

追问专项另读取 9 个仓库的完整文件树、36 个选定源码／文档文件，以及 FlyAgent、MahjongCopilot 的公开说明。五项目对标重新核对 README、默认分支最新提交及部分关键文件；当时看到的提交为 xMahjong `dae9cea`、Mahjong Paipu Assistant `cdfe0f3`、小肥鱼 `e886cc3`、FlyAgent `a604318`、MJsoulCoaching `096b7ac`。此前四个开源仓库核查提交与该次读取一致；均为 2026-11-04 的时点记录，不是整合日最新版本声明。

## 直接同类与相近产品

下表的“未确认”表示本轮来源不足以确认，不能读成“没有”。功能均指上游公开描述或源码中可见的范围。

| 项目 | 路线与形态 | 与我们重叠的能力 | 主要差异／限制 | 证据与研究优先级 |
| --- | --- | --- | --- | --- |
| [shinkuan/Akagi](https://github.com/shinkuan/Akagi) | V3 Rust＋Tauri 桌面程序；MITM 或受控 Chromium/CDP 采集 | 实时局面、HUD、效率／危险、引擎接入、三四麻、历史统计 | 内置专业模型及云推理为主；冻结决策的 LLM 多轮追问未确认；安装形态不同 | C/D；**高** |
| [latorc/MahjongCopilot](https://github.com/latorc/MahjongCopilot) | Python、Tkinter、Playwright；mjai／Mortal | 雀魂三四麻逐步指导、HUD、本地与在线模型 | 包含自动操作；面向专业引擎，LLM 证据解释和持久追问未确认 | D；**高** |
| [FlyA-official/FlyAgent](https://github.com/FlyA-official/FlyAgent) | Windows 客户端＋云端模型，商业 Key | 多平台实时建议、牌面标记、风险／对手状态、解释、历史回放 | **闭源商业软件**；不能复用源码；公开承诺不等于独立验证，持久局面追问未确认 | C/D；产品对标**高** |
| [ponder-j/xMahjong](https://github.com/ponder-j/xMahjong) | Python 后端＋原生 Web 前端；本地 Mortal＋Akochan＋LLM | 结构化证据、逐候选比较、中文解释、局面追问、动作前缀 | 离线复盘为主；切换决策清空聊天，刷新可重新生成；不是我们的实时扩展形态 | C/D；**最高** |
| [AwakeFantasy/mahjong-paipu-assistant](https://github.com/AwakeFantasy/mahjong-paipu-assistant) | Next.js 本地优先复盘工作台 | 雀魂／天凤／一番街牌谱、时间轴、候选点、Mortal sidecar、可选 LLM 追问 | 以回放为主；雀魂下载依赖自备账号／会话；未提供权重 | C/D；**高** |
| [nanashi77777/xiaofeiyu-mahjong-llm](https://github.com/nanashi77777/xiaofeiyu-mahjong-llm) | Python＋专用 Chromium；纯 LLM 决策 | 可知局面、合法动作、规则特征、模型切换、记忆、复盘 | 目标包含鼠标执行与 QQ 控制；连续整场等仍在验收；未确认明确开源许可 | C/D；**高** |
| [swordofkings-blip/MJsoulCoaching](https://github.com/swordofkings-blip/MJsoulCoaching) | Tampermonkey 捕获＋Python 本地服务 | 实时捕获、回放、攻守／弃牌理由、何切咨询提示导出 | 规则／战术网络与模板解释混合；“战术 LLM”不等于通用聊天 LLM；直接 API 多轮追问未确认 | D；**中高** |
| [tzp1021/mj_helper](https://github.com/tzp1021/mj_helper) | Python、CDP、Protobuf、规则建议 | 实时采集与状态机、效率／防守、回放评估、动作点对齐 | 无需外部模型；复杂攻守为规则近似，作者也保留牌力限制 | D；**中高** |
| [Jimboom7/AlphaJong](https://github.com/Jimboom7/AlphaJong) | 原生 JavaScript userscript；传统算法／有限模拟 | 浏览器内运行、HELP 提示模式、三四麻、何切测试 | 有 AUTO 模式；依赖游戏页面接口及历史适配方法；无 LLM 教学链路 | D；**中** |
| [EndlessCheng/mahjong-helper](https://github.com/EndlessCheng/mahjong-helper) | Go 本地规则分析器 | 进张、改良、打点、危险度、手摸切、牌谱分析、三四麻 | 终端／本地工具，历史采集安装方法不能直接沿用到当前客户端；无自由问答 | D；算法参考**高** |
| [Fr0stbyteR/Majsoul-Helper](https://github.com/Fr0stbyteR/Majsoul-Helper) | 牌效与推荐弃牌着色 | 牌面建议的展示形态 | 本轮仅核对简介／元数据，当前协议可用性和实现细节未确认 | M；**低** |

## 五个重点项目与本项目对照

| 项目 | 模型或分析方式 | 实时分析 | 复盘 | 追问与对话 | 最值得学习 |
| --- | --- | --- | --- | --- | --- |
| [xMahjong](https://github.com/ponder-j/xMahjong) | Mortal、Akochan 加用户配置的 LLM | 本轮未确认 | 有，主要场景 | 有同一决策的多轮追问；带最近 6 条消息，切换决策清空 | 多候选证据、事实与推断分离 |
| [Mahjong Paipu Assistant](https://github.com/AwakeFantasy/mahjong-paipu-assistant) | 可选 Mortal、本地分析及用户配置的 LLM | 本轮未确认 | 有，主要场景 | 有自由问答界面；核查版本不向模型传前轮聊天 | 多平台牌谱、时间轴、建议问题 |
| [小肥鱼](https://github.com/nanashi77777/xiaofeiyu-mahjong-llm) | 纯 LLM 决策，具体实际模型名称未公开确认 | 有，含自动操作目标 | 有自动复盘设计／功能；效果未实测 | QQ 宿主支持查询与管理员教学；未确认内置针对当前决策的连续追问 | 合法动作、未知信息与模型输入合同 |
| [FlyAgent](https://github.com/FlyA-official/FlyAgent) | 商业云端模型；具体模型和权重未公开确认 | 官方宣传支持 | 官方介绍历史回放 | 展示解释；自由追问未确认 | 面向实战的 HUD 与信息层次 |
| [MJsoulCoaching](https://github.com/swordofkings-blip/MJsoulCoaching) | 规则分析与战术网络；可导出提示词供外部 Gemini 使用 | 上游声称支持，本轮未实测 | 有回放／模拟 | 可复制提示词去外部咨询；未见内置多轮对话 | 可视化攻守解释和低门槛咨询入口 |
| 本项目 v0.13.0 | 自配 Chat Completions 兼容 LLM；本地确定性工具；可选 mjai 引擎加 LLM 解释 | 有；真实完整对局协议仍待验证 | 有手动牌谱分析、历史决策整理及有限旧报告导入 | 有绑定冻结局面的连续追问和历史回看 | 实时与复盘之间保留同一决策上下文 |

“未确认”表示公开资料或本轮抽查不足以判断，不能推断一定不支持。模型名称、服务、配置与可用性随版本变化；第三方实力、延迟和效果均未独立测试。

## 逐项分析

### xMahjong：让解释有可核查的依据

**优势。** 它以牌谱复盘为中心，同时使用 Mortal、Akochan 和 LLM。候选动作分别组织优劣、适用条件与横向比较；证据模块计算向听、未见进张、宝牌保留和逐家现物等信息。解释中的 `fact / inference / unknown` 和证据引用，以及对部分数值的校验，使读者更容易区分事实与推断。模型追问使用当前决策报告和最近 6 条对话消息，正常交替相当于最近三轮问答。README 还介绍单步弃牌反事实：只重算合法弃牌后的即时证据，不复用未来牌谱，也不声称重新推理模型。

其 README 将 [VoidShine/mortal-298k](https://huggingface.co/VoidShine/mortal-298k) 列为默认 Mortal 接入路线，LLM 则由用户配置；`local-qwen` 是其本地示例名，不能据此断言实际运行的模型。上游自述完成真实天凤及授权雀魂半庄的双模型流程验收，本轮未独立复现，也不能把该社区权重等同于官方线上 Mortal 4.1。

**值得借鉴。** 在现有本地计算和 X-F 确定性比较目录上，逐步建立“结论 → 依据 → 来源”展示：例如对某候选展示向听、进张上界、逐家现物依据，并让解释引用对应来源；模型无法支持的判断明确显示未知。对多个候选分别解释取舍，特别是回答“为什么不选另一张”。也可研究对合法弃牌即时重算事实的反事实比较，清楚标记它不是预测后续结果或重新运行引擎。不必一开始引入双引擎：先用已有数据做小范围试验。

**我们的区别与不足。** 我们已有绑定冻结局面的持续讨论、历史回看、本地事实工具和部分确定性校验；它主要围绕离线牌谱，切换决策会清空聊天。我们在当前实时路径拥有不同的使用场景，但 X-F 不覆盖所有模式，也没有强制每条自然语言结论绑定证据，不能把已有目录当作完整的解释正确性证明。

**依据。** 固定提交 `dae9cea7927c775fbe82bc1fff004a7e6eada019` 的[解释模块](https://github.com/ponder-j/xMahjong/blob/dae9cea7927c775fbe82bc1fff004a7e6eada019/backend/xmahjong/explainer.py)、[证据模块](https://github.com/ponder-j/xMahjong/blob/dae9cea7927c775fbe82bc1fff004a7e6eada019/backend/xmahjong/evidence.py)与[前端对话状态](https://github.com/ponder-j/xMahjong/blob/dae9cea7927c775fbe82bc1fff004a7e6eada019/frontend/app.js)。代码抽查不证明全部解释都正确。

补充实现细节：`Claim.kind` 区分 `fact / inference / unknown`，每条通过 `evidence_ids` 引用证据；服务端重建客观事实文字、拒绝不存在的引用，并检查部分百分比及四舍五入。未知危险率不填零，Mortal 偏好与 Akochan 原始期望值分别保存，不跨模型直接相减。数值与引用校验不构成完整语义证明。

### Mahjong Paipu Assistant：让复盘成为完整工作流

**优势。** 以本地优先的复盘工作台组织雀魂、天凤、一番街等牌谱，提供时间轴、候选决策点、Mortal sidecar、可选 LLM 和建议问题。把回放、定位、分析与提问放在同一工作区，降低用户在工具间来回切换的成本。平台下载条件、账号处理及引擎可用性仍需各自验证。

**值得借鉴。** 让用户从整场概览进入某个决策，看到原局面、自己的实际动作（确实采集或导入时）、建议及历史问题，再返回原位置；可提供“为什么选这张”“另一张的代价是什么”等基于局面的快捷问题。跨平台可作为长期探索，但需要独立评估牌谱授权、数据结构、规则和维护成本，当前无需为了平台数量牺牲雀魂体验。

**我们的区别与不足。** 我们已有手动整盘整理、来源跳转与冻结讨论；整理仅覆盖仍留存且已生成分析的记录，原建议不能冒充实际动作，牌谱游标也不随游戏播放自动移动。对方有问答 UI，但核查版本的模型请求不携带前轮聊天，因此不应把它称作具备多轮聊天记忆；我们的机会是把已有持续讨论和复盘导航做得更易发现、更可靠。

**依据。** 固定提交 `cdfe0f3713c49f36f6afe01bccd924b75a86fbbe` 的[前端请求](https://github.com/AwakeFantasy/mahjong-paipu-assistant/blob/cdfe0f3713c49f36f6afe01bccd924b75a86fbbe/src/app/home-client.tsx#L923)、[请求类型](https://github.com/AwakeFantasy/mahjong-paipu-assistant/blob/cdfe0f3713c49f36f6afe01bccd924b75a86fbbe/src/lib/majsoul/types.ts#L225)和[模型消息构造](https://github.com/AwakeFantasy/mahjong-paipu-assistant/blob/cdfe0f3713c49f36f6afe01bccd924b75a86fbbe/src/lib/majsoul/analysis-llm.ts#L124)。

### 小肥鱼：把局面与合法动作交给纯 LLM

**优势。** 项目以纯 LLM 进行实时选择，强调可知状态、合法动作、结构化输出、模型请求与用量记录；其 QQ 宿主还提供查询及管理员教学入口。其紧凑输入方案区分领域数据和模型投影，并提出保留红牌、阶段、合法动作及未知信息，这些都是建立模型输入合同的有用思路。

**值得借鉴。** 对每类决策明确列出合法动作与不可知字段，输入压缩后可还原关键事实；保持真实动作、模型建议、用户明确教学及未经验证的经验互相区分。先用冻结样本比较输入字节、关键信息保留、回答错误和延迟，再决定是否上线紧凑格式。

**我们的区别与不足。** 我们同样支持纯 LLM 与本地事实计算，默认不自动操作游戏，侧重辅助人类理解与追问；已有可选用户记忆，并要求用户确认候选，不能把建议当作实际动作。小肥鱼的目标包含自动执行；其 QQ 管理员教机器人麻将原则，与用户针对某一手向助手追问是不同场景。其紧凑格式文档是设计契约，不是已证明的运行效果或 token 节省。

**依据。** 固定提交 `e886cc3c6c912bff095a1a4ce35f732fd52530fe` 的[模型客户端](https://github.com/nanashi77777/xiaofeiyu-mahjong-llm/blob/e886cc3c6c912bff095a1a4ce35f732fd52530fe/src/majsoul_llm/model.py)、[输入格式设计](https://github.com/nanashi77777/xiaofeiyu-mahjong-llm/blob/e886cc3c6c912bff095a1a4ce35f732fd52530fe/docs/design/model-wire-format.md)和[QQ 接入说明](https://github.com/nanashi77777/xiaofeiyu-mahjong-llm/blob/e886cc3c6c912bff095a1a4ce35f732fd52530fe/docs/design/api-and-qq.md)。该项目仍在开发，连续实战和教学效果未由本轮验证。

补充协议细节：抽查的模型客户端使用 Responses 风格请求、流式取消、严格 JSON Schema 和用量记录，与本项目 Chat Completions／Pi 路径不同，不能只改 endpoint 就假定兼容。紧凑输入设计还提出共享特征、局部动作 ID；文档没有运行编码器或实测节省结论。

### FlyAgent：实时产品的呈现与使用门槛

**优势。** 官方公开介绍将实时建议、候选、牌面标记、风险、对手状态、解释与历史回放组织成一体化产品，并面向多个平台。README 列有三麻和四麻的不同云端模型阵容、模型风格，以及雀魂／天凤／一番街的游戏内指导和自动操作；具体模型内部实现与权重未公开确认。其价值在于把复杂信息放到用户当前操作附近，并提供一套完整使用路径；这些属于官方描述，本轮未安装验证。

**值得借鉴。** 优先呈现用户当前可采取的动作、最重要依据与时效状态，其余细节按需展开；让配置、费用与发送内容可理解；为分析中、失败、过期、断线等状态设计清晰反馈。验证重点应是用户能否及时理解和正确定位建议，而非单纯堆叠更多指标。

**我们的区别与不足。** 本项目采用浏览器扩展和自配模型，也提供本地分析、可选引擎及冻结追问；这提供模型选择空间，但自配服务和授权也会增加初始配置负担。我们目前仍需手动校准牌面提示、真实整场验证也未完成，不能笼统声称体验或易用性领先。FlyAgent 是否支持自由追问、其模型细节与实际表现均未确认。

**依据。** [官方介绍](https://nashout.com/en)、[使用指南](https://nashout.com/articles/user-guide)和[仓库许可](https://github.com/FlyA-official/FlyAgent/blob/main/LICENSE)。该产品为闭源专有软件，借鉴产品思路不等于取得其源码或素材使用许可。

### MJsoulCoaching：把分析变成可以讨论的教学材料

**优势。** 上游介绍实时捕获、回放、攻守分析与弃牌理由；它还提供把局面整理为提示词、复制到外部 Gemini 咨询的路径。对用户来说，这种路径允许使用熟悉的外部模型，也让分析内容成为可以继续讨论的材料。

**值得借鉴。** 将当前决策整理成可读、可检查的局面摘要，围绕“推荐什么、为什么、另一种选择有什么代价”组织教学。可研究显式复制脱敏摘要到外部工具；必须让用户先看到实际内容，并明确当前时点和未知信息，避免把未来牌谱或未经授权信息混入。

**我们的区别与不足。** 我们已有内置模型接入和冻结追问，能够留在同一界面继续讨论；外部复制可以是可选补充，不必取代内置流程。对方的“Gemini 相談”在核查版本是复制提示词而非内置对话；其战术网络也不能仅因名称被称为通用聊天 LLM。实时能力来自上游说明，尚未实测。

**依据。** 固定提交 `096b7ac5d13b8e145d3dde2f15e831b1f501275a` 的[咨询界面](https://github.com/swordofkings-blip/MJsoulCoaching/blob/096b7ac5d13b8e145d3dde2f15e831b1f501275a/server/templates/simulator_v2.html#L282)和[复制实现](https://github.com/swordofkings-blip/MJsoulCoaching/blob/096b7ac5d13b8e145d3dde2f15e831b1f501275a/server/static/js/simulator_v2_utils.js#L635)。

## 追问与对话能力核查

以下结论限定于原调研的固定提交和公开入口，不是安装或真实模型联调结果。

### 能力矩阵

| 项目 | 自由输入问题 | 前轮问答进入模型 | 入口／适用场景 | 本轮结论 |
| --- | --- | --- | --- | --- |
| xMahjong | 有 | **有，最近 6 条 user／assistant 消息** | 离线牌谱的当前决策；中文追问 | **明确支持局面多轮追问**；切换决策清空当前聊天，前端内存保存而非持久讨论档案 |
| Mahjong Paipu Assistant | 有 | **当前请求不传历史** | “AI 复盘聊天”面板，可输入问题或点建议问题 | **支持反复询问当前局面**，但不是具有前轮聊天记忆的连续对话 |
| 小肥鱼 | QQ 宿主可接收用户文本 | 不是打牌客户端的对话历史；完整 QQ 宿主未包含在该公开仓库 | QQ 查询牌局／经验、控制程序、管理员通过对话教麻将原则 | **支持另一种 QQ 交流／教学接入**；未见独立逐决策聊天接口，不能确认等价于“对这一手连续追问为什么” |
| Akagi V3 | 已查 UI 未见 | 未见 | 实时 HUD、候选、指标与复盘页面 | **未见内置聊天／追问功能** |
| MahjongCopilot | 已查 UI 未见 | 未见 | 实时引擎指导、HUD、自动操作与设置 | **未见内置聊天／追问功能** |
| MJsoulCoaching | 软件内未见自由问答链路 | 软件内未见 | “Gemini 相談”页生成并复制局面提示词 | **是导出提示到外部聊天工具，不是内置对话** |
| FlyAgent | 公开文档未确认 | 未确认 | 候选、危险度、对手推测与模型动机展示 | **只确认有解释展示；自由追问无公开证据**，闭源使源码核查不可行 |
| AlphaJong | 已查 UI 未见 | 未见 | HELP／AUTO 控制与算法建议 | **未见内置对话** |
| mj_helper | 已查入口未见 | 未见 | CDP 采集和本地规则建议 | **未见内置对话** |
| mahjong-helper | 已查文档与文件树未见 | 未见 | 牌效、防守、牌谱分析 | **未见内置对话** |

“未见”仅限定本轮固定版本与核查范围，不等于证明所有分支、私有组件、未来版本均无此功能。**实时计算不等于实时对话；出现 `LLM`、`chat/completions`、`Dialog` 或“教学”字样，也不能单独证明自由聊天。**

### 支持与限制的具体代码证据

#### xMahjong：确有模型多轮追问

固定提交：`dae9cea7927c775fbe82bc1fff004a7e6eada019`。

- [后端入口 app.py，第 302 行](https://github.com/ponder-j/xMahjong/blob/dae9cea7927c775fbe82bc1fff004a7e6eada019/backend/xmahjong/app.py#L302)：`POST /api/replays/{replay_id}/decisions/{decision_id}/chat`，接收 `question` 与 `history`，先取目标决策报告再调用聊天。
- [模型消息 explainer.py，第 291 行](https://github.com/ponder-j/xMahjong/blob/dae9cea7927c775fbe82bc1fff004a7e6eada019/backend/xmahjong/explainer.py#L291)：构造当前局面证据，将 `history[-6:]` 中的 user／assistant 消息加入请求，再追加新问题。正常交替时相当于最近三轮问答，不是六轮。
- [前端 app.js，第 200 行](https://github.com/ponder-j/xMahjong/blob/dae9cea7927c775fbe82bc1fff004a7e6eada019/frontend/app.js#L200)：聊天表单实际提交问题与 `state.history`，成功后加入用户问题和模型回答。
- 同文件第 82 行：切换决策时 `state.history = []`。因此它能承接同一决策的前轮问题，但不能据此宣称拥有我们这种跨决策保存、重开和持续追问的讨论档案。

#### Mahjong Paipu Assistant：聊天 UI 有，聊天历史没有传给模型

固定提交：`cdfe0f3713c49f36f6afe01bccd924b75a86fbbe`。

- [panels.tsx，第 608 行](https://github.com/AwakeFantasy/mahjong-paipu-assistant/blob/cdfe0f3713c49f36f6afe01bccd924b75a86fbbe/src/components/paipu/panels.tsx#L608)：实际 `AnalysisChatPanel`，标题“AI 复盘聊天”，有输入、发送、聊天气泡与建议追问。
- [home-client.tsx，第 923 行](https://github.com/AwakeFantasy/mahjong-paipu-assistant/blob/cdfe0f3713c49f36f6afe01bccd924b75a86fbbe/src/app/home-client.tsx#L923)：前端保留显示用的 `chatMessages`，但出站 JSON 只有当前 `question`、`mode`、`snapshot`、`visibleEvents`、`llmModel`。
- [请求类型 types.ts，第 225 行](https://github.com/AwakeFantasy/mahjong-paipu-assistant/blob/cdfe0f3713c49f36f6afe01bccd924b75a86fbbe/src/lib/majsoul/types.ts#L225)及[API route.ts，第 23 行](https://github.com/AwakeFantasy/mahjong-paipu-assistant/blob/cdfe0f3713c49f36f6afe01bccd924b75a86fbbe/src/app/api/analysis-chat/route.ts#L23)：无 `history/messages` 对话参数。
- [analysis-llm.ts，第 124 行](https://github.com/AwakeFantasy/mahjong-paipu-assistant/blob/cdfe0f3713c49f36f6afe01bccd924b75a86fbbe/src/lib/majsoul/analysis-llm.ts#L124)：请求构造为系统说明和当前问题／证据；其 planner／writer／verifier 是一次回答内部的处理流程，不是用户聊天的多轮历史。

所以“为什么不切 5p？”这类完整新问题可以继续问；“你刚才第二条说的那个是什么意思？”不能假定能理解前轮回答。界面有聊天记录与模型拥有聊天上下文是两个不同能力。上一轮概括其“追问”时没有说明这一限制，本轮据代码补正。

#### 小肥鱼：QQ 交流和教学，不是已经确认的局面聊天产品

固定提交：`e886cc3c6c912bff095a1a4ce35f732fd52530fe`。

- [QQ 接入说明](https://github.com/nanashi77777/xiaofeiyu-mahjong-llm/blob/e886cc3c6c912bff095a1a4ce35f732fd52530fe/docs/design/api-and-qq.md)：复用另一个 QQ 项目的 stdio MCP 工具查询战况、历史、经验与执行控制；活动小局默认不向 QQ 返回手牌、计划及可能间接泄露它们的自由文本。
- [运行手册，第 207 行](https://github.com/nanashi77777/xiaofeiyu-mahjong-llm/blob/e886cc3c6c912bff095a1a4ce35f732fd52530fe/docs/runbook.md#L207)：管理员可说“记住……”并写入／更正麻将原则，标为 `taught_unverified`，之后按条件召回。
- [DEV-096 完成记录](https://github.com/nanashi77777/xiaofeiyu-mahjong-llm/blob/e886cc3c6c912bff095a1a4ce35f732fd52530fe/docs/development/completed/DEV-096-dialogue-mahjong-learning.md)：公开记录支持教学、查询与鉴权边界；没有执行真实 QQ 教学写入测试，签名边界使用隔离测试。
- [panel.html](https://github.com/nanashi77777/xiaofeiyu-mahjong-llm/blob/e886cc3c6c912bff095a1a4ce35f732fd52530fe/src/majsoul_llm/panel.html)：本机面板是状态、操作、计划、指标和资料查询，未见聊天输入框。抽查 `app.py`、`queries.py` 未见类似逐决策 `/chat` 的接口。

可确认的是**借 QQ 宿主围绕记录交流、查询和教机器人**，而非公开仓库独立提供“实时这一手的自由聊天＋历史上下文”。不要把“管理员对话教学”误读成“AI 教用户打牌的多轮课堂”。

#### MJsoulCoaching：“Gemini 相談”是剪贴板导出

固定提交：`096b7ac5d13b8e145d3dde2f15e831b1f501275a`。

[simulator_v2.html，第 282 行](https://github.com/swordofkings-blip/MJsoulCoaching/blob/096b7ac5d13b8e145d3dde2f15e831b1f501275a/server/templates/simulator_v2.html#L282)展示咨询提示预览和复制按钮；[simulator_v2_utils.js，第 635 行](https://github.com/swordofkings-blip/MJsoulCoaching/blob/096b7ac5d13b8e145d3dde2f15e831b1f501275a/server/static/js/simulator_v2_utils.js#L635)实际执行 `navigator.clipboard.writeText(prompt)`。它的 `TacticalTransformer` 是 PyTorch 战术网络，不因名称含 LLM 就成为自由聊天模型。

### 实时项目的核查边界

| 项目／固定提交 | 本轮检查位置 | 能下的结论 |
| --- | --- | --- |
| Akagi `1fb16453ae0b7b0a820510ea1d3dbd01b6939082` | 完整文件树、`GameDashboard.tsx`、`Review.tsx`、`Settings.tsx`、`menuList.ts`、`BotShowList.tsx`、`botShow.ts` | 主要 UI 与输出入口未见自然语言问题／对话历史链路；仓库同名的 `Dialog` 是界面弹窗 |
| MahjongCopilot `31be3de972bbe4b1261360ff61b18f1bb84babbe` | 完整文件树、`gui/main_gui.py`、`gui/widgets.py`、[官网使用说明](https://mjcopilot.com/help/) | 展示引擎建议和控制界面，未见自由问答入口 |
| AlphaJong `a868e1654decb9374081c72117b008beccfa0eaa` | 完整文件树、`src/gui.js`、`src/main.js` | HELP／AUTO 和参数控制，未见自由聊天 |
| mj_helper `74d6a93ad671b2fe2147da47182cd24001fdeb79` | 完整文件树、`majsoul_cdp_live.py`、前轮 README | 本地规则建议，未见聊天服务或聊天 UI |
| mahjong-helper `514bb97c5a6d157fa2ed1ac804a53cb9b559d7d0` | 完整文件树、README | 牌效与防守助手，文档／结构未见自由聊天；未全面审阅所有 Go 文件 |
| FlyAgent，2026-11-04 公开页 | [仓库介绍](https://github.com/FlyA-official/FlyAgent)、[官网](https://nashout.com/en)、[使用指南](https://nashout.com/articles/user-guide) | 只确认“模型动机／解释链路”展示；文档没有给出提问输入、对话历史或聊天配置证据，不能将其计入已确认支持追问的项目 |

**针对“实时分析＋能自由追问”的需求：本轮在这些第三方项目中没有核实到与我们当前形态相同的完整实现。** 这只是对已列对象与固定版本的结论，不能宣传全生态唯一。最有直接代码借鉴价值的对话实现仍是 xMahjong；另一个问答 UI 参考是 Mahjong Paipu Assistant，但须补上其缺失的聊天历史语义。

## 小肥鱼参考来源补充（2026-11-05）

依据小肥鱼固定提交 `6e8e21271be458fe62d1a201fb92af7fa386eefe` 的[第三方声明](https://github.com/nanashi77777/xiaofeiyu-mahjong-llm/blob/6e8e21271be458fe62d1a201fb92af7fa386eefe/THIRD_PARTY_NOTICES.md)和[参考项目说明](https://github.com/nanashi77777/xiaofeiyu-mahjong-llm/blob/6e8e21271be458fe62d1a201fb92af7fa386eefe/docs/design/references.md)，并抽查部分上游 README 与许可。以下是研究线索和建议，不代表本项目已复制、引入、运行或验证这些来源；小肥鱼对第三方的使用也不等于本项目已经使用。

| 来源 | 对本项目的价值与建议 | 状态和边界 |
| --- | --- | --- |
| [MahjongRepository/mahjong](https://github.com/MahjongRepository/mahjong) | **优先**作为开发期离线差分参照：固定规则与手牌，比较普通型、七对子、国士向听及适用的役种／算点结果，再逐条调查分歧 | MIT Python 库；原参考调查阶段尚未进行本项目差分验收，后续已完成下述有限规则差分，未引入扩展运行依赖。上游天凤结果不证明雀魂全部规则等价 |
| [shinkuan/Akagi](https://github.com/shinkuan/Akagi) | **优先**参考雀魂事件恢复、立直、杠、宝牌时点及 mjai 映射，以真实授权事件和固定版本验证本项目状态机 | 已有用户参考和 v2／v3 接入记录，分别见[参考索引](../REFERENCES.md)及 [Akagi v3 验收](../validation/AKAGI_V3_VALIDATION.md)；不得将固定人工样本推及真实整场或其他版本 |
| [MahjongRepository/mahjong_soul_api](https://github.com/MahjongRepository/mahjong_soul_api)，含 [protocol.proto](https://github.com/MahjongRepository/mahjong_soul_api/blob/master/ms/protocol.proto) | **优先**作为认证、快照、操作及计时字段的协议调查线索，对照本项目 wire reader 与授权事件 | 仅研究，不作为运行依赖；小肥鱼称其 schema 仅在本机调查，未纳入公开源码。文件再分发许可未确认，字段或历史版本不证明当前客户端兼容 |
| [747929791/majsoul_wrapper](https://github.com/747929791/majsoul_wrapper) | 参考 Liqi 解码、操作列表及事件分层；如未来研究可见牌面核对或辅助校准，可进一步评估其分类器 | 上游仓库 LICENSE 为 MIT；旧协议覆盖和当前客户端兼容性未验证。小肥鱼记录转换使用其权重，本项目未引入；复用前分别核查权重、训练素材、依赖及分发条件 |
| [747929791/MajsoulAI](https://github.com/747929791/MajsoulAI) | 参考历史事件桥接、座位和牌编码，为状态机边界提供对照 | 上游仓库 LICENSE 为 MIT；历史实现及子模块应分别核查，不据此推定当前雀魂兼容，本项目未接入 |
| [yuhao7370/AutoMajsoul](https://github.com/yuhao7370/AutoMajsoul) | 未来可研究桌面配准、牌面分割与界面校准思路；当前以事件采集和既有手动校准为主，视觉识别非优先项 | 上游声明 CC BY-NC-SA 4.0；小肥鱼仅研究流程，本项目未引入。代码、模型及素材具体许可与来源须分别核对，不因公开而推定可纳入本项目 MIT 分发 |
| [erreurt/MahjongAI](https://github.com/erreurt/MahjongAI) | 可作手牌、役种与传统策略架构的历史思路参考，优先级低于规则和协议对照 | 小肥鱼未确认可用许可证且声明未复制其源码；本项目未复用，未经明确授权不复制实现或资产 |

优先顺序是先做规则差分与真实事件／重连核查，再依据实际需求评估视觉方案。第三方测试数据、旧协议和上游自述均不能替代本项目在对应规则、版本与真实客户端上的验证；如决定引入代码、权重或素材，另行固定来源并检查许可、归属及分发条件。

后续验证状态（2026-11-05）：已用固定 `mahjong==1.4.0` 完成 1,012 组有限规则差分，并对固定 Akagi V2 与 mahjong_soul_api 补充合成事件回归；不覆盖全部役种／计分或真实整场兼容。真实事件及整场重连验收暂缓，快照恢复仍不支持，详见[规则与事件核查](../validation/RULES_EVENTS_VALIDATION.md)。

## 专业 AI、训练框架与复盘引擎

| 项目 | 研究价值 | 使用前的实际条件／边界 | 许可与证据 |
| --- | --- | --- | --- |
| [Equim-chan/Mortal](https://github.com/Equim-chan/Mortal) | Rust `libriichi`、Python／PyTorch、mjai、强化学习、快速模拟 | **框架开源不等于官方权重开放**；须分别确认 checkpoint、版本、规则与动作头 | AGPL-3.0；D，另见[官方文档](https://mortal.ekyu.moe/) |
| [Equim-chan/mjai-reviewer](https://github.com/Equim-chan/mjai-reviewer) | Mortal／Akochan 复盘、局面筛选、HTML 报告组织 | 本地 Mortal 仍需模型；README 明示 Docker 镜像未维护。网页服务可用不代表开放调用 API | 主项目 Apache-2.0；D；引擎另计 |
| [critter-mj/akochan](https://github.com/critter-mj/akochan) | 搜索／期望值型基线、评分分解、与神经网络意见比较 | C++／Boost 构建；不是低成本浏览器依赖 | **自定义许可**，非商业输出、再分发及 AI 部分修改有具体限制；C/D |
| [Cryolite/kanachan](https://github.com/Cryolite/kanachan) | 雀魂四麻、序列特征、训练与牌谱标注 | README 明示不提供采集器、数据和训练模型；目标强度不能当成已达结果 | API 未识别许可，复用前逐文件确认；D |
| [hongdp/LLM_Mahjong](https://github.com/hongdp/LLM_Mahjong) | 复刻牌山配对、轮换座位、训练日志、对手池、BC 与纯自博弈比较 | 名称含 LLM，但 README 明示当前主线已转为小型专用网络，早期 LLM 训练路线已退休；“Mortal 级”是作者限定基线结果 | 未确认明确许可；D |
| [penguinHH/mahjong-llm](https://github.com/penguinHH/mahjong-llm) | 感知／动作／解释分工、确定性事实＋小模型解释、配对统计 | 不提供训练权重与牌谱；README 的高一致率不是即插即用能力，更不是胜率 | 主代码 Apache-2.0，`libriichi_patch` AGPL-3.0；C/D |
| [SiyeW/riichi-analysis-engine](https://github.com/SiyeW/riichi-analysis-engine) | 动作、对手状态、风险等多头输出；Riichi Engine Protocol 2.2 | 明示仍在开发，**无正式权重／训练数据**；不是 mjai 的同义名称；对手暗牌输出是预测，不是观察事实 | AGPL-3.0-or-later；D |
| [747929791/MajsoulAI](https://github.com/747929791/MajsoulAI) | 历史雀魂 AI 与 JianYangAI 接线线索 | 最近推送 2024-06；当前服务及客户端适配未确认 | MIT 为 API 识别；M |
| [moxcomic/MajsoulAI](https://github.com/moxcomic/MajsoulAI) | 历史雀魂／天凤 AI 产品路线 | 最近推送 2024-07；段位仅为简介自述 | GPL-3.0 为 API 识别；M |

**研究判断：** 专业引擎适合作为可选决策来源和分歧参照；它们不能替代解释质量验证。暂不建议为了同类项目宣传的段位，改变本项目“无需专业引擎也能运行”的默认定位。

## 规则、向听、计分与 JavaScript 生态

| 项目 | 可以解决什么 | 对本项目的适配判断 | 许可／证据 |
| --- | --- | --- | --- |
| [kobalab/majiang-core](https://github.com/kobalab/majiang-core) | 手牌、副露、向听、和牌计分、局进程与玩家基类 | **优先**。JavaScript，与现有 Node 测试链路接近；先作离线对照，打包与 MV3/CSP 再单独验证 | MIT；C/D |
| [kobalab/majiang-ai](https://github.com/kobalab/majiang-ai) | 传统 AI、开发工具、固定牌山重复对局 | 研究攻守取舍和确定性基线；不必将整套 AI 带入扩展 | MIT；D |
| [MahjongRepository/mahjong](https://github.com/MahjongRepository/mahjong) | 向听、役、符、番、点数与和牌判定 | **优先**。Python 离线差分 oracle 候选；无需因此引入浏览器 Python。上游海量天凤验证自述不等于雀魂全规则等价 | MIT；D |
| [EndlessCheng/mahjong-helper](https://github.com/EndlessCheng/mahjong-helper) | 多步进张、好型、打点和危险启发式 | 对已有本地效率与防守证据有价值；需区分确定规则、经验表与估计概率 | MIT；D |
| [tomohxx/shanten-number](https://github.com/tomohxx/shanten-number) | C++20 向听算法、查表和理论依据 | 研究边界与验证方法；暂不为浏览器引入原生构建 | LGPL-3.0 为 API 识别；D |
| [Cryolite/nyanten](https://github.com/Cryolite/nyanten) | 高效 C++ 向听／置换数计算、最小完美哈希 | 注意 API 返回 `replacement number = shanten + 1`；副露牌从输入计数排除，不能直接接现有向听合同 | API 为 NOASSERTION，许可另核；D |
| [Apricot-S/xiangting](https://github.com/Apricot-S/xiangting) | Rust 向听库及 Python 绑定 | 可作第二类算法交叉验证；存在依赖开销，先验证需求再考虑 WASM | MIT 为 API 识别；D |

建议的差分样本覆盖普通型、七对子、国士、赤五、已副露、暗杠、四枚持有、三麻缺少 2m–8m，以及“能进张但无役／振听”的区分。**向听相同只验证局部计算，不验证可和牌、危险率或战略建议相同。**

现有 `extension/mahjong-analysis.js` 已有本地向听、已见牌与逐家风险特征；下一步是用独立实现寻找合同和边界差异，而非未经测量就替换整个模块。

## 模拟器、协议与评测平台

| 项目 | 核心能力 | 建议用途与边界 | 许可／证据 |
| --- | --- | --- | --- |
| [smly/RiichiEnv](https://github.com/smly/RiichiEnv) | Rust＋Python、Gym 风格 API、合法动作、mjai、三四麻与规则配置、回放 | **优先**研究离线整场与合法性评测；默认天凤规则和雀魂 preset 要显式固定，不能假定等价 | Apache-2.0；D |
| [hamakyo/jev-mahjong-bench](https://github.com/hamakyo/jev-mahjong-bench) | 同状态比较、合法率、p50/p95 延迟、用量、置信校准、整场与混合代理 | **优先**研究指标和实验合同；捆绑样本是 toy fixture；ECE 衡量的是相对参考的一致校准，参考并非真值 | 实读 LICENSE 为 MIT，覆盖 API 的 NOASSERTION；C/D |
| [eitaar/driichi](https://github.com/eitaar/driichi) | 人类、mjai、MCP LLM 混合对局；轮换座位和回放 | 适合隔离环境研究；尚无 Release，需源码构建；**三麻房间不等于支持三麻 MJAI**，后者当前不支持 | MIT 为 API 识别；D |
| [mjx-project/mjx](https://github.com/mjx-project/mjx) | C++／Python 模拟器、Gym、gRPC、批量推理 | 有论文和研究价值，但 README 当前明确 **build broken**，且不支持 Windows／Apple Silicon；本项目 Windows 首选不宜选它 | MIT；D |
| [gimite/mjai](https://github.com/gimite/mjai) | 历史日麻 AI 服务器与协议源流 | 查规范和事件语义；不能将所有生态的 `mjai` 消息批次、时机和 meta 当成完全相同 | 许可未确认；M |
| [smly/mjai.app](https://github.com/smly/mjai.app) | Bot 包装、执行、协议／容器与评测生态 | 学习 stdin/stdout、批次刷新和 Bot 执行约定；源码仓库与同名网站是两个证据对象，本轮网站访问失败 | AGPL-3.0；D |
| [MahjongRepository/tenhou-python-bot](https://github.com/MahjongRepository/tenhou-python-bot) | 历史天凤机器人 | 元数据确认已归档，适合历史参考，不推荐新依赖 | MIT 为 API 识别；M |

建议分开报告四组指标：

1. **工程可靠性**：状态覆盖、合法动作率、过期结果率、断线恢复、请求交付率。
2. **解释可信度**：事实正确、引用有效、候选比较充分、未知处理、追问是否污染局面。
3. **决策对照**：专业引擎 Top-1／Top-K 一致、合法候选差值；不能命名为绝对正确率。
4. **整场效果与成本**：固定规则、模型与 checkpoint，轮换座位／复刻牌山；报告样本数、置信区间、顺位／收支、端到端延迟与全请求成本。

我们当前同一牌谱的 45 点解释评测不能与第三方数千局面一致率或整场成绩直接排名。要扩大样本，应优先按**牌谱／场次隔离**，避免同场相邻巡目跨训练、提示调参与最终测试。

## 采集、转换、牌谱与统计

| 项目／入口 | 价值 | 具体边界 |
| --- | --- | --- |
| [MahjongRepository/mahjong_soul_api](https://github.com/MahjongRepository/mahjong_soul_api) | Protobuf wrapper、协议生成与版本更新流程 | README 的账号密码例子限 CN，EN／JP 需另做认证；不是现成跨服无账号采集器。明确许可未确认 |
| [yf-dev/majsoul-record](https://github.com/yf-dev/majsoul-record) | 牌谱解析器线索 | 本轮只确认仓库元数据／简介，原始 `README.md` 路径 404 不表示仓库不存在；当前客户端适配未确认 |
| [Xerxes-2/mjai-batch-review](https://github.com/Xerxes-2/mjai-batch-review) | 获取近期雀魂记录、批量 Mortal 复盘、汇总报告 | README 明示需先运行自己的 Mortal＋reviewer，另需模型；不是现成免费云后端 |
| [honvl/Majsoul-to-NAGA](https://github.com/honvl/Majsoul-to-NAGA) | 雀魂与 NAGA 输出流程 | 已有参考对象，本轮更新元数据；README 文件名未进一步定位，不新增兼容结论 |
| [kobalab/tenhou-url-log](https://github.com/kobalab/tenhou-url-log) | 电脑麻将格式转天凤 6 JSON，MIT | 输入是 **kobalab 牌谱**，不是雀魂原始 Protobuf；适合比较输出结构，不是直接雀魂转换器 |
| [SAPikachu/amae-koromo](https://github.com/SAPikachu/amae-koromo) | 牌谱屋前端与统计展示 | 本轮定位的 canonical 仓库；原猜测 `AmaeKoromo/amae-koromo` 返回 404，不使用该地址 |
| [SAPikachu/amae-koromo-scripts](https://github.com/SAPikachu/amae-koromo-scripts) | 数据处理、统计聚合、限流、存储与采集脚本；页面显示 MIT | 代码许可不授予服务器访问额度或牌谱再分发权；应分开评估统计算法与数据来源 |

[牌谱屋公开页](https://amae-koromo.sapk.ch/)说明其记录覆盖金／玉／王座段位战，数据可能不完整或不正确，且通常延迟数分钟至数小时；因此它是**赛后统计参考**，不能替代我们的实时获取器，也不能直接当作全量实战覆盖真值。

## 教学、回放 UI 与素材

- [kobalab/majiang](https://github.com/kobalab/majiang)及[公开演示](https://kobalab.net/majiang/)：规则、AI、UI、服务端、牌谱转换分包组织。其[majiang-ui](https://github.com/kobalab/majiang-ui)提供手牌、桌面、回放、分析、统计和编辑器，MIT。适合后续独立训练／复盘页研究，未确认直接适配本项目 Shadow DOM、打包与交互合同。
- [Euophrys/Riichi-Trainer](https://github.com/Euophrys/Riichi-Trainer)：效率练习、牌谱分析、末局逆转练习；README 明示效率是**当前进张，无后续展望**，不能把训练题首选推广为完整战略最优。GPL-3.0，为交互参考。
- [FluffyStuff/riichi-mahjong-tiles](https://github.com/FluffyStuff/riichi-mahjong-tiles)：普通／黑色 SVG 与 PNG；README 明确 CC0／public domain，比 API 的 NOASSERTION 更有说明力。是可选素材源；本项目已有原创 SVG，本轮不提出替换需求。
- `mahgen` 在 Akagi V3 NOTICE 中被记载为 MIT Web Component，用于牌姿表达；本轮猜测的原始 README 路径未命中，仅作待定位线索，不给出已核实复用建议。

教学产品可研究“从已分析局面生成何切题→用户先答→显示候选证据→追问→稍后复习”。这比继续堆叠实时指标更贴近本项目学习目标，但应先验证现有解释是否可靠。

## GitHub 之外的公开产品与研究资料

| 来源 | 本轮看到的内容 | 对我们的意义 |
| --- | --- | --- |
| [MahjongCopilot 官网](https://mjcopilot.com/) | 实时指导、HUD、本地／在线模型、三四麻、Windows 客户端与开源入口 | 交叉核实仓库的产品定位；没有因此验证现版本客户端可用 |
| [FlyAgent 官网](https://nashout.com/en) | 实时教学、候选／危险／对手推测、历史、云推理与商业 Key；有请求脱敏预览说明 | 对标开箱体验、展示信息和请求透明度；不是开源技术依赖，不采用其训练优劣宣传作为研究结论 |
| [Mortal 官方文档](https://mortal.ekyu.moe/) | 模拟器、训练、mjai、观察／动作表示、libriichi、权重说明 | 更可靠的协议与工程入口；不能从框架文档推导当前官网模型权重开放 |
| [NAGA 官方公开页](https://naga.dmv.nico/naga_report/order_form/) | 登录、付费方案、逐手评价、3D 报告、局面复习题与多类型模型 | 教学／复习流程参考；未登录，未试用，未提交牌谱 |
| [THUDM/LLM4CardGame](https://github.com/THUDM/LLM4CardGame)及[论文](https://arxiv.org/abs/2509.01328) | 多类牌类游戏、教师数据、微调、多任务与通用能力评估 | 实验方法补充；不能只凭论文名称或 RLCard 的麻将环境就认定覆盖完整日麻规则，许可也须再核 |
| [ailab-pku/Mahjong-LLM](https://github.com/ailab-pku/Mahjong-LLM) | Botzone LocalAI 教学模板、兼容 API 客户端、提示与重试 | 参考对局服务与 LLM 适配；README 未证明其规则等同雀魂日麻，不列为即插即用日麻引擎 |

NAGA 公开页当前明确写有：**解析报告不得用于开发／应用与该服务及天凤竞争的产品**。这与“网页可看／可购买”是不同问题。因此目前只研究公开产品交互，不建议采集其报告用作本项目训练、批量评测或产品数据；若以后需要，应先核对具体用途与条款。这里不改变已有手动导出功能，也不声称已经完成其使用条款评审。

本轮没有确定先前提到的“mjai bot 在线服务”究竟是哪一家；`mjai.app` 仓库、同名网站、Mortal 官网以及其他托管推理服务不能混称。

## 许可与维护状态：会影响选型的几处细节

- **Akagi V3**：[LICENSE.txt](https://github.com/shinkuan/Akagi/blob/v3/LICENSE.txt)为 Apache-2.0；[NOTICE](https://github.com/shinkuan/Akagi/blob/v3/NOTICE)记载 Go `mahjong-helper` 部分 Rust 移植、RiichiEnv 依赖，以及只借鉴协议的项目。不能把本项目已固定的 V2 许可说明直接覆盖成 V3，反之亦然。
- **xMahjong**：[LICENSE](https://github.com/ponder-j/xMahjong/blob/main/LICENSE)实读为 MIT，尽管 API 显示 NOASSERTION；其 Mortal、Akochan 和其他组件仍保留独立许可。
- **jev-mahjong-bench**：[LICENSE](https://github.com/hamakyo/jev-mahjong-bench/blob/main/LICENSE)实读为 MIT；不能只靠自动识别作否定判断。
- **FlyAgent**：[LICENSE](https://github.com/FlyA-official/FlyAgent/blob/main/LICENSE)明确 Proprietary，不能将公开 release 仓库计入可复用开源项目。
- **Akochan**：[日文许可](https://github.com/critter-mj/akochan/blob/master/LICENSE)限定非公开研究、非商业输出以及再分发／修改条件；不能当 MIT 或一般宽松开源处理。
- 小肥鱼、kanachan 等未确认明确许可的仓库，可以研究其公开方案，但不能仅凭“可以 fork”就认定获准复制、分发和商用。
- Mortal／libriichi、mjai.app 与其他 GPL／AGPL 代码，需按实际复制、链接、修改和分发方式评估。独立进程是工程边界，不是自动免除许可证义务的结论。
- 模型权重、训练数据、牌谱、UI 代码和图片素材分别确认来源与许可；不将仓库主许可证扩大到所有内容。

元数据中值得关注的活动：Akagi 最近推送 2026-11-01，MahjongCopilot 2025-03-22，Mortal 2025-09-28，mjai-reviewer 2025-02-22，mahjong-helper 2022-06-23，RiichiEnv 2026-10-27，MahjongRepository/mahjong 2026-11-01。日期均取 API 的 UTC 日期，仅提示后续维护评估优先级，**不据此直接判定活跃项目更强或旧项目失效**。

## 建议的产品方向与优先级

1. **定位：实时分析与可回看的个人麻将教练。** 牌局中及时给出有时效标记的建议，结束后回到原决策看依据、比较候选并连续追问。面向想理解选择的玩家；不承诺替用户自动打牌或保证获胜。
2. **可解释：事实、推断和未知分开。** 复用本地向听、进张上界、现物等事实；不把进张上界当牌山余量，也不将模型偏好或引擎 Q 值包装为放铳概率。对证据不足的内容明确标注，逐步支持点击查看依据。
3. **可延续：决策就是讨论的锚点。** 建议、局面快照、时点、用户问题和回答在同一讨论中可回看；切换到实时牌局时撤下过期提示。已有能力应先做可发现性与稳定性验证，而非重复开发。
4. **可选择：纯 LLM 起步，专业引擎按需启用。** 现有 `mortal-explain` 将引擎动作和 LLM 解释分离；动作先显示，解释失败可重试。当前真实引擎验证仍限弱示例和人工局面，不能宣传为线上 Mortal 4.1 或已证明专业牌力。
5. **可信任：把成本和不完整说清楚。** 显示数据采集是否完整、模型请求状态和可得用量；未知费用保持未知。选择和授权由用户控制，独立获取器保持不含模型运行时。

### 产品体验与质量验证

| 优先级 | 建议 | 本项目现状与下一步 | 判断是否有效 |
| --- | --- | --- | --- |
| P0 | 真实实时链路验证 | 真实对局授权样本覆盖开局、座位、赤牌、鸣牌、断线／重连、过期结果；记录无法重建的局面 | 同一事件前缀可复现状态；错误、缺口与旧建议均可定位；不以合成样本代替实战验收 |
| P0 | 证据化候选比较试点 | 从已有 X-F 目录选少量事实，做候选与证据引用原型；保留其他模式的现有合同 | 固定样本人工核验事实错误、引用支持率、候选覆盖和额外耗时／费用；未知不能被填成安全 |
| P0 | 冻结追问质量评估 | 选取涉及前文指代、替代候选、局面变化的问题；检查原局面、问答历史和不泄露未来信息 | 人工评估上下文一致、依据正确和未答问题；与现有实现基线比较，不只看 JSON 是否通过 |
| P1 | 复盘定位与快捷提问 | 在现有整盘整理、来源跳转上优化；只展示有证据的实际动作和已留存决策 | 用户可从概览到原决策、提问并返回；未分析／已淘汰记录清晰标注，不能声称全场覆盖 |
| P1 | 上手和状态体验 | 检查扩展授权、模型配置、手牌校准、断线、费用未知及失败重试 | 用首次使用任务记录完成率、步骤、错误与恢复；模型质量和服务费用分别报告 |
| P2 | 外部咨询摘要 | 研究用户预览后主动复制局面与已授权依据；默认不自动发送 | 人工检查快照时点、未知字段、对手暗牌和未来信息；明确外部平台处理边界 |
| P2 | 多平台／双引擎探索 | 先做独立可行性研究；不把未验证权重、规则或权限纳入当前承诺 | 确认用户需求、规则与数据授权、兼容及维护成本，再决定是否实现 |

以上是建议和验收方向，不表示已经立项、实现或验证。实际牌力、教学效果和差异化体验需要独立用户与牌谱样本验证；先固定规则、输入、模型版本与评价方法，再对比结果。

### 规则、评测与学习工具的补充工作

以下补充生态层面的研究顺序；状态保留原调研时点口径，后续进展以文首验收记录为准。

| 顺序 | 研究／实现对象 | 预期收益 | 判断是否值得继续的证据 |
| --- | --- | --- | --- |
| P0 | kobalab 与 Python mahjong 作离线差分参照 | 找到向听／规则／计分边界问题 | 独立用例集的分歧逐条分类：编码、规则配置、实现错误、适用范围；不先引入生产依赖 |
| P1 | RiichiEnv＋jev benchmark 的隔离评测方案 | 从单牌谱小样本扩展到可重复多场验证 | 固定版本和规则，独立牌谱分组；先验证我们的事件和动作映射，再谈牌力对比 |
| P1 | 将历史讨论变成训练题／复习卡，参考 Riichi-Trainer 与公开产品 | 强化“理解取舍”的长期价值 | 用户先答后解释，保留证据与版本；区分当时建议、后来解释与纠错 |
| P2 | kobalab UI、Akagi V3 的多平台／三麻／统计组织 | 扩展未来产品范围 | 先证明当前四麻链路和解释可靠，再承担新平台／新规则维护成本 |

暂不优先：迁移桌面架构、捆绑未经验证的大模型权重、把自动打牌作为主功能、依赖第三方未公开在线接口，以及直接照搬其他项目的段位／一致率宣传。

## 检索中的纠错与未解决项

1. `AmaeKoromo/amae-koromo` 为 404；本轮已找到真实来源 `SAPikachu/amae-koromo` 与 scripts。
2. `pgx-project/pgx` 为 404；没有把这个猜测地址或 PGX 泛称当成已验证日麻模拟器。
3. 部分原始 `README.md` 路径 404 只是文件名或分支不匹配，不代表仓库失效。MahjongCopilot 已通过仓库渲染 README 与官网补证；其他未补证项保留 M 级。
4. API 的 `NOASSERTION` 只是未自动识别，xMahjong、jev benchmark、CC0 牌面已用具体文本纠正；未实读许可者继续标识其证据来源。
5. 没有复现第三方牌力、教学质量、云端价格、模型可得性与全场兼容；没有对 GitHub 外所有代码托管平台作穷尽检索。
6. 本文是时点调研。实际选用时仍需冻结 commit、依赖版本、规则、权重哈希和许可文件，验证后再更新[接入边界](../REFERENCES.md)。

## 本项目验证与文档边界

本文不引入第三方代码、模型或数据，不替代当前实现清单。原调研时本项目完整实时协议、真实模型教学质量和整场引擎兼容尚未证明；后续版本的实际范围查阅[验证记录](../../VALIDATION.md)、[X-F 范围](../guides/XF_CONTEXT.md)、[Mortal 工作流](../validation/MORTAL_WORKFLOW_VALIDATION.md)、[整场记忆](../guides/USER_MEMORY.md)及文首的当前专项验收记录。

原来的五项目对标与追问专项已并入本文，旧文件仅保留跳转入口。仓库元数据、来源索引和固定提交源码链接继续作为原研究证据保留。
