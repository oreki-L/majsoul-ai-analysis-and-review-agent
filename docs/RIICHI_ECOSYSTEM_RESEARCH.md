# 雀魂助手与立直麻将开源生态调研

调研日期：**2026-11-04（北京时间）**。对象为本项目 v0.13.0：Manifest V3 扩展、独立获取器、用户自配 LLM、实时建议、冻结决策追问，以及默认关闭的 mjai／Mortal 教学路径。本文为研究结果和建议，**不表示已接入、已移植或已实测第三方产品**。

同日专项补充：[追问与对话能力核查](RIICHI_CHAT_SUPPORT_RESEARCH.md)。源码确认 xMahjong 会携带最近问答；Mahjong Paipu Assistant 虽有聊天界面，当前请求不传聊天历史；小肥鱼的 QQ 查询／管理员教学与内置逐决策追问不同。下文概括的“追问”须结合这些限制阅读。

## 主要结论

1. **存在直接同类，不能再把“雀魂实时 AI 助手”本身当作独有定位。** Akagi、MahjongCopilot、FlyAgent 已覆盖实时建议、牌面 HUD、历史统计等；其中 FlyAgent 明确是闭源商业产品。
2. **“LLM 解释和追问”也已经有相近实现。** xMahjong 提供双引擎交叉分析、逐候选证据、中文解释与局面追问；Mahjong Paipu Assistant 提供多平台回放、本地引擎和可选 OpenAI 兼容 LLM。两者主要是复盘工作台，与我们的实时扩展切入点不同。
3. **纯 LLM 日麻路线有可直接比较的项目。** 小肥鱼以可知状态、合法动作和 LLM 完成实时选择，包含自动操作与经验；但仍处于开发和连续实战验收阶段，未确认代码再授权。不能把它当作成熟产品或已证明牌力的基线。
4. **短期最值得研究的不是再换一个强模型，而是补充证据、规则对照与评测。** 优先研究 xMahjong、kobalab/majiang-core、MahjongRepository/mahjong、RiichiEnv、jev-mahjong-bench。
5. **Akagi 需要按版本重新理解。** 当前默认分支为 Rust＋Tauri 的 V3，主项目 Apache-2.0，内置小型 Rust 神经网络并支持可选云推理；本项目此前验证的是固定 V2 提交的弱 Mortal 示例。两者不是同一个兼容对象，旧验证结论保持原范围。
6. **我们可争取的组合优势是低安装负担、用户自配模型、实时决策可持续回看追问、确定性事实工具与独立获取器。** 本轮未确认另一个项目完整复现这套组合，但这不构成“唯一”“首个”或功能领先的证明。

## 研究方法与证据范围

- GitHub 使用 **21 组检索**，返回 191 个条目，去重后 **173 个仓库候选**；这是有相关性与分页上限的候选池，不是生态总量。查询包括 `majsoul AI`、`mahjong LLM`、`riichi mahjong AI`、`majsoul helper`、`mjai`、`riichi mahjong analysis`、`雀魂 插件`、`立直 麻将`、`majsoul llm in:readme`、`mahjong coaching`、`mahjong shanten` 等。
- 通过 GitHub 仓库 API 核对 **41 个仓库**的默认分支、推送时间、归档状态与许可证识别结果，见[元数据清单](riichi-ecosystem-2026-11-04.csv)。清单还保留两个错误地址和明确的 404，避免把猜测当作有效来源。[来源索引](riichi-ecosystem-sources-2026-11-04.json)记录查询、74 个页面／文件摘录条目及本地提取文本哈希；条目包含访问失败和重复来源，不代表 74 个独立项目。
- 重点阅读相关 README、官网、目录与部分源码，包含 xMahjong 的解释／证据模块、小肥鱼的模型客户端、牌谱助手的 sidecar、benchmark 的类型合同、kobalab 的向听实现，以及 Akagi 的 LICENSE／NOTICE。
- GitHub 匿名 API 限流后，使用浏览器读取 GitHub 页面及原始文件继续核对。另访问 Mortal 文档、牌谱屋、MahjongCopilot 官网、FlyAgent 官网和 NAGA 官方公开页。通用搜索提供补充线索；部分搜索触发验证码，未绕过。**没有充分覆盖 Gitee／GitLab，不能据此声称这些平台没有同类。**
- 证据分为 **C：源码／许可文件抽查**、**D：README／官方文档核对**、**M：仅元数据／仓库简介**。C 不是全面代码审计；上游运行结果、速度、段位和评测数字均是作者自述，本轮没有独立复现。
- 没有运行第三方程序、下载模型权重、登录第三方服务、提交真实牌谱或付费调用。记录时点的分支内容可能继续变化；`pushed_at` 是仓库推送活动，不等于功能发布、默认分支最近提交或当前可用性。
- 原始检索和页面摘录仅保留在本地忽略目录 `research/evidence/ecosystem-2026-11-04/`；公开报告提供原始链接及元数据清单，不将第三方源码打包为本项目内容。

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

### 最值得细读：xMahjong

其[解释模块](https://github.com/ponder-j/xMahjong/blob/main/backend/xmahjong/explainer.py)不只是一个“请解释引擎动作”的提示词：

- `Claim.kind` 区分 `fact / inference / unknown`，每条引用 `evidence_ids`。
- 对客观事实，服务端使用计算证据重新生成文字；不存在的引用被拒绝。
- 对数值检查引用支持、百分比形式和四舍五入，降低编造评分或风险率的机会。
- 每个候选分别组织优势、劣势、适用条件、横向比较，避免所有解释都只重复首选。

其[独立证据模块](https://github.com/ponder-j/xMahjong/blob/main/backend/xmahjong/evidence.py)对合法弃牌后状态计算向听、未见进张、保留宝牌与逐家现物；不把未知危险率填成零。Mortal 偏好与 Akochan 原始期望值分开保留，不跨模型直接相减。

**对我们的启发：** 在已有 X-F 比较目录和动作／解释分离的基础上，研究是否将关键解释绑定到可点击的证据 ID，并为候选解释增加覆盖检查。不能从这次源码抽查推导出其自然语言全部正确；也不能把规则型数值校验当成完整语义证明。

### 纯 LLM 对标：小肥鱼与研究项目

小肥鱼的[模型客户端](https://github.com/nanashi77777/xiaofeiyu-mahjong-llm/blob/main/src/majsoul_llm/model.py)可见 Responses 风格请求、流式取消、严格 JSON Schema 和用量记录。它与我们的 Chat Completions／Pi 路径存在实际协议差异，不能只改 endpoint 就假定兼容。

其[紧凑输入设计](https://github.com/nanashi77777/xiaofeiyu-mahjong-llm/blob/main/docs/design/model-wire-format.md)提出：领域数据保持清晰完整，模型请求另做投影；共享相同特征，动作使用局部 ID；保留红牌、阶段、完整合法动作和未知项。但该文开头明确是设计契约，**没有运行编码器或实测节省结论**，不能把方案当性能结果。

我们的差别主要是教学与决策历史组织；它的重点是模型选择如何在时间预算内落地为操作。适合对照输入合同、超时、用量和经验隔离，不宜直接照搬其产品目标。

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

## 适合本项目的后续工作顺序

以下是调研建议，尚未实施；本轮没有引入依赖或改变运行逻辑。

| 顺序 | 研究／实现对象 | 预期收益 | 判断是否值得继续的证据 |
| --- | --- | --- | --- |
| P0 | xMahjong 的 claim／evidence 合同，与已有 X-F 目录做小规模对照 | 降低解释编造，候选比较更完整，追问更可核查 | 同一冻结样本，比较事实错误、候选覆盖、追问相关性与额外 token；不只看 JSON 合法率 |
| P0 | kobalab 与 Python mahjong 作离线差分参照 | 找到向听／规则／计分边界问题 | 独立用例集的分歧逐条分类：编码、规则配置、实现错误、适用范围；不先引入生产依赖 |
| P0 | 完整实战事件与重连验证，参考 Akagi V3 Inspector／日志组织 | 弥补本项目完整实时协议尚未证明的缺口 | 同一事件前缀可重放；动作阶段、座位、赤牌、断线边界与过期建议可定位；仅保留授权数据 |
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
6. 本文是时点调研。实际选用时仍需冻结 commit、依赖版本、规则、权重哈希和许可文件，验证后再更新[接入边界](REFERENCES.md)。
