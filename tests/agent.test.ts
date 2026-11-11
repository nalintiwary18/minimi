import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  plan: vi.fn(),
  assess: vi.fn(),
  retrieve: vi.fn(),
  search: vi.fn(),
  answerContexts: [] as unknown[],
}));
vi.mock("../src/lib/server/db", () => ({ retrieve: mocks.retrieve }));
vi.mock("../src/lib/agent/search", () => ({
  makeWebSearch: () => ({ invoke: mocks.search }),
}));
vi.mock("@langchain/groq", () => ({
  ChatGroq: class {
    withStructuredOutput(_schema: unknown, options: { name: string }) {
      return {
        invoke:
          options.name === "evidence_assessment" ? mocks.assess : mocks.plan,
      };
    }
    async *stream(messages: unknown[]) {
      mocks.answerContexts.push(messages);
      yield { content: "Answer " };
      yield { content: "[S1]" };
    }
  },
}));
import { runAgent, formatMemory } from "../src/lib/agent/graph";
import type { StreamEvent, Turn } from "../src/lib/types";
const old: Turn = {
  id: "old",
  session_id: "session",
  question: "Compare Neon and Supabase pricing",
  answer: "Neon was $19 per month",
  created_at: "2026-11-03T10:00:00Z",
  timezone: "UTC",
  sources: [],
  status: "complete",
};
const input = {
  owner: "owner",
  question: "Has their pricing changed?",
  timezone: "UTC",
  recent: [] as Turn[],
  now: new Date("2026-11-11T08:00:00Z"),
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.answerContexts.length = 0;
  process.env.GROQ_API_KEY = "test";
  mocks.retrieve.mockResolvedValue([]);
  mocks.search.mockResolvedValue([]);
  mocks.assess.mockResolvedValue({ entities: [], facts: [], gaps: [] });
  mocks.plan.mockResolvedValue({
    memoryQuery: "",
    queries: [],
    clarification: null,
  });
});
describe("agent orchestration", () => {
  it("skips paid web search for pure recall", async () => {
    const events: StreamEvent[] = [];
    const result = await runAgent(
      input,
      (e) => events.push(e),
      new AbortController().signal,
    );
    expect(mocks.search).not.toHaveBeenCalled();
    expect(result.answer).toBe("Answer [S1]");
    expect(events.filter((e) => e.type === "token")).toHaveLength(2);
  });
  it("replans after recovering a baseline before searching", async () => {
    mocks.retrieve
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([old]);
    mocks.plan
      .mockResolvedValueOnce({
        memoryQuery: "Neon Supabase",
        queries: [],
        clarification: "Which vendors?",
      })
      .mockResolvedValueOnce({
        memoryQuery: "",
        queries: ["Neon official pricing", "Supabase official pricing"],
        clarification: null,
      });
    mocks.search.mockResolvedValue([
      {
        title: "Pricing",
        url: "https://example.com/pricing",
        excerpt: "Current price",
        fetchedAt: "2026-11-11T08:00:00Z",
      },
    ]);
    const result = await runAgent(
      input,
      () => {},
      new AbortController().signal,
    );
    expect(mocks.plan).toHaveBeenCalledTimes(2);
    expect(mocks.search).toHaveBeenCalledTimes(2);
    expect(result.memory).toContainEqual(old);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].id).toBe("S1");
  });
  it("keeps failures explicit rather than claiming nothing changed", async () => {
    mocks.plan.mockResolvedValue({
      memoryQuery: "",
      queries: ["Neon pricing"],
      clarification: null,
    });
    mocks.search.mockRejectedValue(new Error("timeout"));
    const result = await runAgent(
      input,
      () => {},
      new AbortController().signal,
    );
    expect(result.failures).toEqual([
      "Search failed: Neon pricing. Its claims remain unverified.",
    ]);
    expect(result.sources).toEqual([]);
  });
  it("runs one bounded follow-up round and keeps citation IDs stable", async () => {
    mocks.plan.mockResolvedValue({
      memoryQuery: "",
      queries: ["AtlasCRM pricing"],
      clarification: null,
    });
    mocks.search
      .mockResolvedValueOnce([
        {
          title: "AtlasCRM",
          url: "https://atlas.example/pricing",
          excerpt: "Incomplete terms",
          fetchedAt: input.now.toISOString(),
        },
      ])
      .mockResolvedValueOnce([
        {
          title: "AtlasCRM",
          url: "https://atlas.example/terms",
          excerpt: "Full billing terms",
          fetchedAt: input.now.toISOString(),
        },
      ]);
    const gaps = [
      {
        vendor: "AtlasCRM",
        reason: "missing billing terms",
        query: "AtlasCRM official billing terms",
      },
    ];
    mocks.assess.mockResolvedValue({ entities: ["AtlasCRM"], facts: [], gaps });
    const result = await runAgent(
      input,
      () => {},
      new AbortController().signal,
    );
    expect(mocks.search.mock.calls.length).toBeLessThanOrEqual(4);
    expect(mocks.assess).toHaveBeenCalledTimes(2);
    expect(result.trace.followUps).toContain(gaps[0].query);
    expect(result.trace.followUps.length).toBeLessThanOrEqual(3);
    expect(result.sources.map((s) => s.id)).toEqual(["S1", "S2"]);
    expect(result.trace.gaps).toContain("AtlasCRM: missing billing terms");
  });
  it("preserves structured vendor names and facts beyond shortened prose", () => {
    const memory = {
      version: 1 as const,
      entities: ["AtlasCRM", "LumenCRM", "OrbitCRM", "CedarCRM", "MangoCRM"],
      facts: [],
    };
    expect(
      formatMemory([{ ...old, answer: "details ".repeat(5000), memory }])[0]
        .structured,
    ).toEqual(memory);
  });
  it("renders dated recall from the actual stored question without model paraphrasing", async () => {
    mocks.retrieve.mockResolvedValue([old]);
    const result = await runAgent(
      { ...input, question: "What did I ask on 3 November?" },
      () => {},
      new AbortController().signal,
    );
    expect(result.answer).toContain(old.question);
    expect(result.answer).toContain("2026-11-03");
    expect(mocks.answerContexts).toHaveLength(0);
    expect(mocks.plan).not.toHaveBeenCalled();
  });
  it("skips planning for one dated structured shortlist, searching every vendor", async () => {
    mocks.retrieve.mockResolvedValue([
      {
        ...old,
        created_at: "2026-11-09T10:00:00Z",
        memory: { version: 1, entities: ["AtlasCRM", "LumenCRM"], facts: [] },
      },
    ]);
    const result = await runAgent(
      {
        ...input,
        question: "On Monday we shortlisted CRM tools. Has pricing changed?",
      },
      () => {},
      new AbortController().signal,
    );
    expect(mocks.plan).not.toHaveBeenCalled();
    expect(mocks.search.mock.calls.map((call) => call[0].query)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("AtlasCRM"),
        expect.stringContaining("LumenCRM"),
      ]),
    );
    expect(result.answer).toContain("cannot verify a current price");
  });
  it("does not search invented vendors when clarification is needed", async () => {
    mocks.plan.mockResolvedValue({
      memoryQuery: "",
      queries: ["CRM pricing"],
      clarification: "Which five CRM tools?",
    });
    const result = await runAgent(
      input,
      () => {},
      new AbortController().signal,
    );
    expect(mocks.search).not.toHaveBeenCalled();
    expect(result.answer).toBe("Which five CRM tools?");
    expect(mocks.answerContexts).toHaveLength(0);
  });
  it("falls back to recent saved history when conversational wording has no text-search hit", async () => {
    mocks.retrieve.mockResolvedValueOnce([]).mockResolvedValueOnce([old]);
    const result = await runAgent(
      input,
      () => {},
      new AbortController().signal,
    );
    expect(mocks.retrieve).toHaveBeenNthCalledWith(2, "owner", "");
    expect(result.memory).toContainEqual(old);
    expect(JSON.stringify(mocks.answerContexts)).toContain(old.question);
  });
  it("keeps all emphasized vendor names even when the saved comparison is excerpted", () => {
    const long = {
      ...old,
      answer:
        "**HubSpot** " +
        "details ".repeat(5000) +
        " **Salesforce** **Close** **Freshsales** **Pipeline CRM**",
    };
    const memory = formatMemory([long, old]);
    expect(memory[0].emphasizedText).toEqual([
      "HubSpot",
      "Salesforce",
      "Close",
      "Freshsales",
      "Pipeline CRM",
    ]);
    expect(memory[0].truncated).toBe(true);
  });
});
