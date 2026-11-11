export function isRateLimit(error: unknown) {
  const value = error as { status?: number; message?: string };
  return (
    value?.status === 429 ||
    /rate_limit_exceeded|rate limit reached/i.test(value?.message || "")
  );
}

export function cooldownMs(error: unknown, now = Date.now()) {
  const value = error as {
    headers?: Headers | Record<string, string>;
    message?: string;
  };
  const header =
    value?.headers instanceof Headers
      ? value.headers.get("retry-after")
      : value?.headers?.["retry-after"];
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(1000, seconds * 1000 + 300);
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(1000, date - now + 300);
  }
  const match = value?.message?.match(/try again in\s+([\d.]+)s/i);
  return match ? Math.ceil(Number(match[1]) * 1000) + 300 : 5000;
}

export async function waitForProvider<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
  onWait: (seconds: number) => void,
) {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      return await operation();
    } catch (error) {
      const delay = cooldownMs(error);
      if (!isRateLimit(error) || attempt >= 2 || delay > 30000) throw error;
      onWait(Math.ceil(delay / 1000));
      await new Promise<void>((resolve, reject) => {
        const aborted = () => {
          clearTimeout(timer);
          reject(signal.reason);
        };
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", aborted);
          resolve();
        }, delay);
        signal.addEventListener("abort", aborted, { once: true });
        if (signal.aborted) aborted();
      });
    }
  }
}

export function responseFailure(error: unknown) {
  if (isRateLimit(error))
    return "Groq's usage limit was reached. Wait about a minute, then send your question again. Your question is saved.";
  const value = error as { status?: number; message?: string };
  if (value?.status === 401 || value?.status === 403)
    return "The model provider rejected access. Check the Groq key. Your question is saved.";
  if (/abort|timeout/i.test(value?.message || ""))
    return "The response timed out. Try again with a shorter question. Your question is saved.";
  return "The response could not finish. Please try again. Your question is saved.";
}
