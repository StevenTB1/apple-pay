export function GET() {
  return Response.json({
    service: "apple-pay-api",
    status: "api",
    graphql: "/api/graphql",
  });
}
