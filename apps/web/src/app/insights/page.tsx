import Insights from "./insights";

export const dynamic = "force-dynamic";

export default function InsightsPage() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  // Only a publishable key may reach the browser, never a secret key.
  const publicKey = key.startsWith("sb_publishable_");
  return <Insights supabaseUrl={url} publishableKey={publicKey ? key : ""} />;
}
