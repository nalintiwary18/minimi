import { describe, expect, it } from "vitest";
import {
  validateFacts,
  compareFacts,
  followUpQueries,
  snapshot,
  uncoveredPricing,
  type EvidenceAssessment,
} from "../src/lib/agent/evidence";
import type { ObservedFact, Source, Turn } from "../src/lib/types";
const quote = "AtlasCRM Pro: 25 USD per user per month, billed annually.";
const source: Source = {
  id: "S1",
  title: "AtlasCRM pricing",
  url: "https://atlas.example/pricing",
  excerpt: quote,
  fetchedAt: "2026-11-03T10:00:00Z",
};
const candidate: EvidenceAssessment["facts"][number] = {
  vendor: "AtlasCRM",
  plan: "Pro",
  kind: "price",
  value: "25",
  currency: "USD",
  billingPeriod: "month",
  billingBasis: "seat",
  commitment: "annual",
  sourceId: "S1",
  quote,
  effectiveAt: null,
};
const assessment: EvidenceAssessment = {
  entities: ["AtlasCRM"],
  facts: [candidate],
  gaps: [],
};
const before = validateFacts(assessment, [source]).facts[0];
const old: Turn = {
  id: "old",
  session_id: "session",
  question: "CRM shortlist",
  answer: "AtlasCRM Pro",
  created_at: source.fetchedAt,
  timezone: "UTC",
  sources: [source],
  status: "complete",
  memory: { version: 1, entities: ["AtlasCRM"], facts: [before] },
};
const now: ObservedFact = {
  ...before,
  value: "30",
  quote: quote.replace("25", "30"),
  observedAt: "2026-11-11T10:00:00Z",
};
describe("evidence contracts", () => {
  it("binds a literal quote to the server-provided URL and observation date", () => {
    expect(before).toMatchObject({
      sourceUrl: source.url,
      observedAt: source.fetchedAt,
    });
    expect(validateFacts(assessment, [source]).rejected).toEqual([]);
  });
  it.each([
    { quote: "A fabricated exact quote" },
    { sourceId: "S99" },
    { value: "30" },
    { plan: "Enterprise" },
    { currency: "EUR" as const },
    { billingBasis: "team" as const },
    { commitment: "monthly" as const },
    { effectiveAt: "2026-11-11" },
  ])("rejects unsupported fields: %j", (change) => {
    expect(
      validateFacts({ ...assessment, facts: [{ ...candidate, ...change }] }, [
        source,
      ]).facts,
    ).toHaveLength(0);
  });
  it("does not assume $ means USD", () => {
    const ambiguous = quote.replace("25 USD", "$25");
    expect(
      validateFacts(
        { ...assessment, facts: [{ ...candidate, quote: ambiguous }] },
        [{ ...source, excerpt: ambiguous }],
      ).facts,
    ).toHaveLength(0);
  });
  it("does not match 25 inside 250", () => {
    const inflated = quote.replace("25", "250");
    expect(
      validateFacts(
        { ...assessment, facts: [{ ...candidate, quote: inflated }] },
        [{ ...source, excerpt: inflated }],
      ).facts,
    ).toHaveLength(0);
  });
  it("audits unextracted prices even within an otherwise cited source", () => {
    expect(
      uncoveredPricing(
        "AtlasCRM",
        [{ ...source, excerpt: quote + " Alternative price: 35 USD." }],
        [before],
      ),
    ).toBe(true);
    expect(
      uncoveredPricing(
        "AtlasCRM",
        [source, { ...source, id: "S2", url: "https://atlas.example/terms" }],
        [before],
      ),
    ).toBe(false);
  });
  it("compares consistent observations without inventing an effective date", () => {
    expect(compareFacts([old], [now])[0]).toMatchObject({
      status: "changed-observation",
      before: { value: "25" },
      now: { value: "30", effectiveAt: null },
    });
  });
  it("matching samples are not proof of no change", () => {
    expect(compareFacts([old], [{ ...now, value: "25" }])[0].status).toBe(
      "same-observation",
    );
  });
  it.each([
    { commitment: "monthly" as const },
    { currency: "EUR" as const },
    { billingBasis: "team" as const },
    { commitment: null },
    { billingPeriod: "year" as const },
  ])("doesn't compare different or missing terms: %j", (change) => {
    expect(compareFacts([old], [{ ...now, ...change }])[0].status).toBe(
      "incomparable",
    );
  });
  it("refuses legacy unverified baselines and conflicting current prices", () => {
    expect(compareFacts([{ ...old, memory: undefined }], [now])[0].status).toBe(
      "unverified",
    );
    expect(
      compareFacts([old], [now, { ...now, value: "40", sourceId: "S2" }])[0]
        .status,
    ).toBe("conflicting");
  });
  it("never uses future observations as a historical baseline", () => {
    expect(
      compareFacts(
        [
          {
            ...old,
            memory: {
              ...old.memory!,
              facts: [{ ...before, observedAt: "2026-12-01T00:00:00Z" }],
            },
          },
        ],
        [now],
      )[0].status,
    ).toBe("unverified");
  });
  it("validates an explicit written date without inferring a missing year", () => {
    const dated = quote + " Effective November 10, 2026.";
    expect(
      validateFacts(
        {
          ...assessment,
          facts: [{ ...candidate, quote: dated, effectiveAt: "2026-11-10" }],
        },
        [{ ...source, excerpt: dated }],
      ).facts,
    ).toHaveLength(1);
    const bare = quote + " Effective November 10.";
    expect(
      validateFacts(
        {
          ...assessment,
          facts: [{ ...candidate, quote: bare, effectiveAt: "2026-11-10" }],
        },
        [{ ...source, excerpt: bare }],
      ).facts,
    ).toHaveLength(0);
  });
  it("doesn't compare a scheduled future price as a current price", () => {
    expect(
      compareFacts([old], [{ ...now, effectiveAt: "2027-01-01" }]),
    ).toHaveLength(0);
    expect(
      compareFacts(
        [old],
        [now, { ...now, value: "99", effectiveAt: "2027-01-01" }],
      )[0].status,
    ).toBe("changed-observation");
  });
  it("limits follow-ups to three new queries", () => {
    const gaps = Array.from({ length: 8 }, (_, i) => ({
      vendor: `CRM${i}`,
      reason: "missing terms",
      query: `CRM${i} official pricing`,
    }));
    expect(
      followUpQueries({ ...assessment, gaps }, [], [gaps[0].query]),
    ).toEqual(gaps.slice(1, 4).map((g) => g.query));
  });
  it("retains only mentioned entities, preserving the separate fact ledger", () => {
    expect(
      snapshot(["AtlasCRM", "OtherCRM"], [before], "Use AtlasCRM"),
    ).toEqual({ version: 1, entities: ["AtlasCRM"], facts: [before] });
  });
});
