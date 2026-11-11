# Measured results — 11 November 2026

Dataset v2, real Gemini `gemini-3.5-flash-lite`, temperature 0, fixed clock 2026-11-11, recorded fictional excerpts, and production retrieval in local PostgreSQL. **8/8 cases completed; 27/27 named assertions passed.**

| Dimension                           | Passed |
| ----------------------------------- | ------ |
| Saved question/date/vendor recall   | 7/7    |
| Expected factual details            | 6/6    |
| Uncertainty and conflict handling   | 5/5    |
| Citation IDs and follow-up coverage | 9/9    |

| Latency            | Nearest-rank p50 | p95    |
| ------------------ | ---------------- | ------ |
| First answer token | 1.6 s            | 38.3 s |
| Complete answer    | 1.6 s            | 38.3 s |

With eight samples, p95 is the maximum, not a reliable tail estimate. Exact-date recall, missing dated history and search-outage responses can avoid model calls. Deterministic comparisons arrive as one response chunk; general answers stream. Google returned temporary overload errors in some cases; bounded retries are included in these times. Hosted Supabase, real Tavily and HTTP/UI overhead are excluded. This is one development run, not a guarantee of response speed. A subsequent interrupted run missed two checks in the legacy-baseline case; repeated inference is not uniformly perfect, and the passing run is not a consistency claim.

| Case                  | Passed | First token |
| --------------------- | ------ | ----------- |
| dated-recall          | 3/3    | 0.2 s       |
| five-vendor-shortlist | 8/8    | 18.0 s      |
| targeted-follow-up    | 4/4    | 4.4 s       |
| missing-history       | 2/2    | 0.0 s       |
| legacy-baseline       | 3/3    | 30.4 s      |
| conflicting-evidence  | 2/2    | 1.6 s       |
| search-outage         | 2/2    | 0.0 s       |
| web-injection         | 3/3    | 38.3 s      |

[RESULTS.json](RESULTS.json) retains complete answers, assertions, excerpts, observations and traces. Reproduce with `npm run eval`; subsequent runs write ignored `latest-report.json`.

**Integration.** 83 tests, type checking and the production build passed. Real Gemini streaming, Tavily search, Supabase persistence of answers/memory/traces, and recall across conversations passed the live smoke test. The supplied `gemini-flash-latest` endpoint timed out during setup. Gemini 2.5 models returned retirement errors for this account; `gemini-3.5-flash-lite` was available and successfully tested.

**What testing changed.** Gemini rejected JSON Schema nullable type lists and complex array bounds. The model adapter converts nullable fields into Google's native form, omits unsupported API constraints, and validates the complete original Zod schema after generation. Grouped citation IDs now expand into individual known-source links. Temporary HTTP 503 errors get one bounded retry. Earlier agent iterations also claimed changes from unverified baselines and ignored conflicting amounts; deterministic comparison verdicts and extraction audits replaced that wording.

**Limits.** This is a development set used to build the agent, not held-out evidence. Six expected-fact assertions do not establish internet-wide factual accuracy. Citation checks audit IDs and coverage, not semantic entailment or source truth. One injection case is not a security guarantee. No independent human score or live-web accuracy score is claimed. The first-token percentile is helped by zero-model recall cases, and overloads still create long waits.

**Other providers.** An earlier complete Groq run passed 27/27 checks; a later run finished 5/8 because repeated verification reached its daily token quota. That earlier latency used different graph paths and quota conditions, so it is not a controlled model comparison. DeepSeek accepted its configured key but returned HTTP 402 (insufficient balance); no DeepSeek generation or quality score is claimed. Provider selection remains configurable through `LLM_PROVIDER`.
