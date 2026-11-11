# Recall

Next.js + LangGraph + Groq + Supabase, with **one external tool: web search**.

## Run locally

Requires Node.js 22.17+ and npm. Create a Supabase project and run [the migration](supabase/migrations/001_memory.sql) in its SQL Editor. Copy `.env.example` to `.env.local`, then fill in:

| Variable | Where to get it |
| --- | --- |
| `GROQ_API_KEY` | [Groq Console](https://console.groq.com/keys) |
| `GROQ_MODEL` | Default: `openai/gpt-oss-120b`; choose a Groq chat model with tool calling |
| `TAVILY_API_KEY` | [Tavily](https://app.tavily.com/) |
| `SUPABASE_URL` | Supabase project settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project settings → API → service role secret |
| `SESSION_SECRET` | Random secret of at least 32 characters; command in `.env.example` |

```sh
npm install
npm run dev
```

Open [localhost:3000](http://localhost:3000). Without credentials, the interface loads and explains the missing setup. Paid chat requires configured providers. Never commit `.env.local` or share the service-role key. The UI uses your browser timezone.

## Folder structure

```text
src/
  app/                 Pages and thin HTTP routes
    api/chat/          Streaming admission and persistence
    api/sessions/      Owner-scoped conversation endpoints
  components/          Chat interface, markdown, evidence links
  lib/
    agent/             LangGraph, prompts, dates, sole search tool
    server/            Supabase repository, identity, configuration
    types.ts           Shared stream and storage contracts
supabase/migrations/   Tables, indexes, RLS, transactional admission
tests/                 Dates, orchestration, search, SQL contracts
evals/                 Factual-quality rubric
scripts/               Optional live evaluation runner
DESIGN.md              One-page architecture and tradeoffs
```

## Check it

```sh
npm run typecheck
npm test
npm run build
```

Tests use mocked providers and local PostgreSQL WASM. No API keys needed. For live examples, start the app with valid credentials, then run `npm run eval`. This makes paid provider calls, seeds an isolated workspace, prints answers and checks, saves a local report, and deletes fixture sessions. Review sources and change claims against `evals/README.md`; automatic checks cannot establish truth.

`npm run check:connections` checks the three providers. `npm run test:live` checks a greeting, web search, durable storage, and recall across conversations in a disposable workspace. Both use real credentials and provider calls. The live smoke test passed on 11 November 2026 with Groq's `openai/gpt-oss-120b`; this is functional verification, not a factual-quality benchmark.

## Memory and limits

Memory survives restarts and spans conversations in the same browser. Clearing cookies creates a new workspace. Stored UTC timestamps and turn timezones support “on 3 November” and “last Tuesday.” Historical answers are baselines to recheck, not trusted current facts. Failed questions are saved too. The history display shows the latest 100 turns; agent recall and excerpts have context budgets.

Before public hosting, add Supabase Auth, account quotas, retention/deletion, and deployment-specific origin/proxy configuration. Per-owner throttling is not distributed abuse protection. No live quality or latency benchmark has been measured.

## Submission

Repository: [nalintiwary18/minimi](https://github.com/nalintiwary18/minimi). Submit that repository URL through [the application form](https://binary.so/YIrD8L5). The architecture and tradeoffs are described in `DESIGN.md`.
