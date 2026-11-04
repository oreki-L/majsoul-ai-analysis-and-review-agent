# Akagi v3 模型接入方案：统一管理的第四个可选引擎

> 实施完成（2026-11-04，v0.16.0）：已适配 v0.15.0 便携框架，实现第四个 profile、独立 native 按需安装与推理、精确身份和通用 LLM 解释链路。固定权重真实推理、119 组上游共有样本对照、四模型切换、正式工件在线空目录安装，以及浏览器人工局面手动／主动自动分析均通过。作为四人半庄实验选项开放；真实整场、干净 VM 与牌力仍未验证。以下保存**实施前方案**的设计依据及阶段门槛，实际结果以 [Akagi v3 验收记录](AKAGI_V3_VALIDATION.md) 为准。

日期：2026-11-04。基线：**v0.14.0**。原方案状态：**以下为实施前的审查快照，已由上方实施结果及验收记录更新**。

用户重新要求把 Akagi v3 作为可选项。本方案在已发布的 Akagi v2、VoidShine 298k、Yuchen 582500 及本机模型管理能力上增量设计，不改变这三项的已测范围。`engines/akagi-native/` 是早期未完成草稿，不是可用引擎或发布资产。已完成固定上游源码／权重元信息与当前架构核查；本轮未下载新权重、编译或执行 v3。

## 1. 旧方案的适用与失效差异

| 旧方案假设／当前实现障碍 | v0.14.0 现状与修订 |
| --- | --- |
| 浏览器扩展采集、冻结输入、HTTP `/analyze`、EngineAgent 校验及 LLM 解释 | 继续复用；不替换采集器，不接入 Tauri／CDP／系统代理 |
| 新增 v3、保留 v2 | 扩展为第四项：v2、VoidShine、Yuchen、v3；保留 custom／legacy 配置 |
| mjai 只有一个草稿槽位，新增 `engine-profiles.js`／存储 | 已有 `model-config-store.js` 和 `mjaiEngineProfilesV1`，只增量加入 profile，不建重复 store |
| 新用户优先介绍 v3，首期支持自动分析 | 不优先推荐未验模型；首期实验范围为四人半庄，提前声明范围，手动及既有自动路径须独立验收，不设置逐巡确认 |
| v3 地址使用 `17342` | 已由 VoidShine 使用；候选 v3 地址改为 `http://127.0.0.1:17345/analyze`，管理端口仍为 `17343` |
| 用户可同时启动 v2 与 v3 再切换 | 管理器只运行一个模型；切换先回收旧桥接／worker，保留安装资产 |
| 旧方案已说明 v3 不用 Python；但 v0.14.0 管理代码按现有三模型固定准备 Python／PyTorch | 按 runtime kind 分流；v3 保留原生方案，不调用 Mortal `ensureRuntime` |
| 工具包统一包含 v3 程序 | 改为独立固定 v3 runtime 工件，仅选 v3 时准备；其他模型不为它下载二进制或权重 |
| 新写 `engine-explain` 并迁移所有历史分支 | 不做大规模存储迁移；内部继续兼容 `mortal-explain`，只把用户可见通用文案改为“本地引擎决策 + LLM 解释” |
| 常驻加载、每请求重置／重放、严格动作映射及身份校验 | 保留设计目标，但必须用真实 v3 权重验证，不能把旧草稿或 v4 验收当作 v3 证据 |
| 完整整场和干净 VM 均作为首发硬门槛 | 区分实验可选发布与稳定推荐门槛，见第 4 节；未完成项继续明确标注 |

固定上游为 Akagi commit [`1fb16453ae0b7b0a820510ea1d3dbd01b6939082`](https://github.com/shinkuan/Akagi/tree/1fb16453ae0b7b0a820510ea1d3dbd01b6939082)，核查时仍是默认 `v3` 分支 HEAD（2026-11-01）。公开 release `v3.7.2`（2026-10-21）对应 commit `6fef1c3f2f2e39d983dfbc1aee7d2468025193bf`；HEAD 多两个提交，`native_bot/` 及其锁文件未变。设计仍锁定上述完整 commit，不使用浮动分支／release URL 作为安装锁。

| 已核事实 | 依据与限制 |
| --- | --- |
| 四麻权重 `native_bot/weights/akagi4p.safetensors`，2,641,816 字节 | 本地权重 blob `73d463396c8d91a7ca7e282c01161ceef1e1f4ab` 与固定官方 tree 匹配，为非 LFS 文件；SHA-256 `33c20aaba3f349ef689df73b726224804dc4aaff99922093d8f30cc38d709a1d`。本轮未重新下载或执行 |
| 行为克隆 CNN，非 Mortal | safetensors 为 18 个 F32 tensors、660,050 参数；源码架构为 39×34 输入、82 actions、conv 64、3 blocks、fc 256，需配套编码／动作映射，不能替换 `.pth` |
| 外部权重接口已存在 | [`Engine::new(Vec<u8>, players, seat)`](https://github.com/shinkuan/Akagi/blob/1fb16453ae0b7b0a820510ea1d3dbd01b6939082/native_bot/src/engine.rs#L117) 与 [`from_safetensors`](https://github.com/shinkuan/Akagi/blob/1fb16453ae0b7b0a820510ea1d3dbd01b6939082/native_bot/src/model.rs#L28)，无须重写模型 |
| CPU 与固定依赖 | 源码使用 `Device::Cpu`；已有独立 [`native_bot/Cargo.lock`](https://github.com/shinkuan/Akagi/blob/1fb16453ae0b7b0a820510ea1d3dbd01b6939082/native_bot/Cargo.lock)，candle 0.9.2、riichienv-core 0.4.8。应复用审查后的锁，不从零解析宽松依赖；最低 Rust／Windows 链接与二进制尚未编译验收 |
| 默认嵌入两套权重 | [`defaults.rs`](https://github.com/shinkuan/Akagi/blob/1fb16453ae0b7b0a820510ea1d3dbd01b6939082/native_bot/src/defaults.rs#L9) 的两个 `include_bytes!` 包含四麻／三麻，`lib.rs` 公开 defaults；只“不调用”默认入口不能保证二进制无权重 |
| 许可与训练说明 | 根 LICENSE、NOTICE、crate／README 说明采用／继承 Apache-2.0；weights 没有单独 license／model card。训练说明为天凤行为克隆，未提供详细训练数据来源及授权证明；不扩称训练数据已获授权，不新增采集或训练任务 |

权重拟固定原始地址：[akagi4p.safetensors](https://raw.githubusercontent.com/shinkuan/Akagi/1fb16453ae0b7b0a820510ea1d3dbd01b6939082/native_bot/weights/akagi4p.safetensors)。上述哈希来自固定文件核查，安装仍须实际下载后复核；它不是本项目推理可用或权重加载成功的证明。源码许可见 [LICENSE](https://github.com/shinkuan/Akagi/blob/1fb16453ae0b7b0a820510ea1d3dbd01b6939082/LICENSE.txt)、[NOTICE](https://github.com/shinkuan/Akagi/blob/1fb16453ae0b7b0a820510ea1d3dbd01b6939082/NOTICE)、[训练说明](https://github.com/shinkuan/Akagi/blob/1fb16453ae0b7b0a820510ea1d3dbd01b6939082/native_bot/train/README.md)。

## 2. 最终用户流程

以下是**拟议完成后的流程**，不是当前可用说明：

1. 用户升级到**支持 v3 的新版便携运行包**（具体版本待实施），复用当前源码的新流程：包内 Node 运行 `start.cmd`，自动打开并连接本机管理页，无需预装 Node 或复制管理 Token。已发布 v0.14.0 ZIP 不会自动出现第四项。启动管理页不下载、不推理；普通 LLM、扩展或其他三模型不依赖 v3。
2. 模型目录中出现 Akagi v3 Native 第四项。实施前／未过门槛时标“待验证”且不能安装启动；验证通过后才开放安装。主卡沿用模型名、简洁状态、大小及操作；来源、许可、环境与验证范围放在详情，不增加重复次要标签。
3. 点击 v3“安装”才准备固定 v3 runtime 和所选四麻权重。它们分别校验、记录和原子安装，不下载 Python／PyTorch，不顺带安装其他模型。失败显示真实错误，不回退到 v2、Mortal 或 LLM。
4. 安装不启动推理。点击“启动分析”后校验资产、启动 worker、完成真实预热，才显示分析接口与独立分析 Token；候选端口 `17345`。管理 Token 不用于分析，不写 URL 或持久存储。
5. 扩展选择独立 v3 profile，复用当前源码的运行包配对流程，在管理页批准后自动填入该模型的分析配置，再保存并明确开启分析。必须将 v3 加入配对 profile／固定端口白名单并覆盖身份及迟到保护，不能只新增目录项。profile 切换关闭分析、取消旧在途动作／解释，保存不会启动本机程序。首期仅支持四人半庄，在模型选择与使用说明中提前声明，不要求逐巡勾选。自动分析默认关闭，沿已有自家出牌触发路径验收后才可由用户主动开启；不根据局数或“v3”名称推断整场模式。
6. 管理页对另一已安装模型点击“切换并启动”时，先停止旧模型，再启动所选模型；四个权重可同时保留，运行槽只有一个。用完停止分析再退出管理终端。
7. 删除 v3 模型只删除其受管理且完整性通过的权重／模型目录，保留 v3 runtime 供以后重装；不删除其他模型、共享 v4 Python 环境或外部自备目录。清理 runtime 若以后提供，另作为显式功能设计。

现有 v2 独立 `setup/check/serve --python ...` 路径继续有效；拟增的 v3 CLI 可独立 `check/serve`，由用户手动运行，不要求先通过浏览器管理页。统一 manager 路径保证一次一个模型，不承诺控制用户另行启动的外部 CLI 服务；端口占用需明确报错，不静默换模型或杀其他进程。

当前源码的便携启动器统一使用 `%LOCALAPPDATA%\MajsoulAgent\models`，换包后复用通过校验的已下载模型和环境。旧版安装可用显式 `--root` 指向原目录；不自动发现、搬迁或合并旧包内目录，不强制重装。目录复用需作为升级回归验证，不绕过所有权／完整性检查。

## 3. 资产、架构与文件清单

### 3.1 三层资产

| 资产层 | 内容与固定要求 | 准备／删除时机 |
| --- | --- | --- |
| 通用管理引导层 | 现有 Node 管理服务、UI、目录及驱动声明 | 普通扩展不需要；默认 bootstrap 不嵌入 v3 权重或完整 v3 runtime |
| v3 专用 runtime | 候选 `akagi-native.exe`、配套动态库（如有）、版本／ABI／协议清单、对应源码、完整依赖与许可证、改动记录 | 仅显式安装 v3 时按固定 SHA-256 工件准备；删除权重后保留 |
| v3 模型权重 | 固定四麻 safetensors、来源 revision、权重 SHA-256、大小与许可／model card | 仅显式安装 v3 时准备；仅删除自己的模型目录 |

建议目录沿用 `models/{profile}` 与 `runtimes/{runtimeFamily}`。候选 profile ID 为 `akagi-v3-native`，runtime family 需包含平台／ABI／协议版本；实际名称在来源清单固定时确定。二进制哈希和权重哈希分别记录，启动时核对兼容矩阵，不允许“旧程序 + 任意新权重”静默运行。

v3 runtime 工件下载 URL、发布命名和 SHA-256 **尚未就绪**，不填写假值，不把 GitHub 浮动 release 当锁定来源。若尚不能提供经审查的分发工件，就只保留禁用目录项，不让用户本机临时编译作为普通安装的隐含步骤。普通用户无需 Rust；构建依赖由维护者明确准备。

### 3.2 增量接入现有管理器

当前 `mortal-catalog.json` 使用通用目录格式，可继续保留文件名，不为命名整洁重构全部 Mortal 文件。新增小型固定 profile registry，集中 `source`、`runtimeKind`、`runtimeFamily`、`runnerKind`、`defaultPort`、`weightAsset`；以 driver 分派替代“非 v2 即 Mortal v4”的假设。现有三模型的目录、marker、hash 与运行路径不重写：

- **目录与安装**：权重通过 `weightAsset`／明确 asset role 寻找，不按 `.pth` 或 `.safetensors` 扩展名猜测；`sourceUrl` 显式使用固定 GitHub／权重来源，不走“任意 repository 默认拼 Hugging Face”的回退。`inspect/install/remove` 保持受管理路径、所有权、哈希、原子安装与取消语义；runtime 安装、状态、完整性校验均按类型分派，v3 不进入固定 Python archive／wheel 的 `ensureRuntime`、`pythonFor`、Mortal lock 或 `libriichi.pyd` 专用路径。native runtime 使用独立 `kind`、资产锁与 marker，不能覆盖现有 Mortal `managed-runtime-v1`／锁。
- **路径边界**：继续采用 v0.14.0 修复后的 Windows 大小写／8.3 路径规范化，以及祖先、root、child junction 拒绝检查并覆盖回归；提取 driver 不得退回字符串前缀校验，不因路径别名绕过管理目录与所有权边界。
- **状态**：模型权重、runtime、运行中桥接分别报告；删除最后一个模型后 runtime 仍应显示保留。操作阶段显示校验模型、校验 runtime、加载、预热、监听的真实进度，不杜撰百分比。
- **启动**：`startBridge` 按 driver 构造 runner、identity、预热与端口，v3 不落入默认 Mortal 分支。`createEngineServer` 的 runner 注入已存在，直接复用；loopback、Bearer、Origin／Host、限额、脱敏错误等边界保持。
- **生命周期**：沿用 `infer(request, { signal })`、`close()`、`ready`／`pid` 可观测合同。启动只在检查与预热成功后监听；超时、取消、损坏输出或协议错位后清理整棵 worker 树，清理后释放槽位；重启重新预热，不重试同次失败请求。

进程层优先小范围提取 `persistent-engine-process.cjs`，供 `mortal-process.cjs` 薄适配与新 `akagi-native-process.cjs` 共用进程树终止、有界恢复和协议解析；各自协议／握手／身份仍独立，v2 单次 runner 不改。以当前 20 秒请求、120 秒启动、2 MiB 输入、64 KiB 输出、最多 3 次恢复作为待验证起点，native 真实测试后才能固定预算。失败必须先清理再 reject，不让旧 worker 在新请求期间继续运行；不借抽取扩大并发或修改动作校验。

### 3.3 Rust worker 与动作合同

拟复用上游模型／编码实现，不另用 JavaScript 或 Python 仿写。worker 以显式外部权重路径调用现有外载接口；必须用 feature gate 或明确移除的方式禁用 defaults 的两套 `include_bytes!`，不是仅不调用。构建后检查二进制与分发清单确实无嵌入权重，改动与上游未修改文件分开记录。仅引入推理必要组件，不引入 Tauri 应用、浏览器自动操作、云推理或训练数据下载。

Node↔Rust 使用私有版本化 JSONL envelope，requestId、seat、events 有界；stdout 只承载协议，stderr 有界且不记录 Token／手牌正文。HTTP 外层继续现有 `{format, seat, events}` 与 `/analyze`，不为选模型扩展采集授权。

每次请求保留已加载网络，清空牌局并设置本次座位，严格重放完整授权事件前缀，只在最终局面决策。不采用宽松跳过未知事件的默认行为；允许忽略的 envelope 元数据必须有明确表，必要牌局事件不能建模则失败。A→B→A、不同座位／标签页／回看游标互不污染。

以下为固定源码核查发现的**阶段 0 风险门槛**，尚未以 v3 真实运行验证，不能写成已发生的污染或已修复的缺陷：

| 风险与固定依据 | 实施前必须验证／处理 |
| --- | --- |
| 未知牌 `?`：riichienv-core 0.4.8 的 `state/event_handler.rs:8`、`:93` 将其转为 tile 0（1m）；但 `state/mod.rs:189` 屏蔽其他手牌，[`adapt.rs:81`](https://github.com/shinkuan/Akagi/blob/1fb16453ae0b7b0a820510ea1d3dbd01b6939082/native_bot/src/adapt.rs#L81) 只取 `obs.hands[pid]` | 不能仅凭占位转换断言污染。固定自家／公开输入，改变合法隐藏填充，对四座位比较 observation、mask、logits、action；覆盖未知摸牌、鸣牌、杠及补牌。不得用真实对手暗牌凑输入 |
| 振听状态：[`chankan.rs:64`](https://github.com/shinkuan/Akagi/blob/1fb16453ae0b7b0a820510ea1d3dbd01b6939082/native_bot/src/chankan.rs#L64) 注明 replay 不维护临时／立直振听的 missed-agari flags，core `legal_actions.rs:267` 读取该类状态 | 保留同一步雀魂和牌资格与本项目振听校验；增加错过荣和后同巡再遇、立直后再遇的拒绝用例，不能只信上游 legal mask |
| `start_game.id` 类型：core `replay/mjai_replay.rs:70` 期望 `Option<String>`，本项目为数字 | 按 Akagi [`convert.rs:33`](https://github.com/shinkuan/Akagi/blob/1fb16453ae0b7b0a820510ea1d3dbd01b6939082/src/game_state/convert.rs#L33) 显式转字符串或剥离元数据；座位仍独立 `set_seat`，不能因 parse 失败静默跳过 |
| 默认规则：[`engine.rs:118`](https://github.com/shinkuan/Akagi/blob/1fb16453ae0b7b0a820510ea1d3dbd01b6939082/native_bot/src/engine.rs#L118) 与 reset 固定 `default_tenhou()`，没有 setter；core `rule.rs:29`、`:44` 定义天凤／雀魂差异 | 核对半庄支持范围的相关规则。若 patch 为雀魂规则，标记本地改动；将“未改引擎模型／特征对照”与“规则修改的预期差异／雀魂资格验收”分开，不能要求修改规则后最终动作全相同 |
| 尾随事件与旧合法集：`Engine::decide()` 的 `None` 不等于显式 Pass；上层 [`src/bot/native.rs:559`](https://github.com/shinkuan/Akagi/blob/1fb16453ae0b7b0a820510ea1d3dbd01b6939082/src/bot/native.rs#L559) 对最终 `reach_accepted` 及自家杠后待补牌专门 guard | 把必要 guard 纳入 wrapper，而不是只摘取 native_bot 库；自家弃牌缺动作失败。`None` 仅在当前授权局面可证明无合法响应时才可映射 `none`，显式 Pass 也须验证响应阶段；`reach_accepted`／待补牌依 guard 拒绝或等待，不复用旧建议 |
| 解码内部过滤：[`action_codec.rs`](https://github.com/shinkuan/Akagi/blob/1fb16453ae0b7b0a820510ea1d3dbd01b6939082/native_bot/src/action_codec.rs) 按 action ID 去重普通／赤五且优先普通五，softmax 仅作用于去重合法集；reach 克隆状态再次前向取弃牌，缺配套则移除 reach | 对照并披露上游内部过滤，验证赤五实体与立直配套；桥接层校验失败时仍不得二次替换候选 |

上述 core 路径以 `native_bot/Cargo.lock` 锁定的 riichienv-core **0.4.8** crate 源码为准（不是浮动 Git 分支）。修复或证明这些风险在本项目授权输入下可控，是阶段 A 的前置条件；未通过不能靠扩大输入授权或放松动作校验绕过。

动作仍经现有 EngineAgent 校验：赤五与摸切实体、副露来源、立直及同快照配套弃牌、响应阶段 Pass、荣和／自摸的当前资格与振听约束均须验证。未支持的九种九牌、拔北或其他动作明确拒绝，不在本项目桥接层另选候选替代。保留固定上游内部解码行为的对照记录，不能把上游内部已作的过滤声称为本项目可恢复的原始策略。

首期仅交付最终动作，候选仍可为空。logit／softmax 不当作胜率、放铳率或神经网络“思考过程”。本项目实验支持范围固定为四人半庄并提前声明，不要求逐巡确认，这不表示 v3 权重只用半庄训练或无法支持东风。规则默认值、可配置能力与输入适配仍需核查；如半庄范围内有未解决差异，应解决或阻止该范围发布，不能把“能返回合法动作”视为完整雀魂兼容。

### 3.4 配置、身份与解释

只扩展 `extension/model-config-store.js` 的现有 profile 集合：读取合法旧 `mjaiEngineProfilesV1` 时也按 ID 增量补入缺失的 v3 preset，不能仅改默认数组而直接返回旧保存列表。新增项 `enabled:false`；已有用户不重写 activeId、当前选中项、三个模型的地址／Token、Chat 配置、custom 或 legacy，也不按端口猜测旧模型身份。`modelConfig` 继续是唯一运行时配置，`analysisProviders.mjai` 为兼容草稿。

用户已要求取消逐次规则确认，当前 v4 源码也已移除 `mortal-hanchan-manual-v1` 门槛；v3 不再复用或新增此声明机制。适用范围在模型设置与目录提前展示，保留四人局面、事件一致性、授权与动作合法性校验；不能声称已自动识别整场半庄。手动与既有自动调用路径分别验收，自动默认关闭，沿原有自家出牌触发、去重、频率、上限和过期取消保护，不扩大到自动鸣牌响应。不复用写死“v4”的用户提示来假称 v3 是 Mortal；来源／许可／构建详情折叠。

复用已有 `identity.model/runtime/checkpoint/sourceCommit` 字段，不新增历史 identity schema。`runtime` 使用唯一 runtime build ID，绑定二进制 SHA-256 及 wrapper／编码／协议版本；来源清单保存这些完整值，`checkpoint` 仍为权重 hash，`sourceCommit` 为固定上游 commit。runtime 二进制必须单独核验，不能仅复述源码 commit 就冒认运行身份。值来自经验证资产，不来自显示名。已知 v3 profile 在提交结果前核对期望身份，缺失／错配明确失败；custom 可如实保持身份未知。既有讨论持久字段能够保留该 build ID；仍须测试写入、读取、解释重试与刷新后原始模型身份不变，不能只检查当次 HTTP 响应。

内部工作流继续识别 `mortal-explain`，不为非 Mortal 引擎引入整套 `engine-explain` 存储迁移。只将适用于所有本地引擎的用户可见名称改成通用说法；官网 Mortal 报告、Mortal 特有文档及历史事实不跟随改名。动作先展示并保存，解释失败只重试解释，冻结追问不重跑引擎。

### 3.5 拟议文件范围

| 文件／模块 | 拟议工作 |
| --- | --- |
| `engines/akagi-native/` | 审查旧草稿、固定上游与依赖锁；完成外部权重 worker／转换表；草稿不得直接当可发布组件 |
| 新 `agent/akagi-v3-source.json`、`akagi-v3-local.cjs`、`akagi-native-process.cjs`（名称暂定） | 固定来源与兼容矩阵、独立 check／serve、runner 生命周期 |
| `agent/mortal-catalog.json`、`model-installation.cjs`、`model-manager.cjs` | 第四目录项、driver 分流、按需 v3 runtime 与权重安装、单模型切换 |
| 新小型 profile registry、`persistent-engine-process.cjs`（名称暂定） | 固定资产／runner／端口／策略声明；有限进程生命周期复用，现有 v4 全面回归 |
| `extension/model-config-store.js`、`options.*`、`model-analysis-worker.js`、`analysis-panel.js`、身份校验模块 | preset 增量迁移、独立地址／Token、通用显示名与适用范围；复用已取消逐巡确认的手动／自动路径，验证默认关闭、触发边界与 v3 身份检查 |
| `agent/model-manager-ui/*` | 复用简洁模型卡与真实状态，不增加第二个管理页 |
| `scripts/package-public.py`、工具包打包／校验脚本及来源／许可证文档 | 精确扩展公开源码 allowlist；固定可下载 v3 runtime 包、对应源码／完整依赖许可，默认 bootstrap 不强带 v3 资产 |
| 定向测试、真实验证脚本、公开验收记录 | 分开记录工程合同、真实模型、浏览器操作和未测范围 |

公开源码包只对白名单新增经审查的 `engines/akagi-native/` 必要子树；排除 `target/`、`.exe`、`.dll`、模型权重和私有构建产物，不能为省事递归纳入整个草稿目录。固定上游完整源码 archive 自身含权重，不能原样放入“零模型”bootstrap／runtime 工件；应提供不含 weights 的对应推理源码、原始路径／commit／文件 hash 清单、锁、许可与补丁说明，单独按需下载权重。可执行二进制只在专用 runtime 工件分发。

## 4. 分阶段门槛与测试

| 阶段 | 交付 | 必须通过才能进入下一阶段 |
| --- | --- | --- |
| A. 来源与可行性 | 将已核 commit／已有锁／四麻权重 hash 落入机器可读清单，完成第 3.3 节阶段 0 风险核验与适配 | 实际下载并复核；移除默认嵌入；编译完成；外部权重加载；四座位隐藏填充不变性、振听／资格、事件与 guard、规则差异对照通过；未支持规则明确拒绝 |
| B. 独立运行 | Rust worker、Node runner、CLI check／serve | 真正一次加载；严格重放；动作合同；隔离、取消、超时、崩溃、重启预热和进程回收通过 |
| C. 管理与扩展 | 第四项、按需 runtime、preset／Token、手动 gate、解释复用 | 零下载启动；v3 安装不准备 Python／其他模型；四模型保留切换；删除权重留 runtime；配置与身份不串用；现有三模型回归 |
| D. 实验可选发布 | 固定可下载 runtime 工件、来源／许可、限定说明与验收报告 | 下列实验门槛全部通过；未完成真实整场／干净 VM 时明确实验状态，不首推或默认启用 |
| E. 稳定推荐评估 | 真实完整对局、干净 Windows VM、质量与运维证据 | 完整采集／规则／重连覆盖、安装卸载／恢复、可复核同点质量与资源表现满足标准，才讨论是否推荐 |

**实验可选发布门槛**：

- 真实 v3 权重 → Rust → HTTP → EngineAgent → 扩展展示完整链路；四座位、赤五、立直配套弃牌、吃碰杠／补牌、响应跳过及资格受限的和牌覆盖，未支持项按合同拒绝。真实推理与 LLM mock 解释分开报告。
- 与固定未改上游对照模型数值、事件到特征、合法动作与最终动作；不能用“数值接近”替代事件语义一致性。若有雀魂规则补丁，独立记录预期动作差异及资格验收，不把合理规则差异算作模型数值不一致，也不掩盖未知差异。
- 沿 v4 本机验收口径，使用 100 个或更多预先固定的不同人工请求，初步工程目标为热 **HTTP→EngineAgent 端到端 p95≤2 秒**，不是已测承诺或牌力结论。记录硬件、权重／二进制哈希、事件长度、p50／p95、超时、内存与合法交付率；冷资产全校验和模型加载另报，但请求仍须满足现有 20 秒服务／25 秒客户端预算。未达目标时报告瓶颈并解决，或明确缩小／调整设计再接受；不得事后改样本或排除重放耗时宣称通过，也不能以“只支持手动”为由免除延迟门槛。
- A→B→A、换座位／局面／游标、取消后新请求、崩溃重启均不串局；worker ready 前不接请求，端口占用不留孤儿进程，管理器关闭回收子树。
- 真实浏览器完成零模型、安装、失败、启动、v3↔其余模型切换、停止、删除和 runtime 保留；管理／分析 Token 隔离，默认无原生自启。安装取消／哈希失败不覆盖可用资产。
- 在现有验证主机的全新管理目录完成从正式 bootstrap 及固定 v3 工件的安装、校验、推理；核对干净提交构建、下载后 hash、依赖／许可／清单及扩展资源闭包。若在线下载未通，不能把离线复制当在线已通过；只能说明实际提供并验收过的离线工件入口，不编造 UI 导入或离线安装能力。
- 执行 v3 Rust 定向测试、相关 Node 测试／真实验证脚本，以及 `npm run check`、`npm test`、`npm run build`；v2、VoidShine、Yuchen 和独立 Collector 回归通过。

**稳定推荐额外门槛**：在干净 Windows x64 VM 中无需预装 Python／Rust，按用户路径安装、运行、切换和删除；完成支持规则下从开局到整场结束的真实雀魂采集与关键动作、断线／缺口恢复验证，并以多个授权牌谱的同点评价检查解释与建议质量。未完成可继续作为明确受限的实验选项，不能写为稳定首选或实战认证。

## 5. 边界与待验证项

本轮只修订文档；不新增可用 profile、不构建／下载／发布 v3，不修改现有三模型行为。实施需要下一阶段按本方案逐门槛推进，不以“草稿目录存在”认定进度。

首期范围固定为 Windows x64 CPU、四人半庄，提前声明适用范围，不要求逐巡确认；手动及用户主动开启的既有自动分析路径须通过验收，自动默认关闭。这是本项目的实验支持范围，不据此推断上游训练范围或宣称它不支持东风。东风、三麻、GPU、策略候选、AutoPlay、Tauri 集成、CDP／MITM、远程推理、多模型并行和 v2 常驻化均不包含，其他模式须有独立证据再扩展。模型性能或参考首选一致率不等于牌力、胜率、正确率；不因版本号更新就认为优于 Mortal／v2，也不宣称官网同款。

权重 hash 与固定 raw URL 已核；尚未完成的是该 URL 的实际下载安装验收、runtime 工件 URL／二进制 hash、最低构建工具链与平台依赖、规则适配和真实推理。它们继续标“未测／未就绪”。来源核查可以证明代码和元数据，不能代替构建、模型加载或运行验收。现有 v4 的人工 100 点／关键动作及历史 LLM 45 点评测不转作 v3 证据。

参阅：[当前模型管理](MODEL_MANAGER.md)、[v0.14.0 v4 已验范围](MORTAL_V4_VALIDATION.md)、[mjai 与解释合同](MJAI.md)、[第三方参考索引](REFERENCES.md)。
