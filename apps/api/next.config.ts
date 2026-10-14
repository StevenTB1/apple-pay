import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // server/schemas.graphql is imported as a parsed document, the same way the schema file is loaded elsewhere.
  turbopack: {
    rules: { "*.graphql": { loaders: ["graphql-tag/loader"], as: "*.js" } },
  },
};

export default nextConfig;
