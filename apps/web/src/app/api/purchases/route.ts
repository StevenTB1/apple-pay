const fields = "id source merchant cardLabel: card_label amount currency occurredAt: occurred_at excluded";
const operations = {
  list: `query Month($month: String!, $offset: Int) {
    transactions: getTransactions(month: $month, limit: 50, offset: $offset) { count data { ${fields} } }
    spendingSummary: getSpendingSummary(month: $month) { totalCad: total_cad includedCount: included_count needsReviewCount: needs_review_count excludedCount: excluded_count }
  }`,
  create: `mutation Add($input: ManualTransactionInput!) { createManualTransaction(input: $input) { ${fields} } }`,
  breakdown: `query Breakdown($from_month: String, $to_month: String) {
    breakdown: getSpendingBreakdown(from_month: $from_month, to_month: $to_month) {
      total_cad purchase_count needs_review_count
      months { key total_cad purchase_count } cards { key total_cad purchase_count }
      merchants { key total_cad purchase_count } sources { key total_cad purchase_count }
    }
  }`,
  createToken: `mutation { createShortcutToken { token } }`,
  update: `mutation Correct($id: ID!, $input: TransactionCorrectionInput!) { updateTransaction(transaction_id: $id, input: $input) { ${fields} } }`,
};

function errorResponse(message: string, status: number) {
  return Response.json({ errors: [{ message }] }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization || !/^Bearer (?!ap_)\S{1,8192}$/.test(authorization)) {
    return errorResponse("Owner sign-in is required.", 401);
  }
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return errorResponse("A JSON request is required.", 415);
  }
  const text = await request.text();
  if (text.length > 32 * 1024) return errorResponse("Request body is too large.", 413);
  let body: { action?: unknown; variables?: unknown };
  try {
    body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid body");
  } catch {
    return errorResponse("The request must contain valid JSON.", 400);
  }
  const action = body.action;
  if (typeof action !== "string" || !Object.hasOwn(operations, action)) {
    return errorResponse("Unsupported spending operation.", 400);
  }
  if (!body.variables || typeof body.variables !== "object" || Array.isArray(body.variables)) {
    return errorResponse("Operation variables are required.", 400);
  }
  const endpoint = process.env.GRAPHQL_API_URL;
  if (!endpoint) return errorResponse("The spending service is not configured.", 503);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authorization },
      body: JSON.stringify({ query: operations[action as keyof typeof operations], variables: body.variables }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json();
    // The backend masks domain/infrastructure errors. Never send HTML or raw proxy errors.
    if (!result || typeof result !== "object" || (!result.data && !Array.isArray(result.errors))) {
      return errorResponse("The spending service returned an unexpected response.", 502);
    }
    return Response.json(result, { status: response.status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return errorResponse("Couldn't reach the spending service. If you were saving, refresh purchases before trying again.", 502);
  }
}
