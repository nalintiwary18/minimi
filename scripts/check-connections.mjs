import { createClient } from "@supabase/supabase-js";
import { modelSettings, required } from "../src/lib/server/config.ts";
const model = modelSettings();

const client = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const checks = await Promise.allSettled([
  (async () => {
    const result = await client
      .from("turns")
      .select("id,memory,trace")
      .limit(1);
    return {
      provider: "Supabase",
      status: result.status,
      ready: !result.error,
      errorCode: result.error?.code,
    };
  })(),
  (async () => {
    const response = await fetch(model.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${required(model.keyName)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model.model,
        messages: [{ role: "user", content: "Reply with OK only." }],
        max_tokens: 64,
      }),
      signal: AbortSignal.timeout(20000),
    });
    return {
      provider: model.label,
      status: response.status,
      ready: response.ok,
    };
  })(),
  (async () => {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query: "PostgreSQL official documentation",
        max_results: 1,
        search_depth: "basic",
      }),
      signal: AbortSignal.timeout(20000),
    });
    return { provider: "Tavily", status: response.status, ready: response.ok };
  })(),
]);
for (const check of checks)
  console.log(
    JSON.stringify(
      check.status === "fulfilled"
        ? check.value
        : { ready: false, error: "Connection timed out or failed" },
    ),
  );
