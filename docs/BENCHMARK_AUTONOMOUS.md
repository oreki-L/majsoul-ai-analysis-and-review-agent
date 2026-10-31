# 自主 benchmark 执行与验收

本实现供新的实验运行使用，基于 v0.11.1；产品 `extension/**` 未改动，`production-v010.cjs` 的历史策略保留。旧 `run/resume` 命令继续采用原有保守恢复合同；新命令显式启用本文的冻结、恢复与重试规则，不接管旧实验。

## 一次启动

```powershell
npm run benchmark:validate
node benchmark/cli.cjs autonomous --suite benchmark/examples/suite.mock.json --mock --out research/evidence/benchmark/my-new-demo
```

输出目录必须为新目录。监督器在同一命令内启动普通 Node worker；worker 意外退出会按冻结次数自动重启，Windows 使用隐藏窗口。不会安装系统服务或开机任务。关机、休眠或监督器本身退出后，用同一目录恢复：

```powershell
node benchmark/cli.cjs autonomous-resume --mock --out research/evidence/benchmark/my-new-demo
```

恢复不再需要活动 suite、dataset 或插件。`bundle/` 冻结静态 `require` 的全部传递依赖并重定位外部模块；无法静态解析的插件动态依赖在启动时拒绝。运行、恢复和报告均使用冻结模块，验证全部文件哈希和 Node 主版本。外部插件仍是人工审阅的可信 Node 代码，不提供对恶意插件的操作系统沙箱；不得自行读取标签、未来节点、活动文件或私密配置。插件的数据依赖应使用静态 JSON `require`，不能把运行时任意文件访问当作可冻结依赖。

Live 显式使用 `--live --credentials <私密文件引用>`；环境变量引用沿用 `env:NAME`。执行器不会把实际 Key 写入运行包、日志或报告。`--authorization FILE` 的授权内容和 `--budget-file FILE` 的累计账本路径在启动时绑定；恢复不能换成另一份预算。所有主答、追问、工具后续、结构修复、基础设施重试、摘要、补测均计入同一账本。既有旧账本中没有恢复凭证的未决预留不会被猜测性释放。

## 冻结失败策略

`--policy FILE` 可覆盖以下默认值；未知字段拒绝：

```json
{
  "maxRetries": 2,
  "baseDelayMs": 1000,
  "maxDelayMs": 30000,
  "maxWaitMs": 120000,
  "jitter": 0.2,
  "httpTimeoutMs": 60000,
  "categories": ["pre-dispatch", "rate-limit", "service", "network", "timeout"],
  "unknownCost": "block",
  "circuitFailures": 3,
  "circuitDelayMs": 30000,
  "maxRestarts": 2,
  "restartDelayMs": 1000,
  "maxRecoveryWaitMs": 86400000,
  "reviewConcurrency": 2,
  "reviewRetries": 1,
  "supplemental": false,
  "liabilityContracts": []
}
```

逻辑时限来自 suite；每次重试共享该时限，尊重 `Retry-After`。熔断等待也计入时限，不自动切模型或借用其他 Key。401/403 和明确配置错误禁用相应方案；预算不足停止新增请求。语义低分、结构重复无进展、非法动作不会触发基础设施重试。短暂文件占用只重试本地写入；磁盘满和损坏证据停止准入，保留脱敏原因及恢复行动。

默认未知费用阻断。启用 `unknownCost="contract-hold"` 必须提供 `liabilityContracts[]`，包含 `provider/endpoint/model/modelId/inputTokens/outputTokens/rates/currency/additionalCharges`，其中 `rates` 是每百万 token 的 `cachedInput/uncachedInput/output` 最高价格，`additionalCharges` 必须为 `"none"`。另需 `attestation` 的 `verifiedBy/verifiedAt/sourceUrl/evidenceText/evidenceSha256`；证据文本的 SHA256 必须匹配。由人工确认供应商完整收费上界，执行器只验证来源绑定、完整字段、模型/端点/缓存和峰值价格覆盖，不替代合同真实性审查。

```powershell
node benchmark/cli.cjs contract-hash --contract verified-provider-proof.json
```

将该输出写入模型 `liabilityBound.contractHash`，并使 `inputTokens/outputTokens` 与证明一致，把同一证明对象放入 policy 的 `liabilityContracts`。不能用请求字符数、历史平均 usage 或自填一个哈希自动生成 hold。每个未知物理尝试至多一个 hold，摘要也适用；原始 cost/usage 仍为 null，hold 不是实扣账单。超出上界、未知额外收费或预算不足明确阻断。

## 持久化与崩溃边界

`events.jsonl` 是带序号/hash 链的追加日志，`events.jsonl.objects.jsonl` 是内容寻址的对象库；对象先 flush，状态事件随后引用根。映射按哈希分桶，数组分块，未变的局面/提示词只存一次。内存索引只保留对象哈希与文件偏移，不保留历次完整状态。checkpoint 为可重建索引，每 25 个终态、10 秒或运行首尾刷新；缺失 checkpoint 可从对象库与日志重建。

派发意图先落盘，再发送 HTTP；完整响应先 fsync，再结算账本、推进作业。预留后、派发意图前崩溃可以证明未发送，释放预留；派发后无响应必须合同 hold 或阻断。已记录响应在恢复中按物理 attempt ID 和精确 wire body hash 重放，不重复发送或计费。响应落盘后尚无终态的窗口也受此协议覆盖。锁绑定 PID、进程创建身份和随机 token；陌生锁和损坏锁不擅自删除。断行保留备份；完整行或对象哈希损坏阻断。

持久化可以做到不重发已有可靠响应，但供应商没有幂等接口时不能承诺 HTTP 恰好执行一次。恢复后的原时限保持；超时恢复交付、恢复等待与原实时成功延迟分开。`supplemental=true` 在前台与摘要结束后自动补测基础设施失败点，使用当时冻结 messages、局面、事件、工具输入和摘要水位。结果进入 `supplemental` 独立轨，不回写历史、不替换原结果、不取最高分；补测费计入总预算。

## 独立评审

默认使用盲包导出/独立结果导入；Node 不直接调用 Codex 子代理，也不假定本机有 `gpt-6-sol / medium` 的模型权限。执行中生成 `review/blind/*.json` 和持久 `review/queue.jsonl`。评审不可用或导出短暂失败不会抹去成功回答或阻断前台。独立标签单独冻结在 `evaluation/labels.json`，不进入模型运行包；运行结束自动计算参考统计。

默认六维是 `factual_accuracy/explanation_grounding/legal_comparison/context_isolation/calibration/usability`，每项 0..4；`legal_comparison` 要求实质合法备选、依据和适用条件。默认简写量表不是此前全部人工评审合同的等价证明，不应仅因维度名字相同就跨轮比较均分。可用 `--review-rules FILE` 提供完整量表，在 `evaluation/review-rules.json` 单独冻结。规则字段结构见 `benchmark/review.cjs` 的 `RULES`；允许附加严重错误门槛等说明，所有内容绑定 `rulesHash`。

评审结果文件格式：

```json
{
  "results": [{
    "blindId": "盲包中的ID",
    "sourceHash": "盲包sourceHash",
    "rulesHash": "评审队列中的rulesHash",
    "model": "gpt-6-sol",
    "reasoningEffort": "medium",
    "scores": {"factual_accuracy": 3, "explanation_grounding": 3, "legal_comparison": 3, "context_isolation": 4, "calibration": 3, "usability": 4},
    "citations": [{"target": "answer", "quote": "回答中实际存在的逐字引用"}],
    "severeErrors": []
  }]
}
```

```powershell
node benchmark/cli.cjs review-import --out research/evidence/benchmark/my-new-demo --human independent-scores.json
node benchmark/cli.cjs autonomous-report --out research/evidence/benchmark/my-new-demo
```

导入是独立人工步骤，不是已经自动完成的模型评分。执行器验证来源/规则/model 身份、评分范围、六维覆盖及引用确实出现在本盲包；具体语义、引用是否支持判断以及严重错误是否存在，由独立评审端判断。已完成评分不可覆盖为更高分；重复导入同一结果幂等。

需要程序化执行端时，可调用 `createReviewQueue(output, contractHash, frozenRules).drain(execute, {concurrency, retries})`；`execute(packet)` 仅收到盲包，返回上述单项结果。使用单一 `review.lock` 保护一个消费者；重启后 running/pending 从日志恢复，释放槽后继续派发，不向执行端传方案、Key、费用、金标或其他回答。示例适配器应先具备冻结要求的权限；禁止静默换模型。此接口没有内置付费模型传输或费用豁免；本版本可收费的内置执行角色不包括独立评审。若外部执行端自行付费，必须另行冻结并向总预算接入其费用入口；不能把没有计账的付费 adapter 宣称为受预算保障的运行。

## 报告和限制

`report.html/report.md/report.json` 使用同一统计快照、生成时间、运行合同和 snapshot hash。HTML 主展示质量综合均分 /4 与可评/计划覆盖；六维和 gate 默认折叠，缺评不补零，也不按 gate 排名。另列 MAKA/GPT 各自得分率与两者平均、首选一致、候选覆盖、成功端到端均值/P95、失败耗时、实时含摘要与失败均费。得分率是实际动作权重总和除以每点参考最高可得权重总和；MAKA 权重无需合计 100。

默认主表为实时首轮；追问/global/repeat 和补测单列。实时均费只摊实时及摘要，其他角色仍全部进入总账；未知费用保持未知。报告分别标记 execution、review、billing；`complete` 执行不等于评审已完成或供应商账单已核对。当前账单以 usage 估算及 hold 证据为准；供应商后续对账应追加审计调整，不能删除原未知记录或手改 hold。未内置供应商对账接口。

合成规模复现：

```powershell
node benchmark/scale-smoke.cjs research/evidence/benchmark/new-scale-120 120
npm test
npm run check
```

规模 smoke 会记录 120 点执行和恢复耗时、日志/对象库/checkpoint 字节、RSS 与峰值 RSS。它检验执行器存储规模，不代表模型延迟、真实牌力或正式 638/1236 点实验已执行。真实样本与真实 API 验收需另行授权。
