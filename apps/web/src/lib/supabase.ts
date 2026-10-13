import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: { url: string; key: string; client: SupabaseClient } | undefined;

export function getBrowserSupabase(url: string, key: string): SupabaseClient {
  if (typeof window === "undefined") throw new Error("Browser sign-in must initialize on the client.");
  // Reuse the SDK's browser session across React remounts; never create it during SSR.
  if (!browserClient || browserClient.url !== url || browserClient.key !== key) {
    browserClient?.client.auth.stopAutoRefresh();
    browserClient = { url, key, client: createClient(url, key) };
  }
  return browserClient.client;
}
