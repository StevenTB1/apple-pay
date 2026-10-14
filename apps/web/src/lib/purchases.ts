export type Purchase = {
  id: string;
  source: "APPLE_PAY" | "MANUAL";
  merchant: string | null;
  cardLabel: string | null;
  amount: string | null;
  currency: string | null;
  occurredAt: string;
  excluded: boolean;
};

export type MonthData = {
  transactions: { count: number; data: Purchase[] };
  spendingSummary: {
    totalCad: string;
    includedCount: number;
    needsReviewCount: number;
    excludedCount: number;
  };
};

export async function purchaseRequest<T>(
  token: string,
  action: "list" | "create" | "update" | "createToken",
  variables: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch("/api/purchases", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, variables }),
      signal,
      cache: "no-store",
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(action === "list"
      ? "Couldn't reach the spending service. Check your connection and try refreshing."
      : "Couldn't confirm the save. Refresh purchases before trying again.");
  }
  const result = await response.json();
  if (!response.ok || result.errors?.length || !result.data) {
    const error = result.errors?.[0];
    if (error?.extensions?.code === "UNAUTHENTICATED" || error?.extensions?.code === "FORBIDDEN") {
      throw new Error("Your session has expired. Sign in again.");
    }
    throw new Error(error?.message ?? "The spending service could not complete the request.");
  }
  return result.data as T;
}

// Formatting stays in strings, so large or fractional amounts never pass through a float.
export function decimalDisplay(value: string): string {
  const [integer, fraction = ""] = value.split(".");
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction.padEnd(2, "0")}`;
}

export function localDateTime(instant?: string): string {
  const date = instant ? new Date(instant) : new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
