"use client";

import { useEffect, useState, type FormEvent } from "react";
import { type Session, type SupabaseClient } from "@supabase/supabase-js";
import { decimalDisplay, purchaseRequest, type MonthData, type Purchase } from "@/lib/purchases";
import { getBrowserSupabase } from "@/lib/supabase";
import PurchaseForm from "./purchase-form";

type AuthState = { client: SupabaseClient | null; session: Session | null; ready: boolean };
const purchaseTime = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});

export default function SpendingDashboard({ supabaseUrl, publishableKey, initialMonth }: {
  supabaseUrl: string; publishableKey: string; initialMonth: string;
}) {
  const [auth, setAuth] = useState<AuthState>({ client: null, session: null, ready: false });
  useEffect(() => {
    if (!supabaseUrl || !publishableKey) return;
    const client = getBrowserSupabase(supabaseUrl, publishableKey);
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      setAuth({ client, session, ready: true });
    });
    return () => subscription.unsubscribe();
  }, [supabaseUrl, publishableKey]);

  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <div><p className="eyebrow">Personal spending</p><h1>Spending tracker</h1></div>
        <span className="currency">CAD</span>
      </header>
      {!supabaseUrl || !publishableKey ? (
        <section className="panel"><h2>Sign-in unavailable</h2><p>The account connection is not configured. Check the dashboard’s public Supabase settings.</p></section>
      ) : !auth.ready ? (
        <p className="loading" role="status">Restoring your session…</p>
      ) : auth.session && auth.client ? (
        <OwnerDashboard key={auth.session.user.id} session={auth.session} client={auth.client} initialMonth={initialMonth} />
      ) : auth.client ? (
        <SignIn client={auth.client} />
      ) : null}
      <footer>CAD totals · Purchase times shown in America/Toronto</footer>
    </main>
  );
}

function SignIn({ client }: { client: SupabaseClient }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    const fields = new FormData(event.currentTarget);
    try {
      const { error } = await client.auth.signInWithPassword({
        email: String(fields.get("email")).trim(), password: String(fields.get("password")),
      });
      if (error) setError("Couldn't sign in. Check your email, password, and account confirmation.");
    } catch { setError("Couldn't reach sign-in. Check your connection and try again."); }
    finally { setBusy(false); }
  }
  return (
    <section className="panel sign-in" aria-labelledby="sign-in-heading">
      <p className="eyebrow">Welcome back</p><h2 id="sign-in-heading">Your purchases, in one place.</h2>
      <p className="muted">Sign in with your email and password.</p>
      <form onSubmit={submit}>
        <label>Email<input name="email" type="email" autoComplete="username" required disabled={busy} /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" required disabled={busy} /></label>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </section>
  );
}

function OwnerDashboard({ session, client, initialMonth }: { session: Session; client: SupabaseClient; initialMonth: string }) {
  const [month, setMonth] = useState(initialMonth);
  const [revision, setRevision] = useState(0);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  async function signOut() {
    setSigningOut(true); setSignOutError(null);
    try {
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error) setSignOutError("Couldn't sign out. Please try again.");
    } catch { setSignOutError("Couldn't sign out. Please try again."); }
    finally { setSigningOut(false); }
  }
  return (
    <>
      <div className="account-bar"><span className="muted">{session.user.email}</span><button className="secondary" onClick={signOut} disabled={signingOut}>{signingOut ? "Signing out…" : "Sign out"}</button></div>
      {signOutError ? <p className="error" role="alert">{signOutError}</p> : null}
      <div className="month-controls">
        <label htmlFor="month">Spending month<input id="month" type="month" value={month} required onChange={(event) => {
          if (/^(?!0000)\d{4}-(?:0[1-9]|1[0-2])$/.test(event.target.value)) setMonth(event.target.value);
        }} /></label>
        <button className="secondary" onClick={() => setRevision((value) => value + 1)}>Refresh</button>
      </div>
      <MonthPurchases key={`${month}:${revision}`} month={month} token={session.access_token} refresh={() => setRevision((value) => value + 1)} />
      <PhoneToken token={session.access_token} />
    </>
  );
}

function PhoneToken({ token }: { token: string }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function create() {
    if (busy || !window.confirm("Create a new phone token? Any token already on a phone stops working.")) return;
    setBusy(true); setError(null);
    try {
      const result = await purchaseRequest<{ createShortcutToken: { token: string } }>(token, "createToken", {});
      setSecret(result.createShortcutToken.token);
    } catch (error) { setError(error instanceof Error ? error.message : "Couldn't create a phone token."); }
    finally { setBusy(false); }
  }
  return (
    <section className="panel" aria-labelledby="phone-token-heading">
      <h2 id="phone-token-heading">iPhone Shortcut</h2>
      <p className="muted">The Shortcut uploads purchases with a secret token. It can add captures but never read your spending.</p>
      {secret ? <label>Copy this into the Shortcut now — it is shown only once<input readOnly value={secret} onFocus={(event) => event.target.select()} /></label> : null}
      {error ? <p className="error" role="alert">{error}</p> : null}
      <button className="secondary" onClick={create} disabled={busy}>{busy ? "Creating…" : "Create phone token"}</button>
    </section>
  );
}

function MonthPurchases({ month, token, refresh }: { month: string; token: string; refresh: () => void }) {
  const [data, setData] = useState<MonthData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [editing, setEditing] = useState<Purchase | "new" | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    purchaseRequest<MonthData>(token, "list", { month }, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) { setData(result); setError(null); setHasMore(result.transactions.data.length < result.transactions.count); }
      })
      .catch((error: Error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [month, token]);

  async function loadMore() {
    if (!data || moreBusy) return;
    setMoreBusy(true); setError(null);
    try {
      const result = await purchaseRequest<MonthData>(token, "list", { month, offset: data.transactions.data.length });
      const rows = [...data.transactions.data, ...result.transactions.data];
      setData({ ...result, transactions: { count: result.transactions.count, data: rows } });
      setHasMore(rows.length < result.transactions.count);
    } catch (error) { setError(error instanceof Error ? error.message : "Couldn't load more purchases."); }
    finally { setMoreBusy(false); }
  }

  async function toggleExcluded(row: Purchase) {
    if (savingId) return;
    setSavingId(row.id); setError(null);
    try { await purchaseRequest(token, "update", { id: row.id, input: { excluded: !row.excluded } }); refresh(); }
    catch (error) { setError(error instanceof Error ? error.message : "Couldn't update the purchase."); }
    finally { setSavingId(null); }
  }

  const summary = data?.spendingSummary;
  return (
    <>
      <section className="summary-grid" aria-label="Monthly spending summary" aria-busy={!data && !error}>
        <div className="stat total"><p className="eyebrow">Included spending · CAD</p><p className="total-value">{summary ? `$${decimalDisplay(summary.totalCad)}` : "—"}</p><p className="muted">{summary ? `${summary.includedCount} included purchases` : "Loading your month…"}</p></div>
        <div className="stat"><p className="eyebrow">Needs review</p><p className="stat-value">{summary?.needsReviewCount ?? "—"}</p><p className="muted">Incomplete or other currency</p></div>
        <div className="stat"><p className="eyebrow">Excluded</p><p className="stat-value">{summary?.excludedCount ?? "—"}</p><p className="muted">Outside your total</p></div>
      </section>
      <section className="panel purchases" aria-labelledby="purchases-heading">
        <div className="section-header"><h2 id="purchases-heading">Purchases</h2><button onClick={() => setEditing("new")} disabled={!data || Boolean(editing) || Boolean(savingId)}>Add purchase</button></div>
        {error ? <div className="error" role="alert"><p>{error}</p><button className="secondary" onClick={refresh}>Refresh purchases</button></div> : null}
        {editing ? <PurchaseForm key={editing === "new" ? "new" : editing.id} purchase={editing === "new" ? null : editing} token={token} onSaved={refresh} onCancel={() => setEditing(null)} /> : null}
        {!data && !error ? <p className="loading" role="status">Loading purchases…</p> : null}
        {data?.transactions.data.length === 0 ? <div className="empty-state"><h3>No purchases this month</h3><p>Add a purchase manually or capture one with your iPhone Shortcut.</p></div> : null}
        {data ? <ul className="purchase-list">{data.transactions.data.map((row) => {
          const incomplete = row.amount === null || row.currency === null;
          return (
            <li key={row.id} className={row.excluded ? "purchase excluded" : "purchase"}>
              <div className="purchase-main"><div><h3>{row.merchant ?? "Merchant unknown"}</h3><p className="purchase-meta"><time dateTime={row.occurredAt}>{purchaseTime.format(new Date(row.occurredAt))}</time> · {row.source === "APPLE_PAY" ? "Apple Pay" : "Manual"}{row.cardLabel ? ` · ${row.cardLabel}` : ""}</p></div><p className="purchase-amount">{row.amount === null ? "Amount unknown" : `${row.currency ?? "Currency unknown"} ${decimalDisplay(row.amount)}`}</p></div>
              <div className="purchase-actions"><div>{row.excluded ? <span className="badge">Excluded</span> : incomplete ? <span className="badge review">Incomplete</span> : row.currency !== "CAD" ? <span className="badge review">Other currency</span> : null}</div><div className="button-pair"><button className="text-button" onClick={() => setEditing(row)} disabled={Boolean(editing) || Boolean(savingId)} aria-label={`Edit ${row.merchant ?? "purchase"}`}>Edit</button><button className="text-button" onClick={() => toggleExcluded(row)} disabled={Boolean(savingId) || Boolean(editing)} aria-label={`${row.excluded ? "Restore" : "Exclude"} ${row.merchant ?? "purchase"}`}>{savingId === row.id ? "Saving…" : row.excluded ? "Restore" : "Exclude"}</button></div></div>
            </li>
          );
        })}</ul> : null}
        {hasMore ? <button className="secondary load-more" onClick={loadMore} disabled={moreBusy}>{moreBusy ? "Loading…" : "Load more purchases"}</button> : null}
      </section>
    </>
  );
}
