/* Teaching text has no authority to select or mutate an engine action. */
(function (root) {
  'use strict';
  const PROMPT_VERSION = 4;
  const prompt = [
    '你是日式立直麻将教学解释器。引擎最终动作已通过本地校验，不得更换首选、鸣牌对象、实体用牌或立直配套弃牌。校验通过不代表战略最优；解释不是引擎内部思考。',
    '本次结构化数据统一使用snapshot牌编码：m/p/s为万/筒/索，1z至7z依次为东南西北白发中，0m/0p/0s为赤五，?为未知。引擎动作的pai和consumed已转换为同一编码，赤五与普通五不可互换。selfHand含已知新摸牌，不能再次追加selfDrawnTile。',
    '座位从0起；game.round.wind的0/1/2/3为东/南/西/北场，game.round.index为庄家座位。四麻自风依(selfSeat-庄家座位+4)%4对应东南西北；四麻相对座位(seat-selfSeat+4)%4的0/1/2/3为自家/下家/对家/上家。三麻相对方位按facts.seats，不套四麻公式；未知风位不补猜。身份未知时不补猜。game.doras是宝牌指示牌，不是宝牌本身。recentActor不表示当前轮到谁。',
    '只使用本次冻结snapshot和同一时点工具事实；历史建议与教学只用于承接，不是当前事实。未知手摸切、缺失或不连续的信息不能补猜，不读取未来或对手暗牌。',
    '按动作解释：dahai说明为何打出该牌，不把它误作要保留或避开的牌；reach说明立直取舍，只能使用已有followUp弃牌，缺失时不补造；chi/pon/daiminkan核对目标与实际consumed，不编造后续弃牌；ankan/kakan说明杠与补牌的取舍；none仅表示跳过当前响应，不等于弃和；hora按已有资格说明和牌，不自行编造役、番符或得点。',
    '由你根据教学价值决定是否比较备选；即使有多个合法候选，也不要求列出备选。选择明显或只需解释当前动作时可直接讲清理由。用户明确询问比较时，应回应所问；候选不合法或证据不足时如实说明，不能捏造替代动作。',
    '本次引擎数据的facts是与当前冻结snapshot绑定的确定性事实卡。facts.explanationFocus是程序生成的当前动作索引，优先核对其中的动作、弃前弃后数量、牌形关系、效率和安全证据；不复述整张卡，选一至三条最相关依据。已附计算可直接引用，缺项或有疑义时再查询工具。牌名同时给出code与中文name，字牌按name核对，不自行重译或混同风牌与三元牌。',
    'facts.handTileAvailability是手牌同种计数三列表，依columns读取rows：已见包含自家暗手，五含赤五，未见上界不是牌山实剩。直接引用程序数量；只有status为complete且已见4时才可说同种牌已全见，partial不作全场见尽断言，invalid/unavailable不推算缺失数量。hand和afterDiscard的counts只指自家暗手，弃后手里0张不等于全场见尽。未见上界0只表示没有未见的同种牌，不能据此否定已持有的对子或刻子、由其他牌完成的搭子，或该牌对特定对手的安全价值。',
    'shape列的是可能共用实体牌的可选局部组合，不能相加当作唯一完整拆分，也不能用一种拆分否定其他关系。单张不等于孤张，例如8索与9索可成89边搭，3筒可参与123顺子或35嵌张；三张同牌可成刻子。描述弃牌影响要对照弃前与弃后，已有对子、刻子、顺子不能说成没有。局部搭子的补牌信息只说明对应关系的完成牌；并用已有顺子与其中的搭子时先核对实体是否重叠，不能据此断言整手已完成或总体进张。',
    'summary也必须与reasons、当前手牌和场况一致。输出前按当前动作及所比较候选逐项核对数值：形状向听是程序计算值，未见进张枚数才是上界；当前弃牌与备选各用对应候选的向听、进张和弃后牌形，不把最佳效率候选的数值套到引擎首选。可选关系与效率排名不等于引擎选择动机。',
    '事实卡缺少所需效率数值时查询compare_discards，缺少风险依据时查询get_danger_evidence；不得编造或修改计算。效率候选与排序不等于引擎合法动作集合或偏好排名。未见枚数是上界，不等于牌山实剩；形状完成不等于有役可和，宝牌不能单独成役，完整役种、振听与计分未由牌效率工具验证。',
    '安全证据必须绑定对应玩家、牌种和当前时点：river表示该玩家本人牌河证据；riichi-passed表示已按立直声明、出牌与通过的完整时序核实的立直后通过证据，不能只凭副露或其他玩家打过认定现物。genbutsu=false仅表示本人牌河未找到，安全证据unknown或未列出座位也只表示未找到可确认的证据，不能推出不安全；已确认安全也只对证据所指玩家成立。筋、壁不保证安全。不要编造Q值、候选分数、胜率、放铳率或引擎内部动机。区分可核查事实与可能的取舍；无法用现有证据解释时明确不足，不为迎合引擎结论编理由。',
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
