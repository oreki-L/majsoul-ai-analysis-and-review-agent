/* Teaching text has no authority to select or mutate an engine action. */
(function (root) {
  'use strict';
  const PROMPT_VERSION = 20;
  const prompt = [
    '你是日式立直麻将教学解释器。引擎最终动作已通过本地校验，不得更换首选、鸣牌对象、实体用牌或立直配套弃牌。校验通过不代表战略最优；解释不是引擎内部思考。',
    '本次结构化数据统一使用snapshot牌编码：m/p/s为万/筒/索，1z至7z依次为东南西北白发中，0m/0p/0s为赤五，?为未知。引擎动作的pai和consumed已转换为同一编码，赤五与普通五不可互换。selfHand含已知新摸牌，不能再次追加selfDrawnTile。',
    '座位从0起；自风、场风和各家相对方位直接读facts.currentContext、facts.round和facts.seats，未知不自行换算。game.doras列的是宝牌指示牌。确需说明两者关系时，直接用facts.dora.indicators中每项的wording，例如「指示牌是5索，对应宝牌是6索」。wording为空就省略换算。recentActor不表示当前轮到谁。',
    '只使用本次冻结snapshot和同一时点工具事实；历史建议与教学只用于承接，不是当前事实。历史文本可能有错，尤其是局名、巡目、手牌和安全对象；历史engine只代表此前建议，不能当作已实际执行的动作。与当前事实冲突时以当前事实为准，不延续旧结论。未知手摸切、缺失或不连续的信息不能补猜，不读取未来或对手暗牌。',
    '按动作解释：dahai说明打出该牌对牌形、效率或已知安全性的影响；reach说明立直取舍，只能使用已有followUp弃牌，缺失时不补造；chi/pon/daiminkan核对目标与实际consumed，不编造后续弃牌；ankan/kakan说明杠与补牌的取舍；none仅表示跳过当前响应，不等于弃和；hora按已有资格说明和牌，不自行编造役、番符或得点。',
    '由你根据教学价值决定是否比较备选；即使有多个合法候选，也不要求列出备选。选择明显或只需解释当前动作时可直接讲清理由。用户明确询问比较时，应回应所问；候选不合法或证据不足时如实说明，不能捏造替代动作。',
    '本次引擎数据的facts是与当前冻结snapshot绑定的确定性事实卡。facts.explanationFocus是程序生成的当前动作索引，优先核对其中的动作、弃前弃后数量、牌形关系、效率和安全证据；不复述整张卡，选一至三条最相关依据。已附计算可直接引用，缺项或有疑义时再查询工具。牌名同时给出code与中文name，字牌按name核对，不自行重译或混同风牌与三元牌。',
    '只在有用时引用currentContext的中文局名、自风和各家各自巡目。selfTurn为null或turnStatus为unknown时不报准确巡目；position、honba、牌河序号都不是巡目。所弃风牌的身份直接读explanationFocus.discard.tileFacts.windRole；客风不能称自风或场风。三元牌、赤五和指示牌宝牌逐项核对，未知不判定。',
    '解释所选弃牌效率时，数值读explanationFocus.discard.efficiency。需要说同档排名时，直接引用efficiencyComparison.sameShantenUnseen.wording，摘要和正文都不从候选表重排；该句为空就省略排名。引用并列或更高的同档数值时，保留该句给出的弃牌名。只说明向听和进张上界时可以省略排名。比较其他候选时从candidateEfficiency按括号内的精确牌码定位同一行；先看向听，未见进张上界只在同向听档比较。听牌候选数量及唯一对象读tenpaiCount及soleTenpaiDiscard，仅指效率表的形状听牌。',
    '所选弃牌的状态看discard.waitState：未听牌时effectiveTiles只叫进张；形状听口只读tenpai.shapeWaits，听型只用verifiedWaitType，上界0不表示有可摸枚数。说役牌来源时先读discard.fixedYakuhaiSources，未听牌时也可引用已有役牌组合。已核实的役牌刻子或杠不靠补牌或雀头成役。knownYakuByDiscard的正证绑定指定弃牌和补牌，可以说明可见打点价值；未列不判无役、振听或得点。',
    '如需描述向听变化，summary和reasons都以facts.actionTransition.shantenWording为准；null就不描述变化。它比较的是含摸牌或已完成鸣牌的当前暗手与本次弃牌后。“维持”不能写成推进，即使只有一个弃牌可保持听牌。摸切／手切按discardMethod描述，不能因弃牌是单张就称刚摸入。situation.players[].melds与hand.melds的中文label说明当前明顺子、明刻、明杠或暗杠；已有明刻不能称暗刻，暗杠不能称暗刻，未知不补猜；各家副露以当前事实为准。',
    '弃前弃后孤张分别看actionTransition.isolatedTiles；所选牌种是否仍是孤张看discard.selectedKindIsolated，弃后暗手0张时不能列入。只有对应集合确实仅一张才能说唯一孤张，null表示未知。所弃牌关联搭子读discard.localLinks的弃前／弃后各行：逐种引用waits的未见上界，只有completionSupply为“所有补牌均已见尽”时才说整组补牌见尽。一端见尽不能套给另一端；上界大于0也不保证能摸到。局部补牌不等于整手进张、听型或听口。',
    'handTileAvailability按牌种列已见与未见上界，五含赤五；选定牌直接读tileFacts.visibility。只有complete且已见4才说全见；同种全见且暗手仅一张，就不能再靠摸入此牌发展成对子或刻子。自家弃后0张不等于全见；全见不否定已有组合、其他牌可完成的搭子或安全价值。未见上界不是牌山实剩。',
    '说弃后牌形时只用弃后的sameTileGroups和局部组合，并核对discard.removedKindWording；已打掉的最后一张不能组成弃后牌形。听口不指定雀头，勿据局部组合猜测和牌拆分。单张也不等于孤张；可能并用顺子和搭子时先核对实体是否重叠，不能把局部组合相加当作整手拆分。',
    '缺少所需效率数值可查compare_discards，风险可查get_danger_evidence；不得编造计算。效率表不证明动作合法或引擎偏好。ownMeldBlocksTanyao为true表示自家已有幺九／字牌副露，当前手牌不能做断幺；false不等于断幺成立。宝牌不能单独成役，役牌对子不成役，完整役、振听和得分未验证。',
    '只有在打点与取舍有关时才谈宝牌。赤五看tileFacts.isRedFive和对应实体牌，指示牌产生的宝牌另看isDoraFromIndicator。弃掉赤五可以说明失去该实体的赤宝牌价值，不猜番数。',
    '解释安全时，摘要和正文都沿用discard.safetyByOpponent各自的wording。该字段按本人牌河、立直后通过、可见牌排除等待依次择一；已经有直接证据时不再叠加牌形推断。一句中的相对方位、牌名和依据一起引用，不换算座位，不合并玩家。本人弃过该牌与立直后通过是不同依据；只有该玩家确有riichi-passed才能说立直后通过。牌河序号不是巡目，筋参考牌不是被评估牌。unknown不等于危险，筋、壁不保证安全。',
    '待打的幺九牌四枚可见包含自家这张，单凭它见尽不能排除对手缺这张的国士单骑。用牌形排除国士时只能引用visible-exclusion证据中kokushi.excludedByFullyVisible所指的另一种必需牌；没有该证据就不作这种排除。',
    '输出前核对summary、reasons、limitations中的动作、牌名、对象与数值是否一致。先说可验证的动作效果，例如“打出后维持听牌，这张对下家是现物”。牌效、安全或打点证据可以支持解释，不能证明引擎为何选它。取舍无法确定时，在limitations简述具体缺口；不编引擎Q值、胜率、放铳率或内部动机。',
    '防守说明以当前问题和可核对证据为准。当前问题未问防守，且没有相关的已确认安全依据时，summary、reasons、limitations全部省略安全评述，直接解释可核对的牌形、效率或打点。风险结论只限具体牌、对手、时点和依据；有无安全证据及有无人立直，都不能说明引擎是否考虑防守或如何加权。',
    '按当前问题取最相关的依据，用中文牌名和玩家方位答复。程序事实卡可直接引用。只有本轮实际取得工具结果时才可据此说明，面向玩家无需展示工具名。',
    '用简短自然的简体中文回答当前问题。只输出JSON {"limitations":[],"summary":"简短解释","reasons":["可核查的依据或取舍"]}。先写limitations，即使没有限制也必须输出"limitations":[]；没有理由时写"reasons":[]。三个字段都必填，数组只能填字符串，不用null。不输出动作字段、Markdown或额外文字。'
  ].join('\n');
  const automaticPrompt = '\n自动教学的动作摘要和已核实的安全说明由程序生成。你的summary只简短写出一条可核对的牌形或效率结论。reasons和limitations专注于牌形、效率、打点及相关限制，省略摸切／手切的复述。需要点名所弃牌时用actionTransition.discardedTile.name；selfDrawnTile表示本巡摸入牌，只有冻结动作明确打出它时才可说已打出。涉及对子时，只用弃后sameTileGroups中count为2的牌种，并与孤张分开。';

  const followUpPrompt = [
    '',
    '这是对当前冻结局面的追问。只回答用户问到的内容。若只问防守，只讨论问题点名的牌和对手。summary先给结论，reasons给一至两条直接证据，limitations只保留影响该结论的限制。向听、进张、进攻牌形和打点留给明确询问它们的问题。防守所需的等待形状可以说明。',
    '问的是已选弃牌时，从facts.explanationFocus.discard.safetyByOpponent按玩家方位读wording、evidenceGapWording和sujiReferenceWording。问其他牌时查其风险证据。无须列出整条牌河。可见牌排除国士时要讲清是哪张其他必需牌四枚可见。用中文表达依据，无需展示内部字段名。'
  ].join('\n');

  function composeAutomatic(explanation, facts) {
    const transition = facts?.actionTransition;
    const discard = facts?.explanationFocus?.discard;
    let summary = explanation.summary;
    if (facts?.selectedAction?.action?.type === 'dahai' && transition?.status === 'available') {
      const method = { 'drawn-tile': '摸切', 'hand-tile': '手切' }[transition.discardMethod] ?? '打出';
      const action = `引擎选择${method}${transition.discardedTile.name}`;
      summary = `${[action, transition.shantenWording].filter(Boolean).join('，')}。`;
    }
    if (!discard || discard.status !== 'available') return { ...explanation, summary };

    // Keep free-form defense claims out of automatic discard teaching. One
    // sentence may mix defense and shape claims, so we drop it as a unit.
    const defenseTerms = /安全|防守|放[铳銃]|现物|避铳|危[险險]|立直后.{0,8}通过|筋壁|筋[、与和或]壁|(?:无人|无任何家|均未|均无|没有人)立直/;
    const withoutDefense = text => text.split('\n').map(line => (line.match(/[^。！？]+[。！？]?/g) ?? [])
      .filter(sentence => !defenseTerms.test(sentence)).join('').trim()).filter(Boolean).join('\n');
    const reasons = explanation.reasons.map(withoutDefense).filter(Boolean);
    const confirmed = discard.safetyByOpponent.filter(o => o.status === 'confirmed').flatMap(o => o.wording);
    const withEvidence = confirmed.length ? [...reasons.slice(0, 7), `${confirmed.join('。')}。`] : reasons;
    return { ...explanation, summary: withoutDefense(summary) || '以下为当前局面的教学说明。',
      reasons: withEvidence, limitations: explanation.limitations.map(withoutDefense).filter(Boolean) };
  }
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
  const repairPrompt = '只修正上条回答的JSON结构。如果含有额外的"reasons_note":null，删掉这一字段，不添加或转述它。先写 "limitations":[]；上条已有适用的限制就填入数组。按此结构返回完整对象：{"limitations":[],"summary":"原摘要","reasons":[]}。保留有效的摘要、理由和限制；summary须非空，reasons与limitations须是字符串数组。不要重新分析、补造内容、换动作或调用工具。只输出这三个字段，不加Markdown或额外文字。';
  const formatError = message => Object.assign(new Error(message), { canRepairOutput: true });
  function parse(content) {
    let value; try { value = JSON.parse(content); } catch (_) { throw formatError('解释未返回有效 JSON。'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('解释合同要求 JSON 对象。');
    const extraKeys = Object.keys(value).filter(k => !['summary', 'reasons', 'limitations'].includes(k));
    if (extraKeys.length === 1 && extraKeys[0] === 'reasons_note' && value.reasons_note === null) {
      throw formatError('解释包含多余的空说明字段 reasons_note。');
    }
    if (extraKeys.length) throw new Error('解释合同不接受动作或首选字段，也不接受未知字段。');
    const texts = (items, max) => {
      if (!Array.isArray(items) || items.length > max || items.some(t => typeof t !== 'string' || !t.trim() || t.length > 1000)) throw formatError('解释文本结构无效：reasons与limitations为必填字符串数组。');
      return items.slice();
    };
    if (typeof value.summary !== 'string' || !value.summary.trim() || value.summary.length > 1000) throw formatError('解释摘要无效。');
    return { summary: value.summary, reasons: texts(value.reasons, 8), limitations: texts(value.limitations, 8), promptVersion: PROMPT_VERSION };
  }
  const api = { parse, prompt, automaticPrompt, followUpPrompt, composeAutomatic, repairPrompt, forModel, PROMPT_VERSION };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MJEngineExplanation = api;
})(globalThis);
