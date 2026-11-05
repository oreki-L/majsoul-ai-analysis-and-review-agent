# Akagi v3 Native 验收记录

> **专项验收／v0.16.0 原生引擎。** 本文限定固定资产、平台及人工样本；当前安装与连接见[模型管理](../guides/MODEL_MANAGER.md)，实施前设计见[v3 方案](../research/AKAGI_V3_MODEL_IMPLEMENTATION_PLAN.md)。

日期：2026-11-04。实施基线为已发布 **v0.15.0**；这是新增第四个可选引擎的实验验收，不扩大 v2、VoidShine 298k、Yuchen 582500 的既有范围。四项继续保留，模型/推理/自动分析默认关闭、按需准备、管理器一次只运行一个。首期范围提前声明为 **Windows x64 CPU、四人半庄**，不逐巡确认；本记录不证明真实整场兼容或牌力。

## 固定资产与工件

| 项目 | 锁定值 |
| --- | --- |
| 上游源码 | `shinkuan/Akagi` commit `1fb16453ae0b7b0a820510ea1d3dbd01b6939082` |
| 权重 | `akagi4p.safetensors`，2,641,816 字节，SHA-256 `33c20aaba3f349ef689df73b726224804dc4aaff99922093d8f30cc38d709a1d` |
| 原生程序 | 9,845,760 字节，SHA-256 `b91639e5b6154ce9186c14ac259f7db03e4e66c58db97cd94c71e2e27a3397f5` |
| 运行身份 | `akagi-native-win64-cpu-jsonl-v1-p1-b91639e5b6154ce9` |
| 安装 family | `akagi-v3-win64-cpu-jsonl-v1-p1-b91639e5b6154ce9`，包含不可变 build，升级不覆盖旧 family |
| 专用 runtime ZIP | `akagi-v3-win64-cpu-jsonl-v1-p1-b91639e5b6154ce9.zip`，15,871,839 字节，SHA-256 `bb4d3b0ba13ee4f9dc7289d7e60926940e268339d1ae329ee301a43e336cad12` |
| 内含对应源码 ZIP | `sources.zip`，12,600,119 字节，SHA-256 `6aeda37de153e8f196449a4f71bfd3fd4084424009a210698ebecb989ff80efb` |

机器锁以 [akagi-native-source.json](../../agent/akagi-native-source.json) 为准，二进制和权重分别校验；worker 启动自行计算当前exe SHA形成身份，Node核对固定身份，扩展已知profile再核对精确buildID。源码包不把浮动release/显示名当身份。正式 runtime 已发布于 [固定独立 release](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent/releases/tag/native-akagi-v3-p1-b91639e5b6154ce9)，asset ID `709800604`；来源锁使用官方 asset API 及 `application/octet-stream`，canonical download URL 一并保留。匿名下载与本地最终 ZIP 字节一致。

本轮固定本地权重实核匹配并真实外载；本机直接访问 `raw.githubusercontent.com` 的新下载在Node/Python/PowerShell均遇连接重置，保留失败事实。官方固定commit contents API可用，模型来源锁已改为该API及明确 `application/vnd.github.raw+json`，原raw保留 `upstreamUrl`；后续主代理已从该官方 API 完成真实在线安装，详见下节；没有用本地权重复制充当在线结果。

## 构建、许可与零权重闭包

维护者使用已有本机 **Rust 1.99.1 x86_64-pc-windows-gnu**，原版固定依赖锁，`candle-core/candle-nn 0.9.2`、`riichienv-core 0.4.8`。不修改系统全局PATH，不要求普通用户安装Rust/Python。构建脚本使用PowerShell 7、Rust自带rust-lld、`link-self-contained=yes`、稳定 `ld.lld` flavor与固定路径remap；没有 `target-cpu=native`。GNU外部ld在中文路径/UCRT-mSVCRT组合下失败的中间尝试不作为成功证据；最终有效命令见 [源码说明](../../engines/akagi-native/README.md) 与 [build-akagi-native.ps1](../../scripts/build-akagi-native.ps1)。临时ASCII subst盘符在finally回收，产物留在 `research/evidence/akagi-v3-implementation/`。

PE导入为Windows系统的 `api-ms-win-core-synch-l1-2-0.dll`、`KERNEL32.dll`、`msvcrt.dll`、`ntdll.dll`、`USERENV.dll`、`WS2_32.dll`、`bcryptprimitives.dll`，没有需随包另发的第三方DLL。运行包附Rust版权/完整许可、Apache/GCC runtime exception等文本；不把Rust工具链全部版权声明误称为本项目统一许可。

专用runtime包含25个固定条目及逐项hash/size。对应源码包括123个锁定解析依赖的源代码/许可、原crate SHA、上游原始文件SHA/本地SHA清单和 `LOCAL.patch`。最初仅取Windows platform-filter图会漏Cargo离线解析所需portable-atomic，已改完整解析闭包，未使用失败候选。Candle的三个非推理PyTorch张量测试fixture按路径明示剔除；源码ZIP扫描无 `.pt/.pth/.safetensors/.onnx/.exe/.dll/.crate`。`r-efi 5.3.0/6.0.0` 上游无LICENSE文件，其完整许可与作者声明在随包 `AUTHORS`，README亦明确指向该文件；最终 `licenseFiles` 索引也显式识别 `AUTHORS`，许可正文完整保留。

`defaults`的两个 `include_bytes!` 受未启用的 `embedded-weights` feature隔离；生产只编译 `infer` 并外载模型，源码/专用runtime都没有Akagi三麻或四麻权重。打包同时查验exe不含任一固定完整权重payload。`tests/fixtures/parity_4p.json` 只含固定模型输入/输出数值，不是网络权重。未原样分发含权重的上游完整archive。

从runtime的source ZIP解出源码，用**全新CARGO_HOME和target**，完成 `cargo test --release --offline --locked` 的wrapper和native_bot测试，再完成生产 `cargo build --release --offline --locked`。wrapper **11通过**；本地补丁后的上游库 **43单元+2事件重放+1四麻parity通过**；3个依赖三麻外权重的用例明确ignore。没有隐式下载模型/工具链。普通公开源码白名单的独立导出闭包由发布验收另核。

## 阶段0：真实数值、状态与规则

真实权重外载成功，启动ready前执行实际forward；每请求保留网络、reset完整牌局、独立set_seat、严格重放授权前缀，只在最终决策点输出。数字start_game.id显式转字符串；未知事件、未知字段、对手暗牌/摸牌泄露、格式错误均拒绝。

- 四座位A→B→A逐值复核：observation、legal mask、logits、action一致，不跨座位/局面污染。
- 四座位隐藏填充不变性：同一自家与公开前缀，将 `?` 对照两套按赤/普通五实体区别、由残余物理牌构造的合成合法暗牌，覆盖未知对手摸牌→公开弃牌、吃/碰/大明杠、暗杠、dora、补牌再弃牌/自摸；observation/mask/logits/action逐值相同。没有传真实对手暗牌给生产worker。
- 固定官方PyTorch parity四麻最大logit绝对误差 **0.000091552734**，argmax一致。
- 错过荣和：同巡再遇拒绝；自摸后临时振听解除，立直后永久振听保留；无役和型被跳过后按固定core规则维护同巡振听。测试同时防止旧Ron claims残留导致错误重新振听。
- 显式雀魂GameRule；暗杠国士抢杠窗口在雀魂规则下开放、Tenhou规则不开放；临时/立直振听阻止抢杠。公开杠→补牌补足嶺上役，鸣牌取消首巡/一发，受理开启一发；保持固定core live弃牌清嶺上下文行为，没有依据不另改河底。
- 尾随reach_accepted、杠后待补牌/非决策点拒绝，不复用旧建议。None必须同时证明当前legal mask全零且为他家公开响应点，才可映射none；自家无动作失败，显式Pass仍须为响应阶段。
- 赤五实体、立直配套弃牌、鸣牌目标/consumed沿现有EngineAgent校验。kakan consumed规范成已重放旧碰的实体顺序，与上游三张multiset相同；不换候选。九种九牌、拔北等不支持动作明确失败。

这些修复是**本地规则重放差异**，不是未改上游原行为，详见 [PATCHES.md](../../engines/akagi-native/PATCHES.md)。模型/编码/decoder保持固定上游；保留其按action ID去重、普通五优先、reach配套失败时移除reach的内部策略。本项目桥接不重排替补动作。

## 未改上游对照与HTTP→EngineAgent

固定未改上游native_bot（原提交源码、原锁、外部相同模型）建立独立reference程序；只在独立研究程序内记录GameState特征和输出，不把本地patched tests称作官方对照。使用**预先固定100个不同人工请求**加19个关键局面，共119组：observation和logits逐值一致，legal mask全部一致；118组原始动作/配套字段完全一致，1组kakan仅consumed数组顺序不同，实体multiset/动作一致。临时振听、国士暗杠、嶺上等本地修复的特意差分用例分开按上述规则验收，不要求与旧上游错误mask相同。

真实最终二进制→HTTP→EngineAgent（精确known-profile身份）100/100请求合法交付，同worker PID，四座位及A→B→A通过。Intel Core i7-13700H，冷加载+ready约 **47.34ms**；热端到端 **p50 3.00ms、p95 4.74ms、最大62.61ms**，0超时。该耗时包括完整事件重放、HTTP与EngineAgent，不是纯forward数字；样本事件3–35条，不代表整场/极长事件历史、其他硬件或牌力。

19关键局面中17合法交付，2个缺少同一步雀魂和牌资格的和牌结果被EngineAgent明确拒绝。包含赤五碰后弃牌、吃后弃牌、大明杠/暗杠/加杠补牌、真实加杠输出、真实reach及配套弃牌、reach后单独弃牌、已受理立直、自摸/荣和资格和响应跳过。v3在命名为reach-candidate的原v4样本中选择普通弃牌，这是其实际输出；真实reach输出另由ankan-candidate/replacement样本覆盖，不强行替换候选。模型logit不是胜率/放铳率。

独立最终worker连续100次外载请求后工作集 **17,944,576字节**，峰值 **18,751,488字节**（额外内存测量，不混入前述100点延迟样本）。

## 生命周期与管理回归

10项Node测试覆盖单worker、错身份、崩溃、超时、错误requestId、损坏/超限输出、并发拒绝、取消后先清理再reject、新请求、guard后恢复；独立CLI的start/infer/预热动作失败在keep=true时也始终close。非hang故障用例改5秒预算，hang仍100ms；现有Mortal同类测试非hang改5秒、hang保持80ms，避免满负载时将崩溃误判timeout。

最终真实worker另完成：取消回收旧PID→重新启动/真实预热→新请求；空闲崩溃→有界自动重启/真实预热→新请求；尾随公告拒绝但不返回旧动作；close无孤儿。共4项通过，未重试同次失败请求。复用既有 `killTree` 实现，不维护第二份进程树逻辑。

工程证据位于 `research/evidence/akagi-v3-implementation/`：`final-build-and-tests.log`、工件目录的 `clean-source-{test,build}.log`/`clean-upstream-test.log`、`real-validation.json`、`lifecycle-validation.json`、`memory-validation.json`、`process-tests.log`、`runtime-lock.json`、`source-archive.json`。复现实测入口为 [validate-akagi-native.cjs](../../scripts/validate-akagi-native.cjs)、[生命周期验证](../../scripts/validate-akagi-native-lifecycle.cjs)、[打包脚本](../../scripts/package-akagi-native.py)。源码包内打包脚本/来源快照对应构建时状态，后续来源URL的contents/asset API accept元数据不改变Rust二进制或依赖源码。

最终二进制配首轮ad699对应源码工件，另完成7次v3↔v2/VoidShine/Yuchen真实管理HTTP/身份切换、旧PID回收、删除v3留runtime/其他模型不变；最终源码fixture仅改赤/普通五预留后重包，二进制不变。公开源码精确白名单独立干净导出，新target离线wrapper/native_bot/replay/parity测试通过（同上述通过/ignore数）。证据另见 `research/evidence/akagi-v3-legacy-regression-7be4042f731d4b35b79c4a1c8a80ea47/four-model-final.json` 与 `research/evidence/akagi-v3-public-source-closure-6da77b921aa049169bfadbd18ad97ddf/`。

## 正式下载与浏览器联调

- 正式工件在线验收：全新受管理目录，`toolkit:null`、无 source override；只为安装测试在进程内临时开放当时尚 pending 的 catalog，下载来源保持正式锁。实际下载最终 `bb4d…` runtime 和官方固定权重，安装约 12,718ms、启动约 1,261ms，HTTP200 返回合法弃 C 与精确身份；停删后保留 runtime 并回收所有进程。随后目录正式开放为 `verified-experimental`。证据：`online-install-result.json`。
- Edge 真实扩展与管理页：零模型启动→只安装 v3→启动真实 worker→批准扩展来源配对→保存仍关闭→人工开启。其余三个模型未安装；管理切换另由前节四模型真实 HTTP 回归覆盖。
- 实际游戏域名下通过 route 提供人工 HTML、以正式采集消息合同注入人工事件；真实后台／EngineAgent／HTTP／native 推理得到弃 C。LLM 由本机模拟响应，核对动作先显示、解释随后保存且不改变动作。主动开启自动后，两次自家出牌决策分别新增记录（总数2→3→4），随后关闭自动。
- 停止并删除 v3 后，权重移除、runtime 保留，其他模型安装数仍为0。测试浏览器和本轮管理／模拟教学进程均已关闭。
- 原版扩展在无界面 Edge 中正确等待 optional-host 授权；原生权限弹窗未完成。后续联调用仅预授本机 host 权限的测试副本，其余代码与生产相同，生产 manifest 没有扩大权限。人工局面与模拟 LLM 不代表真实牌局或教学质量。

截图与脱敏回执保存在本机 `research/evidence/akagi-v3-implementation/`，包括 `options-v3-default-off.png`、`manager-v3-running.png`、`game-real-native-action.png`、`game-real-native-mock-explanation.png`、`game-real-native-automatic.png`、`manager-v3-removed-runtime-retained.png`、`browser-validation.json`。

真实整场雀魂、断线重连、干净Windows VM、建议质量/牌力、真实LLM解释尚未验证，不称稳定推荐或实战认证。
