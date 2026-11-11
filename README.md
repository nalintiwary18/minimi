# Recall

A chat agent with one external tool: **web search**. Built with Next.js, LangGraph and Supabase, with Groq, DeepSeek or Gemini for inference. See [DESIGN.md](DESIGN.md) for the architecture and tradeoffs.

## Run locally

Requires Node.js 22.17+ and npm.

1. Create a Supabase project. Run [001_memory.sql](supabase/migrations/001_memory.sql), then [002_structured_memory.sql](supabase/migrations/002_structured_memory.sql) in its SQL Editor. Projects that already have 001 only need 002, which preserves history.
2. Copy [.env.example](.env.example) to `.env.local`. Set `LLM_PROVIDER` and its API key, the Tavily key, Supabase URL and server secret, and a random `SESSION_SECRET`. The example lists every setting and key required. Only the selected model provider needs a key.
3. Install and start:

```sh
npm install
npm run dev
```

Open [localhost:3000](http://localhost:3000). Credentials stay on the server. `.env.local` is ignored by Git. Dates use the browser's timezone.

## Code layout

```text
src/
  app/                 Pages and thin streaming HTTP routes
  components/          Chat interface, progress, markdown and citations
  lib/agent/           Graph, memory retrieval, evidence, comparisons and search
  lib/server/          Supabase repository, identity and configuration
supabase/migrations/   Schema, indexes, RLS and transactional admission
tests/                 Behavior and database contract tests
evals/                 Dataset, runner, live integration check and results
```

## Verify

```sh
npm run typecheck
npm test
npm run build
```

These checks need no API keys. `npm run eval` uses the selected real model, fixed fictional web evidence and local PostgreSQL to score recall, expected facts, uncertainty, evidence coverage and latency. It makes paid model calls but never accesses saved conversations. See the [evaluation guide](evals/README.md) and [measured results](evals/RESULTS.md) for the checks and their limits.

With the app running and credentials configured, `npm run test:live` checks real search, persisted answers/facts/traces and recall across conversations in a disposable workspace.

## Memory and deployment limits

Memory survives restarts and spans conversations in the same browser. Clearing cookies creates a new workspace. Stored timestamps and timezones support questions such as “on 3 November” and “last Tuesday.” Price observations include source quotes, units and dates; comparisons require compatible, source-backed facts. Older answer prose remains unverified, and failed questions are saved. The history display shows the latest 100 turns; retrieval has context budgets.

Before public hosting, add account authentication, distributed quotas, retention/deletion and deployment-specific origin/proxy configuration. The evaluation measures a small set of reasoning behaviors; it does not establish live-web factual accuracy.
