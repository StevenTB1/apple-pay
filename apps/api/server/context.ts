import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextApiRequest, NextApiResponse } from "next";
import { createAdminClient } from "@/server/config/supabase/admin";
import type { Database } from "@/server/types/supabase";

// role "user" is a signed-in Supabase account; "shortcut" is a phone's upload-only credential.
export type Token = { user_id: string; role: "user" | "shortcut"; source_id?: string };

export type Context = {
  req: NextApiRequest;
  res: NextApiResponse;
  supabase: SupabaseClient<Database>;
  token?: Token;
};

export const hashShortcutToken = (token: string) => createHash("sha256").update(token).digest("hex");

async function getDecodedToken(supabase: SupabaseClient<Database>, req: NextApiRequest): Promise<Token | undefined> {
  const match = /^Bearer (\S{1,8192})$/i.exec(req.headers.authorization ?? "");
  if (!match) return undefined;
  const accessToken = match[1];

  if (accessToken.startsWith("ap_")) {
    if (!/^ap_[a-f0-9]{64}$/.test(accessToken)) return undefined;
    const { data, error } = await supabase
      .from("shortcut_token")
      .select("id, user_id")
      .eq("token_hash", hashShortcutToken(accessToken))
      .is("revoked_at", null)
      .maybeSingle();
    if (error) throw error;
    return data ? { user_id: data.user_id, role: "shortcut", source_id: data.id } : undefined;
  }

  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) return undefined;
  return { user_id: data.user.id, role: "user" };
}

// Called once per request by Apollo Server (see src/pages/api/graphql.ts).
// The client uses the service-role key, so every service must filter by token.user_id itself.
export async function getContext(req: NextApiRequest, res: NextApiResponse): Promise<Context> {
  const supabase = createAdminClient();
  return { req, res, supabase, token: await getDecodedToken(supabase, req) };
}
