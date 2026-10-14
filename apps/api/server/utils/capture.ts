import { createHash, randomUUID } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { inputError } from "@/server/utils/errors";

export type NormalizedCapture = {
  source_id: string;
  event_id: string;
  captured_at: string;
  amount: string | null;
  currency: string | null;
  merchant: string | null;
  card_label: string | null;
  raw_amount: string | null;
};

function inputRecord(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw inputError("Input must be an object.");
  }
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    throw inputError("Input contains an unsupported field.");
  }
  return value as Record<string, unknown>;
}

function optionalText(value: unknown, field: string, maximum: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw inputError(`${field} must be text.`);
  const text = value.trim();
  if (text.includes("\u0000")) throw inputError(`${field} contains an unsupported character.`);
  if (text.length > maximum) throw inputError(`${field} is too long.`);
  return text || null;
}

function identifier(value: unknown, field: string, minimum: number, maximum: number): string {
  const text = optionalText(value, field, maximum);
  if (!text || text.length < minimum || !/^[A-Za-z0-9_-]+$/.test(text)) {
    throw inputError(`${field} must be a valid capture identifier.`);
  }
  return text;
}

function currencyCode(value: unknown): string | null {
  const currency = optionalText(value, "currency", 3)?.toUpperCase() ?? null;
  if (currency && !/^[A-Z]{3}$/.test(currency)) {
    throw inputError("currency must be a three-letter code.");
  }
  return currency;
}

// Amounts stay decimal strings end to end, so no value ever passes through a float.
export function canonicalDecimal(value: string): string {
  const [integer, fraction = ""] = value.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return `${integer.replace(/^0+(?=\d)/, "")}${trimmed ? `.${trimmed}` : ""}`;
}

function amountText(value: unknown, currency: string | null): string | null {
  // Shortcuts cannot send JSON null, so an empty string also means "amount unknown".
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{1,16}(?:\.\d{1,4})?$/.test(value)) {
    throw inputError("amount must be a nonnegative decimal string with at most four decimal places.");
  }
  const amount = canonicalDecimal(value);
  if (currency === "CAD" && (amount.split(".")[1]?.length ?? 0) > 2) {
    throw inputError("CAD amounts may have at most two decimal places.");
  }
  return amount;
}

function instantString(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw inputError(`${field} must be an ISO timestamp with an explicit timezone and at most millisecond precision.`);
  }
  try {
    const instant = Temporal.Instant.from(value).toString({ smallestUnit: "millisecond" });
    if (!/^(?!0000)\d{4}-/.test(instant)) throw new Error("Unsupported year");
    return instant;
  } catch {
    throw inputError(`${field} must contain a valid date and time.`);
  }
}

// Wallet reports amounts as display text ("$12.30", "12,30 $", "US$5.00"); unreadable text stays unknown.
function amountFromRaw(raw: string | null, currency: string | null): string | null {
  if (!raw) return null;
  let digits = raw.replace(/[^0-9.,]/g, "");
  digits = /^\d+,\d{1,2}$/.test(digits) ? digits.replace(",", ".") : digits.replace(/,/g, "");
  try { return amountText(digits, currency); } catch { return null; }
}

// shortcut: a bare "$" is read as CAD because this ledger is Canadian; send `currency` to override.
function currencyFromRaw(raw: string | null): string | null {
  if (!raw) return null;
  const code = /\b([A-Z]{3})\b/.exec(raw.toUpperCase())?.[1];
  if (code) return code;
  if (/US\$/i.test(raw)) return "USD";
  if (raw.includes("€")) return "EUR";
  if (raw.includes("£")) return "GBP";
  return raw.includes("$") ? "CAD" : null;
}

// A phone may send only raw Wallet text; the server fills in the id, time, amount and currency.
export function normalizeCapture(input: unknown): NormalizedCapture {
  const data = inputRecord(input, ["source_id", "event_id", "captured_at", "currency", "merchant", "card_label", "raw_amount"]);
  const raw_amount = optionalText(data.raw_amount, "raw_amount", 200);
  const currency = currencyCode(data.currency) ?? currencyFromRaw(raw_amount);
  return {
    source_id: identifier(data.source_id, "source_id", 3, 100),
    event_id: identifier(data.event_id ?? randomUUID(), "event_id", 16, 128),
    captured_at: instantString(data.captured_at ?? new Date().toISOString(), "captured_at"),
    amount: amountFromRaw(raw_amount, currency),
    currency,
    merchant: optionalText(data.merchant, "merchant", 200),
    card_label: optionalText(data.card_label, "card_label", 100),
    raw_amount,
  };
}

// Key order is fixed by normalizeCapture, so equal captures always hash the same.
export function captureFingerprint(capture: NormalizedCapture): string {
  return createHash("sha256").update(JSON.stringify(capture)).digest("hex");
}

export function normalizeManualInput(input: unknown) {
  const data = inputRecord(input, ["merchant", "amount", "currency", "occurred_at"]);
  const currency = currencyCode(data.currency) ?? "CAD";
  if (currency !== "CAD") throw inputError("Manual entries currently use CAD.");
  const amount = amountText(data.amount, currency);
  if (amount === null) throw inputError("A manual entry requires an amount.");
  return {
    merchant: optionalText(data.merchant, "merchant", 200),
    amount,
    currency,
    occurred_at: instantString(data.occurred_at, "occurred_at"),
  };
}

export function normalizeCorrection(
  input: unknown,
  current: { amount: string | null; currency: string | null },
) {
  const data = inputRecord(input, ["merchant", "amount", "currency", "occurred_at", "excluded"]);
  if (Object.keys(data).length === 0) throw inputError("At least one correction is required.");
  const currency = "currency" in data ? currencyCode(data.currency) : current.currency;
  const amount = amountText("amount" in data ? data.amount : current.amount, currency);
  const correction: {
    merchant?: string | null;
    amount?: string | null;
    currency?: string | null;
    occurred_at?: string;
    excluded?: boolean;
  } = {};
  if ("amount" in data) correction.amount = amount;
  if ("currency" in data) correction.currency = currency;
  if ("merchant" in data) correction.merchant = optionalText(data.merchant, "merchant", 200);
  if ("occurred_at" in data) correction.occurred_at = instantString(data.occurred_at, "occurred_at");
  if ("excluded" in data) {
    if (typeof data.excluded !== "boolean") throw inputError("excluded must be true or false.");
    correction.excluded = data.excluded;
  }
  return correction;
}

export function monthBounds(month: string): { start: string; end: string } {
  if (!/^(?!0000)\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) throw inputError("month must use YYYY-MM.");
  const day = Temporal.PlainDate.from(`${month}-01`);
  return {
    start: day.toZonedDateTime("America/Toronto").toInstant().toString(),
    end: day.add({ months: 1 }).toZonedDateTime("America/Toronto").toInstant().toString(),
  };
}
