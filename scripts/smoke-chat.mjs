import { createClient } from "@supabase/supabase-js";
import { createHmac, randomUUID } from "node:crypto";

const owner = randomUUID();
const signature = createHmac("sha256", process.env.SESSION_SECRET)
  .update(owner)
  .digest("hex");
const base = "http://localhost:3000";
const headers = {
  "Content-Type": "application/json",
  Cookie: `recall_owner=${owner}.${signature}`,
  Origin: base,
};
const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
async function newSession() {
  const response = await fetch(`${base}/api/sessions`, {
    method: "POST",
    headers,
  });
  if (!response.ok)
    throw new Error(`Session creation failed: ${response.status}`);
  return (await response.json()).session.id;
}
async function chat(sessionId, question) {
  const start = performance.now();
  const response = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      sessionId,
      requestId: randomUUID(),
      question,
      timezone: "Asia/Kolkata",
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`Chat failed: ${response.status}`);
  let answer = "",
    sources = [],
    complete = false,
    firstTokenMs;
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const chunk = await reader.read();
    buffer += decoder.decode(chunk.value, { stream: !chunk.done });
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const event = JSON.parse(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
      if (event.type === "token") {
        answer += event.text;
        firstTokenMs ??= Math.round(performance.now() - start);
      }
      if (event.type === "sources") sources = event.sources;
      if (event.type === "done") complete = true;
      if (event.type === "error") throw new Error(event.text);
    }
    if (chunk.done) break;
  }
  if (!complete) throw new Error("Completion event missing.");
  const persisted = await db
    .from("turns")
    .select("status,answer")
    .eq("owner_id", owner)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  if (
    persisted.error ||
    persisted.data.status !== "complete" ||
    persisted.data.answer !== answer
  )
    throw new Error("Persistence mismatch.");
  console.log(
    JSON.stringify({
      question,
      answer,
      sourceCount: sources.length,
      firstTokenMs,
      totalMs: Math.round(performance.now() - start),
      persisted: true,
    }),
  );
  return { answer, sources };
}
try {
  const session = await newSession();
  await chat(session, "Hi. Reply in one short sentence.");
  const research = await chat(
    session,
    "Search the web for PostgreSQL's official homepage. What is PostgreSQL? Cite your source.",
  );
  if (!research.sources.length)
    throw new Error("Requested web search produced no sources.");
  const recall = await chat(
    await newSession(),
    "What did I ask you about PostgreSQL earlier?",
  );
  if (!/PostgreSQL|official homepage/i.test(recall.answer))
    throw new Error("Cross-conversation recall failed.");
} finally {
  const result = await db.from("sessions").delete().eq("owner_id", owner);
  if (result.error) console.error("Test workspace cleanup failed.");
}
