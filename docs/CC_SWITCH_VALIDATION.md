# CC Switch 真实程序与人工上游联调

验证日期：2026-10-30。**官方 CC Switch v4.0.22 程序已经参与完整 HTTP 链路；上游为本项目创建的本地人工服务器，没有调用真实云模型。** 这能证明下列版本和配置中的传输、目录及路由行为，不能证明模型质量、实际麻将建议、真实费用或全面兼容。

## 版本与来源

- GitHub `releases/latest` 在验证时仍返回 [v4.0.22](https://github.com/farion1231/cc-switch/releases/tag/v4.0.22)。标签对象 `ab92059613455b5bb6751f16f87817eb731a55e4` 指向提交 `b76426741ef93069e2f374ac01ca7ef5760e1d0e`。
- 使用官方 Release 的 [Windows portable ZIP](https://github.com/farion1231/cc-switch/releases/download/v4.0.22/CC-Switch-v4.0.22-Windows-Portable.zip)，18,474,271 字节，SHA256 `f6ab1023d8ba3b72505c5e1267a85d69e8e8a10f35c235d39395cb67ad81f875`。未运行网络安装脚本。该 EXE 的 Windows Authenticode 状态为 `NotSigned`；记录哈希不等于签名认证。
- 真实程序日志报告 `CC Switch v4.0.22`，初始化全新数据库。没有将替身网关、移植的处理器或源代码片段称为真实 CC Switch。

## 隔离证据

此前仅凭 `CC_SWITCH_TEST_HOME` 不能确认 Tauri store 的隔离。本轮进一步在独立 PowerShell 子进程通过 P/Invoke 调用 Windows `SHGetKnownFolderPath`（`KF_FLAG_DONT_VERIFY`），分别查询 Profile、RoamingAppData 和 LocalAppData：

| 查询 | 子进程设置 `USERPROFILE=<test>/profile` 后的实际结果 |
| --- | --- |
| Profile | 仍为原 Windows 用户目录；不能靠覆盖 `USERPROFILE` 隔离业务 home |
| RoamingAppData | `<test>/profile/AppData/Roaming` |
| LocalAppData | `<test>/profile/AppData/Local` |

因此真实程序使用**组合隔离**，而不是假设所有 Known Folder 都遵循环境变量：

1. 以专用临时目录为工作目录；环境先清空，再加入运行所需 OS 白名单。
2. 仅给该子进程设置 `USERPROFILE`、`APPDATA`、`LOCALAPPDATA`，同时设置源码明确支持的 `CC_SWITCH_TEST_HOME=<test>/profile`。未改变系统或当前会话的 `HOME`、`CODEX_HOME`、Windows 用户、ACL 或全局配置。
3. 给 WebView2 单独设置用户数据目录；仅本地测试进程开启 `127.0.0.1:19227` CDP，通过 playwright-cli 附加其 WebView 配置人工供应商，没有附加用户浏览器或 Codex。
4. 程序返回的 `get_config_dir({app:"codex"})` 实际为 `<test>/profile/.codex`，日志和数据库实际位于 `<test>/profile/.cc-switch`。其首次初始化和零历史也与全新目录一致。
5. 未读取现有 CC Switch `app_paths.json`、窗口状态或真实 Codex 配置内容。既有 Tauri 路径设置与窗口状态只比较文件长度及修改时间，结束后两者均未改变；这项元数据核查本身不声称做过内容哈希比较。

测试进程请求以隐藏窗口启动；CC Switch 在页面加载完成后自行显示 GUI，随后通过专属 CDP 控制。没有停止用户已有进程。

## 实际链路与结果

请求来自本项目 `extension/model-diagnostics.js` 和通用 Chat transport，使用 Node 真实 `fetch`、合成的 Chrome 权限端口。真实官方网关监听 `127.0.0.1:19226`，两个人工上游分别监听 `19228`、`19229`。供应商密钥全部为测试合成值；提交的证据仅记录“配置的上游 token”等类别，不保存真实凭据。

| 场景 | 真实观察 |
| --- | --- |
| Codex 普通路由 | `mock-alpha` 到上游 alpha 的 `/v1/chat/completions`，`stream:false`；先收到 `diagnostic_echo` 调用，第二次请求含 `role:tool` 和 `{"value":"pong"}`，最终 `{"ok":true,"echo":"pong"}` 通过项目校验 |
| 空入站凭据 | 项目不发送 Authorization，CC Switch 向人工上游注入配置的合成供应商 Bearer；完整诊断通过 |
| 合成入站 Bearer | 项目发送与供应商不同的合成 Bearer，人工上游实际仍收到配置的供应商 Bearer，未收到入站值；完整诊断通过 |
| 真实目录 | 普通路由的 `/v1/models` 经专用解析得到 `mock-alpha` 和 `Artificial alpha`；实际格式为 `models[].slug` |
| 无受管理目录引用 | 只修改本次临时 `.codex/config.toml`，暂移除 `model_catalog_json`；真实网关返回空目录，项目得到 `models:[]`。恢复原测试文件后目录恢复 |
| 手填值 | 诊断直接使用手填 `mock-alpha` 和聚合 ID，不要求先选择目录；页面原生目录选择／空目录手填保留另有 Chrome DOM＋合成 Chrome API 检查 |
| 聚合选择 | 目录包含 `ccs-fixture-beta/mock-beta`；该 ID 确实到上游 beta，实际模型改为 `mock-beta`，完整工具／JSON往返通过，没有误发 alpha |
| Codex 统计耦合 | CC Switch 自身请求日志中 `appType:"codex"`、`providerId:"fixture-beta"`、`model:"mock-beta"`，`requestModel` 保留 `ccs-fixture-beta/mock-beta`。应用用量汇总只有 Codex 分类，没有独立 Majsoul 分类 |
| 错误模型／路径 | 人工上游未知模型和网关未知路径均实际 HTTP 404，项目映射为 `MODEL` |
| 上游失败 | 人工上游返回 HTTP 503，项目映射为 `HTTP`，不显示服务端正文 |
| 本地取消 | 人工上游延迟响应时取消项目任务，返回 `CANCELLED`，没有继续第二次工具结果请求。这不保证上游执行或未来计费已撤销 |
| 路由服务关闭／恢复 | 退出测试 Codex 接管后本地服务自动停止，项目目录请求返回 `NETWORK`；重新启用聚合后真实目录和工具／JSON往返再次通过。接管仍生效时直接停止服务会被 CC Switch 拒绝 |

CC Switch 对人工模型没有内置价格，其取样用量记录成本为 0；这是人工响应与未知定价行为，**不能据此声称真实模型免费或费用准确**。取样记录的 token 数全部由人工服务器返回。

可审查的脱敏结果在 [机器可读证据](validation/cc-switch-v4.0.22.json)。本轮没有发现需要修改 Chat 传输或 Codex 目录解析的兼容问题，只更新界面和文档中的验证范围。

## 清理与剩余边界

结束前，通过真实程序将测试 Codex 恢复到 `direct`，确认 `attached:false`、网关 `running:false`。随后结束本次创建的 CC Switch PID `45796` 和人工上游进程，确认 `19226`–`19229` 均不再监听。临时配置、日志、脚本和脱敏证据保留在本次专用测试目录供审查；没有把测试 profile 写入用户真实配置，也没有覆盖或恢复用户原配置。

曾尝试调用该测试 WebView 的 `plugin:process|exit`，未得到进程退出确认，因此不计为完整应用退出／重开验证；最终按上文先恢复测试直连，再结束自己的进程。没有将路由服务重启成功扩大解释为完整应用退出后自动恢复成功。

实际浏览器 MV3 权限及后台网络链路仍未随真实 CC Switch 一起验收；本轮达到的是**项目模块＋合成权限＋真实 HTTP＋真实 CC Switch＋人工上游**。另有真实 Chrome DOM＋合成 Chrome API 的 UI 验证，不能将两者合称真实扩展端到端验收。

未验证：真实云模型或收费调用、完整麻将建议质量、故障转移、完整 CC Switch 应用退出后的自动恢复、OAuth／订阅、Responses-only／Anthropic-only 上游、其他 CC Switch 版本及真实费用。没有上传牌局或使用真实账号。详细支持条件仍以 [配置文档](MODEL_CONFIGURATION.md) 为准。
