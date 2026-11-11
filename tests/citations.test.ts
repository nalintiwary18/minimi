import { describe, expect, it } from "vitest";
import { linkCitations } from "../src/lib/citations";
const sources = [
  {
    id: "S1",
    title: "PostgreSQL",
    url: "https://www.postgresql.org/",
    excerpt: "Official homepage",
    fetchedAt: "2026-11-11T10:00:00Z",
  },
];
describe("provider citation formats", () => {
  it("links normal and full-width brackets from live model responses", () => {
    expect(linkCitations("Database [S1]. Homepage【S1】.", sources)).toBe(
      "Database [S1](#source-S1). Homepage[S1](#source-S1).",
    );
  });
  it("does not link invented source IDs", () => {
    expect(linkCitations("Claim【S99】", sources)).toBe(
      "Claim[unverified citation]",
    );
  });
  it("leaves ordinary markdown intact", () => {
    expect(
      linkCitations(
        "**Database** [homepage](https://www.postgresql.org/)",
        sources,
      ),
    ).toBe("**Database** [homepage](https://www.postgresql.org/)");
  });
});
