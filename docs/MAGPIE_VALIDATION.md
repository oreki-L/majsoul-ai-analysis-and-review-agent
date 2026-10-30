# Magpie 真实程序本地联调

2026-10-30，项目基线 `eb00d199852729479abf7573c76d0ba8f047b405`（v0.11.0）与官方 **Magpie v0.1.2204** 完成本地网关联调。真实官方 Windows 程序负责网关，人工 HTTP 服务只充当上游；未使用真实账号、收费模型或牌局。该结果验证传输与最小诊断合同，不代表模型牌力、全部协议或浏览器扩展整体验收。

## 官方程序与 D 盘安装

- 官方来源：[正式发布 v0.1.2204](https://github.com/yetone/magpie/releases/tag/v0.1.2204)，GitHub latest API 当时返回 `prerelease=false`、`draft=false`；发布提交 `cf9ea977ca77a4d21dbaef289e42cca725fd139c`。
- 使用 [magpie-windows-amd64.exe](https://github.com/yetone/magpie/releases/download/v0.1.2204/magpie-windows-amd64.exe)，72,707,072 bytes。官方也提供 Windows ARM64；没有以其他同名产品替代。
- 文件保留在 `D:\Magpie\magpie-windows-amd64.exe`，目录原先不存在。它是便携程序，无需安装器；`--version` 实际返回 `magpie 0.1.2204`。
- SHA-256：`b15de72731de1fd3d9fe98c2186f67df42da212170aa0b4d8197eec2ae4260e1`，与 release asset digest 和官方 [SHA256SUMS](https://github.com/yetone/magpie/releases/download/v0.1.2204/SHA256SUMS) 均一致。Windows Authenticode 状态为 `NotSigned`；未修改执行策略、安全设置、ACL 或系统环境。
- `D:\Magpie\.portable` 保留，让该程序自己的配置进入同目录的 `data`，而不是用户既有 Magpie 配置。官方实现：[appdir.go](https://github.com/yetone/magpie/blob/cf9ea977ca77a4d21dbaef289e42cca725fd139c/internal/appdir/appdir.go)。

## 隔离与真实链路

程序以 `serve` 运行，监听 `127.0.0.1:23425`；人工上游只监听 `127.0.0.1:23426`。未启动或改写其他用户进程。没有注册 service、开机启动、代理或 Agents adapter，也没有运行 GUI、读取已有工具配置、导入订阅或账号登录。

测试子进程清空继承环境，仅保留必要 Windows 变量，并单独设 `USERPROFILE`、`APPDATA`、`LOCALAPPDATA`、临时目录与 XDG 目录到 `D:\Magpie\integration-home`；`PATH` 仅含 Windows System32。`MAGPIE_NO_ACCOUNTS=1` 禁止订阅发现，`DO_NOT_TRACK=1` 与 `MAGPIE_NO_STATS=1` 禁用统计。这里没有复用 CC Switch 的专用变量：Magpie 官方 [env.go](https://github.com/yetone/magpie/blob/cf9ea977ca77a4d21dbaef289e42cca725fd139c/internal/appdir/env.go) 明确在 Windows 用 `USERPROFILE` 解析 home；便携配置实际写入 `D:\Magpie\data\providers.json`，隔离 home 中没有产生 agent 文件。

项目原始 `extension/model-diagnostics.js` 与 `model-session-transport.js` 通过真实 Node `fetch` 调用 Magpie，注入的权限对象仅模拟 `chrome.permissions.contains`。人工上游的两个响应分别为 `diagnostic_echo({"value":"ping"})` 和 `{"ok":true,"echo":"pong"}`，工具结果由项目本地生成。真实 Chrome 设置页、MV3 后台与授权 UI 没有参与这次链路，不能称为浏览器整体验收。

## 实测结果

| 检查 | 实际结果 |
| --- | --- |
| 服务身份 | 项目识别 `/api/hello`，返回 Magpie `0.1.2204` |
| 空目录 | 无 provider 时，项目收到成功且 `models: []` |
| 标准目录与原始 ID | `/v1/models` 返回 `data[].id`，项目保留 `integration/diagnostic-fast`、`integration/second/model`、`integration/slow` |
| 非流式 tools 两轮 | `connection/tools/json` 全部通过；人工上游收到 `stream:false`、function tools 和第二轮 `role:tool` 的固定 pong |
| 模型切换 | `integration/diagnostic-fast`、`integration/second/model` 均通过；Magpie 分别向上游发送 `diagnostic-fast`、`second/model` |
| 入站标识 | 默认仅回环模式下，`magpie-majsoul-agent`、任意本地标识与不发送 Bearer 均通过；程序日志明确说明 `anything works`。此模式的 Bearer 是调用方标识，不能当作入站安全认证 |
| 上游密钥注入 | 所有人工上游 Chat 请求都收到配置的人工上游 Bearer，而不是扩展的调用方标识 |
| 错误模型 | `missing/model` 映射为项目 `MODEL` 错误 |
| 上游鉴权失败 | 人工上游 401 映射为项目 `AUTH`；恢复上游后重新诊断成功 |
| 权限拒绝 | 注入拒绝权限后返回 `PERMISSION`，没有增加上游请求 |
| 取消与恢复 | 慢上游期间取消返回 `CANCELLED`，后续正常诊断成功；没有证明 Magpie 会停止已发出的上游计算或收费 |
| 网关退出与重启 | 停止本次子进程后返回 `NETWORK`，重启同一个官方程序后诊断成功 |

没有测试 LAN／远程 gateway key、真实厂商模型、路由组、流式响应、真实麻将输出、收费/账单、工具权限撤销 UI、整场采集或完整诊断超时。未发现需要修改项目产品代码的问题。

## 证据与清理

- 仓库内可复查的精简证据：[magpie-v0.1.2204.json](validation/magpie-v0.1.2204.json)。它保留诊断结果与上游结构检查，移除凭据字段和完整请求正文。
- 本机复现脚本、完整人工响应日志及发布元数据：`D:\Magpie\integration-evidence\run.cjs`、`probe.cjs`、`report.json`、`gateway.log`、`D:\Magpie\release-v0.1.2204.json`、`D:\Magpie\SHA256SUMS`。脚本引用本次独立工作树路径，不是常规项目测试或自动检测用户网关的功能；只使用其自身的人工 token。
- 19 项相关回归测试通过；`npm run check`、`npm run build` 均通过。构建包含完整扩展与独立 collector。
- 本次创建的 Magpie 与人工上游进程已退出，23425/23426 无监听；测试 `data` 与隔离 home 已移出活动路径，归档到 `integration-evidence/archived-test-data` 与 `archived-test-home`。官方程序、便携标记、校验文件与证据保留在用户指定的 `D:\Magpie`，下次正常启动不会加载测试 provider，不改变用户既有设置。
