import "server-only";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";

/**
 * Prisma over node-postgres (`pg`) against Neon's *pooled* endpoint
 * (DATABASE_URL, `-pooler` host = PgBouncer). This is Neon's recommended
 * setup for Vercel's Node.js runtime with Fluid compute:
 * - one small `pg` pool per function instance, reused across requests;
 * - `attachDatabasePool` lets Vercel close idle clients before an instance is
 *   suspended, so connections aren't leaked. It's a no-op outside Vercel.
 * Migrations use DATABASE_URL_UNPOOLED instead (see prisma/schema.prisma).
 */
function createPrisma() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 10_000,
  });
  attachDatabasePool(pool);
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

// Reuse one client across hot reloads in dev so we don't exhaust connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrisma();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
