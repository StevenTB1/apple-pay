import { createYoga } from "graphql-yoga";
import { authenticateRequest } from "@/lib/auth";
import { getPrisma } from "@/lib/db";
import { type ApiContext, maskApiError, schema } from "@/lib/graphql";
import { boundGraphQLRequest } from "@/lib/http";

export const runtime = "nodejs";

// This endpoint has no dynamic Next.js route parameters. Keep Yoga's GraphQL
// params separate from Next.js's unrelated route-context params.
const { handleRequest } = createYoga<object, ApiContext>({
  graphqlEndpoint: "/api/graphql",
  graphiql: false,
  landingPage: false,
  cors: false,
  fetchAPI: { Response },
  schema,
  context: async ({ request }) => ({ principal: await authenticateRequest(request), db: getPrisma }),
  maskedErrors: { maskError: maskApiError, isDev: false },
  logging: false,
});

async function handle(request: Request) {
  const bounded = await boundGraphQLRequest(request);
  const response = bounded instanceof Response ? bounded : await handleRequest(bounded, {});
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export { handle as GET, handle as POST, handle as OPTIONS };
