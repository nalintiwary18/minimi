import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  plan: vi.fn(),
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
    withStructuredOutput() {
      return { invoke: mocks.plan };
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
  vi.clearAllMocks();
  mocks.answerContexts.length = 0;
  process.env.GROQ_API_KEY = "test";
  mocks.retrieve.mockResolvedValue([]);
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
  it("does not search invented vendors when clarification is needed", async () => {
    mocks.plan.mockResolvedValue({
      memoryQuery: "",
      queries: ["CRM pricing"],
      clarification: "Which five CRM tools?",
    });
    await runAgent(input, () => {}, new AbortController().signal);
    expect(mocks.search).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.answerContexts)).toContain(
      "Which five CRM tools?",
    );
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
