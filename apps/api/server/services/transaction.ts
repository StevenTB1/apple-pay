import type { Context } from "@/server/context";
import {
  canonicalDecimal, monthBounds, normalizeCorrection, normalizeManualInput,
} from "@/server/utils/capture";
import { inputError, notAuthenticated, notFound } from "@/server/utils/errors";

// amount::text keeps the exact decimal; a JSON number would round large values.
const TRANSACTION_COLUMNS =
  "id, source, merchant, card_label, amount::text, currency, occurred_at, captured_at, received_at, updated_at, excluded";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const withCanonicalAmount = <T extends { amount: string | null }>(row: T): T => ({
  ...row,
  amount: row.amount === null ? null : canonicalDecimal(row.amount),
});

function requireUserId(context: Context): string {
  const user_id = context.token?.user_id;
  if (!user_id) throw notAuthenticated();
  return user_id;
}

const getTransactions = async (
  _obj: unknown,
  args: { month: string; limit?: number | null; offset?: number | null },
  context: Context,
) => {
  const { month } = args;
  const limit = args.limit ?? 50;
  const offset = args.offset ?? 0;
  const { supabase } = context;
  const user_id = requireUserId(context);

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw inputError("limit must be an integer between 1 and 100.");
  if (!Number.isInteger(offset) || offset < 0) throw inputError("offset must be a nonnegative integer.");
  const { start, end } = monthBounds(month);

  const { data, error, count } = await supabase
    .from("transaction")
    .select(TRANSACTION_COLUMNS, { count: "exact" })
    .eq("owner_id", user_id)
    .gte("occurred_at", start)
    .lt("occurred_at", end)
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;
  return { count, data: data.map(withCanonicalAmount) };
};

const getSpendingSummary = async (_obj: unknown, args: { month: string }, context: Context) => {
  const { supabase } = context;
  const user_id = requireUserId(context);
  const { start, end } = monthBounds(args.month);

  // One SQL statement, so the total and the counts always describe the same snapshot.
  const { data, error } = await supabase
    .rpc("spending_summary", { p_owner_id: user_id, p_start: start, p_end: end })
    .single();

  if (error) throw error;
  return data;
};

const createManualTransaction = async (_obj: unknown, args: { input: unknown }, context: Context) => {
  const { supabase } = context;
  const user_id = requireUserId(context);
  const entry = normalizeManualInput(args.input);

  const { data, error } = await supabase
    .from("transaction")
    .insert({ ...entry, owner_id: user_id, source: "MANUAL", updated_at: new Date().toISOString() })
    .select(TRANSACTION_COLUMNS)
    .single();

  if (error) throw error;
  return withCanonicalAmount(data);
};

const updateTransaction = async (
  _obj: unknown,
  args: { transaction_id: string; input: unknown },
  context: Context,
) => {
  const { transaction_id, input } = args;
  const { supabase } = context;
  const user_id = requireUserId(context);

  if (!UUID.test(transaction_id)) throw inputError("transaction_id must be a purchase UUID.");

  const { data: current, error: readError } = await supabase
    .from("transaction")
    .select("amount::text, currency")
    .eq("id", transaction_id)
    .eq("owner_id", user_id)
    .maybeSingle();

  if (readError) throw readError;
  if (!current) throw notFound();

  const correction = normalizeCorrection(input, {
    amount: current.amount === null ? null : canonicalDecimal(current.amount),
    currency: current.currency,
  });

  // shortcut: read-then-write without a row lock; the table's CHECK constraints reject a bad
  // amount/currency pair from a concurrent edit. Move to an RPC if multi-device editing matters.
  const { data, error } = await supabase
    .from("transaction")
    .update({ ...correction, updated_at: new Date().toISOString() })
    .eq("id", transaction_id)
    .eq("owner_id", user_id)
    .select(TRANSACTION_COLUMNS)
    .single();

  if (error?.code === "23514") throw inputError("That amount and currency combination is not allowed.");
  if (error) throw error;
  return withCanonicalAmount(data);
};

export const TRANSACTION_QUERIES = {
  getTransactions,
  getSpendingSummary,
};

export const TRANSACTION_MUTATIONS = {
  createManualTransaction,
  updateTransaction,
};
