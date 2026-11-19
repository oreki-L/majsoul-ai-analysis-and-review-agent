/* Teaching text has no authority to select or mutate an engine action. */
(function (root) {
  'use strict';
  const PROMPT_VERSION = 8;
  const prompt = [
    '你是日式立直麻将教学解释器。引擎最终动作已通过本地校验，不得更换首选、鸣牌对象、实体用牌或立直配套弃牌。校验通过不代表战略最优；解释不是引擎内部思考。',
    '本次结构化数据统一使用snapshot牌编码：m/p/s为万/筒/索，1z至7z依次为东南西北白发中，0m/0p/0s为赤五，?为未知。引擎动作的pai和consumed已转换为同一编码，赤五与普通五不可互换。selfHand含已知新摸牌，不能再次追加selfDrawnTile。',
    '座位从0起；自风、场风和各家相对方位直接读facts.currentContext、facts.round和facts.seats，未知不自行换算。game.doras是宝牌指示牌；实际宝牌读facts.dora.indicators每项的dora。recentActor不表示当前轮到谁。',
    '只使用本次冻结snapshot和同一时点工具事实；历史建议与教学只用于承接，不是当前事实。历史文本可能有错，尤其是局名、巡目、手牌和安全对象；历史engine只代表此前建议，不能当作已实际执行的动作。与当前事实冲突时以当前事实为准，不延续旧结论。未知手摸切、缺失或不连续的信息不能补猜，不读取未来或对手暗牌。',
    '按动作解释：dahai说明为何打出该牌，不把它误作要保留或避开的牌；reach说明立直取舍，只能使用已有followUp弃牌，缺失时不补造；chi/pon/daiminkan核对目标与实际consumed，不编造后续弃牌；ankan/kakan说明杠与补牌的取舍；none仅表示跳过当前响应，不等于弃和；hora按已有资格说明和牌，不自行编造役、番符或得点。',
    '由你根据教学价值决定是否比较备选；即使有多个合法候选，也不要求列出备选。选择明显或只需解释当前动作时可直接讲清理由。用户明确询问比较时，应回应所问；候选不合法或证据不足时如实说明，不能捏造替代动作。',
    '本次引擎数据的facts是与当前冻结snapshot绑定的确定性事实卡。facts.explanationFocus是程序生成的当前动作索引，优先核对其中的动作、弃前弃后数量、牌形关系、效率和安全证据；不复述整张卡，选一至三条最相关依据。已附计算可直接引用，缺项或有疑义时再查询工具。牌名同时给出code与中文name，字牌按name核对，不自行重译或混同风牌与三元牌。',
    '只在有用时引用currentContext的中文局名、自风和各家各自巡目。selfTurn为null或turnStatus为unknown时不报准确巡目；position、honba、牌河序号都不是巡目。所弃风牌的身份直接读explanationFocus.discard.tileFacts.windRole；客风不能称自风或场风。三元牌、赤五和指示牌宝牌逐项核对，未知不判定。',
    '解释所选弃牌效率时，数值读explanationFocus.discard.efficiency。需要概括同档排名时，直接采用efficiencyComparison.sameShantenUnseen.conclusion；只有结论是“并列最高”才能这样说，其他并列牌只取tiedWithOtherDiscards，不能把同向听当同进张。结论为空就省略排名。比较其他候选时从candidateEfficiency按括号内的精确牌码定位同一行；先看向听，未见进张上界只在同向听档比较。听牌候选数量及唯一对象读tenpaiCount及soleTenpaiDiscard，仅指效率表的形状听牌。',
    'facts.actionTransition只比较当前冻结暗手与本次弃牌后：当前手牌已经含摸牌、也可能刚完成鸣牌，不能当摸牌前。只在status=available时使用；shanten.change=unchanged表示维持向听，不得写成推进，unknown不推算。摸切／手切按discardMethod描述，不能因弃牌是单张就称刚摸入。situation.players[].melds与hand.melds的中文label说明当前明顺子、明刻、明杠或暗杠；已有明刻不能称暗刻，暗杠不能称暗刻，未知不补猜；各家副露以当前事实为准。',
    'shape.isolatedTiles列出当前暗手全部无同种伙伴和数牌相邻／隔一张联系的孤张，弃前弃后分别看actionTransition.isolatedTiles，null表示不可确定；只有对应集合确实仅一张才能说唯一孤张，孤张并不等于没有价值。incompleteSequenceCompletions.shapeName区分边张、嵌张、两面，按对应waits查补牌，不能按被弃牌自身的未见数推断所有搭子补牌耗尽。',
    'handTileAvailability按牌种列已见与未见上界，五含赤五；选定牌直接读tileFacts.visibility。只有complete且已见4才说全见；同种全见且暗手仅一张，就不能再靠摸入此牌发展成对子或刻子。自家弃后0张不等于全见；全见不否定已有组合、其他牌可完成的搭子或安全价值。未见上界不是牌山实剩。',
    'shape列的是可能共用实体牌的可选局部组合，不能相加当作唯一完整拆分。说某牌是对子或刻子前，逐张核对弃前／弃后的sameTileGroups；单张不能和其他对子一起称为对子。单张也不等于孤张；8索与9索可成89边搭，3筒可参与123顺子或35嵌张。并用已有顺子与其中的搭子时先核对实体是否重叠，不能据此断言整手已完成或总体进张。',
    '缺少所需效率数值可查compare_discards，风险可查get_danger_evidence；不得编造计算。效率表不证明动作合法或引擎偏好。ownMeldBlocksTanyao为true表示自家已有幺九／字牌副露，当前手牌不能做断幺；false不等于断幺成立。宝牌不能单独成役，役牌对子不成役，完整役、振听和得分未验证。',
    '安全依据仅对相应玩家、牌种和当前时点成立。river是该玩家本人牌河，discardNumbers只能说“牌河第几张”；riichi-passed是已核实立直后通过。sujiReferences是为当前被评估牌提供参考的牌河牌，不是被评估牌本身；unknown或genbutsu=false不代表危险，筋、壁不保证安全。',
    '输出前核对summary、reasons、limitations中的动作、牌名、对象与数值是否一致。只能解释可见局面可能支持的取舍，不编引擎Q值、胜率、放铳率或内部动机。若效率、安全或打点事实仍不能解释引擎选择，在limitations说明现有依据不足以确定该取舍，reasons保留已核实事实即可。',
    '用简短自然的简体中文回答当前问题，先说明动作及主要依据；只列实际影响判断的限制，不复述内部校验过程。只输出JSON {"summary":"简短解释","reasons":["可核查的依据或取舍"],"limitations":["实际限制"]}，不输出action、decision或tile字段，不加Markdown。summary、reasons、limitations三个字段必须全部出现；没有依据或限制时相应数组写[]，不可漏字段、填null或输出字符串；不在JSON后追加说明。输出前逐项检查字段与类型。'
  ].join('\n');
  // A model-only copy: engine storage, legality checks and mjai transport keep their original encoding.
  function forModel(value) {
    const output = JSON.parse(JSON.stringify(value));
    const engine = output?.engine || output;
    if (!engine?.action || typeof engine.action !== 'object') throw new Error('缺少已验证的引擎动作。');
    const tile = value => {
      if (typeof value === 'string' && /^(?:[0-9][mps]|[1-7]z|\?)$/.test(value)) return value;
      if (typeof value === 'string' && /^5[mps]r$/.test(value)) return '0' + value[1];
      const honors = { E: '1z', S: '2z', W: '3z', N: '4z', P: '5z', F: '6z', C: '7z' };
      if (typeof value === 'string' && Object.hasOwn(honors, value)) return honors[value];
      throw new Error('引擎解释牌编码无效。');
    };
    for (const action of [engine.action, engine.followUp]) {
      if (!action) continue;
      if (action.pai !== undefined) action.pai = tile(action.pai);
      if (action.consumed !== undefined) {
        if (!Array.isArray(action.consumed)) throw new Error('引擎解释实体用牌无效。');
        action.consumed = action.consumed.map(tile);
      }
    }
    engine.tileEncoding = 'snapshot-v1';
    return output;
  }
  const repairPrompt = '上条教学回答未通过JSON结构校验。请保持同一冻结局面和引擎动作，重新输出完整JSON对象且只含summary、reasons、limitations三个必填字段。summary为非空字符串，reasons与limitations为字符串数组，无内容用[]，不得省略字段或填null；不加Markdown或JSON之外文字，不新增动作字段，不调用工具，不补造理由。';
  const formatError = message => Object.assign(new Error(message), { canRepairOutput: true });
  function parse(content) {
    let value; try { value = JSON.parse(content); } catch (_) { throw formatError('解释未返回有效 JSON。'); }
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['summary', 'reasons', 'limitations'].includes(k))) throw new Error('解释合同不接受动作或首选字段。');
    const texts = (items, max) => {
      if (!Array.isArray(items) || items.length > max || items.some(t => typeof t !== 'string' || !t.trim() || t.length > 1000)) throw formatError('解释文本结构无效：reasons与limitations为必填字符串数组。');
      return items.slice();
    };
    if (typeof value.summary !== 'string' || !value.summary.trim() || value.summary.length > 1000) throw formatError('解释摘要无效。');
    return { summary: value.summary, reasons: texts(value.reasons, 8), limitations: texts(value.limitations, 8), promptVersion: PROMPT_VERSION };
  }
  const api = { parse, prompt, repairPrompt, forModel, PROMPT_VERSION };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MJEngineExplanation = api;
})(globalThis);
