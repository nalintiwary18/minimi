import { history, ownedSession } from "@/lib/server/db";
import { ownerId } from "@/lib/server/identity";
import { z } from "zod";
export const runtime = "nodejs";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const id = z.uuid().parse((await context.params).id);
    const owner = await ownerId();
    await ownedSession(owner, id);
    return Response.json({ turns: await history(owner, id) });
  } catch {
    return Response.json(
      { error: "Unable to load this conversation." },
      { status: 404 },
    );
  }
}
