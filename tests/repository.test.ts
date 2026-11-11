import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  result: {
    data: { id: "turn" } as { id: string } | null,
    error: null as { message: string } | null,
  },
  selected: false,
  read: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: (name: string, params: unknown) => {
      mock.rpc(name, params);
      return { abortSignal: mock.read };
    },
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
import { finishTurn, retrieve } from "../src/lib/server/db";
beforeEach(() => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test";
  mock.selected = false;
  mock.result = { data: { id: "turn" }, error: null };
  mock.read.mockReset();
  mock.rpc.mockClear();
});
describe("bounded memory read retries", () => {
  it("retries a transient read with the same owner and date window", async () => {
    mock.read
      .mockResolvedValueOnce({
        data: null,
        error: { message: "TypeError: fetch failed" },
        status: 0,
      })
      .mockResolvedValueOnce({ data: [], error: null, status: 200 });
    await expect(
      retrieve("owner", "AtlasCRM", "2026-11-09", "2026-11-10"),
    ).resolves.toEqual([]);
    expect(mock.rpc.mock.calls[0]).toEqual(mock.rpc.mock.calls[1]);
    expect(mock.rpc).toHaveBeenCalledTimes(2);
  });
  it("stops after one retry instead of waiting indefinitely", async () => {
    mock.read.mockResolvedValue({
      data: null,
      error: { message: "fetch failed" },
      status: 0,
    });
    await expect(retrieve("owner", "CRM")).rejects.toThrow(
      "Database unavailable",
    );
    expect(mock.read).toHaveBeenCalledTimes(2);
  });
  it("does not retry a database permission error", async () => {
    mock.read.mockResolvedValue({
      data: null,
      error: { message: "permission denied" },
      status: 403,
    });
    await expect(retrieve("owner", "CRM")).rejects.toThrow(
      "Database unavailable",
    );
    expect(mock.read).toHaveBeenCalledTimes(1);
  });
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
