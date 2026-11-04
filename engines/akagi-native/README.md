# Akagi native 推理源码

此目录是固定 Akagi `1fb16453ae0b7b0a820510ea1d3dbd01b6939082` 的必要推理子树及本项目私有 JSONL wrapper。仅 Windows x64 CPU、四人半庄实验接入。普通用户不编译；模型、推理和自动分析默认关闭，权重与专用 runtime 分开按需准备。

隐藏填充测试按实际普通/赤五物理拷贝预留已知牌，再构造两套暗牌。源码不含训练权重；`vendor/native_bot/tests/fixtures/parity_4p.json` 是固定上游数值输入/输出 fixture，不是网络参数。原始训练代码、Tauri、三麻权重与上游完整含权重 archive 均不分发。网络、39×34 特征编码和82动作映射保持上游实现；规则重放与外层动作字段有明确补丁，见 `PATCHES.md`。

维护者构建（脚本要求 PowerShell 7，不是普通用户运行前提）：Rust 1.99.1 `x86_64-pc-windows-gnu`，使用其自带 `rust-lld.exe`；不要求将工具链装入全局 PATH。仓库根运行：

```powershell
./scripts/build-akagi-native.ps1 -RustBin PATH_TO_RUST/bin -Weights PATH_TO_EXTERNAL/akagi4p.safetensors -Test
```

构建与测试输出默认进入 `research/evidence/akagi-v3-implementation/target`，不进入源码 `target`。脚本只在当前进程设置环境，并在 `finally` 回收临时 ASCII `subst` 盘符。通用 x86-64，没有 `target-cpu=native`；`link-self-contained=yes`、`linker-flavor=ld.lld`，路径 remap 固定为 `/workspace`。最终实际程序仍须按来源锁校验 SHA-256，不把可复现指令等同于任意工具链编译都字节相同。

阶段0测试显式读取 `AKAGI_WEIGHTS_PATH`；上游库定向测试同样外载。三麻两个外权重测试及三麻 parity 明确 `ignore`，未作为本项目支持证据。默认 `infer` 不启用 `embedded-weights`，`defaults` 模块不进入编译；`embedded-weights` 仅保留上游接口说明，缺少模型资产时不能启用。

runtime 中 `sources.zip` 提供此源码、锁、上游逐文件SHA、本地补丁与Windows推理依赖的对应源码/许可。三个 Candle PyTorch 数值测试张量 fixture 按清单省略；不影响库构建。依赖来源、版本、原始crate SHA及省略路径列于 `DEPENDENCIES.json`。安装 `.cargo/config.toml` 将 crates.io 定位到随包 vendor，可从源码包根使用 `cargo build --offline --locked --manifest-path engines/akagi-native/Cargo.toml` 复核；工具链本身仍须明确准备。
