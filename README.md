# Recall

Next.js + LangGraph + Groq, DeepSeek or Gemini + Supabase, with **one external tool: web search**.

## Run locally

Requires Node.js 22.17+ and npm. Create a Supabase project and run [001_memory.sql](supabase/migrations/001_memory.sql), then [002_structured_memory.sql](supabase/migrations/002_structured_memory.sql) in its SQL Editor. Existing projects only need 002; it preserves their history. Copy `.env.example` to `.env.local`, then fill in:

| Variable                    | Where to get it                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------- |
| `GROQ_API_KEY`              | [Groq Console](https://console.groq.com/keys)                                       |
| `GROQ_MODEL`                | Default: `openai/gpt-oss-120b`; choose a Groq chat model with tool calling          |
| `LLM_PROVIDER`              | `groq`, `deepseek` or `gemini`; only the selected provider needs a key              |
| `DEEPSEEK_API_KEY`          | [DeepSeek Platform](https://platform.deepseek.com/)                                 |
| `DEEPSEEK_MODEL`            | Default: `deepseek-flash`; configurable, including `deepseek-v4-pro` when available |
| `GEMINI_API_KEY`            | Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)          |
| `GEMINI_MODEL`              | Default: `gemini-3.5-flash-lite`; can be overridden with an available model         |
| `TAVILY_API_KEY`            | [Tavily](https://app.tavily.com/)                                                   |
| `SUPABASE_URL`              | Supabase project settings → API                                                     |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project settings → API → service role secret                               |
| `SESSION_SECRET`            | Random secret of at least 32 characters; command in `.env.example`                  |

```sh
npm install
npm run dev
```

Open [localhost:3000](http://localhost:3000). Without credentials, the interface loads and explains the missing setup. Paid chat requires configured providers. Never commit `.env.local` or share the service-role key. The UI uses your browser timezone.

For DeepSeek, set `LLM_PROVIDER=deepseek`, `DEEPSEEK_API_KEY`, and `DEEPSEEK_MODEL=deepseek-flash`. The same graph supports planning, evidence extraction and streaming with the selected provider. A DeepSeek key can be valid while chat returns HTTP 402: add credit in the provider account. Provider switching never adds another agent tool.

For Gemini, set `LLM_PROVIDER=gemini`, `GEMINI_API_KEY`, and `GEMINI_MODEL=gemini-3.5-flash-lite`. It uses Google's native API for structured outputs and streaming; web search still uses Tavily. `gemini-flash-latest` can also be selected, but timed out during setup. Gemini 2.5 models returned retirement errors for this account, so use an available model rather than assuming an older name still works.

## Folder structure

```text
src/
  app/                 Pages and thin HTTP routes
    api/chat/          Streaming admission and persistence
    api/sessions/      Owner-scoped conversation endpoints
  components/          Chat interface, markdown, evidence links
  lib/
    agent/             Graph, evidence validation, comparisons, dates, search
    server/            Supabase repository, identity, configuration
    types.ts           Shared stream and storage contracts
supabase/migrations/   Tables, indexes, RLS, transactional admission
tests/                 Dates, orchestration, search, SQL contracts
evals/                 Fixed dataset, scored runner, measured results, rubric
scripts/               Live integration and connection checks
DESIGN.md              One-page architecture and tradeoffs
```

## Check it

```sh
npm run typecheck
npm test
npm run build
```

Tests use mocked providers and local PostgreSQL WASM. No API keys needed. Run `npm run eval` with the selected provider's key for eight fixed temporal scenarios. It uses the production graph, recorded fictional web evidence, and local PostgreSQL; it never touches your saved conversations. It scores expected facts, recall, uncertainty and evidence checks, and reports first-token/total latency. Review [the evaluation guide](evals/README.md) and [measured results](evals/RESULTS.md); these narrow checks cannot establish general factual accuracy.

`npm run check:connections` checks the three providers and database migration readiness. With the app running, `npm run test:live` checks a greeting, real web search, persistence of answers/facts/traces, and recall across conversations in a disposable workspace. Both use real credentials and provider calls.

## Memory and limits

Memory survives restarts and spans conversations in the same browser. Clearing cookies creates a new workspace. Stored UTC timestamps and turn timezones support “on 3 November” and “last Tuesday.” Structured observations keep price fields and source quotes alongside original conversations; only compatible, source-backed observations produce price comparison verdicts. Old answer prose remains unverified. Failed questions are saved too. The history display shows the latest 100 turns; agent recall and excerpts have context budgets.

Before public hosting, add Supabase Auth, account quotas, retention/deletion, and deployment-specific origin/proxy configuration. Per-owner throttling is not distributed abuse protection. The fixed evaluation measures reasoning behavior and Groq latency; it does not measure live-web factual accuracy.
