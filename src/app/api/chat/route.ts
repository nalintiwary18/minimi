import { z } from "zod";
import { beginTurn, finishTurn, history, ownedSession } from "@/lib/server/db";
import { checkOrigin, ownerId } from "@/lib/server/identity";
import { runAgent } from "@/lib/agent/graph";
import { validZone } from "@/lib/agent/time";
import { required } from "@/lib/server/config";
import { responseFailure } from "@/lib/agent/provider-errors";
import type { StreamEvent } from "@/lib/types";
export const runtime = "nodejs";
export const maxDuration = 120;
const Input = z.object({
  sessionId: z.uuid(),
  requestId: z.uuid(),
  question: z.string().trim().min(1).max(8000),
  timezone: z.string().max(80).refine(validZone),
});
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    if (Number(request.headers.get("content-length")) > 40000)
      return Response.json({ error: "Message too large." }, { status: 413 });
    const input = Input.parse(await request.json());
    required("GROQ_API_KEY");
    required("TAVILY_API_KEY");
    const owner = await ownerId();
    await ownedSession(owner, input.sessionId);
    const recent = await history(owner, input.sessionId);
    const { turn, created } = await beginTurn(
      owner,
      input.sessionId,
      input.question,
      input.timezone,
      input.requestId,
    );
    if (
      !created &&
      (turn.session_id !== input.sessionId || turn.question !== input.question)
    )
      return Response.json(
        { error: "Request ID was already used for a different message." },
        { status: 409 },
      );
    if (turn.status === "pending" && !created)
      return Response.json(
        { error: "This response is already running." },
        { status: 409 },
      );
    if (turn.status === "error")
      return Response.json(
        { error: "This request failed. Send it again with a new request ID." },
        { status: 409 },
      );
    const encoder = new TextEncoder();
    const controller = new AbortController();
    const signal = AbortSignal.any([
      request.signal,
      controller.signal,
      AbortSignal.timeout(110000),
    ]);
    let closed = false;
    const stream = new ReadableStream({
      async start(streamController) {
        const emit = (event: StreamEvent) => {
          if (!closed && !signal.aborted)
            streamController.enqueue(
              encoder.encode(JSON.stringify(event) + "\n"),
            );
        };
        try {
          if (turn.status === "complete") {
            emit({ type: "sources", sources: turn.sources });
            emit({ type: "token", text: turn.answer || "" });
          } else {
            const result = await runAgent(
              {
                owner,
                question: input.question,
                timezone: input.timezone,
                recent: recent.filter((t) => t.status === "complete"),
                now: new Date(turn.created_at),
              },
              emit,
              signal,
            );
            signal.throwIfAborted();
            await finishTurn(
              owner,
              turn.id,
              result.answer,
              result.sources,
              "complete",
              result.snapshot,
              result.trace,
            );
          }
          emit({ type: "done", turnId: turn.id });
        } catch (error) {
          console.error(
            "Agent failed:",
            error instanceof Error ? error.message : "unknown",
          );
          try {
            await finishTurn(owner, turn.id, "", [], "error");
          } catch {
            /* surfaced to server logs by DB wrapper */
          }
          emit({
            type: "error",
            text: responseFailure(error),
          });
        } finally {
          if (!closed) {
            streamController.close();
            closed = true;
          }
        }
      },
      cancel() {
        closed = true;
        controller.abort();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof z.ZodError
            ? "Invalid message or timezone."
            : error instanceof Error
              ? error.message
              : "Unable to start response.",
      },
      { status: 400 },
    );
  }
}
