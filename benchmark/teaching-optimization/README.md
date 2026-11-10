# S1/S2/S3 execution adapter

Experimental benchmark code; no production extension files are changed. `runtime-harness.cjs` runs the released Worker/Pi, parser, repair and tools with one whitelisted candidate transform. `runtime-eval.cjs` reuses verified engine caches and the original shared CNY50 ledger.

Prepare and verify without a paid request:

```powershell
node benchmark/teaching-optimization/runtime-eval.cjs prepare --source SOURCE_AB_BATCH --out NEW_BATCH
node benchmark/teaching-optimization/runtime-eval.cjs mock --out NEW_BATCH
node benchmark/teaching-optimization/readiness.cjs NEW_BATCH
```

`prepare` checks that the configured credential is resolvable, without printing it. `mock` never uses that credential or provider transport. It creates separate mock storage and blind packets; those must never be imported as real quality scores. `readiness` checks all 381 mock opportunities, chronology, immutable current facts, neutral blind evidence and the unchanged original budget. Source files, schedule, prompts, reviewer rules and adapter code are frozen in the new contract.

After the user instructs a paid start, execute once:

```powershell
node benchmark/teaching-optimization/runtime-eval.cjs run --out NEW_BATCH --confirm-paid true
```

This is a command-line safeguard against accidentally selecting paid mode, not an additional user approval requirement. `run` requires a matching passing readiness audit. Mock storage and real storage are separate, so real candidate histories start empty. Each real HTTP attempt, including tool continuation and format repair, passes through `openBudget`; no request is assumed free on failure. The original 25-second delivery criterion and single format repair remain unchanged. Live jobs are not automatically resumed or replayed after interruption: inspect durable logs and settle liability first.

Each candidate has all 127 nodes; candidate order rotates at each node, with per-round monotone positions and separate candidate histories. Only historical A/B reference results are reused; new candidate answers and scores are not synthesized from them. Blind packets remove teaching history, the compact table and the focus view; current neutral facts and actual tool evidence remain available. Real generation is followed by independent GPT-6.1 Sol / medium review through the existing review export/import contract. A generation summary has `scoringComplete: false` until that review and final aggregation have actually finished.

`prepare.cjs` is the earlier offline input-rehearsal utility, not the real runtime executor. It can inspect old contexts but its outputs must not serve as new candidate histories or answers.
