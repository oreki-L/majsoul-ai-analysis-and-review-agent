# Mortal＋LLM 事实输入优化与下一轮回归

本轮先准备实验候选和执行器，不更换生产默认，不启动付费生成。上一轮原答、失败、评分及历史参照保持冻结。输入数据已经用于开发和评分，下一轮明确称为开发复测／回归，不能作为未见数据上的泛化证据。

## 优化依据

上一轮正式验证60机会中交付56份、质量通过23份；内容共同五维均分为2.889／4，分母是56份已交付且完成评分的答案。4次未交付不计入这个内容均分，但保留在23／60质量通过率分母。33份答案有major。三个仅增加文字强调的提示词候选均未达到采纳门槛，故这次优先给模型明确的计算结果，而非继续堆叠核对要求。

下表次数来自上一轮新增170份交付答案的272条原评分错误，排除83份历史答案；每条错误只有一个主类，同一答案可出现多类错误。格式故障另计。

| 优先处理 | 全轮错误条 | 正式验证错误条 | 改动与边界 |
| --- | ---: | ---: | --- |
| 手牌形状、副露、张数、可见计数 | 112 | 28 | 给出实体手牌、逐牌计数、实际弃后手牌；明确摸牌已包含、手牌与副露分别计数，不自动选择唯一分组 |
| 现物、筋、防守对象与安全表述 | 64 | 20 | 每份风险证据绑定seat、相对身份及该家原牌河索引；筋壁不推导安全概率 |
| 役牌、宝牌、赤宝牌 | 30 | 10 | 显式给指示牌对应宝牌、赤牌身份、三元牌／场风／自风身份和已有刻杠；不宣称完整役种或得点已验证 |
| 向听、进张、效率比较 | 23 | 6 | 复用本地向听和进张上界；零向听标为形状听牌，不能等同有役可和；不同向听不能仅按进张总数排序 |
| 局名、风位、庄家、座位 | 21 | 13 | 直接给场风、局号、庄家、自风及四座相对身份，减少模型自行换算 |
| 牌名、编码 | 14 | 4 | 保持snapshot统一编码，事实卡附中文名；赤五与普通五保留不同实体编码 |
| 其他理由、比较、证据校准 | 8 | 1 | 解释可核实的收益和代价；不假装知道Mortal内部动机，证据不足时明确不足 |

另有9次格式失败：7次漏`limitations`、2次无效JSON；另1次重复测试因原锚点未交付而跳过。JSON模式只能约束JSON语法，不能保证三个必需字段或内容正确；仍使用产品严格解析器，不静默补字段、修复输出或覆盖失败。

## 候选矩阵

原四候选文件独立保存在`benchmark/prompts/mortal-teaching-20261106/`。根据用户提出的中文字牌方向，新增五候选目录`benchmark/prompts/mortal-teaching-20261106-honors/`，继承四份原始提示词字节，额外加入R4；旧目录与旧准备证据不改。事实卡与历史投影只在实验harness内启用，生产P0、动作校验及mjai传输保持原实现。P0在同一新版执行器下运行。

| 候选 | 事实卡 | 自动历史隔离 | JSON模式 | 比较目的 |
| --- | --- | --- | --- | --- |
| `p0-release-v2` | 无 | 原实现 | 原实现 | 当前生产混合链路同期对照 |
| `r1-facts` | 有 | 原实现 | 原实现 | 确定性事实输入及配套解释指引是否减少事实错 |
| `r2-history` | 有 | 有 | 原实现 | 在r1上隔离旧教学文本，观察后续决策事实错和承接变化 |
| `r3-json` | 有 | 有 | `json_object` | 在r2上加强三字段提示并开启JSON模式，观察交付率 |
| `r4-honors-zh` | 有 | 原实现 | 原实现 | 与r1比较：将模型侧字牌直接写为中文，观察编码误译是否减少 |

这是逐层组合方案比较。r1同时改变事实输入与使用指引，r3同时改变格式提示与传输参数，结果不能进一步归因于其中单一成分。为让历史隔离方向进入开发选择，下一轮开发也按小局维护各方案独立的连续历史，仍共用每点缓存引擎动作；不能沿用上一轮每点清空历史的开发方式。新旧开发分数因此仅作背景描述，改善判断以本轮同期P0为准。

R4是从R1分出的编码实验，不叠加历史隔离或JSON模式。R1保留`{"code":"2z","name":"南"}`这类编码与中文并列的事实卡；R4将模型侧结构化字牌值及计数字典的牌键统一换为`东、南、西、北、白、发、中`，例如手牌中的`"2z"`变为`"南"`。数牌、赤五、座位数字及规则数字保持原定义。当前snapshot、引擎动作、事实卡和工具结果必须使用同一模型编码，不能只改手牌而让工具返回旧码。

转换只作用于模型输入副本，不改变引擎协议、原始局面、动作合法性校验或来源hash。用户问题和历史教学原句保持原文，不用字符串全局替换改写引文；提示词明确它们可能保留旧码，旧引文不作为当前事实。评分包保留原snapshot作为授权依据，并记录模型实际看见的中文投影和工具结果。R4能否优于R1仍需真实复测，不预先认定中文必然更好。

已于2026-11-06只读核对[DeepSeek JSON Output官方说明](https://api-docs.deepseek.com/guides/json_mode)：使用`json_object`，提示词需包含JSON及输出示例；该模式也可能返回全空格，即使`finish_reason`为`stop`。本实验将其保留为未交付，不自动重试。该文档不作为JSON模式与本项目工具循环共同兼容的实测依据；真实检查仍待执行，未采用或宣称支持JSON Schema。

事实卡从本次冻结snapshot和已经通过校验的引擎动作生成，保留来源绑定。直接列出选中动作所需事实，效率候选仅为本地计算候选，不能冒充引擎合法动作集或偏好排名。保留原工具查询能力，冲突或不可计算时如实保留原因。鸣牌不补造后续弃牌，立直只有存在已验证`followUp`时才计算配套弃牌后的事实。

自动下一决策只移除历史模型教学意见，保留历史建议的动作字段和授权事件；旧建议不等于实际打出，也不代表当前事实。冻结讨论追问保留原问题、原回答和前一轮追问，不能通过删掉语境来规避承接错误。备选比较始终由模型按教学价值决定；用户明确要求比较时必须回应，不能捏造合法候选。

## 下一轮顺序

1. **离线准备**：复制原冻结84点、当前发布X-F历史参照、18代表点重复及6问计划；校验原文件hash、缓存引擎身份和输入绑定；冻结新候选、投影代码、评分规则及新批次ID。mock跑真实Worker／Pi／工具／严格解析器，覆盖开发、连续回归和补测。
2. **真实格式兼容检查**：大批调用前，用固定开发点的同一引擎动作，对r3验证`response_format:{type:'json_object'}`与真实工具请求、工具继续轮及严格三字段解析共存，完整保存请求、原响应和usage。只通过mock不能解除门禁。兼容检查失败保留原始失败，停止大批运行；不能默默取消JSON模式后继续沿用同一候选ID。
3. **开发复测**：24点×5方案＝120机会，所有方案共用逐点真实缓存动作。3个开发小局内，按各点position顺序维护每方案独立历史，并按点轮换候选调用顺序。逐份独立盲评后应用原冻结门槛；未满足则保留P0。
4. **连续回归**：60点×P0及胜者，最多120机会，按小局分别维护真实产品历史，各分支重新推理并核对动作。只有胜者为P0时缩为60机会。该数据已揭盲，只能支持同数据回归结论。
5. **稳定性与追问**：胜者使用原18代表点重复、3锚点各两问＝24机会；重复恢复原输入及动作，追问绑定原讨论并承接前答，不调用引擎。未交付锚点保留缺失，不换点、不补跑覆盖。

主实验最多264个回答机会，另加真实兼容检查及其工具继续HTTP；机会数不等于实际HTTP数。新增R4增加24个开发机会，仍使用原50元活动上限。兼容检查、工具继续、后续获准补测均须走原活动总账本。

新入口为`benchmark/mortal-teaching/retest.cjs`。以下为本地工作区中的命令；`PRIVATE_ENGINE_JSON`是ignored文件中的既有认证连接配置，不在命令行放令牌。准备和mock不发模型请求；`smoke-json`及其后的真实运行命令只在开始下一轮时执行。

```powershell
$retestSource = 'research/evidence/mortal-llm-preparation-20261105/prepared-representative-v1'
$retestOutput = 'research/evidence/mortal-llm-preparation-20261105/prepared-honors-v1'
node benchmark/mortal-teaching/retest.cjs prepare --source $retestSource --out $retestOutput
node benchmark/mortal-teaching/retest.cjs mock --out $retestOutput --stage development
node benchmark/mortal-teaching/retest.cjs mock --out $retestOutput --stage regression --winner r4-honors-zh
node benchmark/mortal-teaching/retest.cjs mock --out $retestOutput --stage supplement --winner r4-honors-zh
node benchmark/mortal-teaching/retest.cjs status --out $retestOutput
```

开始真实测试时，先检查原Yuchen 582500连接配置和缓存身份；缓存已经通过源合同校验时无需重跑24次引擎推理。然后执行：

```powershell
node benchmark/mortal-teaching/retest.cjs smoke-json --out $retestOutput --engine-config PRIVATE_ENGINE_JSON
node benchmark/mortal-teaching/retest.cjs run-development --out $retestOutput --engine-config PRIVATE_ENGINE_JSON
node benchmark/mortal-teaching/retest.cjs review-export --out $retestOutput
# gpt-6.1-sol / medium独立执行；保留执行证明后导入。
node benchmark/mortal-teaching/retest.cjs review-import --out $retestOutput --file REVIEW_RESULTS_JSON
node benchmark/mortal-teaching/retest.cjs report --out $retestOutput --stage development
node benchmark/mortal-teaching/retest.cjs select --out $retestOutput --winner WINNER_ID
node benchmark/mortal-teaching/retest.cjs run-regression --out $retestOutput --winner WINNER_ID --engine-config PRIVATE_ENGINE_JSON
node benchmark/mortal-teaching/retest.cjs run-supplement --out $retestOutput --winner WINNER_ID --engine-config PRIVATE_ENGINE_JSON
```

回归与补测后继续导出／导入评分，再分别生成`report --stage regression`和`report --stage supplement`。任何候选、输入或运行代码变化都需新建同父目录准备版本；不能在付费开始后修改冻结合同继续运行。

## 评分和判定

复用`mortal-teaching/1.0.0`与`gpt-6.1-sol / medium`，五个共同维度加按需适用的比较维度。major／critical不能用均分抵消；没有比较且用户没有要求时比较维为NA。

每组并列报告：

- 交付率＝严格解析并在时限内完成数／固定机会数。
- 质量通过率＝评分通过数／固定机会数，未交付及未尝试机会保留在分母。
- 内容均分＝已交付且完成评分答案的共同五维均分，同时显示已评分数和待评分数。
- 端到端均分＝全部交付答案完成评分后，以未交付为0计算的共同五维总分／固定机会数；评分未齐前不得把待评当0发布最终值。
- 按原七类统计错误条数及影响回答数，major与minor分列；格式失败及锚点跳过另列。
- 延迟、usage估费、同点质量胜／负／平及动作差异；历史X-F仅作参照，不当作同期控制。

沿用上一轮选择与采纳门槛，不因上轮表现差而放宽：开发候选必须无major／critical、无未决评分和动作差异，并在至少两小局改善；质量路径要求通过数至少净增2、成对胜多于负且共同均分不降。效率路径仅在交付、质量通过和均分不降时考虑至少15%的延迟或完整估费改善。

连续回归的绝对门槛仍为交付率≥95%、质量通过率≥80%、无major／critical；质量采纳路径还要求相对同期P0通过率至少提高5个百分点、至少两小局改善、均分不降、p95增幅≤10%。效率路径保持质量和均分不降，并达到≥15%的延迟或完整估费改善。完整门槛由执行器实现，文档不替代机器判定；通过后也不自动更换生产或发布。

下一轮将重新对齐同点历史结果，仅读当前发布方案X-F的原首遍；不增加同期纯LLM、不混其他方案或旧复跑。3个庄家首摸规范化差异继续单列，不称为完整相同输入比较。历史评分可复用，不因候选变化重评83份历史答。

## 预算、版本与结论边界

所有准备目录继续使用`research/evidence/mortal-llm-preparation-20261105/billing/`，沿用50元活动上限和已有`group:G`凭据引用。上一轮usage高峰价估费为2.68691464元，理论剩余47.31308536元；以实际共享账本为准，不能新建50元预算。未知费用／未完成派发阻止新增调用，失败不自动重试。订阅内6.1评审需要执行证明；新增付费评审必须纳入同账本并先冻结价格。

原始数据、凭据、模型输出及逐条错误引用保存在ignored证据目录，公开文档只保留汇总。新准备版本不覆盖上一轮合同、原答、评分或选择结果。

事实卡只保证可确定字段的生成方式，不保证LLM会遵守，也不是Mortal内部解释。最终仍需真实模型复测；牌谱模拟不能证明在线浏览器链路、胜率或牌力提升。若同数据回归有改善，再用新小局做独立测试，之后才讨论生产采纳。

## 四候选准备验收（保留记录）

已建立ignored新目录`research/evidence/mortal-llm-preparation-20261105/prepared-facts-v1/`，批次`ac7990c46e2aad60`。原84点及X-F历史、补测计划、授权、价格原字节复用，24点真实引擎动作缓存通过输入和身份校验；数据、候选、评分与运行代码hash已冻结。`PREPARATION_AUDIT.json`记录核查的11份原始核心证据hash不变、共享账本及新批次演练结果。

- `npm run check`通过；全量测试754项：751通过、0失败、3跳过。新增和原benchmark专项合计37／37通过，包含完整模拟JSON＋工具循环、usage缺失停机、冻结合同和评分分母检查；测试数据为合成夹具，不依赖私有牌谱。
- 原84点事实卡预检均能保留本地可用计算，手牌计数、动作实体减牌、风位及snapshot绑定通过。平均事实卡约20KB，最大约28KB；增加的输入量会在真实复测中计入usage和延迟，不预先宣称降本。
- 开发mock 96／96、连续回归mock 120／120、补测mock 24／24交付，共240机会；模型传输均为模拟响应，不是质量成绩。补测18次重复和6次追问共0次新增引擎调用，重复输入逐字绑定检查通过。
- 准备阶段新增付费请求0次，账本估费仍为2.68691464元、预留0、未知费用0。真实兼容检查保持`pending`，未执行；模拟成功不会解除真实批次门禁。

候选和测试支持已落盘，生产默认未变。下一轮第一步是显式执行`smoke-json`，通过后按冻结方案运行和评分；当前没有新的教学质量结论。

## 中文字牌候选补充验收（当前准备版本）

根据用户补充，当前执行准备目录更新为`research/evidence/mortal-llm-preparation-20261105/prepared-honors-v1/`，批次`291c3a57c1a53595`，包含五候选。前述四候选准备目录及manifest保留原样，仍可读取status／report；旧运行代码指纹与当前不同，不能将旧批次直接继续执行。

R4把模型侧结构化字牌及计数牌键直接换为中文，手牌、引擎动作、事实卡、合法弃牌／风险候选及工具返回均一致。历史用户问题、旧教学引文及记忆文字保持原样；中文视图标记为`honor-zh-v1`，来源仍为`snapshot-v1`，来源hash按转换前局面计算。原引擎请求和动作保存不变。

原84点预检通过，当前手牌中的157个字牌实例均按中文表示，原座位数字、局数和来源绑定不变。五候选开发mock 120／120、以R4为赢家的连续回归mock 120／120、R4补测mock 24／24交付，共264机会；补测新增引擎调用0。全量测试763项：760通过、0失败、3跳过。

开发报告新增`encodingComparison`，直接报告R4对R1的同点胜／负／平、动作差异、待评数及共同均分差；原候选对P0的选择门槛不变。模拟数据的24对目前均未评分，不产生中文效果优于编码的结论。后续沿原七类统计比较牌名／编码误译及其他事实错，不能只看总均分。

`PREPARATION_AUDIT.json`和`HONOR_PREFLIGHT.json`保存当前验收结果；上一轮核查的原始证据hash不变，准备新增付费请求0次，账本仍为2.68691464／50元。真实JSON／工具检查仍为pending，生产默认未变，尚无R4真实模型质量结果。
