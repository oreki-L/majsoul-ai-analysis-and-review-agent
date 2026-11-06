# Mortal 测试阻塞：自家庄家 14 张开局记录

日期：2026-11-05；2026-11-06 更新。状态：已按用户指定的“庄家原始手牌最后一张为首摸”规则修复适配器及状态机，没有启动模型、下载资产或调用 LLM。

## 2026-11-06 修复与复核

- 实时及牌谱庄家14张开局均按前13张生成 `start_kyoku`，最后一张生成随后的庄家 `tsumo`；状态机保留完整14张手牌，将最后一张写入摸牌标记。非庄家14张、重复首摸仍拒绝。
- 原45＋39点共84点及旧29点，合计113点，全部通过当前 `EngineAgent.run` 推理前校验；检查到达 `infer` 即终止，未调用真实模型。
- 旧冻结文件未改写。只在核查的内存副本中更新四个开局首节点的 `selfDrawnTile`：`east2-h0` 为 `5p`，`south2-h0` 为 `3m`，`south2-h1` 为 `3z`，`south2-h2` 为 `2s`；其余节点沿用旧快照。
- 下文为原始问题记录及当时的修复约束。其中“不能取第14张”已由用户本次明确指定的处理规则替代，“尚未修复”“30点阻塞”等描述仅代表修复前状态。

## 问题与影响

旧测试源牌谱将庄家配牌与首摸合并记录在 `NewRound.hands[dealer]` 中，共 14 张，没有单独的首摸 `DealTile`。当自家座位为庄家时，当前 `extension/adapters/mjai.js` 的 `fromObservation()` 要求自家开局恰为 13 张，在第 96 行直接拒绝：

```text
自家开局需13张；14张庄家开局无法可靠分离摸牌，unsupported
```

拒绝发生于每次重建本局事件前缀时，所以影响该小局全部决策，不仅是开局第一手。这是适配器有意保留的数据边界；尚不能据此认定 Mortal 本身不支持该局面。

| 数据集 | 小局 | 自家／庄家座位 | NewRound recordIndex | 开局 consumed cursor | 被阻塞决策数 |
| --- | --- | --- | --- | --- | --- |
| 原 45 点 | east2-h0 | 1／1 | 121 | 122 | 13 |
| 原 39 点 | south2-h0 | 1／1 | 537 | 538 | 8 |
| 原 39 点 | south2-h1 | 1／1 | 606 | 607 | 9 |
| 旧 29 点，额外回归范围 | south2-h2 | 1／1 | 675 | 676 | 18 |

主测试 45＋39 共 84 点中，30 点因此被阻塞。其余 54 点已在当前代码下通过 `Mjai.fromObservation` 与 `EngineAgent.run` 的推理前请求校验；检查在进入 `infer` 时立即终止，没有调用真实引擎。这不能证明真实动作返回、LLM 串联或解释质量。逐局结果与源文件 SHA-256 记录在 `research/evidence/mortal-llm-test-plan-20261105/OFFLINE_PREFLIGHT.json`。

## 相关文件与数据

- 当前实现：`D:/雀魂插件/extension/adapters/mjai.js`，`fromObservation()`，特别是自家 13 张约束、他家庄家首摸转换及事件遍历。
- 下游一致性校验：`D:/雀魂插件/extension/engine-agent.js`，`validateSnapshot()` 检查精确手牌、摸牌、摸切、动作顺序、副露、牌河等。
- 原始源：`D:/雀魂插件/research/evidence/maka-context-benchmark-20261025/raw/replay-observation.json`。
- 坐标映射：同证据目录的 `mapping/expansion-public-positions.json`。
- 冻结 45 点：`D:/雀魂插件/research/evidence/realtime-quality-20261031/preparation/dataset.new45.frozen.json`。
- 冻结 39 点：`D:/雀魂插件/research/evidence/realtime-quality-20261031/same-match-remaining-20261102/preparation/dataset.remaining.frozen.json`。

上述真实牌谱和证据为本机私有文件，不随公开源码分发。旧 sidecar 是 LLM 授权上下文，不保留全部原始开局／副露来源字段，不能直接作为完整 mjai 回放源。

## 最小复现

在 `D:/雀魂插件` 运行以下 PowerShell 命令。只读取本地数据，不发网络请求或调用模型；示例为东二开局，替换 cursor 为 538／607 可复现另外两局开局。

```powershell
@'
const fs = require('node:fs');
const Mjai = require('./extension/adapters/mjai.js');
const raw = JSON.parse(fs.readFileSync(
  'research/evidence/maka-context-benchmark-20261025/raw/replay-observation.json', 'utf8'));
const cursor = 122;
const seat = 1;
const records = raw.replayRecords.slice(0, cursor).map(event => {
  const e = structuredClone(event);
  if (e.kind === 'NewRound')
    e.hands = e.hands.map((hand, i) => i === seat ? hand : hand.map(() => '?'));
  if (e.kind === 'DealTile' && e.seat !== seat) e.tile = '?';
  if (e.operation?.seat !== seat) delete e.operation;
  return e;
});
try {
  Mjai.fromObservation({ format: 'mj-observer-v1', mode: 'replay',
    historyView: false, state: { selfSeat: seat },
    replayRecords: records, replayCursor: cursor }, { seat, cursor, hand: true });
  console.log('accepted');
} catch (error) {
  console.log(error.message);
}
'@ | node -
```

## 修复要求与边界

1. 先核原始记录、采集协议及已有字段，确认能否可靠区分庄家 13 张配牌和首摸。现在只确认有 14 张合并记录，**尚未确认数组顺序或其他字段可以证明首摸是哪张**。
2. 证据充分时，形成可验证的 `start_kyoku` 13 张配牌与紧随其后的庄家 `tsumo`，同步处理当前 snapshot 的 `selfDrawnTile`、事件位置与摸切语义。保留来源、转换规则及原始／转换后哈希。
3. 不得随意抽一张当首摸、用之后的弃牌或结局倒推、把已知自家摸牌改成 `?`，或仅删除 13 张约束。若原始数据不可还原，保留明确不支持，并说明需要采集器补什么证据；不能用伪造输入换取通过。
4. 旧开局首节点 snapshot 的 `selfDrawnTile` 为 `null`。若可靠恢复需要补该字段，应输出新版本的输入与差异清单，保持原 decisionId／游标映射，不覆盖旧 dataset、原回答、评分或 hash 锁，也不声称新旧完整输入字节相同。
5. 不通过取消 `EngineAgent` 的事件／snapshot 对照解决；模型侧输入仍不得包含对手暗牌或游标之后的信息。

## 验收建议

- 上表四个小局分别覆盖开局第一手与后续巡目；主 84 点兼容清单重新逐点生成，旧 29 点中的南二二本场另作回归。
- 开局首摸、手切／摸切、相同牌多张、赤五与普通五、首摸后副露／立直等情形分别验证；无法证明的信息明确拒绝。
- 转换后的精确手牌、`selfDrawnTile`、`tsumogiri`、副露实体与来源、有序牌河、点棒／立直棒、宝牌及事件顺序继续通过当前下游合同。
- 不依赖未来记录；修改游标后的事件或对手暗牌身份不得改变该游标的 mjai 请求。
- 非庄家原 54 点及自家标准 13 张开局保持兼容；畸形 14 张非庄家、缺首摸证据和重复首摸继续拒绝。
- 离线校验完成后，再用固定真实社区 Mortal 权重走 HTTP → EngineAgent；真实推理通过与 LLM 教学质量分别验收。

当前检查基线：工作区 `D:/雀魂插件`，Git HEAD `7e8bb574ef53d5d9a31c890dff80cb0b16e85403`。不代表所有未跟踪文件属于本问题。
