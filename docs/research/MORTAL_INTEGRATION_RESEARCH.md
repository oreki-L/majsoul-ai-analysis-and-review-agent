# Mortal 可配置实时分析后端调研

> **历史研究／方案（2026-10-30）。** v0.13.0 已提供有限动作／解释串联及旧报告适配，后续新增社区 v4 与 Akagi v3；下文“当前”“尚未实现”和缺口均保留原调研口径。实际操作见[本机模型管理](../guides/MODEL_MANAGER.md)与[mjai 接入](../guides/MJAI.md)，报告适配见[v0.13.0 工作流验收](../validation/MORTAL_WORKFLOW_VALIDATION.md)，后续模型范围见[v4 验收](../validation/MORTAL_V4_VALIDATION.md)和[v3 验收](../validation/AKAGI_V3_VALIDATION.md)。

核查日期：2026-10-30。本轮只研究公开资料和现有实现，未修改运行代码、安装上游环境或执行真实 Mortal 4.1 推理。

## 结论

**技术上可行，项目已有大部分接入基础；能否使用 mjai-reviewer 官网同款 Mortal，取决于是否取得对应权重或明确获准的推理接口。** 当前不能承诺将官网的 Mortal 4.1a / 4.1b / 4.1c 直接作为可用配置交付。

- `mjai-reviewer` 是调用专业引擎的复盘程序，不是 Mortal 权重发行库。其 README 明确要求另备训练好的模型文件。
- Mortal 开源的是框架。其 README 指向的作者说明仍包含“不计划公开模型参数”的结论；这不能证明所有第三方 Mortal 权重均不可取得，但不能据开源仓库推定官网同款权重可下载。
- 本项目已提供 `chat` / `mjai` 二选一配置、本地 HTTP 桥接、mjai 事件转换和动作合法性校验。当前缺的是官方 Mortal profile、清晰的模型配置和加载性能优化，而非从零创建整个后端。
- 最适合的路径是“可选本地 Mortal + 用户自备可信权重”；无需把整个 mjai-reviewer 复盘程序嵌入实时分析链路。

## 三种对象应区分

| 对象 | 本轮确认 | 对本项目的意义 |
| --- | --- | --- |
| mjai-reviewer 仓库 | 读取牌谱，启动外部 Mortal 进程，生成复盘结果；Apache-2.0 | 借鉴交互协议和动作展示，不提供模型权重 |
| Mortal 仓库 | Python / PyTorch 网络、Rust libriichi、mjai Bot；代码 AGPL-3.0-or-later | 有权重后可本地推理，需要运行时和协议适配 |
| mjai.ekyu.moe 官网 | 页面有 4.1a defensive、4.1b balanced、4.1c aggressive；复盘表单 POST `/review`，包含 Turnstile | 页面模型选项不是开放实时 API，也不是权重下载入口 |

本轮查阅的 README、官方构建说明和服务首页未发现面向第三方的实时局面推理 API 文档。这个结论是“未找到公开接入依据”，不是断言不存在任何私有接口。未提交牌谱、未调用复盘任务、未联系作者。

官网页面注明 Mortal 复盘仅支持半庄。自备模型是否适合东风、不同规则或三麻必须单独确认；本项目现有 mjai 适配也仅支持四麻。

## 已有基础与实际缺口

| 层次 | 当前实现 | 接入官方 Mortal 所需工作 |
| --- | --- | --- |
| 模型设置 | `extension/options.html`、`options.js`：OpenAI 兼容 / 本地 mjai，分别保存配置；mjai 的 model 固定为 `mjai` | 增加引擎名称、模型标识和状态展示；路径、设备等本机参数放在本地服务配置中 |
| 扩展请求 | `extension/adapters/engine-endpoint.js`：只接受 localhost / 127.0.0.1 的 HTTP `/analyze` | 本地方案可复用；远程服务需要另行设计认证、权限及协议 |
| 局面输入 | `extension/adapters/mjai.js`：从连续当前局事件生成 mjai 请求，隐藏对手暗牌 | 验证官方 libriichi 对实际生成事件、赤牌、座位、立直和副露的接受情况 |
| 本地桥接 | `agent/engine-server.cjs`：Bearer Token，单并发，不排队 | 可保留 HTTP 合同；常驻模型应实现新的 runner / 服务实现及取消语义 |
| 进程协议 | `agent/mjai-process.cjs`：一行完整事件数组入，一行最终动作出；每请求新进程 | 官方 Mortal 是逐事件输入，需专用适配层，不能直接填 executable 即用 |
| Python 包装 | `agent/mjai-python-wrapper.py`：`Bot()` 或 `Bot(seat)`，一次 `react(events_json)` | 官方 `libriichi.mjai.Bot` 还需要 engine，逐条 `react(event_json)`；需负责初始化、事件回放与最终动作整理 |
| 输出校验 | `extension/contracts/engine-result.js`：动作校验，`candidates` 为空 | 首版可复用动作；若展示 Q 值排名，需要固定版本的 action mask / 索引映射和新增结果合同 |
| 本地示例 | `agent/akagi-local.py`：固定 Akagi v2 弱模型，逐事件回放并取得立直配套弃牌 | 可借鉴流程；其哈希、网络定义和 Windows Python 3.11 原生库固定，不能直接换文件宣称兼容官方任意权重 |

现有接入的详细约束见 [MJAI.md](../guides/MJAI.md)。本轮同时核对了上述实现，未仅依据文档推定能力。

## 官方调用方式与适配重点

`mjai-reviewer/src/review/mortal.rs` 启动外部进程时传入玩家 ID，并设置 `MORTAL_CFG` 和 `MORTAL_REVIEW_MODE=1`。随后逐条写入 mjai event，逐条读取响应。这是复盘进程协议，不等于本项目“一批事件换一个最终动作”的协议。

Mortal 的 `mortal/mortal.py` 展示了可复用的初始化步骤：读取 checkpoint 的网络结构与版本，加载 `state['mortal']` 和 `state['current_dqn']`，构造 `MortalEngine(..., is_oracle=False)`，再构造 `Bot(engine, player_id)`，逐事件调用 `react`。检查到的官方 CLI 固定使用 CPU；GPU 应由自建适配器明确实现和验收，不能只改配置就声称官方 CLI 已支持。

实时局面推理应直接使用上述非 oracle Bot 能力，不机械照搬 review mode：review mode 在 EOF 后还加载 GRP 模型并计算整场排名估计，当前局动作建议不需要这一步，也不应因此要求另一份 GRP 权重或完整终局牌谱。

需要重点处理：

1. **最后一步响应**：重放历史时消化中间建议，仅返回当前游标对应的动作。官方非 review 模式并非每个事件都打印输出，不能假定逐行输入总有逐行响应。
2. **立直配套弃牌**：在同一个 Bot 状态上处理 `reach` 后的 `dahai`，沿用本项目已有 `action + followUp` 合同；不要额外猜测弃牌。
3. **动作覆盖**：上游可选动作包含九种九牌等本项目尚未支持的动作。遇到这类结果应明确报告不支持，不偷偷换成另一动作。抢杠等现有限制也不会因更换模型消失。
4. **信息隔离**：只用截止当前游标的事件和自家可见信息，不开启 oracle，不使用牌谱未来事件。
5. **解释边界**：Mortal 不输出自然语言推理。Q 值不是放铳率或局收支；候选 softmax 也不是动作正确率。展示首选应以最终 Bot 动作为准，不能用 Q 值排序覆盖上游规则修正。

## 建议的配置和运行形态

用户界面可以保留现有 LLM 模式，并把专业引擎入口明确标识为 Mortal / mjai。扩展仅保存本机 endpoint、token 和用于显示的模型标识。本机服务保存 engine profile、checkpoint 路径、匹配的运行时版本、CPU / GPU 设备；不向浏览器暴露本机文件执行配置。

建议执行链路：

```text
雀魂连续事件 → 现有 mjai 转换 / 校验
             → 本地 Mortal 服务 → 官方网络 + libriichi Bot
             → 动作 / 立直配套弃牌 → 现有动作校验 → 页面建议
```

首版可实现专用 profile 和配置诊断，采用现有请求合同验证真实模型兼容。若目标是日常实时体验，建议后续让模型常驻内存，每次请求新建 Bot 并回放当前局事件；相比维护长期对局 Bot，这更容易避免断线、重连、换座位、切历史游标时的状态串扰。模型共享仍需串行推理或明确的并发隔离。

当前每请求重启并加载权重，浏览器总预算 25 秒，通用进程预算默认 15 秒，Akagi profile 为 30 秒。已有文档记录弱版示例全链路约 6.7–10 秒，不能据此预测官方 4.1 延迟，也不能把放大进程 timeout 当作性能优化。常驻服务还需落实超时、取消、繁忙响应、失败后的状态释放及模型切换机制。

用户在本轮进一步明确希望“Mortal 决策 + LLM 自动解释”，并要求对齐现有产品功能。这是本次建议落地方向；当前一次分析只调用一种后端，需要新增串联编排。具体配置、首选先展示、冻结追问、历史、学习和异常行为见 [产品功能适配研究](MORTAL_LLM_PRODUCT_ADAPTATION.md)。解释器需独立配置，解释是基于证据的 LLM 解读，不能当作 Mortal 内部推理记录。

## 落地顺序与验收

1. 先确定可合法使用的具体 checkpoint、来源和对应 Mortal / libriichi 版本；只有代码或官网模型名称不能完成真实推理验收。
2. 增加独立 Mortal profile：路径和版本诊断、真实模型加载、自家四座位人工事件推理、立直后配套弃牌。
3. 使用授权的完整牌谱按游标回放，通过 HTTP → EngineAgent → 页面结果验证；覆盖副露、杠、立直、和牌资格和不支持动作，不使用游标后的信息。
4. 在目标设备测量冷启动、常驻推理和超时 / 取消行为，再决定上线形态。实际整场兼容性、建议质量和牌力是不同验收项。
5. 需要候选排名或自动 LLM 解释时再扩展结果合同与界面。

如果拿不到官方权重或正式授权接口，可以交付“自备 Mortal 适配能力”，但不能标注“已支持官网 Mortal 4.1”。保留现有弱版示例只能证明接入机制，不代表同款模型或同等牌力。

## 来源和版本

- mjai-reviewer 本轮解析到提交 [`2dc5ec5c8b28517cfb45f57eb21536d9a8f67aa9`](https://github.com/Equim-chan/mjai-reviewer/tree/2dc5ec5c8b28517cfb45f57eb21536d9a8f67aa9)：[README](https://github.com/Equim-chan/mjai-reviewer/blob/2dc5ec5c8b28517cfb45f57eb21536d9a8f67aa9/README.md)、[Mortal 进程调用](https://github.com/Equim-chan/mjai-reviewer/blob/2dc5ec5c8b28517cfb45f57eb21536d9a8f67aa9/src/review/mortal.rs)、[FAQ](https://github.com/Equim-chan/mjai-reviewer/blob/2dc5ec5c8b28517cfb45f57eb21536d9a8f67aa9/faq.md)。
- Mortal 本轮解析到提交 [`0cff2b52982be5b1163aa9a62fb01f03ce91e0d2`](https://github.com/Equim-chan/Mortal/tree/0cff2b52982be5b1163aa9a62fb01f03ce91e0d2)：[README 与许可证](https://github.com/Equim-chan/Mortal/blob/0cff2b52982be5b1163aa9a62fb01f03ce91e0d2/README.md)、[构建说明](https://github.com/Equim-chan/Mortal/blob/0cff2b52982be5b1163aa9a62fb01f03ce91e0d2/docs/src/user/build.md)、[CLI 实现](https://github.com/Equim-chan/Mortal/blob/0cff2b52982be5b1163aa9a62fb01f03ce91e0d2/mortal/mortal.py)、[配置样例](https://github.com/Equim-chan/Mortal/blob/0cff2b52982be5b1163aa9a62fb01f03ce91e0d2/mortal/config.example.toml)。文件通过 GitHub Contents API 读取默认分支，提交哈希用于标识本轮核查版本。
- [作者关于权重发布的说明](https://gist.github.com/Equim-chan/cf3f01735d5d98f1e7be02e94b288c56)：页面中的结论更新日期为 2022-08-19；这是 README 当前仍引用的说明，不将旧日期误写为近期承诺。
- [官方服务首页](https://mjai.ekyu.moe)：本轮实际读取页面确认三种 4.1 网络选项、半庄限制与复盘表单；未使用其网页后台作为实时 API。
- [Mortal issue #116](https://github.com/Equim-chan/Mortal/issues/116)：本轮读取 issue 和评论，未见作者提供权重或正式 API 授权，不能作为模型取得依据。

许可需要分别处理：mjai-reviewer 的 Apache-2.0、Mortal 代码的 AGPL-3.0-or-later、第三方权重自己的授权不能互相替代。建议继续沿用外部安装和独立服务的分发方式；若复制上游代码、分发模型或部署修改版服务，应按相应许可证核对义务，不能因进程隔离就断言没有许可要求。
