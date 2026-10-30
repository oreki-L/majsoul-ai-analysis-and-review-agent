# 可选模型网关接入研究

本文件记录本次 CC Switch 限定接入的证据与未验证范围。已发布的命名配置／Magpie 功能与来源见 [配置与诊断](MODEL_CONFIGURATION.md)；本次不改其协议与直连主路径。

## CC Switch 限定接入复核（2026-10-30）

本轮继续以最新正式 **v4.0.22** 为依据：GitHub `releases/latest` 返回该版本；标签对象 `ab92059613455b5bb6751f16f87817eb731a55e4` 解引用到既有记录的发布提交 `b76426741ef93069e2f374ac01ca7ef5760e1d0e`。未以 main 的新增实现代替发布版本。

| 结论 | 固定发布源码依据 |
| --- | --- |
| `/chat/completions`、`/v1/chat/completions` 等入口走 Codex，并用 OpenAI Chat 响应处理 | [server.rs](https://github.com/farion1231/cc-switch/blob/b76426741ef93069e2f374ac01ca7ef5760e1d0e/src-tauri/src/proxy/server.rs#L315)、[handle_chat_completions](https://github.com/farion1231/cc-switch/blob/b76426741ef93069e2f374ac01ca7ef5760e1d0e/src-tauri/src/proxy/handlers.rs#L972)；`RequestContext` 参数固定 `AppType::Codex`／`codex`，因此共用供应商与用量归类 |
| 普通 models 返回当前 Codex 自有目录，空目录可由配置状态产生 | [handle_models](https://github.com/farion1231/cc-switch/blob/b76426741ef93069e2f374ac01ca7ef5760e1d0e/src-tauri/src/proxy/handlers.rs#L79)；只读取经 `resolve_cc_switch_catalog_path` 判定归属的文件，缺失／错误时 `{"models":[]}`；不是上游实时完整模型目录 |
| Codex schema 为 `models[].slug`，显示名可选；能力字段不作为本扩展能力授权 | [catalog builder](https://github.com/farion1231/cc-switch/blob/b76426741ef93069e2f374ac01ca7ef5760e1d0e/src-tauri/src/codex_config.rs#L2307)；本扩展仅提取 ID 和标签，不执行／信任其工具与模型参数元数据 |
| 聚合 ID 为 `ccs-<key>/<model>`，必须原样传递，普通 ID 走默认供应商 | [stack.rs](https://github.com/farion1231/cc-switch/blob/b76426741ef93069e2f374ac01ca7ef5760e1d0e/src-tauri/src/mode/stack.rs#L33)；Codex 与 Claude 前缀语法不同，不能互换，也不能自行去掉供应商前缀 |
| 普通 Chat／models 路由不要求独立的本机 gateway token，但不代表上游免鉴权 | server router 无普通入口鉴权层；[Codex auth](https://github.com/farion1231/cc-switch/blob/b76426741ef93069e2f374ac01ca7ef5760e1d0e/src-tauri/src/proxy/providers/codex.rs#L1095) 提取配置密钥，[forwarder](https://github.com/farion1231/cc-switch/blob/b76426741ef93069e2f374ac01ca7ef5760e1d0e/src-tauri/src/proxy/forwarder.rs#L2474) 替换上游鉴权；官方 ChatGPT 的 inbound token／账号透传具有另行条件，未纳入本次范围 |
| Responses 转 Chat／Anthropic 不能证明反向 Chat 入口全面转换 | [Responses 判断](https://github.com/farion1231/cc-switch/blob/b76426741ef93069e2f374ac01ca7ef5760e1d0e/src-tauri/src/proxy/providers/codex.rs#L80) 明确检查 Responses endpoint；Chat handler 没有等价的全面协议转换承诺 |

实现只加可选预设与手动、显式 Codex 目录动作，保留既有 Chat transport、人工诊断和目录身份隔离。不同于标准 `data[].id`，CC 目录解析必须经用户点击专属按钮；不根据端口、服务名称或宽松 schema 自动认领，不新增安装包依赖，也不修改 Agent、Pi 或 collector。具体失败与空目录策略见 [配置文档](MODEL_CONFIGURATION.md)。

真实程序验证已完成：从官方 Release 下载的 `CC-Switch-v4.0.22-Windows-Portable.zip` 为 18,474,271 字节，SHA256 `f6ab1023d8ba3b72505c5e1267a85d69e8e8a10f35c235d39395cb67ad81f875`。此前仅凭 `CC_SWITCH_TEST_HOME` 不能确认隔离；后续用独立子进程调用 Windows `SHGetKnownFolderPath`，发现 `USERPROFILE` 覆盖实际会改变 Roaming／Local AppData 的解析，而 Profile 本身仍是真实路径。因此结合**仅对子进程生效**的 `USERPROFILE`、AppData、`CC_SWITCH_TEST_HOME` 和独立 WebView 目录，环境先清空再加入必要 OS 白名单，成功运行正式二进制。未修改系统环境、用户账号、ACL 或真实配置。详细隔离方法、真实 HTTP 结果与清理证据见 [真实联调记录](CC_SWITCH_VALIDATION.md)；先前的“未启动”状态已由本轮验证更新。

可复现模拟验证：`node --test tests/cc-switch-contract.test.js tests/model-diagnostics.test.js tests/engine-options.test.js`。其中 contract 测试启动随机回环端口的**人工 HTTP 服务器**，实际通过项目诊断模块和 fetch 验证 `/v1/models`、两次非流式 `/v1/chat/completions`、精确聚合 ID、无凭据请求、function tool result 回传和最终 JSON。其余单元覆盖 schema 分离、空目录、大小／条数、错误凭据／路径、取消、陈旧结果、手填保留、profile 和鉴权隔离；均不能代替 CC Switch 程序的路由验收。

真实官方网关＋人工上游已验证目录、工具／JSON、请求鉴权替换、聚合到正确供应商、Codex 统计分类，以及退出／重新进入本地路由后的恢复。尚未验证：真实云端或收费模型、完整麻将建议、故障转移、完整应用退出后的自动恢复、OAuth／订阅、Responses-only／Anthropic-only 上游，以及真实费用。功能标记为可选实验接入，不称官方适配或全面兼容。
