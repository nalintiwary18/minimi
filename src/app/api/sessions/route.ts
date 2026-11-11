import { createSession, sessions } from "@/lib/server/db";
import { checkOrigin, ownerId } from "@/lib/server/identity";
export const runtime = "nodejs";
export async function GET() {
  try {
    return Response.json({ sessions: await sessions(await ownerId()) });
  } catch (e) {
    return Response.json(
      {
        error: e instanceof Error ? e.message : "Unable to load conversations.",
      },
      { status: 503 },
    );
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    return Response.json({ session: await createSession(await ownerId()) });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof Error ? e.message : "Unable to create conversation.",
      },
      { status: 503 },
    );
  }
}
