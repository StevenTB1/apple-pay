import { fileURLToPath } from "node:url";
import { loadEnvConfig } from "@next/env";
import { defineConfig } from "prisma/config";

loadEnvConfig(fileURLToPath(new URL(".", import.meta.url)), process.env.NODE_ENV !== "production");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Generation and validation do not need credentials. Migration commands require DIRECT_URL.
  datasource: { url: process.env.DIRECT_URL?.trim() ?? "" },
});
