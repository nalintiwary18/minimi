import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
const db = new PGlite();
const owner = randomUUID(),
  otherOwner = randomUUID(),
  session = randomUUID();
beforeAll(async () => {
  await db.exec(
    "create role anon; create role authenticated; create role service_role;",
  );
  await db.exec(
    await readFile(
      new URL("../supabase/migrations/001_memory.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.exec(
    await readFile(
      new URL(
        "../supabase/migrations/002_structured_memory.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.query("insert into sessions(id,owner_id) values($1,$2)", [
    session,
    owner,
  ]);
}, 30000);
afterAll(() => db.close());
describe("PostgreSQL memory contract", () => {
  it("indexes entities that are absent from the prose", async () => {
    const sid = randomUUID();
    await db.query("insert into sessions(id,owner_id) values($1,$2)", [
      sid,
      owner,
    ]);
    await db.query(
      "insert into turns(owner_id,session_id,request_id,question,answer,timezone,status,memory) values($1,$2,$3,'Shortlist','Details omitted','UTC','complete',$4)",
      [
        owner,
        sid,
        randomUUID(),
        JSON.stringify({ version: 1, entities: ["AtlasCRM"], facts: [] }),
      ],
    );
    expect(
      (await db.query("select * from recall_turns($1,'AtlasCRM')", [owner]))
        .rows,
    ).toHaveLength(1);
    expect(
      (
        await db.query("select * from recall_turns($1,'AtlasCRM')", [
          otherOwner,
        ])
      ).rows,
    ).toHaveLength(0);
  });
  it("admits, saves and replays a request exactly once", async () => {
    const request = randomUUID();
    const params = [
      owner,
      session,
      "Compare Neon pricing",
      "Asia/Kolkata",
      request,
    ];
    const first = await db.query<{
      result: { created: boolean; turn: { id: string } };
    }>("select begin_turn($1,$2,$3,$4,$5) as result", params);
    expect(first.rows[0].result.created).toBe(true);
    const id = first.rows[0].result.turn.id;
    await db.query(
      "update turns set status='complete', answer='Baseline price' where id=$1",
      [id],
    );
    const retry = await db.query<{
      result: { created: boolean; turn: { id: string } };
    }>("select begin_turn($1,$2,$3,$4,$5) as result", params);
    expect(retry.rows[0].result).toMatchObject({
      created: false,
      turn: { id },
    });
    expect(
      (await db.query("select * from turns where request_id=$1", [request]))
        .rows,
    ).toHaveLength(1);
  });
  it("never retrieves another owner's history", async () => {
    expect(
      (await db.query("select * from recall_turns($1,'Neon')", [otherOwner]))
        .rows,
    ).toHaveLength(0);
    expect(
      (await db.query("select * from recall_turns($1,'Neon')", [owner])).rows,
    ).toHaveLength(1);
  });
  it("rejects cross-owner conversation writes", async () => {
    await expect(
      db.query("select begin_turn($1,$2,$3,$4,$5)", [
        otherOwner,
        session,
        "Question",
        "UTC",
        randomUUID(),
      ]),
    ).rejects.toThrow("Conversation not found");
  });
  it("uses half-open date windows and recalls failed questions", async () => {
    await db.query(
      "insert into turns(owner_id,session_id,request_id,question,timezone,status,created_at) values($1,$2,$3,'Failed Postgres question','Asia/Kolkata','error','2026-11-02T18:30:00Z')",
      [owner, session, randomUUID()],
    );
    const result = await db.query(
      "select * from recall_turns($1,'unrelated','2026-11-02T18:30:00Z','2026-11-03T18:30:00Z')",
      [owner],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      question: "Failed Postgres question",
      status: "error",
    });
    expect(
      (
        await db.query(
          "select * from recall_turns($1,'','2026-11-01T18:30:00Z','2026-11-02T18:30:00Z')",
          [owner],
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("rejects a second pending response and expires abandoned requests", async () => {
    const first = await db.query<{ result: { turn: { id: string } } }>(
      "select begin_turn($1,$2,$3,$4,$5) as result",
      [owner, session, "First", "UTC", randomUUID()],
    );
    await expect(
      db.query("select begin_turn($1,$2,$3,$4,$5)", [
        owner,
        session,
        "Second",
        "UTC",
        randomUUID(),
      ]),
    ).rejects.toThrow("already running");
    await db.query(
      "update turns set created_at=now()-interval '4 minutes' where id=$1",
      [first.rows[0].result.turn.id],
    );
    await expect(
      db.query("select begin_turn($1,$2,$3,$4,$5)", [
        owner,
        session,
        "Second",
        "UTC",
        randomUUID(),
      ]),
    ).resolves.toBeDefined();
  });
  it("denies anonymous table and function access", async () => {
    await db.exec("set role anon");
    try {
      await expect(db.query("select * from turns")).rejects.toThrow(
        "permission denied",
      );
      await expect(
        db.query("select * from recall_turns($1,'')", [owner]),
      ).rejects.toThrow("permission denied");
    } finally {
      await db.exec("reset role");
    }
  });
});
