import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};

let prisma: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (prisma) return prisma;
  if (globalForPrisma.prisma) return (prisma = globalForPrisma.prisma);

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString?.trim()) {
    throw new Error("DATABASE_URL is required for transaction storage.");
  }

  const adapter = new PrismaPg(
    {
      connectionString,
      max: 3,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
    },
    { schema: "tracker" },
  );
  prisma = new PrismaClient({ adapter });
  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
  return prisma;
}
