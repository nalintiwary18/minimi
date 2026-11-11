import { describe, expect, it } from "vitest";
import { renderComparison } from "../src/lib/agent/comparison";
import type { ObservedFact, Turn } from "../src/lib/types";
const fact: ObservedFact = {
  vendor: "AtlasCRM",
  plan: "Pro",
  kind: "price",
  value: "25",
  currency: "USD",
  billingPeriod: "month",
  billingBasis: "seat",
  commitment: "annual",
  quote: "AtlasCRM Pro 25 USD per user per month billed annually",
  sourceId: "S1",
  sourceUrl: "https://atlas.example/pricing",
  observedAt: "2026-11-09T10:00:00Z",
  effectiveAt: null,
};
const turn: Turn = {
  id: "baseline",
  session_id: "old",
  question: "CRM shortlist",
  answer: "AtlasCRM",
  created_at: fact.observedAt,
  timezone: "UTC",
  status: "complete",
  sources: [],
  memory: { version: 1, entities: ["AtlasCRM"], facts: [fact] },
};
const now = { ...fact, value: "30", observedAt: "2026-11-11T10:00:00Z" };
describe("deterministic comparison wording", () => {
  it("renders only bounded observation differences with exact stored dates", () => {
    const answer = renderComparison([turn], [now], ["AtlasCRM Pro"]);
    expect(answer).toContain("25 → 30 USD");
    expect(answer).toContain("2026-11-09 and 2026-11-11");
    expect(answer).toContain("exact change date is unknown");
    expect(answer.match(/\*\*AtlasCRM/g)).toHaveLength(1);
  });
  it("cannot turn legacy prose into a confident change claim", () => {
    expect(
      renderComparison([{ ...turn, memory: undefined }], [now], ["AtlasCRM"]),
    ).toContain("no source-backed historical baseline");
  });
  it("does not equate matching samples with no changes", () => {
    expect(
      renderComparison([turn], [{ ...now, value: "25" }], ["AtlasCRM"]),
    ).toContain("does not rule out changes");
  });
  it("refuses a verdict if a price passage was omitted by the extractor", () => {
    expect(
      renderComparison([turn], [now], ["AtlasCRM"], false, ["AtlasCRM"]),
    ).toContain("cannot rule out conflicting amounts");
  });
  it("reports both conflicting values instead of choosing one", () => {
    expect(
      renderComparison(
        [turn],
        [now, { ...now, value: "35", sourceId: "S2" }],
        ["AtlasCRM"],
      ),
    ).toContain("30 USD [S1] versus 35 USD [S2]");
  });
  it("no current evidence produces no current citation", () => {
    expect(renderComparison([turn], [], ["AtlasCRM"])).not.toContain("[S1]");
  });
});
