# 项目目录结构

[文档导航](README.md) · [组件架构与数据流](../ARCHITECTURE.md) · [开发与贡献](../CONTRIBUTING.md)

本页说明仓库目录职责及新增文件的归属。以 v0.13.0 为基线；源码沿现有模块边界组织，文档按[用途索引](README.md)查找。

## 根目录地图

```text
majsoul-ai-analysis-and-review-agent/
├── extension/                 可直接加载的完整版浏览器扩展
│   ├── apps/                  Agent / Collector 组合入口
│   ├── collector/             获取器核心与浏览器、快照适配
│   ├── contracts/             授权快照、引擎动作及解释合同
│   ├── adapters/              模型端点、引擎端点、mjai 与 NAGA 转换
│   ├── profiles/              两种安装配置的显式 manifest
│   ├── tiles/                 原创 SVG 牌面及来源说明
│   └── *.js / *.css / *.html  采集、分析、后台、面板与设置模块
├── agent/                     Node 复盘、回归与可选本地引擎桥接
├── benchmark/                 独立实验执行器、评分与报告工具
│   └── examples/              可公开的人工 suite、局面和标签
├── tests/                     Node 测试、人工夹具与离线 HTML 预览
│   └── fixtures/              测试输入，不存真实账号或对局
├── scripts/                   检查、构建、打包与开发验证脚本
├── docs/                      专题文档；README.md 为分类索引
│   ├── images/                公开说明图片
│   └── validation/            可公开的机器可读验证记录
├── licenses/                  随分发依赖的许可证与来源
├── .github/                   CI、Issue 与 PR 模板
├── README{,.en,.ja}.md         三语介绍、安装与功能边界
├── ARCHITECTURE.md            模块职责与数据流
├── CONTRIBUTING.md            本地开发和贡献入口
├── VALIDATION.md              按版本记录的验证与限制
├── CHANGELOG.md               版本变化
├── SECURITY.md                权限、数据处理和漏洞报告
├── LICENSE                    本项目 MIT 许可证
├── THIRD_PARTY_NOTICES.md      第三方与素材声明
├── AGENTS.md                  仓库协作约定
└── package.json / lock        开发命令、版本及锁定依赖
```

## 按修改目标找源码

下列路径均相对仓库根目录；具体依赖方向以[架构](../ARCHITECTURE.md)和[边界检查说明](DECOUPLING.md)为准。

| 修改目标 | 入口 |
| --- | --- |
| 协议解析与旁路采集 | `extension/protocol.js`、`extension/capture.js` |
| 状态与结算历史 | `extension/state.js`、`extension/history.js`、`extension/history-storage.js` |
| 获取器状态、游标与授权快照 | `extension/collector/`、`extension/contracts/snapshot.js` |
| 本地向听、进张和防守计算 | `extension/mahjong-analysis.js` |
| Chat 输入、X-F 事实投影与结果校验 | `extension/analysis.js`、`extension/xf-context.js`、`extension/agent.js` |
| 有界工具执行与小局上下文 | `extension/harness.js`、`extension/round-context.js`、`extension/decision-discussions.js` |
| 网络、后台生命周期与配置 | `extension/background.js`、`extension/model-analysis-worker.js`、`extension/model-config-store.js`、`extension/model-profiles.js`、`extension/model-session-transport.js` |
| Mortal 动作、独立解释与旧报告 | `extension/engine-agent.js`、`extension/contracts/engine-result.js`、`extension/contracts/engine-explanation.js`、`extension/official-mortal-report.js`；本地进程在 `agent/` |
| 面板、标记与设置页 | `extension/analysis-panel.*`、`extension/overlay.js`、`extension/floating-panel.js`、`extension/hand-hints.js`、`extension/options.*` |
| 默认关闭的记忆学习 | `extension/user-memory-*.js` |
| 两种分发配置 | `extension/profiles/`、`extension/manifest.json`、`scripts/build-extensions.mjs` |
| Pi 上游与浏览器 bundle | `scripts/pi-runtime-entry.mjs`、`scripts/pi-ai-browser.mjs`、`scripts/pi-schema-interpreter.mjs`、`scripts/bundle-pi-runtime.mjs`；产物 `extension/pi-runtime.js` |
| 实验冻结、预算、恢复、盲评与报告 | `benchmark/`；先看 [自主 benchmark](BENCHMARK_AUTONOMOUS.md) |

扩展完整版与独立获取器由 profile 的资源闭包构建。`agent/` 的 Node 工具和 `benchmark/` 的实验执行器不作为浏览器脚本加载；测试继续通过 `tests/*.test.js` 入口发现。修改模块位置前须同步加载顺序、依赖规则、测试引用和打包入口。

## 本地数据与生成目录

以下目录按需生成，通常不在干净克隆中存在。

| 路径 | 用途 | 管理方式 |
| --- | --- | --- |
| `node_modules/` | 锁定开发依赖 | `npm ci` 生成，Git 忽略 |
| `dist/` | 可加载安装目录、ZIP 与校验文件 | build / 打包生成，Git 忽略 |
| `research/evidence/` | 私有实验输入、冻结 run、费用账本与原始验收证据 | Git 忽略；保留原合同与原始记录 |
| `research/public-release/` | 本地发布准备与下载验收记录 | Git 忽略，不随公开源码分发 |
| `research/sources/`、`research/current-web/`、`research/current-desktop/` | 本地研究资料 | Git 忽略 |
| `.venv-akagi/` | 可选本地示例引擎 Python 环境 | Git 忽略；不随扩展分发 |
| `.playwright-cli/`、`.playwright-mcp/`、`playwright-report/`、`test-results/` | 本地浏览器自动化产物 | Git 忽略 |
| `browser-profiles/` | 本地浏览器配置 | Git 忽略，不公开 |

忽略规则的具体范围见 [`.gitignore`](../.gitignore)；不能据子目录被忽略就推断整个 `research/` 都被忽略。模型权重与第三方运行时由使用者单独准备，不移入源码或安装包。

## 常用命令与产物

| 命令 | 作用 |
| --- | --- |
| `npm ci` | 安装锁定依赖 |
| `npm run check` | 语法、版本、profile、依赖边界、Pi bundle 与牌面检查 |
| `npm test` | Node 自动化测试 |
| `npm run build` | 生成 `dist/` 下的完整版与 Collector 安装目录 |
| `npm run pi:bundle` | 重新生成已提交的 Pi bundle；仅修改其源码时需要 |
| `npm run eval` | 人工本地计算回归，不调用真实模型 |
| `npm run benchmark:validate` | 校验公开人工实验示例 |
| `npm run benchmark:mock` | 离线模拟自主实验，输出到 `research/evidence/benchmark/autonomous-demo` |
| `python scripts/package-public.py` | 验证后按白名单生成源码包、两种安装 ZIP 和 SHA-256 |

源码 ZIP 递归包含 `docs/`，根文件和源码目录由 `scripts/package-public.py` 显式白名单管理；新增根文档时须核对分发清单。正式发布从干净提交快照打包，步骤见[发布文档](PUBLISHING.md)。
