# 聊天分享与整场结算推送

仅单独分发的 **Agent 聊天版**（`majsoul-agent-chat-<version>.zip`）支持。它是替代安装包，不是叠加安装的第二个插件；同一浏览器配置中只启用一个版本。切换到不同解压目录加载时，Chrome 通常会分配新的扩展 ID，旧版配置和历史不会自动迁移，建议先导出所需记录并停用旧版。标准版与仅获取器不包含聊天模块或 `alarms` 权限。

聊天发送和整场结算推送均默认关闭；开启发送不等于订阅推送。两种方式共用发送目标：**飞书群自定义机器人**（只向对应群发送，不支持私聊或接收消息）或**签名通用 HTTPS Webhook**。

## 开启整场结算推送

1. 打开扩展设置 →「聊天分享」，打开「允许发送」，添加并启用目标。保存时按提示授权目标的 HTTPS 主机；拒绝或撤销该权限后不能向该主机发送。可先手动测试目标。
2. 在要采集的游戏标签页打开「分析设置」→「绑定结算推送…」。扩展会打开设置页，在「整场结算推送」中选择一个已授权目标，点击「开启整场推送」。
3. 在该游戏页面开始新对局。绑定针对当前标签页的当前文档；刷新、重新打开游戏或换标签后，要从新页面重新绑定。一次只绑定一个来源和一个目标；修改或删除当前绑定的目标后，需要重新绑定，旧待发投递不会转到新目标。

只推送在确认绑定**之后**、从东一局零本场连续采集到明确整场结算的三人或四人麻将。不按小局发送，不实时播报；绑定前已开打、从中途接入、断线恢复、采集有缺口、历史记录和导入／回放的牌谱都不会自动补发。已入队的同一条通知可以按投递策略重试，这不是补发历史对局。

推送只包含人数 `playerCount`、记录的小局数 `roundCount`、结束方式 `endReason`（`win` 和牌、`exhaustive_draw` 荒牌流局、`abortive_draw` 途中流局）。仅在可靠且完整时附按座位顺序排列的 `finalScores`；途中流局不附点数，不推断名次。不会发送玩家昵称、账号、座位标识、手牌、原始牌谱或链接、模型分析文本或密钥；推送本身不调用模型。

在「聊天分享」→「整场结算推送」点击「关闭整场推送」可停订，不影响手动分享。平台受理不等于已读；关闭浏览器或休眠时不保证即时送达，关闭推送也不能撤回已经送达的消息。**受控真实整场与真实飞书群仍待联调。**

## 手动分享赛后摘要

启用发送并添加目标后，从「整盘整理」选择有本地结算证据的对局，打开设置页核对摘要与目标并确认。离线牌谱从本地历史中打开并留存决策；不能核实归属的临时回放不分享。

分享只包含留存样本覆盖计数和固定主题枚举，不是完整牌谱或复盘。平台受理不代表已读；关闭功能会清空待发送项，无法撤回平台已经收到的数据。目标地址或密钥变更后，旧投递不会改投新版本。

## 通用 Webhook 接收端

接收 `POST` 和 `application/cloudevents+json`。先读取原始请求体字节，再校验 `X-MJ-Timestamp`（Unix 秒；例如限制与接收端时间差不超过 5 分钟）和 `X-MJ-Signature`（`sha256=` 加小写十六进制摘要）。用目标密钥计算 `HMAC-SHA256`，输入依次为时间戳的 ASCII 字节、`.` 和原始请求体；用定时安全比较验签，不要把解析后再序列化的 JSON 用于验签。

通过验签后解析 JSON，按 `(source, id)` 原子去重，至少保留 24 小时。仅在已受理后返回 `2xx`；此前已受理的重复请求也返回 `2xx`。扩展重试会更新签名时间但保留事件 ID。飞书不使用这套请求头；如群机器人启用了签名安全设置，录入飞书提供的签名密钥。

## 开发接口

- 游戏顶层可发 `chat:prepare-share {groupKey}` 或通过绑定按钮发起 `chat:offer-match-source`，由后台打开 `options.html`。绑定来源由后台从浏览器的消息发送者获取，不接受页面传入的目标地址或来源标识。
- `chat:status` 返回 `{ok,enabled,destinations,deliveries,share,matchPush}`；`share` 为 `null` 或 `{draftId,preview}`。手动摘要投影为 `{scope:'retained-decisions',roundCount,decisionCount,topics}`，主题枚举：`strategy`、`efficiency`、`calls`、`questions`。目标只返回 `{id,version,kind,name,enabled,origin,hasPermission}`，`origin` 不含 URL 路径、查询或凭据，权限模式是 `https://${new URL(url).hostname}/*`。
- 其余 RPC 仅限顶层 `options.html`，包括 `chat:subscribe-match {offerId,destinationId,destinationVersion}` 和 `chat:unsubscribe-match`。保存已有目标时，省略 `url` 或 `secret` 表示保留原值；只有真正变更才递增整数版本。设置页在用户点击保存时申请具体 HTTPS 主机权限，后台独立复核。`chat:clear` 清除草稿与投递，不删除目标或停订。
- 通用 Webhook 的整场推送事件类型为 `app.majsoul.match.completed.v1`，其 `data` 仅包含上述结算白名单字段；飞书使用对应的文本消息。
- 聊天版后台加载 `extension/chat/delivery.js` 的 `MJChatDelivery`。业务事件采用 CloudEvents 1.0，通用测试事件 `data` 为空对象。`resolveDestination(id)` 返回目标或 `null`；`hasPermission(url)` 独立检查当前权限，`fetchRequest` 仅由投递适配器调用。
