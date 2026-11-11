# Measured results — 11 November 2026

Dataset v2, Groq `openai/gpt-oss-120b`, temperature 0, fixed clock 2026-11-11, recorded fictional web excerpts, real local PostgreSQL retrieval. One complete run; eight cases finished and **27/27 named assertions passed**.

| Dimension                           | Passed |
| ----------------------------------- | ------ |
| Saved question/date/vendor recall   | 7/7    |
| Expected factual details            | 6/6    |
| Uncertainty and conflict handling   | 5/5    |
| Citation IDs and follow-up coverage | 9/9    |

| Latency            | p50   | p95    |
| ------------------ | ----- | ------ |
| First answer token | 8.0 s | 28.9 s |
| Complete answer    | 8.0 s | 28.9 s |

The account's 8,000-TPM Groq tier caused visible rate-limit cooldowns. The longest case was the billing-term follow-up. These times include provider waits and graph work, but exclude hosted Supabase, live Tavily and HTTP/UI overhead. Deterministic comparisons arrive as one response chunk; ordinary answers stream. With only eight samples, p95 is the maximum, not a robust tail estimate.

| Case                       | Passed | First token |
| -------------------------- | ------ | ----------- |
| Dated recall               | 3/3    | 2.0 s       |
| Five-vendor shortlist      | 8/8    | 7.0 s       |
| Billing-term follow-up     | 4/4    | 28.9 s      |
| Missing history            | 2/2    | 8.0 s       |
| Legacy unverified baseline | 3/3    | 20.5 s      |
| Conflicting prices         | 2/2    | 25.6 s      |
| Search outage              | 2/2    | 3.2 s       |
| Web instructions injection | 3/3    | 17.9 s      |

[RESULTS.json](RESULTS.json) contains the complete answers, assertions, source quotes, observations and traces. Reproduce with `npm run eval`; new runs write ignored `latest-report.json`. Results vary with model output and quota state.

**What the evaluation changed.** The first implementation failed to handle null planner entities, claimed a price increase from an unverified old answer, ignored conflicting prices, and cited historical IDs as current sources during an outage. Price comparisons now use code-generated verdicts, extraction audits cover each requested vendor, and missing evidence blocks confident change claims. The runner also needed explicit timestamp serialization to match Supabase's JSON contract. Its follow-up fixture now uses recorded initial/follow-up rounds rather than fragile query-word matching.

**Limits.** Passing pattern checks is not 100% factual accuracy. The fact checks cover six explicit expectations, not every sentence; citation checks validate IDs and coverage, not semantic entailment. Injection is one case, not a security guarantee. This dataset informed implementation, so it is a development set, not held-out evidence. The raw report supports human inspection, but no independent human score or live-web accuracy score is claimed. The current latency is a real weakness under the free-tier quota.

**Final verification.** The production build and 73 tests passed. Real Tavily search, Supabase persistence of answers/memory/traces, and cross-conversation recall passed. A transient Supabase read failure during a later smoke run led to a bounded read retry; the next live run passed.

**Quota-limited later run.** Repeated live verification reached the key's 200,000-token daily Groq limit. The final attempted model run completed 5/8 cases; the remaining three failed with provider usage-limit responses and are not counted as passing. The table above reports the retained complete development run, not that incomplete attempt. Exact-date recall and unambiguous structured comparisons gained planning fast paths afterward; tests cover them, but new live latency is not claimed. Run the full suite again when quota is available before treating these as submission-ready benchmark results.
