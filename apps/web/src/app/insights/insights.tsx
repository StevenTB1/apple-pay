"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { type Session } from "@supabase/supabase-js";
import { decimalDisplay, purchaseRequest, type SpendingBreakdown, type SpendingGroup } from "@/lib/purchases";
import { getBrowserSupabase } from "@/lib/supabase";

const SOURCE_NAMES: Record<string, string> = { APPLE_PAY: "Apple Pay", MANUAL: "Manual entry" };
const monthName = new Intl.DateTimeFormat("en-CA", { month: "short", year: "2-digit", timeZone: "UTC" });
const monthLabel = (key: string) => monthName.format(new Date(`${key}-01T12:00:00Z`));
const dollars = (value: string) => `$${decimalDisplay(value)}`;
const purchases = (count: number) => `${count} purchase${count === 1 ? "" : "s"}`;

export default function Insights({ supabaseUrl, publishableKey }: { supabaseUrl: string; publishableKey: string }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    if (!supabaseUrl || !publishableKey) return;
    const client = getBrowserSupabase(supabaseUrl, publishableKey);
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => subscription.unsubscribe();
  }, [supabaseUrl, publishableKey]);

  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <div><p className="eyebrow">Every source</p><h1>Spending insights</h1></div>
        <Link className="nav-link" href="/">Purchases</Link>
      </header>
      {session === undefined ? <p className="loading" role="status">Restoring your session…</p>
        : session ? <Breakdown token={session.access_token} />
        : <section className="panel"><h2>Sign in first</h2><p>Sign in on the <Link href="/">purchases page</Link>, then come back.</p></section>}
      <footer>CAD totals, excluded purchases left out · Months in America/Toronto</footer>
    </main>
  );
}

function Breakdown({ token }: { token: string }) {
  const [range, setRange] = useState({ from: "", to: "" });
  return (
    <>
      <div className="month-controls">
        <label>From<input type="month" value={range.from} max={range.to || undefined} onChange={(event) => setRange({ ...range, from: event.target.value })} /></label>
        <label>To<input type="month" value={range.to} min={range.from || undefined} onChange={(event) => setRange({ ...range, to: event.target.value })} /></label>
        <button className="secondary" onClick={() => setRange({ from: "", to: "" })} disabled={!range.from && !range.to}>All time</button>
      </div>
      {/* Keyed by range so each period starts from a clean loading state, like the month list on the purchases page. */}
      <RangeTotals key={`${range.from}:${range.to}`} token={token} from={range.from} to={range.to} />
    </>
  );
}

function RangeTotals({ token, from, to }: { token: string; from: string; to: string }) {
  const [data, setData] = useState<SpendingBreakdown | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    purchaseRequest<{ breakdown: SpendingBreakdown }>(token, "breakdown", { from_month: from || null, to_month: to || null }, controller.signal)
      .then((result) => setData(result.breakdown))
      .catch((error: Error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [token, from, to]);

  const period = from || to ? `${from ? monthLabel(from) : "Start"} – ${to ? monthLabel(to) : "now"}` : "All time";
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!data) return <p className="loading" role="status">Adding up your spending…</p>;
  if (data.purchase_count === 0 && data.needs_review_count === 0) {
    return <section className="panel"><h2>No spending in this period</h2><p>Totals appear once there is a complete CAD purchase in the selected months.</p></section>;
  }
  return <Totals data={data} period={period} />;
}

function Totals({ data, period }: { data: SpendingBreakdown; period: string }) {
  const average = (Number(data.total_cad) / Math.max(data.months.length, 1)).toFixed(2);
  return (
    <>
      <section className="insight-grid" aria-label={`Summary for ${period}`}>
        <div className="stat total"><p className="eyebrow">{period} · CAD</p><p className="total-value">{dollars(data.total_cad)}</p><p className="muted">{purchases(data.purchase_count)}</p></div>
        <div className="stat"><p className="eyebrow">Monthly average</p><p className="stat-value">{dollars(average)}</p><p className="muted">over {data.months.length} month{data.months.length === 1 ? "" : "s"}</p></div>
        <div className="stat"><p className="eyebrow">Not in totals</p><p className="stat-value">{data.needs_review_count}</p><p className="muted">Unknown amount or other currency</p></div>
      </section>
      <MonthChart months={data.months} />
      <BarList title="By payment card" groups={data.cards} />
      <BarList title="By source" groups={data.sources.map((group) => ({ ...group, key: SOURCE_NAMES[group.key] ?? group.key }))} />
      <BarList title="Top merchants" groups={data.merchants.slice(0, 10)} />
    </>
  );
}

function MonthChart({ months }: { months: SpendingGroup[] }) {
  const max = Math.max(...months.map((month) => Number(month.total_cad)));
  const latest = months.at(-1)?.key;
  return (
    <section className="panel" aria-labelledby="months-heading">
      <h2 id="months-heading">Monthly spending</h2>
      <div className="month-chart">
        {months.map((month) => {
          const label = `${monthLabel(month.key)}: ${dollars(month.total_cad)}, ${purchases(month.purchase_count)}`;
          // Only the latest and the highest month carry a value label; the rest show it on hover or focus.
          const labelled = month.key === latest || Number(month.total_cad) === max;
          return (
            <div key={month.key} className="month-bar" title={label} aria-label={label} tabIndex={0}>
              {labelled ? <em>{dollars(month.total_cad)}</em> : null}
              <span style={{ height: `${max ? (Number(month.total_cad) / max) * 100 : 0}%` }} />
            </div>
          );
        })}
      </div>
      <div className="month-labels" aria-hidden="true">{months.map((month) => <span key={month.key}>{monthLabel(month.key)}</span>)}</div>
      <details>
        <summary>Show as table</summary>
        <table>
          <thead><tr><th>Month</th><th>Purchases</th><th>Spent (CAD)</th></tr></thead>
          <tbody>{months.map((month) => <tr key={month.key}><td>{monthLabel(month.key)}</td><td>{month.purchase_count}</td><td>{dollars(month.total_cad)}</td></tr>)}</tbody>
        </table>
      </details>
    </section>
  );
}

function BarList({ title, groups }: { title: string; groups: SpendingGroup[] }) {
  const max = Math.max(...groups.map((group) => Number(group.total_cad)));
  return (
    <section className="panel" aria-label={title}>
      <h2>{title}</h2>
      <ul className="bar-list">
        {groups.map((group) => (
          <li key={group.key} className="bar-row">
            <span>{group.key} <span className="muted">· {purchases(group.purchase_count)}</span></span>
            <strong>{dollars(group.total_cad)}</strong>
            <div className="bar-track" aria-hidden="true"><span style={{ width: `${max ? (Number(group.total_cad) / max) * 100 : 0}%` }} /></div>
          </li>
        ))}
      </ul>
    </section>
  );
}
