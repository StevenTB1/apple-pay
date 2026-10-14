"use client";

import { useState, type FormEvent } from "react";
import { localDateTime, purchaseRequest, type Purchase } from "@/lib/purchases";

export default function PurchaseForm({ purchase, token, onSaved, onCancel }: {
  purchase: Purchase | null; token: string; onSaved: () => void; onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [originalTime] = useState(() => localDateTime(purchase?.occurredAt));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    const fields = new FormData(event.currentTarget);
    const date = String(fields.get("occurredAt"));
    try {
      const input = {
        merchant: String(fields.get("merchant")).trim() || null,
        amount: String(fields.get("amount")).trim() || null,
        currency: String(fields.get("currency")).trim().toUpperCase() || null,
        // Preserve the original seconds/milliseconds when only another field is edited.
        occurred_at: purchase && date === originalTime ? purchase.occurredAt : new Date(date).toISOString(),
      };
      await purchaseRequest(token, purchase ? "update" : "create", purchase ? { id: purchase.id, input } : { input });
      onSaved();
    } catch (error) { setError(error instanceof Error ? error.message : "Couldn't save the purchase."); }
    finally { setBusy(false); }
  }
  return (
    <form className="purchase-form" onSubmit={submit} aria-labelledby="purchase-form-heading">
      <h3 id="purchase-form-heading">{purchase ? "Edit purchase" : "Add a purchase"}</h3>
      <fieldset disabled={busy}>
        <label>Merchant<input name="merchant" type="text" maxLength={200} defaultValue={purchase?.merchant ?? ""} autoFocus /></label>
        <div className="form-columns">
          <label>Amount<input name="amount" type="text" inputMode="decimal" pattern="[0-9]{1,16}(\.[0-9]{1,4})?" required={!purchase} defaultValue={purchase?.amount ?? ""} placeholder={purchase ? "Unknown" : "0.00"} aria-describedby="amount-hint" /></label>
          <label>Currency<input name="currency" type="text" maxLength={3} pattern="[A-Za-z]{3}" required={!purchase} defaultValue={purchase ? purchase.currency ?? "" : "CAD"} readOnly={!purchase} placeholder="Unknown" /></label>
        </div>
        <p className="field-hint" id="amount-hint">Use a decimal point. CAD uses two decimal places.{purchase ? " Leave amount or currency blank if unknown." : ""}</p>
        <label>Purchase time (your device timezone)<input name="occurredAt" type="datetime-local" required defaultValue={originalTime} /></label>
      </fieldset>
      {error ? <p className="error" role="alert">{error}</p> : null}
      <div className="button-pair"><button type="submit" disabled={busy}>{busy ? "Saving…" : "Save purchase"}</button><button className="secondary" type="button" onClick={onCancel} disabled={busy}>Cancel</button></div>
    </form>
  );
}
