# Repeatable temporal evaluation

Run `npm run eval` after configuring `GROQ_API_KEY` in `.env.local`. This makes paid Groq calls. It needs no running app, Tavily key or hosted Supabase database: web evidence and the clock are fixed, and local PostgreSQL runs the actual production migrations and retrieval function. It never reads or deletes your saved conversations.

`npm run eval -- --case=targeted-follow-up` selects one case. The same production graph accepts injected search/repository adapters only through server-side code, never HTTP parameters. The model is real, not mocked. `dataset.ts` is the versioned dataset and ground truth; fictional vendors and .example URLs prevent synthetic prices being mistaken for real ones.

Cases cover dated recall, a long five-vendor shortlist, incomplete billing terms requiring follow-up, missing history, a legacy unverified answer, conflicting prices, a search outage, and instructions hidden in a web excerpt.

The runner writes `latest-report.json` (ignored by Git), with:

- Per-case completion and named pass/fail assertions.
- Recall, expected-fact, uncertainty and citation/coverage scores.
- First answer token and total latency, p50/p95 over completed cases.
- Full answers, source excerpts, saved facts, queries, gaps and stage timings.

Failures count against scores; failed cases are excluded from latency percentiles and reported separately. A failing assertion or unfinished case gives a nonzero exit code. These transparent pattern checks measure specified behaviors. They do not prove every claim is true or every citation entails its sentence. Review the report manually; do not call the score general factual accuracy.

Human review (0–2 each): correct historical question/date/entities; consistent price units and baseline; source passage actually supports the claim; honest limits/conflicts; concise useful response. Inspect every additional price, inferred date, and unsupported “nothing changed” statement. Test held-out wording and multiple model runs before claiming broad quality.

`npm run test:live` requires a running app and all provider keys. It checks real search, owner-isolated cross-conversation recall, and persistence of answers, structured memory and traces, cleaning up only its own disposable workspace. `npm run check:connections` checks credentials and migration readiness. These are integration checks, not factual-quality scores. See `RESULTS.md` for measured runs and limitations.
