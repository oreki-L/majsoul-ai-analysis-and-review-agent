# Mortal 工作流实现与验收记录

日期：2026-11-01；2026-11-02 随 v0.13.0 整合。本文区分源实现验收与发布整合验收，不构成官方认证或牌力结论。

源实现基线 `6e1126f6a7b8c3e4eee47db6cba1a2994b328979`。发布整合只迁移已核定的35文件，并保留其源码快照与SHA锁；未迁移私有PRD、真实报告、模型资产或旧Pi bundle。

## 当前交付

1. **可选本地决策 → LLM 教学解释**：显式勾选 `mortal-explain`，保留原 Chat/纯引擎路径。Chat 和本地引擎配置、凭据、权限独立。已有配置不会自动启用新模式。引擎沿用完整事件及动作合法性合同；验证后先保存动作并发送阶段消息，LLM 用独立解释 JSON 合同，只能附加教学文本。未通过解释合同不改变原弃牌、实体用牌或立直配套动作；弃牌不再被默认标为进攻。
2. **实时和冻结讨论**：等待更新、失败和取消保留上一份有效卡及其来源；过期牌面提示同步撤下。阶段消息绑定客户端请求与冻结指纹，迟到结果不能成为当前提示。解释失败可只重试 LLM，追问无需切后端或重跑引擎。分支保留原解释及每次问答，连续追问读到原教学与前次回答。初次自动串联使用 live lane 的隔离小局历史和固定记忆，记忆只影响解释；手动与冻结讨论独立。重启将 pending 解释标为中断/费用未知，不自动发请求。清除、关闭与权限/配置失效清理展示，并让在途 UI 导入/回包失效。
3. **官方复盘有限接入**：复盘模式提供原生雀魂分享 URL 的官方 `?url=` 预填跳转。用户自行选择模型、视角并完成 Turnstile/提交。另支持用户主动选择保存的**英文 Classic / mjai-reviewer 1.5.3 / Mortal 3** HTML，只解析白名单数据，脚本、样式、iframe 不执行或加载。当前官网 4.1、KillerDucky、CLI JSON 均明确拒绝。未自动提交牌谱，也没有官网 API、报告轮询或跨站报告读取权限。

官方旧报告的首版仅适配无副露、摸牌后普通弃牌。报告最终动作优先，未取候选最大 Q 值，也不展示 Q/softmax 概率。绑定前逐小局核对完整四家动作序列，再核对起始座位、剩余牌、精确红牌手牌、实际弃牌和唯一游标；不能按巡号猜。缺失/歧义/未适配条目保留计数。只有匹配条目保存独立历史版本，按需解释与追问，不自动全场收费、不提供 live overlay，也不进入用户实际行为学习。完整报告、对手暗牌、未来记录只参与本地核对，不进入当时解释输入。已导入匹配决策可从持久历史回看；未匹配条目的临时列表需重新选择原文件查看，未宣称全部条目已持久化导入。

## 已完成验证

### 真实本地推理

复用了源工作区已有 ignored 资产，没有下载或覆盖模型：

- profile：`akagi-v2-weak-mortal-windows-py311`；来源提交 `91cc2993e4e3682248d33d73d93afe055040e700`。
- checkpoint SHA-256：`e94dc90bc3aaf412b0270d670660d7fe55c9d33b14419f97caf42fe77c01456f`。
- Windows x64 / Python 3.11；`torch 2.7.0+cpu`、`numpy 1.26.2`。
- `node agent/akagi-local.cjs check --dir <model-directory> --python <python311>` 通过，真实返回 `dahai C`。
- `node scripts/validate-mortal-local.cjs <model-directory> <python311>`：四座位人工局面均真实返回该座位 `dahai C`，通过完整 EngineAgent 合法性校验，再通过真实 Pi loop + **mock 教学 transport**。单次记录约 9499/5630/5445/5457 ms，仅为本机人工样本，不是实时延迟承诺。

桥接现在可报告固定 profile、runtime、checkpoint 和 sourceCommit；浏览器只保留有界白名单，未知服务身份保持未知。这是本地服务报告，不能当作官网模型认证。

### 真实报告样本

只读取得公开 [旧版 demo](https://gh.ekyu.moe/mjai-reviewer-demo.html)，没有提交用户牌谱或创建官方任务。原文件 947586 bytes；SHA-256 `444ab33691428d5d2505666fe59367c362c0038967500f472a18173d3f7ead49`。实际 model tag `mortal3-b24c512-t22122709`，生成于 2023-03-07，视角 1。

真实文件离线解析出 13 小局、205 条记录，130 条符合首版普通弃牌结构，75 条明确未适配。这是解析覆盖，**不是 130 条均已对齐本地雀魂牌谱**。仓库测试仅保存无脚本/无第三方牌面素材的结构摘录；动作序列错配、座位错配、红牌错配、实际动作错配、同巡歧义和未知格式拒绝另有测试。没有取得当前官方 4.1 / KillerDucky 报告，未完成其解析或真实雀魂报告全链路对齐验收。

### 自动检查与 UI

`npm test` 最终冻结版本共 589 项，587 通过、0 失败、2 跳过；`npm run check`、`npm run build`、`git diff --check` 均通过。主代理独立隐私/面板/会话/串联验收 70/70 通过，另独立临时目录 Agent/Collector 构建通过，日志 `research/evidence/mortal-final-privacy-acceptance.log`。Collector 构建依赖闭包不包含新引擎解释或官方报告模块；不增加 collector 模型依赖。

关键测试包括：引擎先显示；非法/冲突解释不改首选；解释失败与取消保留动作；仅 LLM 重试；连续追问保留解释；已删除历史不被晚到补写；刷新中断不重发；双服务迁移/权限；实际面板自动请求进入 live lane；历史和固定记忆不传给引擎，不混入手动或未来；报告部分支持与歧义；官方历史教学不发送完整报告。用量导出精确白名单，并测试负数、对象及 SECRET 字符串不能进入新增计数字段或工作流标签。

使用 `playwright-cli` 对 `tests/mortal-workflow-preview.html` 做真实浏览器离线核验，看到动作先显示、解释失败保留动作/仅 LLM 重试、推进事件后旧卡仍可读；控制台无错误/警告。截图为人工 fixture，不是雀魂实战或真实模型 UI 验收。状态、晚到与 overlay 保护另外由实际面板 VM 测试覆盖。

## 调度、用量及已知限制

- 保持现有自动触发/间隔/上限，不扩大到自动鸣牌响应。引擎综合决策与纯效率/危险专项分开。
- 现有 Worker 默认 25 秒总请求 timer；解释若显式开启支持的 thinking 配置则沿用已有 120 秒解释 timer。Pi live 至多 2 次 HTTP，manual-review 至多 3 次，至多 4 次只读工具。没有新增自动失败重试，也没有注册或运行收费 benchmark。以上是代码预算，不是服务 SLA。
- 账本分 engine / explanation，记录引擎推理数/耗时、LLM HTTP 尝试与成功时可得的工具数；失败未知 token/费用保持 null。引擎阶段与 LLM 尝试分开，不将本地推理当成 token。中途失败无法确认的工具数保持未知。
- 解释合同不具有动作权限，但不能自动证明所有自然语言牌理正确；本轮没有真实付费 LLM 教学质量评测。真实本地验证是四个座位人工决策，不是连续整场/所有副露/真实立直配套推理覆盖。
- 没有官方 4.1 权重或实时 API；不得把弱示例或模型名当作官网同款。第三阶段仅官网入口及上述旧版有限导入，当前官网 4.1/KillerDucky 完整回读仍不满足验收，具体缺少真实样本与格式合同。
- 没有全场匿名天凤 JSON 导出补充、自动提交、验证码绕过、消息维护者、推送、合并或发布。

## 证据路径

以下为2026-11-01源实现的私有验收证据相对路径，不随公开源码或安装包分发：

- 集中证据：`research/evidence/mortal-implementation-20261101/`。
- 真实四座位：该目录 `real-local-validation.log`；根目录同名日志也保留。
- 全量：该目录 `full-test-final.log`；独立主代理验收另在 `research/evidence/mortal-final-acceptance-tests.log` / `mortal-final-acceptance-check.log`。
- 静态与构建：该目录 `check-final.log`、`build-final.log`。
- 上下文恢复：该目录 `recovery-history-tests.log`；隐私追加回归 `privacy-final-tests.log`。
- UI 截图：`research/evidence/mortal-ui-action-final.png`、`mortal-ui-explanation-failed.png`、`mortal-ui-stale-final.png`；原 HTML 样本 `research/evidence/mortal-classic-1.5.3.html`。

以上源证据和 PRD 位于 ignored 目录，不随扩展分发。v0.13.0 的代码及结构测试夹具纳入发布提交；最终整合验收见 [版本验证记录](../VALIDATION.md)。


## v0.13.0 整合修复与边界

- 跨标签解释重试使用持久原子 attempt claim；未持有当前 pending token 的请求不能改写终态，取消迟到响应不能覆盖新重试。初始解释也绑定 token。
- 撤销权限取消在途请求、清空当前展示，保留历史问答和用量；不自动再次发送。
- 整合首次全量发现旧卡缺少“暂无当前可用建议”提示；修复后保留旧时点/历史卡，同时撤下过时手牌 overlay，实际面板回归覆盖这两侧及迟到响应。
- 整合版 Edge 离线 UI 使用人工 fixture 和 mock：动作先显示，解释失败保留动作，点击重试仅分派 Chat 解释请求，推进事件后旧卡标明非当前。控制台仅本地 favicon.ico 404，无脚本错误或警告；不等同于真实游戏、MV3完整加载或收费LLM教学验收。
