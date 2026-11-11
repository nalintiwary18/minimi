import { cookies } from "next/headers";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { required } from "./config";

export async function ownerId() {
  const jar = await cookies();
  const secret = required("SESSION_SECRET");
  if (secret.length < 32)
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  const sign = (id: string) =>
    createHmac("sha256", secret).update(id).digest("hex");
  const raw = jar.get("recall_owner")?.value;
  if (raw) {
    const [id, signature] = raw.split(".");
    if (
      /^[0-9a-f-]{36}$/.test(id ?? "") &&
      /^[0-9a-f]{64}$/.test(signature ?? "")
    ) {
      if (timingSafeEqual(Buffer.from(signature), Buffer.from(sign(id))))
        return id;
    }
  }
  const id = randomUUID();
  jar.set("recall_owner", `${id}.${sign(id)}`, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return id;
}

export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    throw new Error("Cross-origin requests are not allowed.");
}
