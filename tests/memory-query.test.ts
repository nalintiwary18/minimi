import { describe, expect, it } from "vitest";
import { memorySearchQuery } from "../src/lib/agent/memory-query";
describe("conversational memory queries", () => {
  it("finds topics instead of requiring the follow-up's exact wording", () => {
    expect(memorySearchQuery("What CRM tools did we shortlist earlier?")).toBe(
      "CRM OR shortlist",
    );
  });
  it("uses recent history when no topic is given", () => {
    expect(memorySearchQuery("What did I ask you earlier?")).toBe("");
  });
});
