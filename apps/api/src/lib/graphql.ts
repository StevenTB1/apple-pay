import { GraphQLError } from "graphql";
import { createSchema } from "graphql-yoga";
import { type PrismaClient, type Transaction } from "../generated/prisma/client";
import { AuthenticationError, PermissionError, type Principal, requireOwner, requireShortcut } from "./auth";
import { InputValidationError } from "./capture";
import {
  CaptureConflictError, createManualTransaction, listTransactions, recordCapture,
  spendingSummary, TransactionNotFoundError, updateTransaction,
} from "./transactions";

export type ApiContext = { principal: Principal | null; db: () => PrismaClient };

// Safe domain errors may reach callers; SDK/database/configuration details never do,
// including in development mode.
export function maskApiError(error: unknown): GraphQLError {
  const cause = error instanceof GraphQLError ? error.originalError ?? error : error;
  const known = [
    [InputValidationError, "BAD_USER_INPUT"],
    [AuthenticationError, "UNAUTHENTICATED"],
    [PermissionError, "FORBIDDEN"],
    [CaptureConflictError, "CONFLICT"],
    [TransactionNotFoundError, "NOT_FOUND"],
  ] as const;
  for (const [ErrorType, code] of known) {
    if (cause instanceof ErrorType) {
      return new GraphQLError(cause.message, {
        path: error instanceof GraphQLError ? error.path : undefined,
        extensions: { code },
      });
    }
  }
  // Parser/validation errors have no resolver error and contain no backend details.
  if (error instanceof GraphQLError && !error.originalError) return error;
  return new GraphQLError("The request could not be completed.", {
    path: error instanceof GraphQLError ? error.path : undefined,
    extensions: { code: "INTERNAL_SERVER_ERROR" },
  });
}

export const schema = createSchema<ApiContext>({
  typeDefs: /* GraphQL */ `
    enum CaptureSource { APPLE_PAY MANUAL }
    type Transaction {
      id: ID!
      source: CaptureSource!
      merchant: String
      cardLabel: String
      amount: String
      currency: String
      occurredAt: String!
      capturedAt: String
      receivedAt: String!
      updatedAt: String!
      excluded: Boolean!
    }
    type SpendingSummary {
      totalCad: String!
      includedCount: Int!
      needsReviewCount: Int!
      excludedCount: Int!
    }
    type CaptureAck { transactionId: ID!, eventId: String!, duplicate: Boolean! }
    input CaptureInput {
      sourceId: String!
      eventId: String!
      capturedAt: String!
      amount: String
      currency: String
      merchant: String
      cardLabel: String
      rawAmount: String
    }
    input ManualInput { merchant: String, amount: String!, currency: String, occurredAt: String! }
    input CorrectionInput { merchant: String, amount: String, currency: String, occurredAt: String, excluded: Boolean }
    type Query {
      status: String!
      transactions(month: String!, limit: Int = 50, after: ID): [Transaction!]!
      spendingSummary(month: String!): SpendingSummary!
    }
    type Mutation {
      recordCapture(input: CaptureInput!): CaptureAck!
      createManualTransaction(input: ManualInput!): Transaction!
      updateTransaction(id: ID!, input: CorrectionInput!): Transaction!
    }
  `,
  resolvers: {
    Query: {
      status: () => "api",
      transactions: (_parent, args: { month: string; limit?: number; after?: string | null }, context) => {
        const ownerId = requireOwner(context.principal);
        return listTransactions(context.db(), ownerId, args.month, args.limit, args.after);
      },
      spendingSummary: (_parent, args: { month: string }, context) => {
        const ownerId = requireOwner(context.principal);
        return spendingSummary(context.db(), ownerId, args.month);
      },
    },
    Mutation: {
      recordCapture: (_parent, args: { input: unknown }, context) => {
        const principal = requireShortcut(context.principal);
        return recordCapture(context.db(), principal, args.input);
      },
      createManualTransaction: (_parent, args: { input: unknown }, context) => {
        const ownerId = requireOwner(context.principal);
        return createManualTransaction(context.db(), ownerId, args.input);
      },
      updateTransaction: (_parent, args: { id: string; input: unknown }, context) => {
        const ownerId = requireOwner(context.principal);
        return updateTransaction(context.db(), ownerId, args.id, args.input);
      },
    },
    Transaction: {
      amount: (row: Transaction) => row.amount?.toString() ?? null,
      occurredAt: (row: Transaction) => row.occurredAt.toISOString(),
      capturedAt: (row: Transaction) => row.capturedAt?.toISOString() ?? null,
      receivedAt: (row: Transaction) => row.receivedAt.toISOString(),
      updatedAt: (row: Transaction) => row.updatedAt.toISOString(),
    },
  },
});
