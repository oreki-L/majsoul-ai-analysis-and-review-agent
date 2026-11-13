# 离线回答一致性诊断

`benchmark/answer-consistency.cjs` 用当前snapshot和本地计算检查有限的、能明确定位的自然语言断言，返回原句、JSON Pointer、实际断言、预期事实和诊断类别。它是离线开发工具，没有接入在线回答拒绝、质量评分或自动纠错流程。

当前支持的窄语法包括：字牌的场风、自风、三元牌及客风身份；明示弃牌与拆对子、保留赤牌的关系；弃后单张被称对子；同向听合法候选集合中的进张上界最高值；两张牌的搭子花色和形状；逐家现物与对应牌河；明确声称全场无副露。比较句若存在主体切换、假设、否定或未明确的范围，优先不判。自由文本并未获得完整解析。

调用方式：

```js
const { inspect } = require('../benchmark/answer-consistency.cjs');
const result = inspect(context, parsedAnswer);
// context.snapshot: 当前已授权局面
// context.prepared.data.localAnalysis: 同一局面的确定性计算
// context.factCatalog.binding.snapshotHash: 如提供，必须匹配当前snapshot
// 不提供factCatalog时，由调用方确保localAnalysis和snapshot为同一状态。
```

结果中的 `qualityPass` 固定为null，`naturalLanguageVerified` 和 `automaticCorrectionEnabled` 固定为false。每条finding的 `correctionEligible` 也固定为false。没有finding可能是表述未被解析，不能作为质量通过或免审依据。检查范围统计以“含至少一条可识别断言的理由段落”为单位；该段落其余内容仍未获核验。

**形状与有役边界。** 当前 `extension/mahjong-analysis.js` 返回的 `completionValidation` 为 `{shape:true,yaku:false,furiten:false,scoring:false}`。算法数值仍是标准形状向听及未见枚数上界；它没有实现完整役种、振听或计分验证。零向听下能完成形状不等于已经确认可和，宝牌不能单独成役。诊断器遇到“和牌进张”会给出 `yaku-not-verified` 边界提醒，这不是无役判定，不计入事实错误finding。

**已有答案回放。** 不读凭证，不调用模型；只对既有冻结输入和已解析原答运行诊断，并检查来源hash。输出必须是新目录，禁止覆盖输入证据目录或已有输出。

```powershell
node scripts/evaluate-answer-consistency.cjs --report 'ABSOLUTE_PATH/REPORT.json' --contexts 'ABSOLUTE_PATH/contexts.original-inputs.frozen.private.json' --out 'ABSOLUTE_PATH/new-replay' --diagnostics 'ABSOLUTE_PATH/ANALYSIS.json'
```

最后的 `--diagnostics` 可选，用于标记已分析的失败节点子集。报告会列出全部交付、原评审通过答案对照、原失败答案、诊断子集的提示数量及解析覆盖。原评分不变；“失败答案中有提示”不是错误召回率，“通过答案中有提示”也不能直接计为误报，因为通过答案可以保留minor错误。

**自动纠错的准入仍未满足。** 本工具主要用已知错误开发，词法支持有限，遗漏严重程度和跨字段矛盾也未完整判断。上线前应先建立独立的断言级正误标注、核对每条提示、补充否定/假设/范围/主体切换等正确负对照，并在新样本上验证。不要据开发集表现触发额外API请求、改写答案或改变评分；如后续测试修正，必须保留初稿、最终答、新引入错误、额外耗时和费用。

冻结实验目录及其中代码、输入、答案、评分均维持原样；本次工作区边界说明只影响后续从工作区构建的输入，不反写历史实验。
