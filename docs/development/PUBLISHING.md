# 公开与打包

Majsoul AI Analysis & Review Agent的源码可用于生成完整版和仅获取器。打包脚本不提交、推送、创建仓库或修改仓库可见性。

## 当前状态

项目统一维护于[oreki-L/majsoul-ai-analysis-and-review-agent](https://github.com/oreki-L/majsoul-ai-analysis-and-review-agent)。公开Git历史保留原私有仓库的全部10个开发提交，并已逐提交清理旧素材、打包产物、研究文件与个人邮箱；说明和逐版本测试结果见[历史迁移](../research/HISTORY.md)。

净化后的历史通过全新仓库发布。原始bundles和提交映射仅作本地私有备份；不要把旧对象、分支或标签重新推回公开仓库。仅删除工作树文件或加入`.gitignore`不能清理旧历史。

## 检查与打包

Node.js 22.19+可检查、测试、生成安装目录和运行人工回归。首次使用或锁文件更新后先执行 `npm ci`；源码包包含 `package-lock.json`、已生成的 Pi bundle 和完整第三方许可证。ZIP打包需Python 3.10+，打包脚本本身只使用标准库。

```sh
npm ci
npm run check
npm test
npm run build
npm run eval
python scripts/package-public.py
```

`package-public.py` 会先运行对应源码的检查和测试，再按明确白名单生成前三个 ZIP 和校验文件。本期 v0.14.0 另加入可选 Windows x64 模型管理工具包，正式 Release 共发布五项资产：

- `dist/majsoul-ai-analysis-and-review-agent-source-<version>.zip`：以`majsoul-ai-analysis-and-review-agent/`为根的源码，含三语介绍、Agent、harness、获取器、公开benchmark与人工样例、测试和CI。
- `dist/majsoul-ai-analysis-and-review-agent-<version>.zip`：完整版，解压后直接含`manifest.json`。
- `dist/majsoul-collector-<version>.zip`：仅获取器，不含模型代码、设置页或模型主机权限。
- `dist/majsoul-model-manager-windows-x64-<version>.zip`：独立模型管理引导工具包，按下文单独生成；不属于扩展包。
- `dist/SHA256SUMS-<version>.txt`：以上**四个 ZIP** 的 SHA-256。`package-public.py` 初次只写前三个 ZIP，加入工具包后必须重算四项，不能遗漏新增资产。版本以源码中的 manifest 与 package 为准。

`npm run build`单独生成两个可加载目录，不压缩。再次生成时会将旧目录改名为`.previous-时间戳`，不会递归删除已有目录；不再使用的旧目录可由维护者清理。不要同时在游戏中启用两种安装配置。

`--base-ref` 隔离快照从同一提交提取运行代码、构建脚本、npm 配置与锁文件，避免把当前 Pi 依赖混入旧版本。旧提交没有 npm 依赖时可生成空锁文件；有依赖却未提交锁文件时拒绝打包。快照的版本号同时更新 manifest、profile 和锁文件；文档及原创牌面仍来自当前准备目录。有依赖的临时快照先在自己的目录执行 `npm ci --ignore-scripts --no-audit --no-fund`，需要 npm 与依赖下载能力；安装失败会停止验证，无依赖的旧快照不安装。

白名单排除`.git`、`research/`、旧安装包、HAR、日志与浏览器配置，并扫描部分常见凭据格式。它不能替代人工审查。完整源码中的截图是离线模拟，牌面为37张原创SVG，不打包早期游戏截图。

当前正式发布沿用自 v0.8.0 起的干净 Git 提交快照流程：先用 `git -c core.autocrlf=false -c core.eol=lf archive` 将选定提交解压至独立目录，在快照目录执行 `npm ci`、检查／测试／构建、`python scripts/package-public.py` 和 `npm run eval`。不要直接打包带有未提交修改的工作区；源码、构建脚本、README、工具包脚本与文档都应取自同一选定提交。核对五个资产、四份 ZIP 的 SHA-256，以及源码／manifest／profile／锁文件版本一致后，再上传 Release。

## 可选模型管理工具包

工具包必须使用上述干净提交中的打包脚本，固定 native 构建输入由维护者显式提供。示例中的 `NATIVE_SOURCE_DIR` 是经校验的准备目录，`NEW_TOOLKIT_DIR` 必须是不存在的新目录：

```sh
node scripts/prepare-node-runtime.cjs --out NEW_NODE_RUNTIME_DIR
node scripts/package-mortal-toolkit.cjs --dir NATIVE_SOURCE_DIR --out NEW_TOOLKIT_DIR --node-runtime NEW_NODE_RUNTIME_DIR
node scripts/verify-mortal-toolkit.cjs NEW_TOOLKIT_DIR
```

默认发布 bootstrap，不传 `--offline-profile`，不捆绑模型权重或完整 Python。Python、固定 wheels 和用户所选模型只在用户明确安装时准备；模型进程仍需另行点击启动。不要将开发验收时的 `installations/`、完整运行环境、权重、Token 或日志混入发布包。

打包前后必须核对固定 `agent/mortal-source.json`、运行时锁、native SHA-256／ABI／构建记录。包内保留完整固定 Mortal 源码、`Cargo.lock`、匹配的完整 vendored crate 源码及原许可、Rust／GCC 运行库公告、项目许可和 native 构建说明；不能只分发 `.pyd` 而省略对应源码与许可证，也不能用本项目 MIT 覆盖第三方许可。完整 vendored crate 复制前后均须通过 Cargo 的 `.cargo-checksum.json` 复核；依赖源码中也可能包含名为 `target` 的目录，不得套用构建产物过滤。逐文件清单为 `TOOLKIT-SHA256.json`，验证脚本通过后再将目录内容压缩为 `majsoul-model-manager-windows-x64-<version>.zip`，解压后直接包含 `start.cmd`。

若在最后审查时更新管理 UI、后端或文档，应从同一最终提交重新生成工具包，再重算清单和 ZIP 哈希。`--refresh` 只能刷新已经识别且没有安装数据的工具包，不替代发布来源一致性审查。首次在线下载链路、干净环境和真实推理的已测／未测范围必须保留在包内指南与 [验收记录](../validation/MORTAL_V4_VALIDATION.md)，不得用离线复制成功替代在线安装验收。

## 上传与匿名复核

1. 检查四个 ZIP 的文件清单、版本、来源、许可与泄密扫描结果，重算 `SHA256SUMS-0.14.0.txt`。校验文件必须恰好覆盖 Agent、Collector、源码、模型管理工具包四项。
2. 将 tag 指向已验收的干净提交，核对远端提交与 CI；上传四个 ZIP 和一个校验文件，Release 说明链接到本期验证记录。
3. 发布后不使用登录凭据，匿名下载全部五项资产到新目录。核对下载字节与本地发布资产一致，并用下载的校验文件重新验证四个 ZIP；不要只检查 Release API 元数据。
4. 解压匿名下载的源码运行检查／测试／构建，检查扩展 manifest／profile 版本；解压下载的工具包运行逐文件校验，确认默认没有权重、完整 Python 或安装数据。核对 Release tag、latest 标识和远端提交，再报告发布完成。

## 后续维护

1. 检查本地变更、三语介绍、许可证、来源和实际安装包。
2. 直接在统一仓库的净化历史上继续开发，使用GitHub的noreply邮箱；旧克隆应重新克隆后单独迁移改动。
3. 改动完整、验证通过后可以提交和推送，执行前核对目标仓库与差异。不要将私密研究、历史ZIP或真实对局记录加入公开提交。
4. 等待公开仓库的远程CI，不能将本地测试当成远程CI结果。已启用私密漏洞报告功能。
5. 获得发布版本的指令后创建 Release，上传源码 ZIP、两种扩展 ZIP、独立模型管理工具包 ZIP 和统一校验文件。它们未签名，也不是浏览器商店分发包。

仓库简介可用：

> Majsoul AI Analysis & Review Agent：雀魂局面分析与复盘，包含独立牌局获取器、有界工具执行和自选模型。Mahjong analysis and review with a standalone collector and an execution harness.

Topics建议：`mahjong`、`majsoul`、`agent`、`browser-extension`、`llm`、`replay`。

## 验证边界

每次发布须核对所选提交的实际检查、测试、构建与浏览器验收，不能用旧版本成功记录替代本次验收。按版本维护的自动测试与浏览器范围见[验证记录](../../VALIDATION.md)，X-F 输入移植见 [X-F 验证](../benchmark/XF_VALIDATION.md)，可选 Mortal 路径见[工作流验收](../validation/MORTAL_WORKFLOW_VALIDATION.md)。历史人工牌局与模拟上游验证不等于真实整场采集、断线续接、任意模型兼容或实战牌力。`npm run eval` 的人工样例仅用于本地计算回归。

## Akagi v3 独立 runtime（v0.16.0 起）

默认五附件仍为两种扩展、公开源码、便携管理包与四ZIP校验表。它们不含 v3 权重或原生二进制；选择 v3 后按 `agent/akagi-native-source.json` 的固定来源、SHA-256、大小及逐文件清单下载。

v3 runtime 单独使用不可变 build release，不替换应用 latest。对应源码／锁／完整依赖许可／本地补丁随专用ZIP提供；打包见 `scripts/package-akagi-native.py`，构建见 `scripts/build-akagi-native.ps1`。正式发布后先匿名核对 asset API 下载字节，再更新固定 asset ID；保留 canonical release URL，下载须使用锁中的 Accept。公开源码只纳入 `scripts/package-public.py` 的 `NATIVE_SOURCE_FILES` 确切文件，不打包含权重的上游 archive 或本地草稿。
