import { GraphQLError, type GraphQLFormattedError } from "graphql";

const SAFE_CODES = new Set(["BAD_USER_INPUT", "UNAUTHENTICATED", "FORBIDDEN", "CONFLICT", "NOT_FOUND"]);

const apiError = (message: string, code: string) => new GraphQLError(message, { extensions: { code } });

export const inputError = (message: string) => apiError(message, "BAD_USER_INPUT");
export const notAuthenticated = () => apiError("Not authenticated", "UNAUTHENTICATED");
export const notAuthorized = () => apiError("Not authorized", "FORBIDDEN");
export const notFound = () => apiError("The purchase was not found.", "NOT_FOUND");
export const captureConflict = () =>
  apiError("This event ID already belongs to a different capture. Keep the saved event for review.", "CONFLICT");

// Domain and query-validation errors reach callers; database/SDK details are logged and masked.
export function formatError(formattedError: GraphQLFormattedError, error: unknown): GraphQLFormattedError {
  const code = String(formattedError.extensions?.code ?? "");
  if (SAFE_CODES.has(code) || code.startsWith("GRAPHQL_") || code === "BAD_REQUEST") {
    return { ...formattedError, message: formattedError.message.replace(/ Did you mean [^?]*\?/g, "") };
  }
  console.error("[graphql]", { message: formattedError.message, path: formattedError.path, code, error });
  return {
    message: "The request could not be completed.",
    path: formattedError.path,
    extensions: { code: "INTERNAL_SERVER_ERROR" },
  };
}
