# 可执行的模块边界（0.4.0）

`extension/profiles/agent.json` 与 `collector.json` 是两个独立、完整的 Chrome manifest。构建器直接读取各自入口，不从 Agent 文件清单删除模块生成 Collector。`extension/manifest.json` 保持可直接加载的 Agent 配置；检查会拒绝它与 Agent profile 的任何漂移。

## 组合与依赖方向

- `apps/agent-app.js` 组合获取器、独立悬浮分析卡、局面DTO适配器和手牌标记；`apps/collector-app.js` 只组合获取器与显示面板。两者分别启动应用，分析卡不再挂在获取器的扩展槽内。
- `collector/controller.js` 管理状态、记录和回放，接收存储、时钟、哈希等端口；`collector/browser-adapter.js` 提供 Chrome、页面事件和浏览器存储端口。`overlay.js` 负责显示和用户输入。
- `contracts/snapshot.js` 定义清洗后的分析输入；`collector/snapshot-adapter.js` 将获取器状态投影为该合同。`analysis-panel.js` 接收 snapshot 函数、座位标签和局面标识，不持有获取器状态机。
- `agent.js` 仅依赖合同、分析算法和通用执行器；`harness.js` 不认识项目业务模块。HTTP 和权限地址规则在 `adapters/model-endpoint.js`，设置页通过 `model-config-store.js` 持久化，`background.js` 注入能力到 `model-analysis-worker.js` 执行请求。
- 获取器内部、浏览器适配器与获取器显示层禁止依赖模型 endpoint、Agent、harness 和分析模块。分析面板禁止直接依赖 Agent。合同、Agent、分析算法、执行器和获取器核心禁止使用 DOM、Chrome、网络及浏览器存储能力。

`floating-panel.js` 只处理通用界面行为，不读取业务模块。`hand-hints.js` 只接收手牌、摸牌、建议与逐对手风险的展示数据，用手动校准映射Canvas位置，不访问controller或Agent。组合入口同步订阅controller，让分析面板在每次局面变化时立即清除不匹配的标记；获取器仍独立节流刷新。当前局面、发送范围、任务和视图上下文共同判断结果是否过期，历史／牌谱结果不能标记实时手牌。标记模块不加入Collector依赖闭包，也不改变手牌外发授权。

本地预览的分析面板会使用 `MJAnalysis.prepare`，因此 Agent content scripts 明确加载合同、本地算法和分析模块；Agent 执行器仍只由后台加载。Collector 的资源闭包不含分析模块、模型地址适配器和设置页。

## NAGA 的独立牌谱边界

`adapters/naga-replay.js` 仅接受完整牌谱导出与显式规则，返回逐局 Tenhou URL、匿名牌局 JSON 和逐局拒绝原因。它不调用 DOM、Chrome、网络、模型、引擎或 harness，不复用实时分析快照补造整局。`protocol.js` 新增结算字段只用于 replay，标准 LLM 合同不扩张。

完整版组合入口向 `naga-panel.js` 注入完整 replay 导出端口。面板默认关闭，负责规则确认、选局、只读预览、复制、下载和固定官方链接；不包含账号、自动提交、扣费或报告处理。NAGA 不是 `chat` / `mjai` 的实时推理 provider。Collector 入口与构建资源闭包不包含 NAGA 模块，也不增加服务权限。

## 构建与验证

运行 `npm run check`、`npm test`、`npm run build`。检查递归覆盖 `extension` 子目录。公开源码包按既有顶层白名单递归收录新增模块，拒绝其中嵌套的 `.git`、`research`、`node_modules` 和 `dist`。

`scripts/check-boundaries.mjs` 提供受控项目 global 到源文件的 provider 表，并分析静态 `require`、`import`、`export ... from`、`importScripts` 和浏览器 global 名称。词法扫描跳过注释、字符串、正则文本及 template 文本，扫描 template 的表达式。对受限核心禁止计算形式的 global 访问、`eval`、`Function`，拒绝动态模块路径和未知 `MJ...` 项目 global。新增模块必须显式登记 provider 和允许方向。

构建器从每个 profile 的 content scripts、worker、设置 HTML、HTML 资源与 web-accessible resources 解析依赖闭包，仅复制该闭包。每个 content script 隔离组和设置页面独立检查依赖加载顺序；classic worker 按实际静态 `importScripts` 顺序递归检查。构建前验证源文件，复制后重新验证资源、依赖和顺序。版本保持 `0.4.0`。

`tests/architecture-boundaries.test.js` 用违规代码注入验证依赖方向、浏览器能力、动态路径、未知 global、加载顺序、缺失传递资源和默认 manifest 漂移均被拒绝。`tests/build-profiles.test.js` 检查 Collector 实际闭包排除模型文件，Agent 保留相应能力。

这些是针对当前代码约定的静态约束，不是完整 JavaScript parser，也不能全面证明运行时动态依赖。别名、反射、原型和新语法可能超出检查范围；新写法需要增加规则及负例测试，运行时行为仍需测试和浏览器验收。

## 配置持久化边界

`model-config-store.js` 通过注入的 storage 提供 `load/save/disable/clear`，统一迁移读取、命名配置与兼容槽位的一次写入、关闭和清除的串行顺序；`model-profiles.js` 继续只做纯转换。`modelConfig` 是唯一运行时生效配置，`llmProfilesV1` 是用户保存集合，`analysisProviders` 是兼容草稿槽位。额外配置字段及 mjai 凭据保留。

设置页持有表单、命名草稿和目录身份，真实用户手势内先申请主机权限，再调用 store 保存；选择不写存储、不自动开启。关闭／清除会使尚未开始写入的保存失效，已开始写入则由队列中后续操作覆盖。清除仍通过注入回调取消后台及清理会话，只移除既有模型／会话键，不碰历史和记忆。队列与 generation 属于每个设置页实例，未提供跨窗口事务保证。

## 后台分析编排边界

`background.js` 保留可信组合入口及消息的扩展身份、URL、frame 检查与分发；`model-analysis-worker.js` 的 `create` 接收 storage、permissions、fetchModel、runtime 和同一份 roundContexts/runStore/discussions/memoryWorker 实例。`prepare/analyze` 承接授权 DTO 准备、配置校验、Pi 与 mjai 请求、timeout/abort、会话提交回滚与用量记账。`busy/cancel/cancelAll/invalidate` 公开生命周期控制；pending 与配置 revision 只在该服务各保留一份，记忆模块通过 busy 回调服从实时分析优先。

诊断、记忆、历史和讨论保留各自模块；HTTP 与密钥仍仅在可信后台执行。服务不依赖 Chrome／DOM／采集器全局，只使用注入能力；固定 Pi bundle、提示词、工具预算、lane、冻结追问与用量未知语义保持不变。两项新模块登记静态依赖白名单、加载顺序和 Agent-only 资源闭包，Collector 不会分发它们。

重构验证（2026-10-30）：`npm run check`、`npm test`（467/467）和 `npm run build` 通过。保留真实 background＋Pi VM 集成，覆盖配置／局面取消、记账和会话持久化期间取消回滚、迟到响应、记忆实时优先与诊断隔离；新增无 Chrome／DOM／HTTP 环境下独立注入服务的双 tab busy/cancel/invalidate 回归及新模块静态能力／Collector 闭包负例。真实 Chrome 的 options.html 使用合成 Chrome API 验证权限先于写入、拒绝权限不保存、命名切换不启用、挂起保存后关闭覆盖，以及清除保留历史／记忆，无 pageerror（静态服务器 favicon 404 不影响页面）。未使用真实凭据、收费模型或真实牌局；未将每页队列宣称为跨窗口事务。

架构／CC Switch 本地整合验证（2026-10-30）：`npm run check`、`npm test`（472/472）、`npm run build` 和 `git diff --check` 通过；两项新服务模块在 Agent 构建闭包内、在 Collector 闭包外。CC 预设创建通过 configStore generation 取消旧保存，存储和分析服务边界保持不变。真实 Chrome DOM 配合合成 Chrome API 已确认：CC 预设默认关闭且密钥为空、显式目录与原文聚合 ID、保存先申请权限、跨 profile 目录隔离、空目录保留手填，以及关闭和清除覆盖已开始的保存；mjai 凭据、额外配置字段、历史和记忆按既有范围保留。无 pageerror。本轮未重新启动真实 CC Switch 或调用真实模型；真实程序与人工上游的已验收范围见 [CC Switch 验证](CC_SWITCH_VALIDATION.md)。
