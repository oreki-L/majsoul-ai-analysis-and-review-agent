# 规则差分与事件核查（2026-11-05）

> **专项验收／2026-11-05。** 本文对应 v0.16.1 已发布的规则／采集修复范围，并保留本地开发检查记录；真实事件和整场重连暂缓，快照恢复仍不支持。发布变化见[更新记录](../../CHANGELOG.md)。

本轮完成开发期离线规则差分和固定协议的合成事件回归，没有替换采集架构，没有增加扩展运行依赖。真实客户端事件采集、整场断线恢复验收按用户要求搁置；以下结果不能当作真实整场兼容证明。

## 规则差分

参照 [MahjongRepository/mahjong 1.4.0](https://pypi.org/project/mahjong/1.4.0/)（MIT），开发环境使用 Python 3.11。版本及 PyPI 工件 SHA-256 固定在 [requirements](../../scripts/mahjong-reference-requirements.txt)。库只安装在忽略目录，不随扩展分发；正常 Node 测试读取已生成的结果，不要求用户或 CI 安装 Python。

- [生成器](../../scripts/mahjong-reference.py)独立调用 Python 库产生预期值，没有从本地 JavaScript 计算结果生成预期值。
- [固定样本](../../tests/fixtures/mahjong-reference.json)：种子 `20261105`，1,012 组，四麻／三麻、0–4 组副露、杠、13／14 张的对应结构数、赤五、七对子种类修正、国士、死等待；一半生成样本偏向和牌或接近听牌形状。向听分布：和牌104、听牌361、一向听201、二向听156、三向听115、四向听64、五向听10、六向听1。
- [Node 差分测试](../../tests/mahjong-reference.test.js)逐组比较普通型、七对子、国士和综合向听，再比较 2,999 个弃牌候选及共 3,507 个弃牌后／当前手牌的全部合法进张、未见枚数上界和总量；统一规则后全部一致。
- 本地新增 `shantenByType()`，保留原来的综合向听及分析接口。副露含暗杠时也禁用特殊型，返回 `null`；四张同种不计为两对；赤五按普通五进行34种编码，弃牌仍保留赤牌身份。

### 分歧归因

Python 库从暗手数量推断副露组数，不接收副露实际牌种；本地还会排除锁在自家副露中的第五枚等待。固定样本有4组普通型原始值为0、本地为1：`meld-locked-wait`、`seed-3-4-1-2`、`seed-3-4-1-16`、`seed-3-4-1-27`。这是输入信息／规则定义差异，没有把本地改成允许第五枚等待。样本同时保留 `referenceRaw` 和统一规则后的 `expected`，可逐条检查，未静默跳过差异。

普通型单项初稿漏用了已有的死等待校验，`1111m222p333s444z` 暴露差异；已修正。原有综合向听和进张在首轮没有发现计算错误。当前样本未发现其他未解释差异；不表示穷举全部手牌，也不覆盖计分、役种、振听或高向听全部摸打路径可达性。

### 复现

```powershell
py -3.11 -m venv research/sources/mahjong-venv
research/sources/mahjong-venv/Scripts/python.exe -m pip install --require-hashes -r scripts/mahjong-reference-requirements.txt
research/sources/mahjong-venv/Scripts/python.exe scripts/mahjong-reference.py
node --test tests/mahjong-reference.test.js
```

`--samples` 控制每种人数／副露数／手牌数量组合的样本数，默认50。生成器显式过滤三麻不存在的2–8万，禁用三麻吃副露；暗手顺子仍合法。Python 参照不把三麻模拟成另一种计分规则，比较仅限所述牌形计算。

## 固定协议调查

本轮实读下列固定源码，只调查字段与行为，没有复制或分发上游实现／proto／生成代码：

| 来源 | 依据与核查范围 |
| --- | --- |
| [mahjong_soul_api protocol.proto](https://github.com/MahjongRepository/mahjong_soul_api/blob/5925c3f14da7bee2662358c5d890f585555ef7bd/ms/protocol.proto) | `ReqAuthGame.account_id=1`；`ResAuthGame.seat_list=3`；enter/sync响应的 `game_restore=4`；恢复中的 `snapshot=1, actions=2`；立直确认、鸣牌、杠和宝牌字段 |
| [Akagi bridge.py](https://github.com/shinkuan/Akagi/blob/91cc2993e4e3682248d33d73d93afe055040e700/mitm/bridge/majsoul/bridge.py) | 认证座位映射、恢复顺序、鸣牌来源、加杠／暗杠分类、杠后宝牌时点 |
| [Akagi liqi.py](https://github.com/shinkuan/Akagi/blob/91cc2993e4e3682248d33d73d93afe055040e700/mitm/bridge/majsoul/liqi.py) | `parse_syncGameActions` 直接解码恢复动作的明文 protobuf，与实时掩码通知不同 |

上述三个文件的 SHA-256 依次为 `8ad0e287f6978b7dd83f86d1b3c7226a0e8fe4ea72696f34bcde5b950e549336`、`0e0751c899b80ccb5ad52344965a71ad6415dbf322b6c5cae88665c8fabe3671`、`b344015185a0137beed6196d60c254632540ef49c2a76d7891cc95a7fd92182d`。参考版本沿用已有Akagi V2固定提交，不将其等同于V3或当前线上协议。

## 已修复与离线验证

- 恢复列表显式按明文解码，并先完整解码整批，再发布事件，避免坏尾部留下部分开局。全量开局重放可重建；重复增量按step去重。
- 认证请求／响应按socket及request id配对推导座位，只向桥接层发出座位编号；账号仅在socket闭包中暂存，token／session及账号字段不进入消息或导出。没有操作提示的非庄家也能在开局前确定座位。
- `close` 排在该socket已到达的Blob解码队列之后，最终可靠性保持断线。新socket接管后，忽略旧socket晚到的动作及关闭事件；新连接仅有增量时继续标记不完整。
- 加杠补齐第四张牌的 `froms`，同时更新本地状态与引擎重放校验，保留赤五及原碰牌来源。
- 立直声明不自行扣点，等待服务器确认；鸣牌标记被叫走的河牌；杠后从真实携带 `doras` 的事件更新指示牌，重复事件不重复摸牌。

回归入口：`tests/capture.test.js`、`tests/collector-controller.test.js`、`tests/state.test.js`，并覆盖已有引擎动作验收。所有输入都是按固定字段独立构造的合成样本，未冒充真实采集事件。

`GameSnapshot` 的牌河／立直位置等恢复语义尚未实机核实，仍明确诊断“不支持”，保持不完整并要求从开局重建。本轮没有实现快照恢复，也没有宣称仅增量可修复断线期间全部缺口。恢复阶段的计时字段未接入，也不推算剩余操作时间。

## 最终检查

- `node --test --test-concurrency=4 tests/*.test.js`：704项，703通过、1跳过、0失败。
- `npm run check`、`git diff --check`通过。
- 首次默认并发全量运行发现加杠状态与引擎校验不一致，已同步修复；另有既有Mortal进程重启测试在PID存活断言失败，单独复测及降低并发的最终全量运行均通过，未改动该测试或进程实现。默认高并发时的时序波动仍保留此记录，不声称已修复。

本机日志：`research/rules-differential.log`、`research/rules-events-final-test.log`、`research/rules-events-final-check.log`（忽略目录，不随包分发）。临时旧Python环境的删除被自动审批策略阻止，保留于已忽略的 `research/.venv-mahjong/`；实际固定参照环境为 `research/sources/mahjong-venv/`。
