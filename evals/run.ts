import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { runAgent } from "../src/lib/agent/graph";
import { cases, NOW } from "./dataset";
import type { Turn } from "../src/lib/types";
import { modelSettings, required } from "../src/lib/server/config";
import { citationIds } from "../src/lib/citations";

const selected = process.argv
  .find((arg) => arg.startsWith("--case="))
  ?.slice(7);
const targets = selected ? cases.filter((c) => c.id === selected) : cases;
if (!targets.length) throw new Error(`Unknown case: ${selected}`);
const model = modelSettings();
required(model.keyName);
const db = new PGlite();
const owner = randomUUID();
const results: Record<string, unknown>[] = [];
try {
  await db.exec(
    "create role anon; create role authenticated; create role service_role;",
  );
  for (const migration of ["001_memory.sql", "002_structured_memory.sql"])
    await db.exec(
      await readFile(
        new URL(`../supabase/migrations/${migration}`, import.meta.url),
        "utf8",
      ),
    );
  for (const test of targets) {
    await db.query("delete from sessions where owner_id=$1", [owner]);
    const session = randomUUID();
    await db.query("insert into sessions(id,owner_id) values($1,$2)", [
      session,
      owner,
    ]);
    for (const turn of test.history)
      await db.query(
        "insert into turns(id,owner_id,session_id,request_id,question,answer,timezone,created_at,status,sources,memory) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [
          randomUUID(),
          owner,
          session,
          randomUUID(),
          turn.question,
          turn.answer,
          turn.timezone,
          turn.created_at,
          turn.status,
          JSON.stringify(turn.sources),
          JSON.stringify(
            turn.memory || { version: 1, entities: [], facts: [] },
          ),
        ],
      );
    const started = performance.now();
    let firstTokenMs: number | null = null;
    console.log(`Running ${test.id}`);
    try {
      const result = await runAgent(
        {
          owner,
          question: test.question,
          timezone: "UTC",
          recent: [],
          now: new Date(NOW),
        },
        (event) => {
          if (event.type === "token" && event.text && firstTokenMs === null)
            firstTokenMs = performance.now() - started;
          if (event.type === "status" && event.text.includes("Retrying"))
            console.log(event.text);
        },
        AbortSignal.timeout(110000),
        {
          retrieve: async (id, query, start, end) =>
            (
              await db.query<Turn>(
                "select * from recall_turns($1,$2,$3,$4,16)",
                [id, query, start || null, end || null],
              )
            ).rows.map((t) => JSON.parse(JSON.stringify(t)) as Turn),
          search: test.search,
        },
      );
      const normalizedAnswer = result.answer.replace(/[‘’]/g, "'");
      const checks: { dimension: string; name: string; pass: boolean }[] =
        test.assertions.map((a) => ({
          dimension: a.dimension,
          name: a.name,
          pass:
            new RegExp(a.pattern, "i").test(normalizedAnswer) !== !!a.absent,
        }));
      const ids = citationIds(result.answer);
      checks.push({
        dimension: "evidence",
        name: "citation IDs exist and searched answers cite evidence",
        pass:
          ids.every((id) => result.sources.some((s) => s.id === id)) &&
          (!result.sources.length || ids.length > 0),
      });
      if (test.id === "targeted-follow-up")
        checks.push({
          dimension: "evidence",
          name: "targeted follow-up fills missing commitment",
          pass:
            result.trace.followUps.length > 0 &&
            result.snapshot.facts.some((f) => f.commitment === "annual"),
        });
      const row = {
        id: test.id,
        completed: true,
        firstTokenMs,
        totalMs: performance.now() - started,
        checks,
        answer: result.answer,
        snapshot: result.snapshot,
        sources: result.sources,
        trace: result.trace,
      };
      results.push(row);
      console.log(
        `${checks.filter((c) => c.pass).length}/${checks.length} assertions, ${(Number(firstTokenMs) / 1000).toFixed(1)}s first token`,
      );
    } catch (error) {
      results.push({
        id: test.id,
        completed: false,
        firstTokenMs,
        totalMs: performance.now() - started,
        error: error instanceof Error ? error.message : "unknown",
        checks: test.assertions.map((a) => ({
          dimension: a.dimension,
          name: a.name,
          pass: false,
        })),
      });
      console.log(
        `${test.id} failed: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }
} finally {
  await db.close();
}
const scores: Record<string, { passed: number; total: number }> = {};
for (const row of results)
  for (const check of row.checks as { dimension: string; pass: boolean }[]) {
    const score = (scores[check.dimension] ||= { passed: 0, total: 0 });
    score.total++;
    if (check.pass) score.passed++;
  }
const percentile = (key: string, p: number) => {
  const values = results
    .filter((r) => r.completed && typeof r[key] === "number")
    .map((r) => Number(r[key]))
    .sort((a, b) => a - b);
  return values.length
    ? Math.round(values[Math.max(0, Math.ceil(values.length * p) - 1)])
    : null;
};
const report = {
  datasetVersion: 2,
  ranAt: new Date().toISOString(),
  clock: NOW,
  model: model.model,
  provider: model.provider,
  mode: `real ${model.label}, recorded web, real local PostgreSQL`,
  completed: results.filter((r) => r.completed).length,
  count: results.length,
  scores,
  latencyMs: {
    firstTokenP50: percentile("firstTokenMs", 0.5),
    firstTokenP95: percentile("firstTokenMs", 0.95),
    totalP50: percentile("totalMs", 0.5),
    totalP95: percentile("totalMs", 0.95),
  },
  results,
};
await writeFile(
  new URL("latest-report.json", import.meta.url),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify(
    {
      completed: report.completed,
      count: report.count,
      scores,
      latencyMs: report.latencyMs,
    },
    null,
    2,
  ),
);
if (
  results.some(
    (r) =>
      !r.completed || (r.checks as { pass: boolean }[]).some((c) => !c.pass),
  )
)
  process.exitCode = 1;
