import { Prisma, type PrismaClient } from "../generated/prisma/client";
import {
  captureFingerprint, InputValidationError, monthBounds, normalizeCapture,
  normalizeCorrection, normalizeManualInput,
} from "./capture";

export class CaptureConflictError extends Error {
  constructor() {
    super("This event ID already belongs to a different capture. Keep the saved event for review.");
    this.name = "CaptureConflictError";
  }
}

export class TransactionNotFoundError extends Error {
  constructor() {
    super("The purchase was not found.");
    this.name = "TransactionNotFoundError";
  }
}

function ownerIdentifier(ownerId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId)) {
    throw new InputValidationError("The configured owner ID must be a UUID.");
  }
  return ownerId;
}

export async function recordCapture(
  db: PrismaClient,
  principal: { ownerId: string; sourceId: string },
  input: unknown,
) {
  const ownerId = ownerIdentifier(principal.ownerId);
  const capture = normalizeCapture(input);
  if (capture.sourceId !== principal.sourceId) {
    throw new InputValidationError("The capture source does not match this credential.");
  }
  const fingerprint = captureFingerprint(capture);
  try {
    const transaction = await db.transaction.create({
      data: {
        ownerId,
        source: "APPLE_PAY",
        sourceId: capture.sourceId,
        eventId: capture.eventId,
        captureFingerprint: fingerprint,
        originalCapture: capture,
        capturedAt: new Date(capture.capturedAt),
        occurredAt: new Date(capture.capturedAt),
        merchant: capture.merchant,
        cardLabel: capture.cardLabel,
        amount: capture.amount,
        currency: capture.currency,
      },
      select: { id: true },
    });
    return { transactionId: transaction.id, eventId: capture.eventId, duplicate: false };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error;
    }
    const existing = await db.transaction.findUnique({
      where: {
        captureIdentity: { ownerId, sourceId: capture.sourceId, eventId: capture.eventId },
      },
      select: { id: true, captureFingerprint: true },
    });
    if (!existing) throw error;
    if (existing.captureFingerprint !== fingerprint) throw new CaptureConflictError();
    return { transactionId: existing.id, eventId: capture.eventId, duplicate: true };
  }
}

export async function createManualTransaction(db: PrismaClient, ownerId: string, input: unknown) {
  const entry = normalizeManualInput(input);
  return db.transaction.create({
    data: {
      ownerId: ownerIdentifier(ownerId),
      source: "MANUAL",
      merchant: entry.merchant,
      amount: entry.amount,
      currency: entry.currency,
      occurredAt: new Date(entry.occurredAt),
    },
  });
}

export async function updateTransaction(
  db: PrismaClient,
  ownerId: string,
  id: string,
  changes: unknown,
) {
  ownerIdentifier(ownerId);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new InputValidationError("id must be a purchase UUID.");
  }
  // Lock this owner's row until validation and correction finish. Concurrent edits
  // validate current values without restoring fields from an earlier read.
  return db.$transaction(async (tx) => {
    const [current] = await tx.$queryRaw<Array<{ amount: Prisma.Decimal | null; currency: string | null }>>`
      SELECT "amount", "currency" FROM "tracker"."Transaction"
      WHERE "id" = ${id}::uuid AND "ownerId" = ${ownerId}::uuid FOR UPDATE
    `;
    if (!current) throw new TransactionNotFoundError();
    const correction = normalizeCorrection(changes, {
      amount: current.amount?.toString() ?? null,
      currency: current.currency,
    });
    return tx.transaction.update({ where: { id, ownerId }, data: correction });
  });
}

export async function listTransactions(db: PrismaClient, ownerId: string, month: string, limit = 50, after?: string | null) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new InputValidationError("limit must be an integer between 1 and 100.");
  }
  const { start, end } = monthBounds(month);
  const where = { ownerId: ownerIdentifier(ownerId), occurredAt: { gte: start, lt: end } };
  if (after) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(after)) {
      throw new InputValidationError("after must be a purchase UUID.");
    }
    const cursor = await db.transaction.findFirst({ where: { ...where, id: after }, select: { id: true } });
    if (!cursor) throw new TransactionNotFoundError();
  }
  return db.transaction.findMany({
    where,
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: limit,
    ...(after ? { cursor: { id: after }, skip: 1 } : {}),
  });
}

export async function spendingSummary(db: PrismaClient, ownerId: string, month: string) {
  const { start, end } = monthBounds(month);
  const period = { ownerId: ownerIdentifier(ownerId), occurredAt: { gte: start, lt: end } };
  const completeCad = { ...period, excluded: false, currency: "CAD", amount: { not: null } };
  // A database transaction gives totals and counts a consistent view during corrections.
  const [included, needsReviewCount, excludedCount] = await db.$transaction([
    db.transaction.aggregate({ where: completeCad, _sum: { amount: true }, _count: { _all: true } }),
    db.transaction.count({
      where: {
        ...period,
        excluded: false,
        OR: [{ amount: null }, { currency: null }, { currency: { not: "CAD" } }],
      },
    }),
    db.transaction.count({ where: { ...period, excluded: true } }),
  ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  return {
    totalCad: (included._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
    includedCount: included._count._all,
    needsReviewCount,
    excludedCount,
  };
}
