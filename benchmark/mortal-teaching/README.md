# Mortal 教学实验执行器

仅用于本轮实验；不改变产品默认提示词。设计与采纳条件见 [实验方案](../../docs/benchmark/MORTAL_LLM_PROMPT_EXPERIMENT_20261105.md)。

- 被测：冻结的四套提示词、`deepseek-flash`、4096输出上限、非思考、实验参数 `temperature:0`。产品 Worker、Pi 1.4.0、工具、HTTP构造、解释解析、动作阶段消息和本地存储实际运行。
- 引擎：固定 `yuchen-582500`，通过产品身份及动作校验。开发阶段先缓存24点真实校验动作，四套共用；验证阶段每分支重新推理。
- 数据：冻结历史45＋39点，逐点截断、遮蔽对手暗牌及摸牌、移除操作字段，小局内重编索引并保留原 consumed cursor。属于牌谱模拟，不代表浏览器渲染或真实在线牌局。
- 开局修复后的输入使用 `mortal-teaching-inputs-v2`：通过当前状态机重建，仅允许庄家开局首节点的缺失 `selfDrawnTile` 从null补为原手牌末张。保存原snapshot、前后hash及逐字段变化，其他事实变化拒绝。原84点现全部通过推理前校验，开发24／验证60；旧准备目录保留，新版本继续共用活动账本。
- 独立总额：50 CNY，复用原配置中的 `group:G` 引用，密钥仅进内存。旧预算与账本不动。每次HTTP派发前按完整1M上下文上界预留2.12992元，完整usage按高峰价估费；未知费用保留预留并停止，重启不自动重发。
- 评分：新合同 `mortal-teaching/1.0.0`，`gpt-6.1-sol / medium`，五个共同维度＋可选比较维。没有比较不扣分；明确询问比较时适用。重大错误fail，未决问题needs_review。排名使用共同五维。

## 离线准备和演练

以下路径均为示意，应替换为本机实际文件；输出必须位于ignored的 `research/evidence/`。`prepare`读取凭据以确认引用可解析，不发送网络请求。价格HTML应先从方案中的官方链接保存；prepare校验并冻结其SHA-256与已核对的价格合同。

```powershell
node benchmark/mortal-teaching/cli.cjs prepare --out research/evidence/EXPERIMENT --evidence D:/雀魂插件/research/evidence --credentials PRIVATE_CONFIG_JSON --pricing-html SAVED_OFFICIAL_PRICING_HTML
node benchmark/mortal-teaching/cli.cjs mock --out research/evidence/EXPERIMENT --stage development
node benchmark/mortal-teaching/cli.cjs mock --out research/evidence/EXPERIMENT --stage validation --winner p1-grounding
node benchmark/mortal-teaching/cli.cjs mock --out research/evidence/EXPERIMENT --stage supplement --winner p1-grounding
node benchmark/mortal-teaching/cli.cjs report --out research/evidence/EXPERIMENT --stage development --mock true
```

mock只使用合成传输响应，仍跑真实产品Worker与Pi。可用输入、代码、候选、评分规则、预算、价格均冻结；修改后在同一活动目录下建立新的准备子目录，不能把已有批次换成新版本。所有准备版本共享父目录的 `billing/` 账本；换准备版本不能重置50元。批次ID绑定输入、提示词与代码hash，账本区分各版本调用并累计费用。运行中途崩溃的逻辑作业必须审计，执行器不会自动重新发送。完整已结束作业可以恢复，原失败不替换。

## 真实运行顺序

引擎启停及开局兼容最后准备。启动时将既有本地引擎连接配置保存在ignored私有JSON，字段为 `endpoint/model/engineProfile/apiKey`，令牌不放命令行。CLI仅允许认证的loopback `/analyze`。

```powershell
node benchmark/mortal-teaching/cli.cjs cache-engines --out research/evidence/EXPERIMENT --engine-config PRIVATE_ENGINE_JSON
node benchmark/mortal-teaching/cli.cjs run-development --out research/evidence/EXPERIMENT --engine-config PRIVATE_ENGINE_JSON
node benchmark/mortal-teaching/cli.cjs review-export --out research/evidence/EXPERIMENT
node benchmark/mortal-teaching/cli.cjs review-import --out research/evidence/EXPERIMENT --file REVIEW_RESULTS_JSON
node benchmark/mortal-teaching/cli.cjs report --out research/evidence/EXPERIMENT --stage development
node benchmark/mortal-teaching/cli.cjs select --out research/evidence/EXPERIMENT --winner WINNER_ID
node benchmark/mortal-teaching/cli.cjs run-validation --out research/evidence/EXPERIMENT --winner WINNER_ID --engine-config PRIVATE_ENGINE_JSON
node benchmark/mortal-teaching/cli.cjs run-supplement --out research/evidence/EXPERIMENT --winner WINNER_ID --engine-config PRIVATE_ENGINE_JSON
node benchmark/mortal-teaching/cli.cjs review-history --out research/evidence/EXPERIMENT
node benchmark/mortal-teaching/cli.cjs status --out research/evidence/EXPERIMENT
```

开发组完整评分后才允许选择；`select`执行预定质量／效率门槛，未通过则保留P0。验证后report另列采纳门槛，不自动发布。为保守自动判断，候选含任何major时不自动选用／采纳；需要复核或新开发版本，不能靠均分抵消。效率费用指标是统一高峰价下的usage估费，所有对应attempt已知才可比较；实际账单另核。

重复样本按用户更新固定为九小局各两个代表点，共18点。按原冻结可见状态选取，覆盖3个庄家首摸、非庄家早段闭手、6个鸣后点、多副露、对手已立直、较晚牌山和赤牌；不根据模型新答案或历史评分选样，不声称覆盖所有动作或具有统计代表性。坐标、选取理由及可见事实随 `supplement-plan.json` 冻结，完整名单见实验方案。任一固定点缺失、不兼容或重复均拒绝准备，不自动替补。

追问固定为 `east2-h0:0`（庄家首摸）、`east4-h0:24`（鸣后）、`south4-h0:64`（对手已立直）各两轮，共6问。补测合计24个逻辑作业，全范围开发96＋验证120＋补测24＝240个；所有调用仍共用本轮50元上限。重复恢复原请求前存储并逐字校验首个Pi输入，只重用原动作；追问恢复原保存决策及自己的前一问答，均不重新推理。补测不回灌主批历史，也不替换主答。原锚点未交付就保留补测未交付，不能另挑好样本。

## 独立评审导入

每份盲包包含完整答案、授权snapshot／事件／合法候选、当时上下文及实际工具结果，移除system prompt和引擎身份；随机盲序持久化。可能由文风推断来源，不声称完全双盲。`history-xf.json`只读原首遍9个运行目录，保留83份旧评分及1个原失败；历史重评只导出83份已交付原答，不为每套候选重复评历史。

历史盲包始终使用原回答实际见到的原snapshot。3个首摸补全点在历史sidecar的 `inputComparison` 及总合同中标明新旧hash、差异和 `identicalSnapshot:false`；其余81点相同。只允许经规范化来源校验的这类差异，不直接取消历史输入一致性检查，也不把新补全事实用于评价旧答案。跨版本结果仍可逐决策对读，但这3点不得称为完整相同输入的对照。

导入文件：`{results:[...],attestation:{model:"gpt-6.1-sol",reasoningEffort:"medium",evidence:"执行元数据出处",billing:{kind:"included-in-subscription",additionalApiChargeCny:0,evidence:"无额外API收费的执行依据"}}}`。单项输出合同在盲包rules内，引用须逐字存在；导入时全批验证，已完成评分不可覆盖。模型身份的执行证明来自外部运行记录，不能只让评分模型自称身份。

目前提供导出／导入通道，**未启动评审**。只接受有记录的订阅内评审；未配置付费6.1 API价格／责任上界的执行器，拒绝用未知收费的外部评审绕过50元总额。若后续增加付费评审适配器，必须把每个评审attempt也接入同一本轮账本并重新冻结合同。

本次没有实施开发后可选的额外一轮修订；如触发，必须新增候选ID与批次、保留旧输出，并在验证揭盲前重新冻结，不能覆盖四套文件后继续运行。
