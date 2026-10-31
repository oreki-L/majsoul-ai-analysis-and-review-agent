# 可复用上下文 benchmark

新实验可使用已实现的 [自主执行与恢复工作流](BENCHMARK_AUTONOMOUS.md)：`autonomous` 一次启动后冻结全部静态传递依赖、监督重启、按冻结规则重试与合同预留、自动补测/汇总、导出持久盲包并生成 HTML/Markdown/JSON。独立评分仍需具备权限的外部评审端导入；报告明确分开执行、评审、账单状态。本文下方 `run/resume` 是保留的旧合同，不会自动改变旧实验的重试或费用规则。

这是一个默认离线、Node 22 CommonJS、无新增依赖的通用执行器。公开示例完全合成；真实局面、独立标签、Key 配置、checkpoint 和报告放在已忽略的 `research/evidence/`。参考首选一致、权重和文字评分不能等同正确率、胜率或牌力。费用是根据 usage 与配置单价计算的估算，不是供应商实扣凭证。

本引擎可组合上下文策略，但**没有宣称本轮 32 realtime / 5 branch / 3 global 方案、43 决策点和 QA 题组已经冻结**。真实 campaign 仍需独立冻结数据、同一题组、方案参数、模型参数、授权范围、重复次数与预算。完整 production B-current、完整 state adapter 等特殊语义必须显式提供可信插件；不能把内置 compact 或 extract 当成等价实现。

公共 `campaign-policies.cjs` 提供带版本的 32 realtime 构造策略，`production-v010.cjs` 保留基准 commit `7977a771a6c5471a0e6ed2092ee5c1ec20102d0f` 的精确 messagesFor/authorizedEvents。它们需要可信插件显式提供已清洗、哈希绑定的真实 baseline、观察分组和节点绑定；不把首决策快照近似为开局。未知 policy/version/窗口拒绝运行。此扩展仍需 campaign 独立参数冻结与验收；5 个独立 branch 压缩和跨局 global 不由这套 realtime policy 隐式代替。

历史 exchange 现在可保留成功请求最后 user 原文与最终 assistant 原文，仍不带跨决策 tool turns。生产自然追问通过显式 policy 使用冻结 snapshot 的生产重复基线与完整 JSON response schema，和 generic free-text smoke 分开。`scheme.aliasOf` 是显式结果别名，复用 canonical 请求、自然追问、账本与结果，不增加独立样本；别名是否等价仍须实验预注册证明。

`discussion-policies.cjs` 独立支持 fullbranch/code/free-text/code+free-text/code+typed 五种长讨论处理。冻结当前 snapshot 永不参与历史压缩，typed 摘要逐项核对 source QA 引用、用户逐字引用和冻结 snapshot 字段值。`global-policies.cjs` 单独支持 selected-round/asOf 的 Full/Code/Hybrid，工具只能取明确 scope 内的决策/事件/计算，原主会话或别的 branch 聊天不自动注入。它不把非连续选定小局当成整盘。

受控实验可通过 `--fixed-source` 复用真实冻结原始分析，`--seed-branches` 携带同一真实 QA 前缀，只对新的固定后续问题计请求与评分。源 fixture 不作为新的 main 结果计时/排名。`summary-jobs` 显式准备受控 probe 的冷摘要，所有准备费归同一个 `--budget-file`；准备耗时与答案延迟分开，mock 冷摘要保留 synthetic 标记，不能升级成正式源。

真实执行支持 `execution.backgroundPolicy="shared-quota"`：至多一个摘要请求与前台共享 provider 配额，前台不等待摘要；已派发摘要不强制取消以免产生未知付费负债。并发不代表隔离，实际竞争/失败/延迟会记录。后台准入保护下一次前台的保守费用余量；费用不足时拒绝本次后台准入，不应把正常准入拒绝误记为持久化失败。`--budget-file` 的排他累计账本跨 setup/main/probe/branch/global/repeat 保留用量，任何阶段不能重新获得一份预算。

## 离线复现

```powershell
npm run benchmark:validate
node benchmark/cli.cjs dry-run --suite benchmark/examples/suite.mock.json
node benchmark/cli.cjs run --suite benchmark/examples/suite.mock.json --mock --out research/evidence/benchmark/demo
node benchmark/cli.cjs resume --suite benchmark/examples/suite.mock.json --mock --out research/evidence/benchmark/demo
node benchmark/cli.cjs score --checkpoint research/evidence/benchmark/demo/checkpoint.json --labels benchmark/examples/labels.synthetic.json
node benchmark/cli.cjs report --checkpoint research/evidence/benchmark/demo/checkpoint.json --labels benchmark/examples/labels.synthetic.json
```

`validate` 与 `dry-run` 不加载 labels、Key，不执行 context 插件、不触网。`run` 和 `resume` 必须选择且只选择 `--mock` 或 `--live`。已有 checkpoint 不会被 `run` 覆盖；用 `resume` 或新输出目录。mock 输出明确标记 synthetic，不能据此比较模型效果。

示例含两局、四决策点、普通与鸣后弃牌、多巡历史、逐点追问、独立 global task、复核与异步摘要。鸣后显式约束禁打牌；完整合法动作集合经本地牌型计算与数据声明约束交集校验。标签只有两个点，刻意展示全组共同缺测；原始 MAKA 权重不必合计 100。

## 配置与新增方案

`suite.schemaVersion=1`，`dataset` 是相对 suite 文件的局面 JSON 路径，`labels` 只作独立评分时的路径提示。运行阶段不会读取该文件。`models` 是模型 ID 到 provider 配置的映射；每个 `schemes[]` 有独立 `id`、`modelId`、可选 `summaryModelId`、`credentialAlias`、`review` 和 `context`。

主调用、复核与追问优先使用 scheme.credentialAlias；显式 summaryModelId 的摘要优先使用该 summary model 自己的 credentialAlias，缺失时才回退 scheme。报告中的 keyAlias 是配置引用，并不暴露实际 Key，也不假设别名代表独立配额。

模型可配置 `usageSemantics: {"inputIncludesCached": true, "noCache": false}`，仅接受这两个可选布尔字段。inputIncludesCached 指 provider 的 input 总量是否包含缓存命中；noCache=true 仅适用于 provider 明确定义为不使用缓存的模型／端点。必须依据供应商 usage 定义配置，不能因为响应缺少 cache 字段就猜缓存数为 0。未声明 noCache 且缺失明细时保留未知；缓存与非缓存单价相同时可据已知 input 总量估价，但不会伪造缓存拆分。该配置仅用于本地计费归一化，不作为 generation 参数发送给 provider。

```json
{
  "id": "custom-example",
  "modelId": "model-a",
  "summaryModelId": "model-a",
  "review": false,
  "context": {
    "current": "compact",
    "events": "important",
    "eventWindow": 32,
    "snapshots": {"mode": "extract", "recent": 1},
    "advice": {"mode": "llm", "recent": 1, "trigger": 3},
    "activeCards": true
  }
}
```

`current` 支持 full/compact；compact 仅含当前自家手牌、摸牌、副露、北与必要局况，完整对手公开状态可经冻结工具读取。`events` 支持 none/important/all/related，可指定 relatedSeats/importantKinds/eventWindow。历史 snapshots 与 advice 各自选择 none/raw/truncate/extract/code/llm/hybrid，`recent` 保留尾部原文，`trigger` 是摘要最少前缀条数。truncate 在 `maxChars` 总窗口下丢弃最旧的完整历史项，不剪断 JSON；强制 recent 超预算会显式标记。code 是显式图例的 JSON 编码；extract 是固定字段提取；二者不等同生产紧凑状态协议。每个方案、每个 repetition 都维护自己的成功历史；某方案出错不会借用其他方案答案，也不把失败答案加入后续历史。

调度在每局内保留决策因果顺序，跨局交错，并以 seed/repetition/决策轮换方案先后。前台请求保持顺序。`execution.backgroundPolicy` 默认 defer，真实执行会把摘要延后至前台结束，保持原文 fallback；这会产生 late-unused/insufficient_exposure，不能当作已测得的摘要方案效果。显式 independent-quota 需要不同的 `foregroundQuotaId` 与 `summaryQuotaId`，且摘要方案指定不同的 `summaryModelId`；这是用户声明的独立配额假设，不是供应商验证。该模式下 `execution.concurrency>1` 才让摘要使用额外槽，始终保留一个前台槽，不同步等待摘要。mock 可模拟并行，但报告明确其 synthetic 身份。每次原始 HTTP、工具后续模型请求、追问、复核、重复与摘要都入同一预算；可选的 maxModelRequests/maxToolCalls 对整个 campaign 生效，null 表示不设对应次数限制。

## 数据与三个 channel

数据结构是 `rounds[].events[]` 和 `rounds[].decisions[]`。decision 具有 `id/position/type/snapshot/legalActions/followups`，可显式声明 `decisionContext`；鸣后必须声明 `discardConstraints`。snapshot 由现有 snapshot contract 清洗，scope 绑定 session/round/授权范围。一个局内 decision position 严格递增，legalActions 必须穷举受约束的合法弃牌集合，赤五不被普通五悄悄代替。

- realtime：独立当前决策，仅读取该方案截至本点之前的成功历史与截止位置事件。
- decision-discussion：`decision.followups:[{id,question}]`，冻结该点原始 answer、历史、摘要和 snapshot；后续追问只加入本分支已完成的问答，不写回主会话历史。
- global-analysis：`round.globalTasks:[{id,nodeId,question}]`，nodeId 指向同局冻结点；独立 request，只读取其之前历史，不携带原始 answer 或讨论分支内容。内置通用 builder 仅支持同局 global scope；显式使用上述 global-policies 可信适配器时可提供冻结的 selected-round/asOf 跨局 scope，不代表整盘。主答失败会把依赖它的追问明确标记 blocked；global 不依赖主答仍可执行。campaign 提前停止时余下 planned 结果也显式保留 blocked。

工具使用本点冻结的已授权 snapshot、截止 events 和本地确定性计算；没有任意文件、网络或未来牌谱读取工具。所有摘要输入都来自同 scheme/round/channel/授权范围的已完成前缀，descriptor 绑定 source hash 与 coveredDecisionIds。ready 前使用原文，ready 后只互斥替换匹配前缀；更短的有效摘要允许保留未覆盖后缀原文。晚到且没有后续消费者的摘要记录为 late-unused，失败为 discarded。历史模型意见和摘要始终是意见，不升级成当前权威事实。

## 可信 context 插件

在 `scheme.context.module` 指定相对 suite 的本地 `.cjs`，`context.options` 传参。文件内容参与 resume fingerprint；validate/dry-run 只解析/指纹，不执行模块。执行时模块有 Node 本机权限，只应选择人工审阅的可信代码。

```javascript
module.exports.version = 1;
module.exports.buildContext = ({ baseline, snapshot, events, prepared, options }) => {
  // baseline 已按截止点和授权范围构建，不会传入 labels 或未来节点。
  return { messages: baseline.messages };
};
```

插件收到 scoped input 与 baseline，必须同步返回 text messages。它不能通过这套参数获得金标或未来节点；可信模块本身仍须遵守不自行读取私密 labels/未来数据的实验约束。新增特殊上下文适配器时，先给独立冻结的字段合同与无未来测试，再把 32/5/3 campaign 模板映射为具体 scheme；未实现的语义应拒绝运行。

## Live 与恢复

真实执行显式使用 `--live --credentials <私密配置路径>`。每个模型需 openai-compatible provider、无内嵌凭据的 endpoint、model、maxTokens、完整 input/cachedInput/output 单价与同币种 currency；execution 需正 budget.cap。maxModelRequests/maxToolCalls 可保持 null，不默认套用产品调用上限。Key 只通过 credentialAlias 延迟解析，mock/validate/dry-run 不解析。planNN 必须命中 `credentialAliases`，并由配置 `executionGate="allowed"` 或精确冻结的 scoped authorization 授权；不会跨命名空间回退到 groups。group 解析也必须由 caller 或 scoped authorization 显式授权，CLI 不默许。每个请求先按保守输入字节界与最大输出预留费用；未知 usage、超预留或未知已付负债会停止后续付费请求。没有自动重试或后台探测。

checkpoint 原子替换，另写追加 audit；包含完整成功历史、冻结讨论、摘要、分支、每次 request 状态和账本。fingerprint 绑定 suite、数据源内容、模型与参数、授权范围、seed、context 插件与内部执行源码；不包含实际 Key、runId、输出目录或独立标签。改变输出目录不会让同一 checkpoint 重复计分。resume 只接受同 fingerprint 与相同 mock/live 模式；任何未决 HTTP/已预留未知负债直接拒绝自动重发，须先在供应商侧人工核对。不要通过手改 pending 为 failed 绕过核对，否则可能重复扣费。完成的 request 会复用响应，恢复后的 history/QA 不会丢失。每轮真实送模的 system/messages/tool schema 与同轮后续工具回执写入脱敏的私有 `requests.private.jsonl`，模型返回写入 `responses.private.jsonl`，均位于私密输出目录；不把 provider reasoning_content 加入后续决策历史。证据持久化失败会停止后续请求。checkpoint 另有排他 `.lock`，同路径不能同时 run/resume；不会自动删除陌生或损坏的 stale lock，人工清理前须核对未决请求和付费状态。

## 评分和报告

labels 独立文件：`{schemaVersion:1,labels:[{decisionId,maka?,gpt?}]}`。每个 source 的 candidates 是 `{action:"discard",tile,weight}`；MAKA 必须显式 preferred，权重可不合计 100；GPT 权重是合计 100 的非负整数，argmax 并列皆算命中。0 权重候选仍算候选覆盖，但不算正权重覆盖。失败、非法和未完成答案在有标签的评分点都记 0、保留分母；缺标签按 source 全组共同缺测。结果 ID 去重，resume/同 ID 别名不会重复计分计账。

人工／独立 grader 评分可用 `--human FILE` 导入 `{results:[{id,score}]}` 或 `{results:[{resultId,scores:{coherence:4,factual:3}}]}`。结果 ID 必须存在且同 ID/维度不能重复；按方案/run/channel/维度汇总分数、缺测与失败，缺成功样本评分时不伪造全组平均。当前不会调用任何在线 grader，也未假定未来 GPT 倾向标签已生成。首轮比较独立展示，repeat 各 run 保留分母，另给 mean/min/max，绝不通过累加重复轮次分母与单轮比较。主报告分别列 main/branch/global 首轮成功请求的 submit→validated-final P50/P95；main 包含工具循环与独立 review，followup 单独计时，失败/blocked覆盖率和所有 request role 延迟另表展示。JSON report 保留 role/scheme/keyAlias/run 分账、unknown liability、摘要实际接入、未接入与 covered source；未知 cost 保持 null，不作免费。Markdown 强调 synthetic 和估算边界。仅对照同 campaign、同决策与同 QA、同重复次数才有可比性。
