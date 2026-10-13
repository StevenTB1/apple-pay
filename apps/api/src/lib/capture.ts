import { createHash } from "node:crypto";
import { Temporal } from "@js-temporal/polyfill";
import { Prisma } from "../generated/prisma/client";

export class InputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputValidationError";
  }
}

export type NormalizedCapture = {
  sourceId: string;
  eventId: string;
  capturedAt: string;
  amount: string | null;
  currency: string | null;
  merchant: string | null;
  cardLabel: string | null;
  rawAmount: string | null;
};

function inputRecord(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InputValidationError("Input must be an object.");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) {
    throw new InputValidationError("Input must be a plain object.");
  }
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    throw new InputValidationError("Input contains an unsupported field.");
  }
  return value as Record<string, unknown>;
}

function optionalText(value: unknown, field: string, maximum: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new InputValidationError(`${field} must be text.`);
  }
  const text = value.trim();
  if (text.includes("\u0000")) throw new InputValidationError(`${field} contains an unsupported character.`);
  if (text.length > maximum) {
    throw new InputValidationError(`${field} is too long.`);
  }
  return text || null;
}

function identifier(value: unknown, field: string, minimum: number, maximum: number): string {
  const text = optionalText(value, field, maximum);
  if (!text || text.length < minimum || !/^[A-Za-z0-9_-]+$/.test(text)) {
    throw new InputValidationError(`${field} must be a valid capture identifier.`);
  }
  return text;
}

function currencyCode(value: unknown): string | null {
  const currency = optionalText(value, "currency", 3)?.toUpperCase() ?? null;
  if (currency && !/^[A-Z]{3}$/.test(currency)) {
    throw new InputValidationError("currency must be a three-letter code.");
  }
  return currency;
}

function amountText(value: unknown, currency: string | null): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !/^\d{1,16}(?:\.\d{1,4})?$/.test(value)) {
    throw new InputValidationError("amount must be a nonnegative decimal string with at most four decimal places.");
  }
  const amount = new Prisma.Decimal(value);
  if (currency === "CAD" && amount.decimalPlaces() > 2) {
    throw new InputValidationError("CAD amounts may have at most two decimal places.");
  }
  return amount.toString();
}

function instantString(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new InputValidationError(`${field} must be an ISO timestamp with an explicit timezone and at most millisecond precision.`);
  }
  try {
    const instant = Temporal.Instant.from(value).toString({ smallestUnit: "millisecond" });
    if (!/^(?!0000)\d{4}-/.test(instant)) throw new Error("Unsupported year");
    return instant;
  } catch {
    throw new InputValidationError(`${field} must contain a valid date and time.`);
  }
}

export function normalizeCapture(input: unknown): NormalizedCapture {
  const data = inputRecord(input, [
    "sourceId", "eventId", "capturedAt", "amount", "currency", "merchant", "cardLabel", "rawAmount",
  ]);
  const currency = currencyCode(data.currency);
  return {
    sourceId: identifier(data.sourceId, "sourceId", 3, 100),
    eventId: identifier(data.eventId, "eventId", 16, 128),
    capturedAt: instantString(data.capturedAt, "capturedAt"),
    amount: amountText(data.amount, currency),
    currency,
    merchant: optionalText(data.merchant, "merchant", 200),
    cardLabel: optionalText(data.cardLabel, "cardLabel", 100),
    rawAmount: optionalText(data.rawAmount, "rawAmount", 200),
  };
}

export function captureFingerprint(input: NormalizedCapture): string {
  const canonical = {
    sourceId: input.sourceId,
    eventId: input.eventId,
    capturedAt: input.capturedAt,
    amount: input.amount,
    currency: input.currency,
    merchant: input.merchant,
    cardLabel: input.cardLabel,
    rawAmount: input.rawAmount,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function normalizeManualInput(input: unknown) {
  const data = inputRecord(input, ["merchant", "amount", "currency", "occurredAt"]);
  const currency = currencyCode(data.currency) ?? "CAD";
  if (currency !== "CAD") {
    throw new InputValidationError("Manual entries currently use CAD.");
  }
  const amount = amountText(data.amount, currency);
  if (amount === null) throw new InputValidationError("A manual entry requires an amount.");
  return {
    merchant: optionalText(data.merchant, "merchant", 200),
    amount,
    currency,
    occurredAt: instantString(data.occurredAt, "occurredAt"),
  };
}

export function normalizeCorrection(
  input: unknown,
  current: { amount: string | null; currency: string | null },
) {
  const data = inputRecord(input, ["merchant", "amount", "currency", "occurredAt", "excluded"]);
  if (Object.keys(data).length === 0) {
    throw new InputValidationError("At least one correction is required.");
  }
  const currency = "currency" in data ? currencyCode(data.currency) : current.currency;
  const amount = amountText("amount" in data ? data.amount : current.amount, currency);
  const correction: {
    merchant?: string | null;
    amount?: string | null;
    currency?: string | null;
    occurredAt?: Date;
    excluded?: boolean;
  } = {};
  if ("amount" in data) correction.amount = amount;
  if ("currency" in data) correction.currency = currency;
  if ("merchant" in data) correction.merchant = optionalText(data.merchant, "merchant", 200);
  if ("occurredAt" in data) correction.occurredAt = new Date(instantString(data.occurredAt, "occurredAt"));
  if ("excluded" in data) {
    if (typeof data.excluded !== "boolean") {
      throw new InputValidationError("excluded must be true or false.");
    }
    correction.excluded = data.excluded;
  }
  return correction;
}

export function monthBounds(month: string): { start: Date; end: Date } {
  if (!/^(?!0000)\d{4}-(?:0[1-9]|1[0-2])$/.test(month)) {
    throw new InputValidationError("month must use YYYY-MM.");
  }
  const day = Temporal.PlainDate.from(`${month}-01`);
  return {
    start: new Date(day.toZonedDateTime("America/Toronto").toInstant().epochMilliseconds),
    end: new Date(day.add({ months: 1 }).toZonedDateTime("America/Toronto").toInstant().epochMilliseconds),
  };
}
