import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cooldownMs,
  responseFailure,
  waitForProvider,
} from "../src/lib/agent/provider-errors";
afterEach(() => vi.useRealTimers());
describe("provider throttling", () => {
  it("retries a temporary service outage once and reports the provider", async () => {
    vi.useFakeTimers();
    const error = { status: 503 };
    const operation = vi.fn().mockRejectedValue(error);
    const result = waitForProvider(
      operation,
      new AbortController().signal,
      () => {},
    ).catch((e) => e);
    await vi.runAllTimersAsync();
    expect(await result).toEqual(error);
    expect(operation).toHaveBeenCalledTimes(2);
    expect(responseFailure(error, "Gemini")).toContain(
      "Gemini is temporarily unavailable",
    );
  });
  it("reports selected-provider access and credit failures", () => {
    expect(responseFailure({ status: 402 }, "DeepSeek")).toContain(
      "DeepSeek has insufficient credit",
    );
    expect(responseFailure({ status: 401 }, "DeepSeek")).toContain(
      "DeepSeek key",
    );
    expect(responseFailure({ status: 429 }, "DeepSeek")).toContain(
      "DeepSeek's usage limit",
    );
  });
  it("honors the real cooldown format reported by Groq", () => {
    expect(
      cooldownMs({
        message: "Rate limit reached. Please try again in 15.915s.",
      }),
    ).toBe(16215);
    expect(cooldownMs({ headers: new Headers({ "retry-after": "7" }) })).toBe(
      7300,
    );
  });
  it("waits before retrying a throttled request", async () => {
    vi.useFakeTimers();
    const operation = vi
      .fn()
      .mockRejectedValueOnce({ status: 429, headers: { "retry-after": "2" } })
      .mockResolvedValue("answer");
    const waiting = vi.fn();
    const promise = waitForProvider(
      operation,
      new AbortController().signal,
      waiting,
    );
    await vi.advanceTimersByTimeAsync(2000);
    expect(operation).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(await promise).toBe("answer");
    expect(waiting).toHaveBeenCalledWith(3);
  });
  it("stops bounded retries and reports usage limits accurately", async () => {
    vi.useFakeTimers();
    const error = { status: 429, message: "rate_limit_exceeded" };
    const operation = vi.fn().mockRejectedValue(error);
    const promise = waitForProvider(
      operation,
      new AbortController().signal,
      () => {},
    ).catch((e) => e);
    await vi.runAllTimersAsync();
    expect(await promise).toBe(error);
    expect(operation).toHaveBeenCalledTimes(3);
    expect(responseFailure(error)).toContain("Groq's usage limit");
    expect(responseFailure(error)).not.toContain("key");
  });
  it("does not retry rejected credentials", async () => {
    const operation = vi.fn().mockRejectedValue({ status: 401 });
    await expect(
      waitForProvider(operation, new AbortController().signal, () => {}),
    ).rejects.toMatchObject({ status: 401 });
    expect(operation).toHaveBeenCalledTimes(1);
  });
  it("cancels a cooldown immediately when the user stops", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const operation = vi.fn().mockRejectedValue({ status: 429 });
    const promise = waitForProvider(
      operation,
      controller.signal,
      () => {},
    ).catch((e) => e);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(new Error("Stopped"));
    expect(await promise).toEqual(new Error("Stopped"));
    expect(operation).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
