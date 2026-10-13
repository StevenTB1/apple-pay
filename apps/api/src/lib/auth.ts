import { createHash, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export type Principal =
  | { kind: "shortcut"; ownerId: string; sourceId: string }
  | { kind: "owner"; ownerId: string };

export class AuthenticationError extends Error {
  constructor() {
    super("A valid credential is required.");
    this.name = "AuthenticationError";
  }
}

export class PermissionError extends Error {
  constructor() {
    super("This credential cannot perform that operation.");
    this.name = "PermissionError";
  }
}

export function authenticateShortcutToken(
  token: string,
  credentials: { ownerId: string; sourceId: string; tokenHash: string },
): Principal {
  if (!/^ap_[a-f0-9]{64}$/.test(token) || !/^[a-f0-9]{64}$/i.test(credentials.tokenHash)) {
    throw new AuthenticationError();
  }
  const actual = createHash("sha256").update(token).digest();
  const expected = Buffer.from(credentials.tokenHash, "hex");
  if (!timingSafeEqual(actual, expected)) throw new AuthenticationError();
  return { kind: "shortcut", ownerId: credentials.ownerId, sourceId: credentials.sourceId };
}

export async function authenticateRequest(request: Request): Promise<Principal | null> {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const match = /^Bearer (\S+)$/i.exec(authorization);
  if (!match || match[1].length > 8192) throw new AuthenticationError();
  const token = match[1];
  const ownerId = process.env.OWNER_USER_ID?.trim();
  if (!ownerId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId)) {
    throw new Error("Backend owner configuration is incomplete.");
  }
  if (token.startsWith("ap_")) {
    const sourceId = process.env.SHORTCUT_SOURCE_ID?.trim();
    const tokenHash = process.env.SHORTCUT_TOKEN_SHA256?.trim();
    if (!sourceId || !/^[A-Za-z0-9_-]{3,100}$/.test(sourceId) || !tokenHash) {
      throw new Error("Backend Shortcut configuration is incomplete.");
    }
    return authenticateShortcutToken(token, { ownerId, sourceId, tokenHash });
  }
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) throw new Error("Backend sign-in configuration is incomplete.");
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user || data.user.id !== ownerId) throw new AuthenticationError();
  return { kind: "owner", ownerId };
}

export function requireOwner(principal: Principal | null): string {
  if (!principal) throw new AuthenticationError();
  if (principal.kind !== "owner") throw new PermissionError();
  return principal.ownerId;
}

export function requireShortcut(principal: Principal | null) {
  if (!principal) throw new AuthenticationError();
  if (principal.kind !== "shortcut") throw new PermissionError();
  return principal;
}
