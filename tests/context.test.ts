import { describe, expect, it } from "vitest";
import { packContext } from "../src/lib/agent/context";
describe("prompt context budgets", () => {
  it("bounds large evidence without modifying stored text or the user's question", () => {
    const context = {
      question: "Has any pricing changed since Tuesday?",
      memory: [
        {
          question: "Compare five CRM vendors",
          answer: "Baseline pricing. ".repeat(1000),
          localDate: "2026-11-10",
        },
      ],
      currentSources: Array.from({ length: 30 }, (_, i) => ({
        id: `S${i + 1}`,
        title: "Official pricing",
        url: `https://vendor${i}.example/pricing`,
        excerpt: "Fresh public evidence. ".repeat(1000),
        fetchedAt: "2026-11-11T10:00:00Z",
      })),
    };
    const snapshot = structuredClone(context);
    const packed = packContext(context);
    expect(packed.length).toBeLessThanOrEqual(14500);
    expect(JSON.parse(packed).question).toBe(context.question);
    expect(JSON.parse(packed).memory[0].localDate).toBe("2026-11-10");
    expect(JSON.parse(packed).contextTruncated).toBe(true);
    expect(context).toEqual(snapshot);
    expect(
      JSON.parse(packed).currentSources.every((s: { id: string }) =>
        snapshot.currentSources.some((original) => original.id === s.id),
      ),
    ).toBe(true);
  });
  it("keeps small contexts complete", () => {
    const context = {
      question: "What did I ask yesterday?",
      memory: [
        {
          question: "Compare Postgres hosting",
          answer: "Neon and Supabase",
          localDate: "2026-11-10",
        },
      ],
    };
    expect(JSON.parse(packContext(context))).toEqual(context);
  });
});
