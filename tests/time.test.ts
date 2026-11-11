import { describe, expect, it } from "vitest";
import { timeContext, validZone } from "../src/lib/agent/time";
describe("historical dates", () => {
  const now = new Date("2026-11-11T08:00:00Z");
  it("resolves last Tuesday in the user's timezone", () => {
    const result = timeContext(
      "Last Tuesday I asked you about Postgres hosting",
      "Asia/Kolkata",
      now,
    );
    expect(result.mentionedDate).toBe("2026-11-10");
    expect(result.start).toBe("2026-11-09T18:30:00.000Z");
    expect(result.end).toBe("2026-11-10T18:30:00.000Z");
  });
  it("resolves a bare historical calendar date", () => {
    expect(
      timeContext("What did I ask you on 3 November?", "Asia/Kolkata", now)
        .mentionedDate,
    ).toBe("2026-11-03");
  });
  it("uses the local date at a UTC midnight boundary", () => {
    expect(
      timeContext(
        "What did I ask yesterday?",
        "Asia/Kolkata",
        new Date("2026-11-10T20:00:00Z"),
      ).mentionedDate,
    ).toBe("2026-11-10");
  });
  it("preserves explicit years", () => {
    expect(
      timeContext("What did I ask on 3 November 2025?", "UTC", now)
        .mentionedDate,
    ).toBe("2025-11-03");
  });
  it("handles a daylight-saving day as a local calendar day", () => {
    const result = timeContext(
      "What did I ask on November 1, 2026?",
      "America/New_York",
      now,
    );
    expect(Date.parse(result.end!) - Date.parse(result.start!)).toBe(
      25 * 60 * 60 * 1000,
    );
  });
  it("does not invent a date for topic questions", () => {
    expect(
      timeContext("Compare Postgres hosting", "UTC", now).start,
    ).toBeUndefined();
    expect(validZone("invalid/zone")).toBe(false);
  });
});
