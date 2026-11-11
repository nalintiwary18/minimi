import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  result: {
    data: { id: "turn" } as { id: string } | null,
    error: null as { message: string } | null,
  },
  selected: false,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: () => {
      // PostgREST mutations return null data unless a return selection is requested.
      const query = {
        update: () => query,
        eq: () => query,
        select: () => {
          mock.selected = true;
          return query;
        },
        single: async () => mock.result,
        then: (resolve: (value: unknown) => void) =>
          resolve(mock.selected ? mock.result : { data: null, error: null }),
      };
      return query;
    },
  }),
}));
import { finishTurn } from "../src/lib/server/db";
beforeEach(() => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
  mock.selected = false;
  mock.result = { data: { id: "turn" }, error: null };
});
describe("durable completion", () => {
  it("requires returned proof of persistence before accepting completion", async () => {
    await expect(
      finishTurn("owner", "turn", "Answer", [], "complete"),
    ).resolves.toBeUndefined();
    expect(mock.selected).toBe(true);
  });
  it("fails completion if the pending row was not saved", async () => {
    mock.result = { data: null, error: null };
    await expect(
      finishTurn("owner", "turn", "Answer", [], "complete"),
    ).rejects.toThrow("no data");
  });
});
