# 可选 mjai 本地引擎适配

项目仍以用户自选 LLM 的局面分析与解释为主要用途。`mjai` 是可选后端，默认选择 `chat`，分析默认关闭；Mortal 只是可能接入的上游之一，不是内置或默认引擎。设置页分别保留一份 `chat` 与 `mjai` 配置，保存时选择其中一种生效，一次请求不会同时调用两者，也不会把引擎输出再发送给 LLM。

Agent 浏览器扩展已捆绑 Pi agent runtime 和 TypeBox 的浏览器构建，安装扩展无需另装 npm 包；独立获取器不含这些运行库。源码构建需 Node.js 22.19+ 并先运行 `npm ci`。以下本地引擎工具与 Pi 运行库分别准备。本项目不捆绑或训练模型；新增 `engine:akagi setup` 可由用户显式运行，从固定官方来源下载并校验指定资产。上游代码、模型及数据各自的许可证和使用条件另行适用。

## 普通用户起步：Akagi v2 的小型 Mortal 示例

以下是 **0.10.0 提供的 Windows x64 接入路径**，命令包含在该版源码包中，浏览器扩展安装包仅含浏览器文件。它使用 Akagi 维护者公开提供的小型、较弱的 Mortal 示例权重，仅适合检查本地接入与尝试建议；不是 Equim 的线上 Mortal 4.1，也不是由 mjai-reviewer 提供的权重，不代表专业牌力。LLM 分析仍是主要用途，本地引擎默认关闭。

固定来源为 [Akagi v2 提交 `91cc2993e4e3682248d33d73d93afe055040e700`](https://github.com/shinkuan/Akagi/tree/91cc2993e4e3682248d33d73d93afe055040e700)。上游为 AGPLv3 加 Commons Clause，请先阅读该提交中的许可；本项目不将上游程序或权重打入扩展安装包。`setup` 只从固定官方来源下载并检查文件，不安装依赖、不运行下载代码、不上传牌局；后续 `check` / `serve` 才使用本机 Python 加载模型。

**已测组合**：Windows x64、Python 3.11、PyTorch 2.7.0 CPU、NumPy 1.26.2，以及上述固定五文件。2026-10-26 已完成真实权重加载、四个座位的人工局面经 HTTP → EngineAgent 返回验证通过的不同动作，并验证取消清理；实测约 6.7–10 秒。这证明该限定组合可给出真实本地模型建议，不证明雀魂线上整场兼容性、其他版本兼容或实战牌力。证据与完整边界见 [VALIDATION.md](../VALIDATION.md)。

### 1. 准备本项目与 Python 环境

获取 [0.10.0 源码包](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/download/v0.10.0/majsoul-ai-analysis-and-review-agent-source-0.10.0.zip)，在包含 `agent/akagi-local.cjs` 的项目根目录打开 PowerShell。扩展安装 ZIP 只有浏览器文件，不能直接代替该源码目录。先安装 [Node.js 22.19+](https://nodejs.org/) 和 [Python 3.11 x64](https://www.python.org/downloads/)，然后执行：

```powershell
npm ci
py -3.11 -m venv .venv-akagi
.\.venv-akagi\Scripts\python.exe -m pip install torch==2.7.0 --index-url https://download.pytorch.org/whl/cpu
.\.venv-akagi\Scripts\python.exe -m pip install numpy==1.26.2
```

无需启用虚拟环境，也无需复制本机现有的聊天 API Key。这里使用 CPU 推理；其他 Python、系统或 PyTorch 版本不视为已验证组合。

### 2. 下载固定资产并实际检查模型

```powershell
npm run engine:akagi -- setup --dir research/evidence/akagi-v2
npm run engine:akagi -- check --dir research/evidence/akagi-v2 --python .venv-akagi/Scripts/python.exe
```

`setup` 下载固定的五个上游文件并核对 SHA-256：`model.py`、`mortal.pth`（约 5.12 MB）、Windows `libriichi.pyd`、`LICENSE.txt` 和 `README.md`。精确路径与哈希见[固定资产清单](../agent/akagi-source.json)。模型保存在已忽略的 `research/evidence/` 下，不应提交到本项目仓库或放入扩展文件夹。

下载成功只证明文件完整；`check` 使用人工四麻局面真实加载权重并调用推理，与通用 Python 包装器只检查签名的 `--check` 不同。成功输出含 `inferenceVerified:true` 及经过检查的 `dahai` 动作；确认成功后再继续。首次安装依赖需要联网，推理在本机执行。

### 3. 启动桥接并填写扩展设置

```powershell
npm run engine:akagi -- serve --dir research/evidence/akagi-v2 --python .venv-akagi/Scripts/python.exe --port 17341
```

`serve` 会先再次执行真实模型检查，成功后才监听端口。保持终端运行，将终端显示的 `/analyze` 地址和随机 Bearer Token 填入完整版“模型设置”中的“本地 mjai”。默认地址为 `http://127.0.0.1:17341/analyze`；Token 只填在 Token 框，不拼入 URL，不公开终端输出。手动勾选“开启模型分析”、保存并授予本机接口权限。

回到事件连续、进行中的四麻局面，授权对局信息、四家牌河与自家手牌，确认座位，选择“综合攻守”，查看将发送的数据后手动分析。成功时显示经合法动作校验的建议；不会自动打牌。切回 `chat` 可恢复之前保存的 LLM 配置。关闭桥接可在终端按 `Ctrl+C`，同时在扩展关闭分析。

此起步适配每次请求都会重新加载模型，进程预算为 30 秒；浏览器整体请求预算仍为 25 秒。本机检查成功不保证较慢设备上的浏览器请求及时完成。

### 常见问题

- 找不到 `engine:akagi` 或脚本：确认使用 0.10.0 源码包并在源码根目录运行；扩展安装 ZIP 不含这些本机命令。
- Python 或依赖找不到：重新执行第 1 步，所有检查和启动均指定同一 `.venv-akagi/Scripts/python.exe`；不要用另一个环境的 `pip`。
- `FILES_MISSING`：在相同 `--dir` 再运行 `setup`。`SOURCE_HASH_MISMATCH` / `EXISTING_FILE_MISMATCH`：现有文件不符合固定资产，请选择新的空目录重新 `setup`，不要覆盖未知文件或跳过校验。
- `PYTHON_NOT_FOUND`：为 `--python` 填写 Python 可执行文件的正确路径。`PYTHON_VERSION_UNSUPPORTED`：须使用 Windows x64 的 Python 3.11。`PYTHON_DEPENDENCIES_FAILED`：将固定版本依赖装在 `--python` 指定的环境。`REAL_INFERENCE_FAILED`：文件校验通过仍无法加载或推理，核查上述依赖与 Windows 运行库；不要把它当作检查成功。
- `PORT_IN_USE`：关闭旧桥接，或改用 `--port 17342`，并把扩展地址同步改为终端实际显示值。
- HTTP 401：填写当前这次启动的 Token；每次启动默认生成新 Token。HTTP 429：等待现有推理结束后再手动重试。
- 检查成功但牌局分析拒绝：先核查下面的支持范围。三麻、事件不连续、未知自家手牌、缺少当前和牌资格或不支持的动作都会明确拒绝；检查不保证真实游戏整场兼容性或建议质量。

## 进阶：接入自备 Python Bot

`agent/mjai-python-wrapper.py` 适配一个用户提供的 Python 模块：默认模块导出可零参数构造的 `Bot` 类（可用 `--class` 修改类名），由该类自行初始化运行环境并加载权重。包装器调用一次同步 `bot.react(events_json)`；参数是整个事件数组的 JSON 字符串，返回值应为 mjai 动作字典或该字典的 JSON 字符串。

显式传入 `--constructor seat` 可改用 `Bot(player_id)`，座位来自事件数组首条且唯一的 `start_game.id`，必须为整数0至3。默认 `--constructor zero` 保持 `Bot()`；不自动猜测构造方式，也不在失败后回退。其他构造参数、异步方法、生成器、逐事件输入或不同的 `react` 签名仍需用户提供适配类。这不表示任意 Mortal/Akagi `bot.py` 都可直接运行。命令和模块以当前工作目录运行，不自动切换到配置文件目录；建议使用绝对路径。

```sh
python agent/mjai-python-wrapper.py --help
```

例如将自己的适配模块保存为 `D:/my-engine/my_mjai_bot.py`，并准备 `runtime.json`：

```json
{
  "command": "python",
  "args": [
    "D:/majsoul-ai-analysis-and-review-agent/agent/mjai-python-wrapper.py",
    "--module-dir", "D:/my-engine",
    "--module", "my_mjai_bot",
    "--class", "Bot"
  ],
  "timeoutMs": 15000,
  "maxOutputBytes": 65536,
  "maxInputBytes": 2097152
}
```

以上路径均需替换为本机实际路径；`my_mjai_bot` 是用户模块示例名，不是本项目提供的模型。依赖和权重由该模块管理。配置中的 `command` 与 `args` 是本机程序执行权限，**不是沙箱**；虽然以 `shell:false` 启动，仍会执行所配置程序及导入模块的任意代码，只应使用可信配置和模块。

对于已提供 `Bot(player_id)`、同步 `react(events_json)` 的可信模块，在上例 `args` 中追加 `"--constructor", "seat"`。其最小接口如下；实际模型初始化仍由用户实现：

```python
class Bot:
    def __init__(self, player_id):
        self.player_id = player_id

    def react(self, events_json):
        # Replace with your own initialized model's batch-event inference.
        return {"type": "none"}
```

先用与运行配置相同的参数执行接口检查：

```sh
python agent/mjai-python-wrapper.py --module-dir D:/my-engine --module my_mjai_bot --constructor seat --check
```

成功输出 `{"format":"mjai-python-interface-v1","constructor":"seat","react":"events-json","signatureCompatible":true,"inferenceVerified":false}`。检查只导入模块并验证类的构造及同步 `react` 参数签名，不构造 Bot、不调用 `react`；**导入模块仍可能触发其顶层代码加载模型或其他副作用**。`--check` 对无法检查的签名返回 `SIGNATURE_UNAVAILABLE`，不能据此判定接口不可运行。正常推理保留不暴露 Python 签名的可调用接口（例如部分原生扩展）的运行能力，仍拒绝能够确定的参数不匹配、异步或生成器接口；构造方式始终按用户配置，不自动回退。签名兼容不能证明返回值、模型文件、推理依赖或真实推理可用，接下来应使用自己的授权导出执行 `engine:review`；不得把检查结果作为真实 Mortal/Akagi 权重兼容证明。

包装器失败时 stdout 为空，stderr 使用固定阶段码：`IMPORT_FAILED`、`INTERFACE_INCOMPATIBLE`、`SIGNATURE_UNAVAILABLE`（仅接口检查）、`INVALID_INPUT`、`CONSTRUCTOR_FAILED`、`REACT_FAILED` 或 `INVALID_ACTION`，不输出捕获到的用户异常。用户模块主动写出的调试日志仍会进入 stderr，应自行避免记录敏感信息。Node runner/HTTP 对外保持通用失败，不透传进程日志；排查包装器阶段码需在本机直接运行相同命令与授权事件输入。

## JSONL 进程协议

每次推理都会启动一个新进程，不复用模型状态。Node runner 在 stdin 写入 **一行 JSON 事件数组加换行**，随后关闭 stdin；不是逐事件多行，也不是 HTTP 请求外层对象：

```text
[{"type":"start_game","id":0,"names":["Player 0","Player 1","Player 2","Player 3"]},{"type":"start_kyoku",...},{"type":"tsumo","actor":0,"pai":"9p"}]
```

上行仅示意数组形状，`...` 不是有效 JSON；真实内容由适配器生成，包含完整开局字段与从本局开局到当前游标的连续事件。上游必须基于这一批事件重建状态并返回当前动作。数牌使用 `1m` 至 `9s`，赤五使用 `5mr/5pr/5sr`，字牌为 `E/S/W/N/P/F/C`。

stdout 必须仅输出一行 JSON，并以换行结束。可以继续返回原有的单动作结构：

```json
{"type":"dahai","actor":0,"pai":"9p","tsumogiri":true}
```

也可以明确返回立直与配套弃牌，下面是一行可复制的有效 JSON：

```json
{"action":{"type":"reach","actor":0},"followUp":{"type":"dahai","actor":0,"pai":"9p","tsumogiri":true}}
```

只有 `reach` 接受同一 `actor` 的 `dahai` 作为 `followUp`；两步动作仍须通过当前局面的合法性校验。此结构也适用于通用 Python `Bot.react` 的返回值，不能用它提交任意动作序列。未提供配套弃牌时仍可只返回 `{"type":"reach","actor":0}`，页面保留立直意向，具体弃牌为空。

固定 Akagi profile 在模型返回立直后，会向同一个 Bot 追加它自己的 `reach` 事件，取得模型实际返回的 `dahai`，再形成上述配套结构；通用 Python 包装器不会擅自追加事件或多调用一次 `react`，需要模块自行明确返回配套结构。

日志应写 stderr。runner 收到第一行完整响应后结束并清理进程；超时、取消、异常退出、响应超限或非 JSON 响应会失败。默认进程预算15秒，stdout 与 stderr 的累计限额64KiB，进程输入和 HTTP 请求体限额2MiB；mjai DTO 还受256KiB序列化长度限制。浏览器 Agent 整体预算25秒，调大进程超时不会延长浏览器预算。每次重新加载大模型的成本可能导致超时，当前没有常驻模型服务池。

Python 包装器把模块初始化和 `react` 中的 stdout 调试输出重定向到 stderr；输出只保留动作字段，删除上游 metadata/Q 值。它不是权限隔离机制。自写其他 JSONL 进程也可接入，但同样必须遵守这些约定。

## 本地桥接与扩展设置

在仓库根目录执行：

```sh
npm run engine:serve -- --config runtime.json --port 17341
```

服务只监听 `127.0.0.1`，显示 `/analyze` 地址和随机 Bearer Token。也可通过环境变量 `MJAI_ENGINE_TOKEN` 或 `--token` 指定 Token；命令行参数可能进入终端历史，不要公开服务输出或凭据。服务全局同时只运行一次推理，忙时返回 HTTP 429，不排队；客户端断开后先取消并清理进程，推理结束后才释放执行槽位。

在完整版“模型设置”选择 `mjai`，填写 `http://127.0.0.1:17341/analyze` 和该 Token，手动开启分析、保存并授予本地主机权限。切换回 `chat` 时可恢复已保存的聊天模型配置；点击关闭会关闭分析，清除会移除两种后端的配置与凭据。仅获取器版没有这些入口，也不包含引擎适配或网络权限。

页面使用时需要授权对局信息、四家牌河及自家手牌，确认自家座位，选择“综合攻守”，预览真实的 `majsoul-mjai-v1` 请求后手动分析。HTTP `POST /analyze` 接收 `{format,seat,events}`，返回 `{action: <mjai动作>}`；Token 由扩展后台加入 Authorization，不进入页面桥接或牌局导出。

## 导出事件的协议复盘

```sh
npm run engine:review -- observation.json --config runtime.json --seat 0 --hand --cursor 12
```

输入为获取器导出的 `mj-observer-v1` JSON，`--hand` 必须显式授权，座位0至3。牌谱 `--cursor N` 仅使用前 N 条记录，禁止游标后的未来事件；实时导出省略 `--cursor`。缺少本局开局或连续事件时拒绝，不能从结算历史快照或截断事件伪造回放。

此 CLI 从指定游标重建快照，通过同一个 `EngineAgent.run` 执行快照/事件一致性对照、用户进程推理及最终动作合同校验。输出 `majsoul-engine-review-v1`，包含 `engine`、兼容分析结果的 `result`、`localAnalysis` 与脱敏 `trace`，不直接透传上游原始动作或文本。它同样受连续四麻及可证明动作的限制；离线牌谱不伪造实时和牌资格，不自动执行游戏操作。原有 `npm run review` 仍只做本地确定性计算，不启动外部引擎。

## 当前支持范围与数据边界

- 页面 Agent 支持完整、进行中、可连续重放的四人对局，包括可验证副露和补牌流程。自家必须有明确可验证手牌、摸牌、四家有序牌河和对局信息；三麻、已结束局面、未知赤五组成的对手五暗杠及信息缺口明确拒绝。自家14张开局记录无法可靠区分庄家摸牌，适配器明确拒绝，不猜测拆牌。牌山只校验已知上界，不声称精确重建。
- 适配器生成 `start_game` 和13张 `start_kyoku` 后的事件流。玩家名匿名化，对手开局手牌和摸牌统一为 `?`；牌谱即使保存四家手牌，也不会向此引擎发送对手暗牌。严格白名单拒绝未知字段和额外私人数据。
- Agent 重放自家手牌，检查摸打轮转、立直成立顺序，并对照快照的局数、本场、供托、点数、宝牌、公开有序牌河及立直状态。不从 collector 内部状态或未来事件补全缺失信息。
- 页面接受验证通过的 `dahai`、`reach`、`none`、`chi`、`pon`、`daiminkan`、`ankan`、`kakan` 和 `hora`。弃牌须来自当前手牌与本地合法候选，鸣牌后检查食替；立直后弃牌仅允许确认的摸切。`reach` 仅在返回并验证 `followUp` 弃牌时展示宣言牌，否则保持 `tile:null`，不猜测。吃碰杠展示来源、鸣牌张和手牌用牌，杠提示等待补牌，不误标为弃牌。
- 荣和／自摸要求本地和牌形与同一步、同座位实时游戏操作资格（9／8）；荣和另检查自家牌河振听。完整役与临时／立直振听资格依赖游戏提示，不宣称独立完整判定。抢杠、自家立直后杠、多人四杠后继续对局保守拒绝；对手已发生的合法立直后暗杠可重放。离线牌谱无实时资格时不能给和牌建议。
- 响应建议需手动“分析当前局面”；自动触发仍限原有自家弃牌点。结果展示阶段，动作牌与弃牌提示区分；冻结历史及 LLM 追问保留经过白名单筛选的动作、阶段和配套弃牌。客户端资格只在实时当前步且授权对局时保留，断线、换座位或后续新事件清除，普通 LLM 请求不加入此字段。不自动执行任何操作。
- Q 值是策略分数，不是放铳概率。没有可验证的固定动作索引映射时 `candidates` 为空；不会对 Q 值做 softmax 后冒充概率，也不会据此生成危险牌。非有限值、非法动作和超大响应拒绝。
- harness 只记录工具名、状态和耗时，不记录牌局载荷、原始输出或密钥。Token 保存在扩展本地存储，与聊天 API Key 一样不是加密保险箱。

除人工事件、模拟进程与 HTTP 回归外，上述 Akagi v2 固定组合已完成真实示例权重推理与 HTTP → EngineAgent 验收；新增动作另以真实模型人工局面验证 profile → runner → Agent，不将其合称真实模型 HTTP 全链路。其他 Bot、权重与环境不据此视为已测，真实游戏整场兼容性与实战牌力仍待验证。上述能力纳入 0.10.0；本轮未做真实完整牌谱验证。模型可能在 Agent 尚不支持的动作中选出最优动作，此时明确失败，不擅自替换成另一个动作。运行与数据风险另见 [SECURITY.md](../SECURITY.md)，验证记录见 [VALIDATION.md](../VALIDATION.md)。
