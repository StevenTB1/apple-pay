import { randomBytes } from "node:crypto";
import { type Context, hashShortcutToken } from "@/server/context";
import type { Json } from "@/server/types/supabase";
import { captureFingerprint, normalizeCapture } from "@/server/utils/capture";
import { captureConflict, notAuthenticated } from "@/server/utils/errors";

// One active phone credential per user: issuing a new one revokes the previous.
const createShortcutToken = async (_obj: unknown, _args: unknown, context: Context) => {
  const { supabase } = context;
  const user_id = context.token?.user_id;
  if (!user_id) throw notAuthenticated();

  const token = `ap_${randomBytes(32).toString("hex")}`;

  const { error: revokeError } = await supabase
    .from("shortcut_token")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", user_id)
    .is("revoked_at", null);
  if (revokeError) throw revokeError;

  const { error } = await supabase
    .from("shortcut_token")
    .insert({ user_id, token_hash: hashShortcutToken(token) });
  if (error) throw error;

  return { token };
};

const MONEY = /(?:[A-Z]{2,3}\s?)?[$€£]\s?\d[\d,]*(?:\.\d{1,4})?|\d[\d.,]*\s?(?:[$€£]|[A-Z]{3}\b)/;

const text = (value: unknown, maximum: number) =>
  value === undefined || value === null ? null : String(value).trim().slice(0, maximum) || null;

// The phone may send anything. An object contributes the fields it has; any other value is treated
// as raw transaction text: the first money-looking part is the amount, the rest is shown as merchant.
function captureFields(input: unknown) {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const fields = input as Record<string, unknown>;
    return {
      event_id: text(fields.event_id, 128),
      captured_at: text(fields.captured_at, 40),
      currency: text(fields.currency, 3),
      merchant: text(fields.merchant, 200),
      raw_amount: text(fields.raw_amount ?? fields.amount, 200),
      card_label: text(fields.card_label ?? fields.card, 100),
    };
  }
  const raw = String(input ?? "").replace(/\s+/g, " ").trim();
  const amount = MONEY.exec(raw)?.[0] ?? null;
  return { merchant: text(amount ? raw.replace(amount, "") : raw, 200), raw_amount: amount };
}

const recordCapture = async (_obj: unknown, args: { input?: unknown }, context: Context) => {
  const { supabase, token } = context;
  if (!token?.user_id || !token.source_id) throw notAuthenticated();

  // source_id always comes from the credential, so a phone cannot write under another source.
  const capture = normalizeCapture({ ...captureFields(args.input), source_id: token.source_id });
  const fingerprint = captureFingerprint(capture);

  const { data, error } = await supabase
    .from("transaction")
    .insert({
      owner_id: token.user_id,
      source: "APPLE_PAY",
      source_id: capture.source_id,
      event_id: capture.event_id,
      capture_fingerprint: fingerprint,
      original_capture: { ...capture, received: (args.input ?? null) as Json },
      captured_at: capture.captured_at,
      occurred_at: capture.captured_at,
      merchant: capture.merchant,
      card_label: capture.card_label,
      amount: capture.amount,
      currency: capture.currency,
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (!error) return { transaction_id: data.id, event_id: capture.event_id, duplicate: false };
  if (error.code !== "23505") throw error;

  // Unique (owner_id, source_id, event_id): a replay of the same capture is acknowledged, not re-saved.
  const { data: existing, error: readError } = await supabase
    .from("transaction")
    .select("id, capture_fingerprint")
    .eq("owner_id", token.user_id)
    .eq("source_id", capture.source_id)
    .eq("event_id", capture.event_id)
    .maybeSingle();

  if (readError) throw readError;
  if (!existing) throw error;
  if (existing.capture_fingerprint !== fingerprint) throw captureConflict();
  return { transaction_id: existing.id, event_id: capture.event_id, duplicate: true };
};

export const SHORTCUT_MUTATIONS = {
  createShortcutToken,
  recordCapture,
};
