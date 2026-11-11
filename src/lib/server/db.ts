import { createClient } from "@supabase/supabase-js";
import { required } from "./config";
import type {
  Session,
  Turn,
  Source,
  MemorySnapshot,
  ResearchTrace,
} from "../types";

function db() {
  return createClient(
    required("SUPABASE_URL"),
    required("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
function checked<T>(result: {
  data: T;
  error: { message: string } | null;
}): NonNullable<T> {
  if (result.error) {
    console.error("Database operation failed:", result.error.message);
    if (/already running/i.test(result.error.message))
      throw new Error("A response is already running. Try again shortly.");
    throw new Error("Database unavailable. Try again shortly.");
  }
  if (result.data === null) throw new Error("Database returned no data.");
  return result.data as NonNullable<T>;
}
export async function sessions(owner: string): Promise<Session[]> {
  return checked(
    await db()
      .from("sessions")
      .select("id,title,created_at")
      .eq("owner_id", owner)
      .order("created_at", { ascending: false })
      .limit(100),
  );
}
export async function createSession(
  owner: string,
  title = "New conversation",
): Promise<Session> {
  return checked(
    await db()
      .from("sessions")
      .insert({ owner_id: owner, title })
      .select("id,title,created_at")
      .single(),
  );
}
export async function ownedSession(owner: string, id: string) {
  const data = checked(
    await db()
      .from("sessions")
      .select("id")
      .eq("owner_id", owner)
      .eq("id", id)
      .maybeSingle(),
  );
  if (!data) throw new Error("Conversation not found.");
}
export async function history(owner: string, session: string): Promise<Turn[]> {
  return checked(
    await db()
      .from("turns")
      .select("*")
      .eq("owner_id", owner)
      .eq("session_id", session)
      .order("created_at", { ascending: false })
      .limit(100),
  ).reverse();
}
export async function retrieve(
  owner: string,
  query: string,
  start?: string,
  end?: string,
): Promise<Turn[]> {
  const read = () =>
    db()
      .rpc("recall_turns", {
        p_owner: owner,
        p_query: query,
        p_start: start ?? null,
        p_end: end ?? null,
        p_limit: 16,
      })
      .abortSignal(AbortSignal.timeout(8000));
  let result = await read();
  // A transport failure must not turn an available memory into invented history.
  // Retry this read once; never replay ambiguous writes here.
  if (
    result.error &&
    (/fetch failed|network|timeout|abort/i.test(result.error.message) ||
      result.status >= 500)
  ) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    result = await read();
  }
  return checked(result);
}
export async function beginTurn(
  owner: string,
  session: string,
  question: string,
  timezone: string,
  requestId: string,
): Promise<{ turn: Turn; created: boolean }> {
  return checked(
    await db().rpc("begin_turn", {
      p_owner: owner,
      p_session: session,
      p_question: question,
      p_timezone: timezone,
      p_request: requestId,
    }),
  );
}
export async function finishTurn(
  owner: string,
  id: string,
  answer: string,
  sources: Source[],
  status: "complete" | "error",
  memory?: MemorySnapshot,
  trace?: ResearchTrace,
) {
  checked(
    await db()
      .from("turns")
      .update({
        answer,
        sources,
        status,
        ...(memory ? { memory } : {}),
        ...(trace ? { trace } : {}),
      })
      .eq("owner_id", owner)
      .eq("id", id)
      .eq("status", "pending")
      .select("id")
      .single(),
  );
}
