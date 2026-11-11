import { createClient } from "@supabase/supabase-js";
import { createHmac, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { DateTime } from "luxon";

for (const key of [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SESSION_SECRET",
]) {
  if (!process.env[key])
    throw new Error(`Missing ${key}; fill in .env.local first.`);
}
const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);
const owner = randomUUID();
const signature = createHmac("sha256", process.env.SESSION_SECRET)
  .update(owner)
  .digest("hex");
const base = process.env.EVAL_BASE_URL || "http://localhost:3000";
const headers = {
  "Content-Type": "application/json",
  Cookie: `recall_owner=${owner}.${signature}`,
  Origin: new URL(base).origin,
};
const now = DateTime.now().setZone("Asia/Kolkata");
const tuesday = now.minus({ days: (now.weekday - 2 + 7) % 7 || 7 });
const monday = now.minus({ days: (now.weekday - 1 + 7) % 7 || 7 });
const november = DateTime.fromObject(
  { year: now.year, month: 11, day: 3, hour: 12 },
  { zone: now.zoneName },
);
const novemberPast = november > now ? november.minus({ years: 1 }) : november;
const fixtures = [
  {
    date: monday,
    question: "Shortlist 5 CRM tools for a 20-person sales team.",
    answer:
      "Shortlist: HubSpot, Salesforce, Pipedrive, Zoho CRM, and Freshsales. Compare per-seat billing and implementation effort for 20 users.",
  },
  {
    date: novemberPast,
    question:
      "Does Supabase include PostgreSQL hosting? What should I consider?",
    answer:
      "Supabase hosts PostgreSQL. Evaluate compute, backups, connection limits and monthly spend.",
  },
  {
    date: tuesday,
    question:
      "Compare Postgres hosting from Neon and Supabase. What does pricing depend on?",
    answer:
      "Compare Neon and Supabase. Pricing depends on compute size, storage and usage. This synthetic baseline has no verified dollar amount.",
  },
];
const report = [];
try {
  const { data: session, error } = await db
    .from("sessions")
    .insert({ owner_id: owner, title: "Temporal fixtures" })
    .select("id")
    .single();
  if (error) throw error;
  const inserted = await db.from("turns").insert(
    fixtures.map((f) => ({
      owner_id: owner,
      session_id: session.id,
      request_id: randomUUID(),
      question: f.question,
      answer: f.answer,
      timezone: "Asia/Kolkata",
      status: "complete",
      created_at: f.date.toUTC().toISO(),
      sources: [],
    })),
  );
  if (inserted.error) throw inserted.error;
  const cases = [
    {
      question: `On ${monday.toFormat("d LLLL yyyy")} we shortlisted 5 CRM tools for a 20-person sales team. Has any changed pricing or shipped something big since?`,
      vendors: ["HubSpot", "Salesforce", "Pipedrive", "Zoho", "Freshsales"],
    },
    {
      question: `What did I ask you on 3 November ${novemberPast.year}? Is your answer still correct today?`,
      vendors: ["Supabase"],
    },
    {
      question:
        "Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?",
      vendors: ["Neon", "Supabase"],
    },
    {
      question: "Which flight did I ask you to book in 2020?",
      vendors: [],
      missing: true,
    },
  ];
  for (const test of cases) {
    const created = await fetch(`${base}/api/sessions`, {
      method: "POST",
      headers,
    });
    const body = await created.json();
    if (!created.ok) throw new Error(body.error);
    const start = performance.now();
    let firstTokenMs = null;
    let answer = "";
    let sources = [];
    let completed = false;
    const response = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        sessionId: body.session.id,
        requestId: randomUUID(),
        question: test.question,
        timezone: "Asia/Kolkata",
      }),
    });
    if (!response.ok) throw new Error((await response.json()).error);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const event = JSON.parse(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
        if (event.type === "token") {
          firstTokenMs ??= Math.round(performance.now() - start);
          answer += event.text;
        }
        if (event.type === "sources") sources = event.sources;
        if (event.type === "done") completed = true;
        if (event.type === "error") answer += `\nERROR: ${event.text}`;
      }
      if (chunk.done) break;
    }
    const ids = new Set(sources.map((s) => s.id));
    const citations = [...answer.matchAll(/[\[【](S\d+)[\]】]/g)].map(
      (m) => m[1],
    );
    const result = {
      question: test.question,
      firstTokenMs,
      totalMs: Math.round(performance.now() - start),
      completed,
      answer,
      sources,
      checks: {
        vendorsRecalled: test.vendors.every((v) =>
          answer.toLowerCase().includes(v.toLowerCase()),
        ),
        knownCitationIds: citations.every((id) => ids.has(id)),
        missingHistoryAcknowledged: test.missing
          ? /couldn't find|cannot find|can't find|no (saved|record)|don't have|do not have|not.*saved/i.test(
              answer,
            )
          : null,
      },
    };
    report.push(result);
    console.log(JSON.stringify(result, null, 2));
  }
  await writeFile("evals/latest-report.json", JSON.stringify(report, null, 2));
} finally {
  const cleanup = await db.from("sessions").delete().eq("owner_id", owner);
  if (cleanup.error)
    console.error("Fixture cleanup failed:", cleanup.error.message);
}
