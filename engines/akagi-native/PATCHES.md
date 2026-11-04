# 本地补丁说明（p1）

上游固定来源：shinkuan/Akagi commit `1fb16453ae0b7b0a820510ea1d3dbd01b6939082`；riichienv-core保持原始 crates.io `0.4.8`，没有改网络、编码、decoder、原始权重或crate源码。对应源码包 `UPSTREAM-FILES.json` 给出原始/本地SHA，`LOCAL.patch` 给出逐文件diff。

- `native_bot/Cargo.toml`、`src/lib.rs`：将 `defaults` 的两个 `include_bytes!` 移到明确的 `embedded-weights` feature，生产只使用 `infer`，权重经独立外部文件加载并核hash。
- `src/engine.rs`：保留原始 `feed`/`decide` 供语义对照，新增 wrapper 专用 `feed_checked`、`set_rule` 与审计snapshot。每请求reset；雀魂规则显式设置。错过荣和/无役和型使用一次性窗口记录，同巡振听在自摸/自家鸣牌解除、立直振听保留；不再用残留 `current_claims` 推断新窗口。公开杠→补牌维护嶺上，鸣牌取消首巡/一发，立直受理开启一发，弃牌结束本人一发。首巡资格维护不改变上游训练时的 `turn_count` 特征，后者仍由固定上游重放实现决定。
- `src/chankan.rs`：读取临时/立直振听；按雀魂规则补暗杠国士抢杠窗口（仅国士和型，其他暗杠不开放）。保持固定core live弃牌清嶺上上下文的行为；不凭尚无可靠依据的规则猜测另改河底资格。
- 外层 `src/main.rs`：版本化私有JSONL，stdout仅协议；外载模型SHA，启动真实forward；每请求reset/座位/严格完整重放。数字start_game.id显式转字符串；kakan的consumed规范为已验证旧碰的实体顺序（与上游返回的三张multiset一致），只是动作字段映射，不换候选；立直配套弃牌取上游clone预测并按真实drawn entity标摸切。尾随reach_accepted和非决策/待补牌拒绝；None必须证明legal mask全零且位于他家公开响应点才映射none；自家缺动作失败。未知事件/字段拒绝；忽略表仅已校验的匿名names/id及kakan.consumed（core表示不含此字段）。
- 本地数值/语义测试 `src/stage0_tests.rs`；上游 `tests/parity.rs`、`tests/engine_replay.rs` 与engine内权重测试改为显式环境变量外载。三麻外权重用例明确ignore。旧 `missed_agari_flags_are_ignored_by_design` characterization改为 `missed_agari_flags_block_the_window`，这是本地规则修复，与未改上游行为差异单独记录。

内部分布仍保留上游按动作ID去重、普通五优先和立直配套失败时去除reach的decoder策略。本项目桥接不重排/补选替代候选。logit/softmax不是胜率或思考过程。动作最终仍须由 EngineAgent 按当前授权快照的实体手牌/响应阶段/振听及同一步雀魂和牌资格校验；九种九牌、拔北或未支持动作明确拒绝。
