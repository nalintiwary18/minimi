import { compareFacts } from "./evidence";
import type { ObservedFact, Turn } from "../types";

export function isPriceComparison(question: string) {
  return (
    /pric(?:e|es|ing)|expensive|cost/i.test(question) &&
    /chang|since|when we|than (?:before|when)|still correct/i.test(question)
  );
}
export function canonicalVendor(name: string, entities: string[]) {
  return (
    entities.find((e) => name.toLowerCase() === e.toLowerCase()) ||
    entities
      .filter((e) => name.toLowerCase().startsWith(e.toLowerCase() + " "))
      .sort((a, b) => b.length - a.length)[0] ||
    name
  );
}
export function renderComparison(
  history: Turn[],
  facts: ObservedFact[],
  entities: string[],
  releases = false,
  uncovered: string[] = [],
) {
  const known = [
    ...new Set([
      ...history.flatMap((t) => t.memory?.entities || []),
      ...facts.map((f) => f.vendor),
    ]),
  ];
  const normalized = facts.map((f) => ({
    ...f,
    vendor: canonicalVendor(f.vendor, known),
  }));
  const comparisons = compareFacts(history, normalized);
  const vendors = [
    ...new Set([
      ...entities.map((e) => canonicalVendor(e, known)),
      ...normalized.map((f) => f.vendor),
    ]),
  ];
  const lines: string[] = [];
  for (const vendor of vendors) {
    const rows = comparisons.filter(
      (c) => c.vendor.toLowerCase() === vendor.toLowerCase(),
    );
    if (uncovered.some((e) => e.toLowerCase() === vendor.toLowerCase())) {
      lines.push(
        `**${vendor}:** Some pricing passages remain unverified. I cannot rule out conflicting amounts or establish a reliable price change.`,
      );
    } else if (!rows.length) {
      lines.push(
        `**${vendor}:** I cannot verify a current price from the available excerpts, so I cannot establish a change.`,
      );
    } else {
      // Prefer complete observations over incomplete duplicates of the same plan.
      const groups = new Map<string, typeof rows>();
      for (const row of rows)
        groups.set(row.plan || "", [
          ...(groups.get(row.plan || "") || []),
          row,
        ]);
      for (const group of groups.values()) {
        const row =
          group.find((r) => r.status === "conflicting") ||
          group.find((r) =>
            ["changed-observation", "same-observation"].includes(r.status),
          ) ||
          group[0];
        const label = `**${vendor}${row.plan ? ` ${row.plan}` : ""}:**`;
        const amount = `${row.now.value}${row.now.currency ? ` ${row.now.currency}` : " (currency unknown)"}`;
        const terms = `${row.now.billingBasis === "seat" ? "per user" : row.now.billingBasis === "team" ? "per team" : "unit unknown"}, ${row.now.billingPeriod ? `per ${row.now.billingPeriod}` : "billing period unknown"}, ${row.now.commitment ? `${row.now.commitment} billing` : "commitment unknown"}`;
        const cite = `[${row.now.sourceId}]`;
        if (row.status === "conflicting") {
          const alternatives = [
            ...new Map(group.map((r) => [r.now.value, r.now])).values(),
          ];
          lines.push(
            `${label} Sources conflict: ${alternatives.map((f) => `${f.value} ${f.currency || "(currency unknown)"} [${f.sourceId}]`).join(" versus ")}. I cannot establish a reliable price change.`,
          );
        } else if (row.status === "unverified") {
          lines.push(
            `${label} Current observed price: ${amount} (${terms}) ${cite}. I cannot establish a change because there is no source-backed historical baseline for this plan. A saved answer alone is unverified.`,
          );
        } else if (row.status === "incomparable") {
          lines.push(
            `${label} Current observed price: ${amount} (${terms}) ${cite}. The old and new billing terms differ or are incomplete, so I cannot compare them reliably.`,
          );
        } else {
          const before = row.before!;
          const dates = `${before.observedAt.slice(0, 10)} and ${row.now.observedAt.slice(0, 10)}`;
          lines.push(
            row.status === "changed-observation"
              ? `${label} Observed price differs: ${before.value} → ${amount} (${terms}) ${cite}. These are matching recorded billing terms sampled on ${dates}; the exact change date is unknown.`
              : `${label} Same sampled price: ${amount} (${terms}) ${cite}, on ${dates}. This does not rule out changes between the observations.`,
          );
        }
      }
    }
    if (releases) {
      const start = history.map((t) => t.created_at).sort()[0];
      const events = normalized.filter(
        (f) =>
          f.vendor === vendor &&
          f.kind === "release" &&
          f.effectiveAt &&
          start &&
          f.effectiveAt > start.slice(0, 10) &&
          f.effectiveAt <= f.observedAt.slice(0, 10),
      );
      lines.push(
        events.length
          ? events
              .map(
                (f) =>
                  `Dated release evidence: ${f.effectiveAt} — ${f.value} [${f.sourceId}].`,
              )
              .join("\n")
          : "I couldn't establish a major release since that conversation from dated evidence; missing results do not mean nothing shipped.",
      );
    }
  }
  return (
    lines.join("\n\n") +
    "\n\nThese observations do not establish region, tax treatment, or changes between checks. Historical quotes are saved records; citations refer to the current search."
  );
}
