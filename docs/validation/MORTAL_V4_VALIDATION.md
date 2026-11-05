# 社区 Mortal v4 实现与真实验收

> **专项验收／含后续补充。** 原始 v0.14.0 结果与后续便携、授权变化分别保留；当前操作见[模型管理](../guides/MODEL_MANAGER.md)和[v4 运行说明](../guides/MORTAL_V4.md)，其他引擎另验。

日期：2026-11-04。范围：v0.14.0发布候选的实验接入验收。真实权重、本地CPU、HTTP→EngineAgent、独立官方动作对照已通过；不证明实战牌力、真实网页整场兼容或付费LLM教学质量。发布状态以对应Release为准。

## 来源与本地哈希

| 组件 | 固定来源与本地复核 |
| --- | --- |
| VoidShine 298k | HF revision `dbbea7e3d34f99ec43fc4834ab7f2aaaed70b6ee`；130774416 字节；SHA256 `bfb3a6c072aa0bfd4171a9cdc77cb6c02ae42cde920843f9e5784394f23447d8` |
| Yuchen1457 582500 | HF revision `7386c9f5c751a3ea75efea99737cef5a5ef950f1`；130786031 字节；SHA256 `738e0d6e3c0ce9671629554ad39abd147d2ffbac676e80b194c83f2acc0fea20` |
| Mortal source | commit `0cff2b52982be5b1163aa9a62fb01f03ce91e0d2`；archive SHA256 `225cfdcec1c041d2a31fa619c7f36e1f1ff691f4c87783761724013082dbb070` |
| `model.py`／`engine.py` | 未修改；SHA256 `217e2d3dc20631c769a57ea3f09ca4fac232430fc28f76b21d5f37cec7bf84f2`／`5a7444b3f6f232ee168c9e8c17bafde1e6bc36d2620eaf726d14eeaaebd071b6` |
| libriichi native | 本地从上述源码构建，Rust1.99.1 GNU／cp311；features仅pymod；SHA256 `2ccbbc8db60f1df95f840f42735f83e75519290e435c83fbc2634cbbb9f3502c` |
| Python | 3.11.9 embed amd64；archive SHA256 `009d6bf7e3b2ddca3d784fa09f90fe54336d5b60f0e0f305c37f400bf83cfd3b` |
| CPU wheels | torch2.7.0+cpu、numpy1.26.2及8个依赖；全部固定URL/SHA见 `agent/mortal-runtime-lock.json` |

HF 直连在后续请求中超时，model card／license及Yuchen文件通过 `hf-mirror.com` 的同一固定 revision 取得，权重本地哈希与上游 LFS／manifest一致；没有浮动 latest 或无哈希替代。Yuchen README 声称发布者已获权重再分发许可，这属于发布者声明，不是本项目独立法律认证。

两 checkpoint 均在 `weights_only=True` 下读取，真实 config v4／192／40，严格 state dict 加载通过；Yuchen真实steps=582500。两者使用同一固定便携runtime和native，独立模型dir、每请求新engine/Bot、单网络权重常驻；v2目录及资产不变。

## 真实推理和性能

硬件：Windows x64，Intel i7-13700H（14核20逻辑处理器），系统内存约16.9GB。CPU推理单线程，eval/non-oracle、官方quick-eval与和牌保护开启。每模型100个预先固定且不同的人工请求：同一基本手牌，四座位，3–35个事件，点数／本场／事件前缀变化；不是100份真实牌谱，也不覆盖100种独立战略局面。

| 模型 | 冷载及ready | 热HTTP→Agent p50／p95 | 超时／交付 | 热态worker WorkingSet |
| --- | --- | --- | --- | --- |
| VoidShine 298k | 首轮3.212s；最终3.989s | 最终70.9／114.0ms | 0／100/100 | 275,513,344 字节 |
| Yuchen582500 | 首轮3.374s；最终3.703s | 最终73.9／121.9ms | 0／100/100 | 276,258,816 字节 |
| 旧v2同输入基线 | 每请求重新冷载，不与常驻cold混为一项 | 5834／6566ms | 0／100/100 | 未采集 |

冷载不计入热请求预算；单次WorkingSet是Windows热态工作集采样，不是峰值或GPU显存。`memoryBytes` 字段是系统总内存，不能当作worker占用。首轮v4性能采样无并行v2负载；主代理独立复跑298k获得cold3.133s、p50 69.8／p95 112.8ms。达到本机人工请求p95≤2秒的初步目标，不是实际游戏延迟承诺。

真实路径：State→Snapshot→Mjai完整授权事件→鉴权loopback HTTP→常驻Python网络→EngineAgent合法动作／身份校验。固定官方 `model.py`／`engine.py`／Bot 的独立参考脚本不导入产品wrapper；19组逐条对照动作及立直followUp一致，并保存mask、合法Q和数值快照哈希。此一致性只证明固定推理开关与样例，不是独立规则证明或模型正确率。

19组包括无可响应skip、可吃／碰／大明杠选择时的模型skip、吃碰后的弃牌、赤五构成、真实暗杠／加杠及补牌、真实立直与配套弃牌、自家reach已宣告待弃牌、立直成立后摸切／荣和、具备同一步资格的荣和和自摸；缺资格的两组明确拒绝。模型没有实际选择chi/pon/daiminkan的样例只验证这些合法机会和后续事件，不宣称模型已选择该动作；既有动作合同另有mock合法性测试。

额外边界：事件末尾是 `reach_accepted`／`dora` 时明确拒绝，保留worker，后续新请求成功。不能回用前一个建议掩盖原生Bot公告时清除可动作状态的限制。抢杠、自家立直后杠和九种九牌保持不支持。

## 隔离、生命周期、配置

A→B→A、四座位、不同游标前缀保持同一PID且A结果相同。主代理独立检查立即Abort旧PID退出，重启后真实HTTP→Agent成功，close后旧／新PID均不存在。mock故障测试覆盖超时、取消、崩溃、错误ID、损坏／超限输出、并发拒绝、pre-ready拒绝、连续启动失败预算和成功后重置故障预算；mock不等于真实模型牌力测试。

显式 `scripts/validate-mortal-lifecycle.cjs` 另用真实模型1ms请求预算触发超时、重启后立即取消、再次重启并close；逐个检查旧PID不存在。CLI带换行Token及端口已占用的两种启动失败均自行退出且无worker遗留，结果保存在 `lifecycle-validation.json`。

v2主代理独立 `engine:akagi check` 通过，torch2.7.0+cpu／numpy1.26.2，耗时6266ms，弃C；旧命令、文件、配置和历史保留。v0.14.0发布时半庄声明在UI与后台均有检查，两个v4仅逐次手动，刷新不恢复声明。当前源码已按用户要求移除此交互，改为提前说明四人半庄范围；新行为验收见 [v0.15.0 记录](../../VALIDATION.md#0150-社区-v4-取消逐次确认)。known profile的model／checkpoint／revision／sourceCommit核对发生于保存动作和解释之前，runtime/native由ready固定校验。原未知本地服务迁移为legacy，不按端口猜v2；模型切换关闭、Token独立、disable/clear覆盖全部profile。

管理器真实离线298k安装→启动HTTP→停止→再启动→删除通过，初始零下载／零推理，两个PID退出，模型删除而runtime保留。安装并不启动；模型目录与安装状态独立。管理页token只在内存，分析token独立；无Native Messaging／自启。后续管理器共享与Yuchen验收以管理测试记录为准。

后端另完成三模型真实离线安装／切换：Yuchen→298k→v2→298k，经真实HTTP核对身份，v4共享环境、v2独立family，切换保留其他权重、删除保留runtime；记录 `model-manager-switch-validation.json`。主代理独立从空目录安装298k后start→真实HTTP→stop→start→remove通过，管理／分析Token独立，runtime保留；优化后首次start35.798s、再次6.424s（包含全runtime文件校验，非单纯网络冷载），见 `parent-model-manager-validation.json`。这些本机管理流程不替代干净VM或真实游戏验收。

## 可复跑命令与证据

```powershell
node agent/mortal-local.cjs check --dir MODEL_DIR --python RUNTIME_DIR/python/python.exe
node agent/mortal-local.cjs check --profile yuchen-582500 --dir YUCHEN_MODEL_DIR --python RUNTIME_DIR/python/python.exe
# 以下验证脚本从项目源码目录运行，需先准备对应固定模型与运行环境
node scripts/validate-mortal-v4.cjs MODEL_DIR --python RUNTIME_DIR/python/python.exe
node scripts/validate-mortal-v4.cjs YUCHEN_MODEL_DIR --profile yuchen-582500 --python RUNTIME_DIR/python/python.exe
node scripts/benchmark-akagi-v2.cjs V2_MODEL_DIR V2_PYTHON_EXE
npm run check
npm test
npm run build
```

命令中的目录和可执行文件占位符须替换为实际路径。普通用户无需运行验证脚本。实机权重验收均显式执行，不在普通test/build下载或调用。原始 `real-validation.json`、旧v2基线、管理器验证JSON和浏览器QA为本机证据，未随发布包分发；本文记录验证结论及限制。公开测试与分发验收的最终通过数在任务交付记录给出。

最终工程检查：`npm run check`、`npm test`（638/638）、`npm run build`通过；根代理独立同样通过。定向生命周期／配置／管理测试按最后代码增量复验。默认bootstrap在新路径显式启动获得全模型未安装、全部runtime未安装、bridge stopped；没有推理或下载。另显式298k离线导出在新路径用其自带Python真实检查四座位通过，不依赖全局Python/Rust；不是默认产品包，也未做干净VM。

新增默认bootstrap、空安装目录、真实管理器API在线安装实测：约189秒完成python.org及全部10个固定wheel官方源下载、便携运行环境原子安装，事后全runtime文件哈希通过；约213秒在HF固定VoidShine checkpoint阶段返回 `SUBPROCESS_FAILED`。单独以同一固定URL、60秒预算诊断，21.135秒后为 `System.Net.Http.HttpRequestException`，`huggingface.co:443` 连接无响应、HTTP状态为空，确认本机连通失败，未取得HTTP错误响应。失败后模型暂存目录清理、已验runtime保留、无所属进程遗留。

因此官方Python／wheel在线下载安装已验证，完整在线模型安装尚未通过；完整模型安装与推理实测使用离线工件。开发期间另经镜像取得固定权重并核对SHA，不作为默认管理器在线安装通过证据。下载依赖本机网络环境；网络失败会报告错误，不回退其他模型或LLM。

尚未验证：真实网页整场／断线恢复、干净Windows VM安装、多个授权半庄牌谱与专家评测、对局牌力／胜率／段位、真实付费LLM教学质量、GPU／三麻／东风。本轮没有登录游戏、真实对局或调用付费LLM；保留实验标签。
