# 哪些日麻助手真正支持追问与对话

核对日期：2026-11-04。补充[生态调研](RIICHI_ECOSYSTEM_RESEARCH.md)。本轮读取 9 个仓库的完整文件树、36 个选定源码／文档文件，以及 FlyAgent、MahjongCopilot 的公开介绍／使用说明；结论基于固定提交源码或公开文档，不是安装与真实模型联调结果。

## 结论

**在此前列出的第三方项目中，明确实现“输入自由问题，并让模型带着此前问答继续回答”的是 xMahjong，但场景为离线复盘。** Mahjong Paipu Assistant 有聊天界面与自由问题接口，但当前请求不携带聊天历史。小肥鱼有依赖 QQ 宿主的查询／讨论与管理员教学入口，不能直接等同于内置局面连续追问。

对实时助手 Akagi、MahjongCopilot、AlphaJong、mj_helper、mahjong-helper，当前已核对入口未见内置自然语言追问链路。FlyAgent 闭源，仅能确认公开宣传的解释展示，尚无公开证据证明自由追问。

## 能力对照

| 项目 | 自由输入问题 | 前轮问答进入模型 | 入口／适用场景 | 本轮结论 |
| --- | --- | --- | --- | --- |
| xMahjong | 有 | **有，最近 6 条 user／assistant 消息** | 离线牌谱的当前决策；中文追问 | **明确支持局面多轮追问**；切换决策清空当前聊天，前端内存保存而非持久讨论档案 |
| Mahjong Paipu Assistant | 有 | **当前请求不传历史** | “AI 复盘聊天”面板，可输入问题或点建议问题 | **支持反复询问当前局面**，但不是具有前轮聊天记忆的连续对话 |
| 小肥鱼 | QQ 宿主可接收用户文本 | 不是打牌客户端的对话历史；完整 QQ 宿主未包含在该公开仓库 | QQ 查询牌局／经验、控制程序、管理员通过对话教麻将原则 | **支持另一种 QQ 交流／教学接入**；未见独立逐决策聊天接口，不能确认等价于“对这一手连续追问为什么” |
| Akagi V3 | 已查 UI 未见 | 未见 | 实时 HUD、候选、指标与复盘页面 | **未见内置聊天／追问功能** |
| MahjongCopilot | 已查 UI 未见 | 未见 | 实时引擎指导、HUD、自动操作与设置 | **未见内置聊天／追问功能** |
| MJsoulCoaching | 软件内未见自由问答链路 | 软件内未见 | “Gemini 相談”页生成并复制局面提示词 | **是导出提示到外部聊天工具，不是内置对话** |
| FlyAgent | 公开文档未确认 | 未确认 | 候选、危险度、对手推测与模型动机展示 | **只确认有解释展示；自由追问无公开证据**，闭源使源码核查不可行 |
| AlphaJong | 已查 UI 未见 | 未见 | HELP／AUTO 控制与算法建议 | **未见内置对话** |
| mj_helper | 已查入口未见 | 未见 | CDP 采集和本地规则建议 | **未见内置对话** |
| mahjong-helper | 已查文档与文件树未见 | 未见 | 牌效、防守、牌谱分析 | **未见内置对话** |

“未见”仅限定本轮固定版本与核查范围，不等于证明所有分支、私有组件、未来版本均无此功能。**实时计算不等于实时对话；出现 `LLM`、`chat/completions`、`Dialog` 或“教学”字样，也不能单独证明自由聊天。**

## 支持与限制的具体代码证据

### xMahjong：确有模型多轮追问

固定提交：`dae9cea7927c775fbe82bc1fff004a7e6eada019`。

- [后端入口 app.py，第 302 行](https://github.com/ponder-j/xMahjong/blob/dae9cea7927c775fbe82bc1fff004a7e6eada019/backend/xmahjong/app.py#L302)：`POST /api/replays/{replay_id}/decisions/{decision_id}/chat`，接收 `question` 与 `history`，先取目标决策报告再调用聊天。
- [模型消息 explainer.py，第 291 行](https://github.com/ponder-j/xMahjong/blob/dae9cea7927c775fbe82bc1fff004a7e6eada019/backend/xmahjong/explainer.py#L291)：构造当前局面证据，将 `history[-6:]` 中的 user／assistant 消息加入请求，再追加新问题。正常交替时相当于最近三轮问答，不是六轮。
- [前端 app.js，第 200 行](https://github.com/ponder-j/xMahjong/blob/dae9cea7927c775fbe82bc1fff004a7e6eada019/frontend/app.js#L200)：聊天表单实际提交问题与 `state.history`，成功后加入用户问题和模型回答。
- 同文件第 82 行：切换决策时 `state.history = []`。因此它能承接同一决策的前轮问题，但不能据此宣称拥有我们这种跨决策保存、重开和持续追问的讨论档案。

### Mahjong Paipu Assistant：聊天 UI 有，聊天历史没有传给模型

固定提交：`cdfe0f3713c49f36f6afe01bccd924b75a86fbbe`。

- [panels.tsx，第 608 行](https://github.com/AwakeFantasy/mahjong-paipu-assistant/blob/cdfe0f3713c49f36f6afe01bccd924b75a86fbbe/src/components/paipu/panels.tsx#L608)：实际 `AnalysisChatPanel`，标题“AI 复盘聊天”，有输入、发送、聊天气泡与建议追问。
- [home-client.tsx，第 923 行](https://github.com/AwakeFantasy/mahjong-paipu-assistant/blob/cdfe0f3713c49f36f6afe01bccd924b75a86fbbe/src/app/home-client.tsx#L923)：前端保留显示用的 `chatMessages`，但出站 JSON 只有当前 `question`、`mode`、`snapshot`、`visibleEvents`、`llmModel`。
- [请求类型 types.ts，第 225 行](https://github.com/AwakeFantasy/mahjong-paipu-assistant/blob/cdfe0f3713c49f36f6afe01bccd924b75a86fbbe/src/lib/majsoul/types.ts#L225)及[API route.ts，第 23 行](https://github.com/AwakeFantasy/mahjong-paipu-assistant/blob/cdfe0f3713c49f36f6afe01bccd924b75a86fbbe/src/app/api/analysis-chat/route.ts#L23)：无 `history/messages` 对话参数。
- [analysis-llm.ts，第 124 行](https://github.com/AwakeFantasy/mahjong-paipu-assistant/blob/cdfe0f3713c49f36f6afe01bccd924b75a86fbbe/src/lib/majsoul/analysis-llm.ts#L124)：请求构造为系统说明和当前问题／证据；其 planner／writer／verifier 是一次回答内部的处理流程，不是用户聊天的多轮历史。

所以“为什么不切 5p？”这类完整新问题可以继续问；“你刚才第二条说的那个是什么意思？”不能假定能理解前轮回答。界面有聊天记录与模型拥有聊天上下文是两个不同能力。上一轮概括其“追问”时没有说明这一限制，本轮据代码补正。

### 小肥鱼：QQ 交流和教学，不是已经确认的局面聊天产品

固定提交：`e886cc3c6c912bff095a1a4ce35f732fd52530fe`。

- [QQ 接入说明](https://github.com/nanashi77777/xiaofeiyu-mahjong-llm/blob/e886cc3c6c912bff095a1a4ce35f732fd52530fe/docs/design/api-and-qq.md)：复用另一个 QQ 项目的 stdio MCP 工具查询战况、历史、经验与执行控制；活动小局默认不向 QQ 返回手牌、计划及可能间接泄露它们的自由文本。
- [运行手册，第 207 行](https://github.com/nanashi77777/xiaofeiyu-mahjong-llm/blob/e886cc3c6c912bff095a1a4ce35f732fd52530fe/docs/runbook.md#L207)：管理员可说“记住……”并写入／更正麻将原则，标为 `taught_unverified`，之后按条件召回。
- [DEV-096 完成记录](https://github.com/nanashi77777/xiaofeiyu-mahjong-llm/blob/e886cc3c6c912bff095a1a4ce35f732fd52530fe/docs/development/completed/DEV-096-dialogue-mahjong-learning.md)：公开记录支持教学、查询与鉴权边界；没有执行真实 QQ 教学写入测试，签名边界使用隔离测试。
- [panel.html](https://github.com/nanashi77777/xiaofeiyu-mahjong-llm/blob/e886cc3c6c912bff095a1a4ce35f732fd52530fe/src/majsoul_llm/panel.html)：本机面板是状态、操作、计划、指标和资料查询，未见聊天输入框。抽查 `app.py`、`queries.py` 未见类似逐决策 `/chat` 的接口。

可确认的是**借 QQ 宿主围绕记录交流、查询和教机器人**，而非公开仓库独立提供“实时这一手的自由聊天＋历史上下文”。不要把“管理员对话教学”误读成“AI 教用户打牌的多轮课堂”。

### MJsoulCoaching：“Gemini 相談”是剪贴板导出

固定提交：`096b7ac5d13b8e145d3dde2f15e831b1f501275a`。

[simulator_v2.html，第 282 行](https://github.com/swordofkings-blip/MJsoulCoaching/blob/096b7ac5d13b8e145d3dde2f15e831b1f501275a/server/templates/simulator_v2.html#L282)展示咨询提示预览和复制按钮；[simulator_v2_utils.js，第 635 行](https://github.com/swordofkings-blip/MJsoulCoaching/blob/096b7ac5d13b8e145d3dde2f15e831b1f501275a/server/static/js/simulator_v2_utils.js#L635)实际执行 `navigator.clipboard.writeText(prompt)`。它的 `TacticalTransformer` 是 PyTorch 战术网络，不因名称含 LLM 就成为自由聊天模型。

## 实时项目的核查边界

| 项目／固定提交 | 本轮检查位置 | 能下的结论 |
| --- | --- | --- |
| Akagi `1fb16453ae0b7b0a820510ea1d3dbd01b6939082` | 完整文件树、`GameDashboard.tsx`、`Review.tsx`、`Settings.tsx`、`menuList.ts`、`BotShowList.tsx`、`botShow.ts` | 主要 UI 与输出入口未见自然语言问题／对话历史链路；仓库同名的 `Dialog` 是界面弹窗 |
| MahjongCopilot `31be3de972bbe4b1261360ff61b18f1bb84babbe` | 完整文件树、`gui/main_gui.py`、`gui/widgets.py`、[官网使用说明](https://mjcopilot.com/help/) | 展示引擎建议和控制界面，未见自由问答入口 |
| AlphaJong `a868e1654decb9374081c72117b008beccfa0eaa` | 完整文件树、`src/gui.js`、`src/main.js` | HELP／AUTO 和参数控制，未见自由聊天 |
| mj_helper `74d6a93ad671b2fe2147da47182cd24001fdeb79` | 完整文件树、`majsoul_cdp_live.py`、前轮 README | 本地规则建议，未见聊天服务或聊天 UI |
| mahjong-helper `514bb97c5a6d157fa2ed1ac804a53cb9b559d7d0` | 完整文件树、README | 牌效与防守助手，文档／结构未见自由聊天；未全面审阅所有 Go 文件 |
| FlyAgent，2026-11-04 公开页 | [仓库介绍](https://github.com/FlyA-official/FlyAgent)、[官网](https://nashout.com/en)、[使用指南](https://nashout.com/articles/user-guide) | 只确认“模型动机／解释链路”展示；文档没有给出提问输入、对话历史或聊天配置证据，不能将其计入已确认支持追问的项目 |

**针对“实时分析＋能自由追问”的需求：本轮在这些第三方项目中没有核实到与我们当前形态相同的完整实现。** 这只是对已列对象与固定版本的结论，不能宣传全生态唯一。最有直接代码借鉴价值的对话实现仍是 xMahjong；另一个问答 UI 参考是 Mahjong Paipu Assistant，但须补上其缺失的聊天历史语义。
