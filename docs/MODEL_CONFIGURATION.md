# 命名模型配置与手动诊断

完整版设置页可保存多份命名 LLM (`chat`) 配置。旧的 `modelConfig` 与 `analysisProviders.chat` 自动读入；两份旧值不同会分别保留，只有点击保存才写入新的 `llmProfilesV1`。`modelConfig` 继续代表当前生效服务，`analysisProviders` 保留原有 mjai 用法。删除、重命名、新增与选择均先在本页编辑，点击保存才应用；切换配置或服务类型将取消测试并把页面的分析开关关闭，必须自行重新开启。自动分析仍由牌局面板独立控制，不会随保存或测试开启。密钥只保存在扩展本机存储，清除配置也清除全部命名配置。

## 直连与 Magpie

直连仍填写 Chat Completions 兼容地址、模型 ID 和自己的密钥。选择“新增 Magpie 预设”会保留原配置，并填写 `http://127.0.0.1:3425/v1` 和 `magpie-majsoul-agent`；请按自己的网关改地址或端口。Magpie 必须由用户自主安装、运行并启用模型；本扩展不扫描端口、不读取桌面设置、账号或私有数据库，也不提供额度。Pi 是扩展内运行时，不能自动读取桌面 Pi 配置。

Bearer 标识只是 Magpie 按应用归类用量的本机标识，不是上游 API Key。用户点击“识别 Magpie”才请求同源 `GET /api/hello`；“加载标准 / Magpie 模型”请求所填 API 基址的 `GET /models`（默认 `/v1/models`）。目录只接受标准 `data` 数组，保留模型 ID 原文与可用的 `display_name`；同一身份加载失败保留原目录与手填值，成功也不自动替换已选模型。`provider/model` 和组名均按原文发送。可一直手填，不要求先识别服务。目录绑定当前服务类型、profile ID、规范化 Chat Completions 地址和实际发送的 Bearer 值；切换／新增／删除／清除配置或修改地址、鉴权后，旧目录不再可选，手填模型保留，过期响应不能写回。身份只在页面内存比较，不持久化或显示凭据。

优先使用固定且已测试的模型。网关别名不代表已识别真实上游，路由组、网关重试与换模型的真实费用可能未知；本项目的配置价格只是估算。DeepSeek 思考开关仅作用于官方域名，经网关不发送其专用开关，**不等于已关闭上游思考**。请自行确认网关参数与输出限制。本轮没有动态路由追踪、统一账单、订阅登录、Magpie 插件或 Agents 注册。CC Switch 的可选实验入口见下文。

## 诊断的范围

点击“发送测试请求（可能收费）”才会向当前页面配置发送最多两次非流式 Chat Completions 请求：先要求 `diagnostic_echo({"value":"ping"})`，本地只返回固定无副作用的 `pong`，再校验最终文本严格为 JSON 对象 `{"ok":true,"echo":"pong"}`。这是有意义的最小工具与结构合同，**不是完整麻将建议合同或牌力测试**。HTTP 200、hello 和模型目录均不代表诊断通过；诊断通过也不代表实际麻将输出、服务所有模型或真实整场兼容。

测试不读取或发送牌局、用户历史、记忆与实际麻将工具数据。请求仍从扩展后台发出，沿用地址校验、可选主机权限、Chat Completions 序列化和响应解析。手动授权前不请求网络；权限拒绝或撤销、配置变更、取消按钮会停止测试。后台同时只处理一个诊断或发现任务，默认总超时 25 秒，响应限 256 KB；不自动重试、不自动换服务。错误只显示固定的网络、鉴权／模型参数、工具或最终格式类别，不显示服务端正文、密钥或推理内容。

本次自动化验证使用人工响应与模拟浏览器权限，未安装／启动 Magpie，也未发送收费真实模型请求。真实网关版本、路由配置、模型 tools 与最终麻将输出仍需用户在上述知情操作下验证。Magpie 协议来源固定为 v0.1.2183、commit `0414bbeddbfc2028508b610fd1e7c194143454a0` 的 `docs/integrating.md` 和 `internal/gateway/gateway.go`；这不是上游兼容认证。

回归验证补充（2026-10-30）：模拟 DOM 单元测试直接调用处理器，不实现浏览器原生 select 行为和自动 input/change 冒泡，不能代替实际 DOM 验证。另使用真实 `options.html`、Playwright 和合成 Chrome API，确认目录跨服务隔离、同身份失败刷新保留、地址／鉴权失效、过期响应、原生选择事件冒泡、空／重复名称切换失败时草稿和选择恢复，且没有未处理 pageerror；未发送真实服务请求。

## 配置持久化边界

`model-config-store.js` 通过注入的 storage 提供 `load/save/disable/clear`，统一迁移读取、命名配置与兼容槽位的一次写入、关闭和清除的串行顺序；`model-profiles.js` 继续只做纯转换。`modelConfig` 是唯一运行时生效配置，`llmProfilesV1` 是用户保存集合，`analysisProviders` 是兼容草稿槽位。额外配置字段及 mjai 凭据保留。

设置页持有表单、命名草稿和目录身份，真实用户手势内先申请主机权限，再调用 store 保存；选择不写存储、不自动开启。关闭／清除会使尚未开始写入的保存失效，已开始写入则由队列中后续操作覆盖。清除仍通过注入回调取消后台及清理会话，只移除既有模型／会话键，不碰历史和记忆。队列与 generation 属于每个设置页实例，未提供跨窗口事务保证。

## 后台分析编排边界

`background.js` 保留可信组合入口及消息的扩展身份、URL、frame 检查与分发；`model-analysis-worker.js` 的 `create` 接收 storage、permissions、fetchModel、runtime 和同一份 roundContexts/runStore/discussions/memoryWorker 实例。`prepare/analyze` 承接授权 DTO 准备、配置校验、Pi 与 mjai 请求、timeout/abort、会话提交回滚与用量记账。`busy/cancel/cancelAll/invalidate` 公开生命周期控制；pending 与配置 revision 只在该服务各保留一份，记忆模块通过 busy 回调服从实时分析优先。

诊断、记忆、历史和讨论保留各自模块；HTTP 与密钥仍仅在可信后台执行。服务不依赖 Chrome／DOM／采集器全局，只使用注入能力；固定 Pi bundle、提示词、工具预算、lane、冻结追问与用量未知语义保持不变。两项新模块登记静态依赖白名单、加载顺序和 Agent-only 资源闭包，Collector 不会分发它们。
## CC Switch（可选实验接入）

点击“新增 CC Switch 预设”新增一份关闭分析的配置，默认 `http://127.0.0.1:15721/v1`，端口／地址可编辑，密钥留空。必须自行安装并保持 CC Switch 运行，在其中启用 **Codex 路由或聚合**，并配置支持 Chat Completions、非流式 function tools 的第三方上游及其密钥。本项目不启动服务、不扫描端口、不接管 Codex，也不读取桌面设置或账号。该入口共用 **Codex 供应商、路由切换、故障转移和用量分类**，没有独立应用管理或统计项；在 CC Switch 改 Codex 可能影响本扩展。

v4.0.22 普通 Chat／models 入口没有独立的本地网关 token 校验；第三方供应商的上游鉴权由 CC Switch 配置提取并替换。预设留空不代表任何上游免鉴权／免费。若本机另设了反向代理鉴权，请自行填写 Bearer。**官方 ChatGPT 登录透传、OAuth／订阅、Responses-only 和 Anthropic-only 上游不属于本次支持范围**；不能把 CC Switch 为 Responses 或其他客户端提供的格式转换直接套用到此 Chat 入口。不要把真实账号 token 复制到这里试图绕过限制。

“加载 CC Switch Codex 目录”显式请求当前基址的 `GET /models`（默认 `/v1/models`），只解析已核对的 `models[].slug` 与可选 `display_name`；标准／Magpie 按钮仍只接受 `data[].id`，不会自动推断服务身份或 schema。该按钮不是身份认证。成功不自动改手填模型；ID 原文保存、发送，聚合的 `ccs-<key>/<model>` 前缀不能删改，未带前缀由默认 Codex 供应商承接。不要使用 Claude 专用的 `ccs-claude-…--…` ID。

目录依赖当前 Codex `config.toml` 仍引用 CC Switch 自有 `cc-switch-model-catalog.json`，文件缺失、读取／解析失败、路径归属或大小检查不通过时可能返回 `{"models":[]}`。空目录不等于路由不可用，也不代表所有上游模型均已列出；可始终手填精确模型 ID。不会为获取目录而修改真实 Codex 配置。目录按现有身份隔离与取消语义处理：同身份失败保留旧目录和手填值，成功空目录清除旧候选但保留手填值；切换 profile、地址或 Bearer 后旧目录不可选。响应上限 256 KB，最多扫描前 1000 项、返回 200 个有效去重 ID，每个 ID／显示名最多 200 字符。超大、错误 schema 或全无有效 ID 的非空 CC 目录报告格式错误，可继续手填。

**验证边界（2026-10-30）**：已用官方 CC Switch v4.0.22 portable（提交 `b76426741ef93069e2f374ac01ca7ef5760e1d0e`）完成真实进程 → 两个本地人工上游联调。项目 `model-diagnostics` 使用真实 fetch、合成 Chrome 权限，验证真实目录／空目录、非流式 function tool 与最终 JSON、入站凭据替换、聚合 `ccs-` 路由、Codex 用量分类、关闭／重启路由、错误路径／模型、上游失败和本地取消。另有真实 Chrome DOM＋合成 Chrome API 检查目录按钮与手填行为；尚非实际 MV3 扩展完整网络链路。通过子进程专属 `USERPROFILE`／AppData 与 `CC_SWITCH_TEST_HOME` 隔离设置，Windows Known Folder API 的实际路径已经单独探测；既有路径设置／窗口状态的长度与修改时间未变，未读取其内容。结束时测试 Codex 回到直连，测试进程和端口已清理。未读取真实账号或密钥、未调用收费或真实云模型、未上传牌局。OAuth／订阅、跨协议上游、故障转移、完整应用退出后自动恢复、云模型质量和实际费用仍未知；不构成官方适配或全面兼容认证。详见 [真实联调证据](CC_SWITCH_VALIDATION.md) 和 [研究记录](MODEL_GATEWAY_RESEARCH.md)。
