# Mortal 教学 v12 回归准备

提示词 v12、事实卡 v11 针对 [v11 扩样实测](TEACHING_FACTS_V11_EXPANDED_20261120.md) 的两条重大错误。沿用原有的向听变化、搭子各端未见上界、Mortal 动作、三字段 JSON 和可选备选比较规则。

| 错例 | 程序直接提供的事实 |
| --- | --- |
| `d-567ab9a74182f2e9ca32138b`，摸切赤 5 万 | 弃后暗手无 5 万，不能用它组成弃后的对子、搭子或面子；形状听口仍是 3 筒、4 筒。已有的中明刻提供役牌，和补哪一张、用什么牌作雀头无关。 |
| `d-3c136cc97af63af46851a5ba`，摸切 9 筒 | 下家本人牌河第 5、9 张弃过 9 筒，9 筒对下家是现物；对家没有这条依据。摘要和正文均引用同一玩家的证据。 |

`removedKindWording` 按牌种检查弃后暗手，同种赤牌一起计数；若仍有普通五或牌形未知，不输出「已无此牌」。`fixedYakuhaiSources` 只列已核实的固定役牌刻子或杠；不把役牌对子算成役，也不假定局部搭子决定和牌拆分。`safetyByOpponent[].wording` 绑定相对座位、牌和安全依据，并区分本人弃牌、立直后通过和公开牌排除等待。

40/40 点通过离线回放，冻结快照、历史和缓存 Mortal 动作逐点匹配。两条新错例均检查了模型收到的事实；同时确认「维持 0 向听」和搭子两端上界的旧修复保留。60 项相关测试、`npm run check` 和差异格式检查通过。无真实 API 请求，独立账本上限 10 元，支出 0 元。离线通过只证明程序输入和交付链路，模型实际解释仍待盲评。

正式实测建议先检查两条新错例，再覆盖同一 40 点；使用 `gpt-6.2-sol`（`low`）盲评，分开报告首次交付和已交付答卷的质量。复用同评分合同的历史答卷和已核实评分；重点核对两条重大错误是否消失、旧修复有无回退、JSON 未交付是否复发。未提交或发布。

可从研究工作区运行冻结清单复查：

```powershell
node benchmark/current-teaching-v12/regression.cjs verify research/evidence/current-teaching-v6-live-20261117 research/evidence/current-teaching-v8-targeted-cny10-20261119 research/evidence/current-teaching-v12-cny10-20261121
```
