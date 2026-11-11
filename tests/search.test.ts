import { afterEach, describe, expect, it, vi } from "vitest";
import { makeWebSearch } from "../src/lib/agent/search";
afterEach(() => vi.unstubAllGlobals());
describe("web search adapter", () => {
  it("preserves provenance and returns tool data rather than generated search answers", async () => {
    process.env.TAVILY_API_KEY = "test";
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        results: [
          {
            title: "Vendor pricing",
            url: "https://vendor.example/pricing",
            content: "Plan costs $25 per seat monthly",
            published_date: "2026-11-10",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await makeWebSearch(new AbortController().signal).invoke({
      query: "vendor official pricing",
    });
    expect(result).toEqual([
      expect.objectContaining({
        url: "https://vendor.example/pricing",
        publishedAt: "2026-11-10",
        fetchedAt: expect.any(String),
      }),
    ]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).include_answer).toBe(
      false,
    );
  });
  it("rejects provider errors rather than returning an empty result", async () => {
    process.env.TAVILY_API_KEY = "test";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Rate limited", { status: 429 })),
    );
    await expect(
      makeWebSearch(new AbortController().signal).invoke({
        query: "vendor pricing",
      }),
    ).rejects.toThrow("429");
  });
});
