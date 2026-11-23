# 聊天渠道事件接入方案

**状态：可选 Agent 聊天版已实现手动赛后分享与主动整场结算推送；标准版不包含聊天模块。受控真实整场和真实飞书群仍待联调。** 生态对标沿用 2026-11-18 的固定 GitHub 提交和平台资料（原调研基线 `HEAD 5096ebb2765e`），未安装上游程序或使用真实聊天账号。操作见[聊天分享与整场结算推送](../guides/CHAT_INTEGRATIONS.md)。

本机 Chromium 使用预授权测试副本和合成牌局事件，验证了游戏面板绑定、持久化历史、HTTPS 收件和签名校验；重复终局、未绑定标签和停订后的新局均未外发。原生授权弹窗和实际回收后由报警唤醒未由该测试覆盖。

## 结论

**聊天模块发布经过筛选的业务事件，由渠道适配器发送。当前只支持飞书群自定义机器人和签名通用 HTTPS Webhook，更多渠道与聊天追问未接入。** 只由 MV3 扩展后台发送，不要求常驻进程、模型管理器或公网回调；标准版和仅获取器没有聊天外发路径。双向互动仍建议由独立的可选桥接处理，不把浏览器扩展暴露成服务器。

聊天发送与自动订阅均默认关闭。在设置 →「聊天分享」打开「允许发送」，添加并启用目标，按目标 HTTPS 主机授权。手动分享仍从「整盘整理」发起并预览确认；自动推送须另从游戏面板「分析设置」→「绑定结算推送…」发起，在设置页选择已授权目标并点击「开启整场推送」。两种发送都不新增模型调用。

## GitHub 对标

| 项目与证据 | 核查结果 | 借鉴与取舍 |
| --- | --- | --- |
| **Agent Autoloop**：[README](https://github.com/KKKKhazix/agent-autoloop/blob/ca5c0ffe2c92be17502c4f1a75cdb71823eeafef/README.md#插件体系四个方向都能自由替换) · [协议](https://github.com/KKKKhazix/agent-autoloop/blob/ca5c0ffe2c92be17502c4f1a75cdb71823eeafef/docs/protocol.md) · [配置手册](https://github.com/KKKKhazix/agent-autoloop/blob/ca5c0ffe2c92be17502c4f1a75cdb71823eeafef/skills/agent-autoloop/SKILL.md#接一个通道) | 来源规范化事件，内核路由，通道领卡并报告投递结果；飞书能接回调，其他内置聊天模板单向发送。 | 借鉴事件、路由、呈现及回执分离。上游 MIT，CLI 需要 Node 24+；不引入其运行时、完整事件溯源、调度或 Agent 执行器。 |
| **MajsoulUID / gsuid_core**：[麻将订阅与查询](https://github.com/KimigaiiWuyi/MajsoulUID/blob/b7b44f7d5be9d005ac1346b8b9303ea1ef42c743/MajsoulUID/majs_notify/__init__.py) · [牌谱链接配置](https://github.com/KimigaiiWuyi/MajsoulUID/blob/b7b44f7d5be9d005ac1346b8b9303ea1ef42c743/README.md) · [Core](https://github.com/KimigaiiWuyi/gsuid_core/blob/19a18254597beb3e246a4079aecdc95b33947924/README.md) | 麻将插件通过宿主支持多平台；订阅区分 Bot、会话和用户；默认不附牌谱链接。另有 [HoshinoBot 雀魂插件](https://github.com/DaiShengSheng/Majsoul_bot/blob/7672aefb429b88b85669df9153ae97c1f52694b6/README.md)基于牌谱屋监测并在 QQ 播报。 | 借鉴订阅隔离和最小外发，不移植采集、账号和牌谱来源。宿主声明覆盖的平台不等于每个平台功能相同，或旧 Bot 方案今天仍可用。 |
| **小肥鱼**：[API 与 QQ 设计](https://github.com/nanashi77777/xiaofeiyu-mahjong-llm/blob/e886cc3c6c912bff095a1a4ce35f732fd52530fe/docs/design/api-and-qq.md) | QQ 宿主经本机 stdio MCP 按需查询，不是定时主动推送。实时自由文本可能泄露手牌，默认整段不返回。 | 借鉴字段投影和活动局过滤；不提供聊天控制打牌、启停或教学写入。 |
| **AstrBot**：[收发接口](https://github.com/AstrBotDevs/AstrBot/blob/90ba3270f09b857063da68908d80f742042067cd/astrbot/core/platform/platform.py) · [消息事件](https://github.com/AstrBotDevs/AstrBot/blob/90ba3270f09b857063da68908d80f742042067cd/astrbot/core/platform/astr_message_event.py) | `commit_event` 将标准消息放入事件队列，`send_by_session` 封装主动发送。 | 可作为已有 Bot 用户的可选宿主，不嵌入扩展，不另建一条麻将 LLM 链路。 |
| **Apprise / n8n**：[通知目标和标签](https://github.com/caronc/apprise/blob/eab0f8bfe669e302a5f54be507000fb7c7809738/README.md) · [n8n Webhook 触发器](https://github.com/n8n-io/n8n/blob/d5bdc976b1d32bca9e418d91845c360f8ab35c6c/packages/nodes-base/nodes/Webhook/Webhook.node.ts) | Apprise 聚合单向通知，n8n 从 Webhook 触发转发和聚合，两者不是聊天话题授权层。 | 支持用户自建中继：扩展发给 n8n 或其他转接器，由转接器按需调用 Apprise。都不打包进本项目。 |

## 渠道优先级

| 渠道 | Autoloop 固定提交中的能力 | 本项目建议 |
| --- | --- | --- |
| **通用 HTTPS Webhook** | 自定义 JSON POST 模板；其自有事件入口是另一套合同 | **已实现。** 发签名业务事件给自建接收器或转接器，不把同一业务 JSON 直接投给各平台机器人接口。 |
| **飞书** | [应用机器人适配器](https://github.com/KKKKhazix/agent-autoloop/blob/ca5c0ffe2c92be17502c4f1a75cdb71823eeafef/plugins/feishu/channel.ts)经 `lark-cli` 长连接接收卡片动作，以消息 ID 更新卡片；上游声明已实测发送、回调、更新 | **已实现单向适配，待真实飞书群联调。** 用[飞书群自定义机器人](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot)向指定群发送摘要或结算通知，不支持私聊或回调。私聊和追问再用应用机器人。 |
| **钉钉、企业微信** | [固定 Webhook 模板](https://github.com/KKKKhazix/agent-autoloop/blob/ca5c0ffe2c92be17502c4f1a75cdb71823eeafef/plugins/webhook/templates.ts)检查 `errcode`；上游只用本地模拟服务验证 | **第二批。** 只支持组织允许的官方机器人入口，按[钉钉](https://open.dingtalk.com/document/orgapp/custom-bot-send-message-type)和[企微](https://developer.work.weixin.qq.com/document/path/91770)分别验收。企业微信不是个人微信。 |
| **Discord、Slack** | 同组文本模板；Discord 禁止提及，Slack 关闭链接展开并检查 `ok`；上游仅模拟验收 | **第二批。** 按 [Discord](https://docs.discord.com/developers/resources/webhook#execute-webhook)和 [Slack](https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/)各自格式发送。需要原地追问再上 Bot/App，现有 Webhook 不收消息。 |
| **Telegram** | 手册以自定义模板调 `sendMessage`，不是内置双向渠道 | **第二批可选。** 用 [Bot API](https://core.telegram.org/bots/api#sendmessage)给可达会话发送，双向可由桥接采用受支持的 `getUpdates` 轮询。不在日志和导出中显示含 Token 的 URL。 |
| **QQ、QQ 频道、个人微信** | 固定提交的内置渠道表没有这些实现 | QQ / QQ 频道分别核查官方 Bot 权限及主动消息限制；已有 OneBot 或 AstrBot 可选自部署转接，但不承诺任意私聊或群发。个人微信不以非官方客户端作为首发路径。 |
| **桌面通知及其他** | [桌面插件](https://github.com/KKKKhazix/agent-autoloop/blob/ca5c0ffe2c92be17502c4f1a75cdb71823eeafef/plugins/desktop/channel.ts)单向，无原地回复 | 无外传需求先看扩展内状态；桌面通知按需再加。邮件、Matrix、通知聚合等交给中继。 |

Autoloop 的文本渠道可带由其服务托管的回答链接，但这不是聊天软件内的回调，且持有链接即可回答，手机要能访问该服务。**本项目不使用免登录回答链接，也不把 `127.0.0.1` 或 `chrome-extension://` 链接发到手机。** 已部署 Autoloop 的用户可另做显式转接，把最小化事件映射为其 `POST /v1/events`，使用独立来源 Bearer，或编写来源插件验签。接到事件不会自动通知，仍需用户配置后续规则；本项目不自动派发 Agent 任务。

## 本仓库的事件出口

```text
扩展内业务动作 → 校验及脱敏投影 → 订阅路由 → 持久发送队列 → 渠道适配器 → 平台受理状态
```

页面桥 `mj-observer-v1`、控制器 `subscribe` 和 `chrome.runtime.onMessage` 分别负责采集、视图刷新、扩展内部调用，**都不直接作对外 API**。同源和序号过滤不能把页面桥数据变成可信审计证据。只在 `agent` profile 的扩展后台处理外发；网页和模型都不能指定地址、模板、授权或自动开关。

| 事件 | 触发点 | 外发内容 |
| --- | --- | --- |
| `app.majsoul.integration.test.v1` | 用户在设置页手动测试当前目标 | 固定人工文案，不读取牌局，不触发业务订阅。 |
| `app.majsoul.review.summary.shared.v1` | **首版。** [整盘整理 UI](../../extension/analysis-panel.js)请求预览，后台按本地选择重读 [discussion store](../../extension/decision-discussions.js)，复用 [postgame-review](../../extension/postgame-review.js)构建投影。后台只批准已结算的本地对局或已导入的离线复盘，不以面板已打开作为依据。确认绑定同一摘要和目标版本，有变化则再次预览 | 只发覆盖计数和预设主题标签，注明是留存分析样本，不是完整复盘。回放或报告导入不自动发，不发送 `summarize()` 的自由文本和证据片段。 |
| `app.majsoul.match.completed.v1` | **已实现。** 仅聊天版通过[采集控制器](../../extension/collector/controller.js)跟踪确认绑定后从东一局零本场开始、连续观察的三／四麻 `live` 对局。[历史写入](../../extension/history-storage.js)首次持久化明确整场终局时，经[后台订阅校验](../../extension/chat/integrations.js)生成待投递记录；普通小局结算、断线恢复、采集缺口和回放导入不触发 | 只允许 `playerCount`（人数）、`roundCount`（记录的小局数）、`endReason`（`win`、`exhaustive_draw`、`abortive_draw`）和可选 `finalScores`（可靠且完整时按座位顺序给出；途中流局不附）。不推断排名或补齐分数，不外发手牌、牌谱、账号或昵称。 |
| `decision.*`、`review.ready` | **首版不发布。** [分析 worker](../../extension/model-analysis-worker.js)分别保存引擎动作和解释；纯 LLM 路径由[分析面板](../../extension/analysis-panel.js)请求留存。当前整盘整理即时聚合，没有持久的「报告已生成」状态 | 以后只在明确的持久状态变化后发布；动作保存、解释完成、失败和重试不可当成同一事件。默认不通知活动局建议。 |

现有 `live-*` 是本地生成的标识，不是跨标签、跨设备的雀魂对局 ID。自动订阅一次只绑定一个来源（浏览器的 `tabId` 与 `documentId`）和一个已授权目标版本。刷新、重新打开游戏或更换标签后需重新绑定；停订、重新绑定或目标配置变更后，旧订阅的待发项不会改投。不会扫描历史补发，也不补发绑定前开打或中断的比赛；不提供逐局推送或实时播报。

## 外发合同与投递

通用 Webhook 采用 [CloudEvents 1.0 JSON 信封](https://github.com/cloudevents/spec/blob/fc1f6f31f5f011a72183f1bcea20c987cb683ade/cloudevents/spec.md)（`application/cloudevents+json`，不引 SDK）。飞书直连用机器人文本格式。`source` 是安装范围内的随机名称，不含账号或硬件标识；确认手动分享或持久化合格终局时生成 `id`，同一事件的内部重试沿用它。外发只用字段白名单，例如：

```json
{
  "specversion": "1.0",
  "id": "9d8e7383-3db6-4423-9a25-781350a78574",
  "source": "urn:majsoul-agent:installation:5ae33b37-e358-4084-a7a1-82cf2bce3ff9",
  "type": "app.majsoul.match.completed.v1",
  "time": "2026-11-18T09:24:00Z",
  "datacontenttype": "application/json",
  "data": { "playerCount": 4, "roundCount": 8, "endReason": "win" }
}
```

- **持久化。** 合格终局的历史与最小待投递记录通过同一次 `chrome.storage.local.set` 写入，后台再将该记录移入 IndexedDB 发送队列。同一待投递记录再次尝试入队时沿用事件 ID；发送前复核订阅与目标版本及当前权限。恢复的是已生成的待投递项，不是重扫历史；有积压上限和过期边界，不保证零漏发。入队不等于平台受理。
- **恢复与重试。** [MV3 worker](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)可被回收；在入队、启动及 [Alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms) 唤醒时消费队列，重启检查报警并恢复过期租约。建议初值：单目标串行、单次超时 10 秒、最多 5 次且最长等待 24 小时，遵守 `Retry-After`，可确定的暂时失败退避。浏览器关闭或休眠期间不承诺即时送达。重试不重新分析。
- **处理不确定结果。** 按平台协议校验响应，HTTP `2xx` 不一定表示平台受理，平台受理也不等于已读。通用 Webhook 要求接收端原子地按 `source + id` 记录受理，去重记录覆盖整个重试窗口，重复请求仍返回已受理。无幂等能力的直连目标在确认丢失时标为「结果不明」，由用户决定是否重发。失败不影响其他目标或页面；目标配置变更使旧版本待发送项失效，不能悄悄改投新群。队列满、过期和撤权要可见。
- **目的地与认证。** 默认关闭；只有可信设置页能添加地址、申请对应主机权限、发送测试消息和撤销目标。直连校验配置的是对应官方端点；通用 Webhook 默认显式配置 HTTPS，拒绝重定向、不附浏览器 Cookie。每个通用 Webhook 用独立密钥做 HMAC-SHA256，签名覆盖时间戳、分隔符和原始请求体；接收方在解析前验签并检查时钟窗口，重试更新签名时间但沿用事件 ID。飞书群机器人按其原生签名规范配置，不混用两类签名。密钥留在可信扩展上下文，日志隐藏完整 URL、错误响应正文和凭据。
- **默认内容。** 不外发原始协议、牌谱链接、座位或账号 ID、手牌、完整快照、聊天原文、模型自由文本或模型密钥。不使用群提及或任意模型链接；队列只保存脱敏负载，提供清除和撤销，另设有限留存。这里的关闭指不再外发，不承诺删除平台已收到的消息。

## 双向追问：用同一份冻结决策

建议第一条双向链路选**飞书应用机器人私聊**，参考 Autoloop 的长连接卡片；不需要飞书的用户，可另验 Telegram 轮询或已有 Bot 宿主。飞书私聊不是群自定义机器人升级一个开关，需要应用权限、会话配对和官方回调或长连接。只提供赛后对一条已明确授权的决策追问；不在群里推送手牌或解释，不把群消息自动送给模型。

1. 扩展在用户明确配对和分享后，为指定冻结决策签发可撤销、短时且限定会话的引用。Bot 回复或按钮只带引用，不带牌局快照、本地记录 ID 或模型配置。桥接收到平台事件后验证来源，按平台、机器人实例、会话、发送者和平台事件 ID 做授权及去重；不能仅凭消息里自称的身份或持有引用通过。
2. 桥接默认只监听 `127.0.0.1` 或用官方出站连接；独立配对、凭据和接口，不复用本机[模型管理器](../../agent/model-manager.cjs)的管理授权。扩展向桥接拉取待处理请求，在浏览器不活跃时只排队或超时。确实需要公开回调的渠道另部署最小接收器，不能公开扩展调试、引擎或本机管理端口。
3. 从现有 `discussion:ask` 和 `model:analyze` 提取后台可复用的窄操作，使用 [冻结上下文](../../extension/decision-discussions.js) 而非当前牌局；外部操作不能伪造成受信任游戏标签，使用独立 `manual-review` 排队和预算，不覆盖、取消或挤占实时分析。启用外部模型调用权限需单独确认，按用户限流、计费，同一入站请求不重复调用；中断且费用不明时不自动重跑。只回原授权会话，答复前再检查授权，已删除或过期只返回不可用状态。

## 实施与验收

| 阶段 | 交付 | 放行条件 |
| --- | --- | --- |
| **1 · 手动分享** | `agent` profile 的事件合同、发送队列、订阅／目的地设置、分享预览；通用 Webhook 与飞书群机器人；一份接收和验签示例 | 合成样例覆盖同一确认重复提交、队列重启、限流、平台业务错误、确认丢失、撤权和字段白名单。真实飞书测试群＋自建接收器各完成一次端到端；默认关闭和 collector 无网络发送路径。 |
| **2 · 自动通知与扩渠道** | 已实现单来源、单目标整场终局订阅，沿用通用 HTTPS Webhook 与飞书群机器人；其他渠道待评估 | 回归覆盖三／四麻终局、流局、普通小局结算、回放、断线重连、跨文档隔离和已落盘待投递项恢复。受控真实整场与飞书群联调待完成；新渠道须分别用真实测试目标验收，不以上游模拟通过代替。 |
| **3 · 私聊追问** | 可选桥接及一条飞书私聊闭环；有明确用户需求再做 QQ 等 | 合法回复只能命中原冻结决策；跨群、跨身份、过期引用、回调重放、已撤权、浏览器离线和重复计费均有测试。不发送活动局上下文，不开放外部控制。 |

不在当前范围：逐局或实时逐巡播报、历史补发、主动打牌、公共牌谱服务、托管所有机器人、大规模任务编排。实现不等于真实平台验收；验收后再扩大对外兼容承诺。
