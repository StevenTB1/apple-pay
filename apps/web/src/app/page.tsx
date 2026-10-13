import SpendingDashboard from "./spending-dashboard";

export const dynamic = "force-dynamic";

export default function Home() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  // Refuse to serialize a service-role/secret key even if accidentally misconfigured.
  let publicKey = key.startsWith("sb_publishable_");
  if (!publicKey) {
    try { publicKey = JSON.parse(Buffer.from(key.split(".")[1] ?? "", "base64url").toString()).role === "anon"; }
    catch { publicKey = false; }
  }
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const month = `${date.find((part) => part.type === "year")?.value}-${date.find((part) => part.type === "month")?.value}`;
  return <SpendingDashboard supabaseUrl={url} publishableKey={publicKey ? key : ""} initialMonth={month} />;
}
