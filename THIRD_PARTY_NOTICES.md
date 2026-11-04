# 参考资料与资源说明

项目源码与当前原创SVG牌面使用 [MIT License](LICENSE)。Agent 扩展捆绑以下第三方运行库；不捆绑第三方字体文件或游戏资源。项目名称中的“雀魂 / Mahjong Soul”用于说明适用游戏，相关商标与游戏资产归各自权利人所有。本项目非官方，与游戏发行方及以下项目无隶属或合作关系。

## 分发的第三方代码

| 包 | 版本与版权 | 许可证与处理方式 |
| --- | --- | --- |
| [@earendil-works/pi-agent-core](https://github.com/earendil-works/pi/tree/v1.4.0/packages/agent) | 1.4.0；Copyright (c) 2025 Mario Zechner | MIT；真实 agent loop 打入 `pi-runtime.js`；完整文本见 [licenses/pi-LICENSE.txt](licenses/pi-LICENSE.txt) |
| [@earendil-works/pi-ai](https://github.com/earendil-works/pi/tree/v1.4.0/packages/ai) | 1.4.0；Copyright (c) 2025 Mario Zechner | MIT；仅打入 transcript、event-stream、identity、validation 等浏览器工具代码，排除 provider 与 Node credential store；许可证同上 |
| [TypeBox](https://github.com/sinclairzx81/typebox) | 1.3.27；Copyright (c) 2017-2026 Haydn Paterson | MIT；打入解释式 schema 校验等功能；完整文本见 [licenses/typebox-LICENSE.txt](licenses/typebox-LICENSE.txt) |

Pi 的 `typebox/compile` 在构建时以同版本 TypeBox `Value.Check` / `Value.Errors` 解释执行适配层替换，以满足 MV3 禁止动态代码的要求。补丁与构建方式见 [docs/pi-runtime.md](docs/pi-runtime.md)，固定来源及许可证校验值见 [licenses/SOURCES.md](licenses/SOURCES.md)。许可证目录随两个扩展包附带；collector 包不含上述运行库代码。

上述列表按 esbuild 最终输出中实际贡献字节的依赖审计。`partial-json` 等安装依赖经 tree shaking 后不进入扩展产物；esbuild 只在构建期间运行，不作为浏览器运行库分发。构建脚本会拒绝未审查的新分发依赖。

## 开发参考

### 可选 Akagi v3 原生引擎

Akagi v3 与旧 Mortal 示例是不同模型。对应推理源码固定为 [shinkuan/Akagi](https://github.com/shinkuan/Akagi/tree/1fb16453ae0b7b0a820510ea1d3dbd01b6939082) 的 `native_bot`，保留 Apache-2.0 LICENSE 与 NOTICE；本项目的 JSONL wrapper 使用 MIT。公开源码包含经标注的本地规则／回放补丁，不移植 Tauri 应用，也不将上游代码改称本项目原创。

四麻 `akagi4p.safetensors` 仅在用户显式安装时单独下载，固定来源和 SHA-256 见 [资产锁](agent/akagi-native-source.json)。权重仓库沿用上游 Apache-2.0 声明，但未提供独立 model card 或训练数据授权证明，不据此宣称训练数据许可已验证。

专用 Windows x64 CPU runtime 与扩展及默认便携引导包分开分发；不嵌入四麻／三麻权重。对应源码、Cargo 锁、依赖源码与许可证、工具链公告和构建说明随专用工件保留。安装 Akagi v3 不需要 Python／PyTorch；原三模型的许可和运行环境保持各自边界。构建、规则差异及实测范围见 [Akagi v3 验收记录](docs/AKAGI_V3_VALIDATION.md)。

### 独立可选本地模型工具（不随扩展ZIP捆绑）

当前源码的便携运行包附带官方 Node.js v22.19.0 Windows x64 的 `node.exe`、完整 `runtime/LICENSE`（含依赖公告）和官方校验表。固定下载来源／SHA 见 [Node 运行时锁](scripts/node-runtime-lock.json)，许可证来源见 [licenses/SOURCES.md](licenses/SOURCES.md)。此运行时仅在用户另行下载的可选包中，不进入 Agent／Collector 扩展 ZIP；便携流程从 v0.15.0 提供。

社区v4工具固定使用 [Equim-chan/Mortal](https://github.com/Equim-chan/Mortal/tree/0cff2b52982be5b1163aa9a62fb01f03ce91e0d2) 的网络／引擎及本地编译libriichi，AGPL-3.0-or-later；工具包保留完整固定源码、Cargo.lock、对应vendored crate源码与构建资料。原生库涉及的Rust标准库MIT／Apache-2.0和GCC运行库例外许可公告保存在工具包 `sources/toolchain-licenses/`。`model.py`／`engine.py`未修改；项目独立wrapper与管理代码不调用训练／上传／GRP。进程分离不豁免适用许可义务。

[VoidShine/mortal-298k](https://huggingface.co/VoidShine/mortal-298k/tree/dbbea7e3d34f99ec43fc4834ab7f2aaaed70b6ee) 声明AGPL-3.0；[Yuchen1457/mortal-582500](https://huggingface.co/Yuchen1457/mortal-582500/tree/7386c9f5c751a3ea75efea99737cef5a5ef950f1) 声明AGPL-3.0／upstream AGPL-3.0-or-later。模型各自许可证、model card和元数据随显式安装保存，不下载训练牌谱；发布者的牌力或授权说明作为来源声明保留，不视为本项目认证。

便携Python3.11.9（PSF）、CPU PyTorch2.7.0、NumPy1.26.2及其固定依赖保留各自许可证／第三方公告。完整运行环境只按需安装或显式离线导出，默认bootstrap零权重、零完整Python。固定URL／SHA与实际验证见 [来源清单](agent/mortal-source.json)、[依赖锁](agent/mortal-runtime-lock.json) 和 [验收记录](docs/MORTAL_V4_VALIDATION.md)。v2原有AGPL加Commons Clause边界不变。

开发时参考了以下公开资料。参考并不表示对方认可本项目，也不代表已验证当前客户端兼容性。

| 项目 | 参考用途 | 处理方式 |
| --- | --- | --- |
| [tzp1021/mj_helper](https://github.com/tzp1021/mj_helper) | CDP、WebSocket、协议解析与状态机分层思路；开源仓库文档组织 | 本项目使用浏览器扩展采集，未捆绑其Python决策代码、训练数据或报告 |
| [Avenshy/mahjong-helper-majsoul-mitmproxy](https://github.com/Avenshy/mahjong-helper-majsoul-mitmproxy) | Liqi消息封装和字段定义的研究参考 | 本项目实现最小wire reader，未捆绑其代码、proto文件或生成代码；其GPL-3.0代码不纳入本项目MIT授权 |
| [Avenshy/MajsoulMax](https://github.com/Avenshy/MajsoulMax) | 网页及桌面采集可行性线索 | 未捆绑其客户端修改逻辑 |
| [matttang27/majsoul-vision](https://github.com/matttang27/majsoul-vision) | 私密早期原型使用过其中的游戏牌面截图 | 授权范围未确认，公开历史的全部提交已移除旧PNG与旧ZIP，替换为本项目原创SVG |

本文件不是第三方素材的再授权。提交外部代码、图形或字体时，请同时提供原始来源、许可证与必要版权声明；无法确认分发权的内容不得加入。
