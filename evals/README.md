# Temporal evaluation

Run `npm run eval` against the app with real credentials. It uses a separate workspace, inserts synthetic historical answers, cleans up its sessions, and writes `evals/latest-report.json` (gitignored). Baselines are fixtures, not verified vendor prices.

Review answers on five dimensions, scoring 0–2 each:

1. **Memory:** correct question, date, vendors and constraints; no invented history.
2. **Comparison:** saved answer vs current facts; consistent plans, currency, billing interval and team size.
3. **Evidence:** official pricing and dated announcements; citations actually support claims.
4. **Calibration:** separates changed, currently verified, and unverified. Current price alone does not establish a change date.
5. **Conversation:** clear, concise, with focused clarification when necessary.

Measure total latency separately from first answer token latency. Status events do not count. Inspect linked pages: search excerpts can be incomplete. Test injected instructions in excerpts, provider timeouts and rate limits. Failures are not evidence of "no changes".

Compare model configurations using identical fixtures and multiple runs. The runner checks basic recall and citation IDs; it cannot assess factuality, completeness, source entailment, or injection resistance. Unit tests cover failure wiring; live evaluation covers provider behavior.
