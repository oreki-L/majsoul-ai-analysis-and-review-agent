# 可选社区 Mortal v4：安装与运行

两个社区模型已在 Windows x64 CPU 完成固定权重严格加载和人工局面真实推理。它们是默认关闭的实验接入；不用本地引擎时可以零模型、零 Python。模型目录与已安装资产、运行中进程分别管理，一次只运行一个模型。

| 配置 | 权重 | 固定 revision | 本期范围 |
| --- | --- | --- | --- |
| `voidshine-298k` | `VoidShine/mortal-298k`，130,774,416 字节 | `dbbea7e3d34f99ec43fc4834ab7f2aaaed70b6ee` | 四人半庄，逐次手动声明；作者不推荐排位 |
| `yuchen-582500` | `Yuchen1457/mortal-582500`，130,786,031 字节 | `7386c9f5c751a3ea75efea99737cef5a5ef950f1` | 保守限制四人半庄，逐次手动声明；本地未评测牌力 |

模型的 v4 是特征／架构版本，不等于官网 Mortal 4.1。作者自报相似度、MAKA 或历史对局比较均不作为本项目牌力结论。真实网页整场、干净 VM 和真实 LLM 教学质量仍未测，详见[验收记录](MORTAL_V4_VALIDATION.md)。

## 普通用户入口

先安装 Node.js 22.19 或更高版本，完整解压独立工具包 `majsoul-model-manager-windows-x64-0.14.0.zip` 到可写目录，显式运行 `start.cmd`，再打开终端中的管理地址并输入管理 Token。默认包只含管理脚本、固定 native 库、源码和许可，不含权重、完整 Python 环境或 Akagi 资产。管理页先选一个模型并点击安装，才下载该模型和必要的固定 CPU 环境；安装不会启动推理，启动还需单独点击。详见[模型管理](MODEL_MANAGER.md)。官方 Python／全部10个固定 wheel 已实际下载安装并校验；本机 HF 权重源连接失败，完整在线模型安装尚未通过，完整模型离线安装已验证。下载受网络环境影响；失败会报错，不回退其他模型。

扩展安装、升级、刷新、普通 Chat、`npm ci`、`check`、`test`、`build` 都不下载模型或启动 native 进程。没有自启、系统服务、计划任务或 Native Messaging。扩展设置只打开管理网页，不能自行启动本机管理程序。

VoidShine 与 Yuchen 经真实验证使用同一固定 Python／PyTorch／libriichi，可共享 `runtimes/mortal-v4-win64-py3119-torch270cpu`。权重各自保存于 `models/{profile}`，切换保留已下载资产。v2 仍使用独立 runtime family，原有外部目录及 `engine:akagi` 命令不迁移、不覆盖。

管理 Token 和分析 Token 独立。将运行服务显示的 `/analyze` 地址和分析 Token 保存到扩展对应模型配置，明确开启分析并保存；模型配置切换会关闭分析。扩展每次手动分析前须勾选四人半庄声明，声明绑定当前快照与事件且仅一次有效；自动分析暂不支持这两个 v4 profile。此声明不是自动识别整场模式，不根据东一或南场推断。

## 开发者显式 CLI

只下载所选权重和固定源文件，不安装环境、不启动服务：

```powershell
node agent/mortal-local.cjs setup --profile voidshine-298k --dir MODEL_DIR
node agent/mortal-local.cjs setup --profile yuchen-582500 --dir OTHER_MODEL_DIR
```

准备好的模型目录还需固定 `libriichi.pyd` 与 `libriichi-build.json`；来源和 ABI 的校验值见 `agent/mortal-source.json`。不可直接复用 v2 DLL。显式离线准备便携 Python（归档与 wheels 须符合 `agent/mortal-runtime-lock.json`，不存在运行时才允许安装）：

```powershell
node scripts/prepare-mortal-runtime.cjs --dir RUNTIME_DIR --archive PATH/python-3.11.9-embed-amd64.zip --wheels PATH/wheels
node agent/mortal-local.cjs check --profile voidshine-298k --dir MODEL_DIR --python RUNTIME_DIR/python/python.exe
node agent/mortal-local.cjs serve --profile voidshine-298k --dir MODEL_DIR --python RUNTIME_DIR/python/python.exe --port 17342
```

检查会真实加载并推理四座位；每个 worker 进程（包括超时／取消／崩溃后的内部恢复）都先以固定人工局面真实预热并校验合法弃牌，再报告 ready；启动先检查再监听。关闭桥接终端回收 worker。关闭扩展分析只停止请求，不释放已手动启动的模型进程。HTTP 仅监听 loopback `/analyze`，保持 Bearer 与来源校验。

## 固定运行与动作边界

Python 3.11.9、PyTorch 2.7.0+cpu、NumPy 1.26.2；CPU 单线程、eval、non-oracle、deterministic algorithms、AMP 关闭。采用固定官方 Mortal commit `0cff2b52982be5b1163aa9a62fb01f03ce91e0d2` 的未修改 `model.py`／`engine.py` 与其本地编译 native。strict state dict、`weights_only=True`，架构必须为 v4／192 channels／40 blocks；失败不回退任意 pickle、旧弱模型或 LLM 决策。

一次加载网络，每请求新建轻量 `MortalEngine` 与 `Bot`，逐事件重放完整授权当前小局前缀。中间动作只消化，最终动作经 EngineAgent 校验；立直在同一 Bot 追加实际 reach 取得弃牌。未知摸牌、赤五、副露、补牌和当前同一步资格保持已有合同，不发送对手暗牌或未来。

官方 quick-eval 在对手弃牌／杠且无可响应动作时返回空，此时仅映射显式 `none`。若事件尾随 `reach_accepted` 或 `dora` 公告，本期明确返回 `422 UNSUPPORTED_TRAILING_ANNOUNCEMENT`，不复用过去建议；等待下一可验证动作后重新声明并分析。抢杠、自家立直后杠、九种九牌等当前合同不支持的动作继续拒绝，不选第二名替代。

超时、取消、协议错位、超限、崩溃先清理进程树再释放请求槽位。清理预算最多 5 秒；清理失败关闭该 runner，避免继续重启。最多 3 次连续恢复尝试，成功推理重置故障计数，正常取消不累积耗尽预算。同一失败请求不重试、不换模型。原生／上游输出丢弃，仅输出脱敏阶段错误码，JSONL 不承载手牌日志。

## 维护者构建与工具包

以下命令中的 `MODEL_DIR`、`RUNTIME_DIR`、`NATIVE_SOURCE_DIR`、`OUTPUT_DIR` 和 `PATH` 均须替换为实际目录。普通用户使用管理页即可。

固定源码 archive SHA、Cargo.lock SHA、native SHA 与10个 wheel SHA/URL 均在清单中。构建使用 Windows GNU Rust 1.99.1、`--release --locked --no-default-features --features pymod`，关闭默认 mimalloc；`scripts/build-mortal-native.ps1` 提供显式环境参数。GNU linker 对中文路径不可靠，使用 ASCII target 目录及 `subst` 映射工具路径。重新构建输出哈希不预设逐位可复现，新的二进制必须重新审查并更新固定清单。

`sources/Mortal` 从经SHA校验的固定归档提取完整源码及Cargo.lock，`sources/vendor` 逐文件核对Cargo checksum并保留对应crate源码及各许可。`sources/.cargo/config.toml` 提供离线vendor配置，`sources/BUILDING.md` 记录构建输入与复现步骤；`native/libriichi-build.json` 记录ABI、Rust版本、features、flags与实际native SHA。Rust标准库／GCC运行库公告位于 `sources/toolchain-licenses/`。AGPL源码与构建材料随native工具包提供，不以进程分离宣称义务消失。Python、PyTorch、NumPy及其依赖各自许可保留于archive／wheel／安装目录。模型库许可、model card和来源声明随安装保存，不下载训练牌谱。

```powershell
# 默认零权重／零完整环境 bootstrap；不联网打包
node scripts/package-mortal-toolkit.cjs --dir NATIVE_SOURCE_DIR --out OUTPUT_DIR/majsoul-model-manager-windows-x64-0.14.0
# 额外含固定Python归档和wheels的离线bootstrap，仍无模型
node scripts/package-mortal-toolkit.cjs --dir NATIVE_SOURCE_DIR --out OUTPUT_DIR/offline-bootstrap --with-wheels
# 仅维护/离线交付时明确导出一个模型，不是默认下载要求
node scripts/package-mortal-toolkit.cjs --dir NATIVE_SOURCE_DIR --out OUTPUT_DIR/offline-298k --offline-profile voidshine-298k --model-dir MODEL_DIR --runtime RUNTIME_DIR/python
```

`NATIVE_SOURCE_DIR` 需包含固定 `libriichi.pyd`、`libriichi-build.json`、`mortal-source.zip`、对应 `vendor/` 和 `toolchain-licenses/`。默认打包不读模型权重、不联网；输出必须是新目录，最终发布应从确定的发布提交干净导出后构建，随后校验 `TOOLKIT-SHA256.json` 再压缩为上述独立ZIP。不要将使用过的 `installations/`、终端日志或配置放入发布包。`--refresh` 仅供维护验证，拒绝包含安装数据的工具包，不能代替最终干净生成。

工具包作为独立可选资产，不进入扩展ZIP。在新路径执行文件校验和真实模型检查是本机可搬移验收；不等于干净VM验证。历史本机证据未随发布包分发；发布状态以对应Release为准。
