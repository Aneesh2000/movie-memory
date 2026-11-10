import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";

/**
 * Auth.js v5 with Google and *database* sessions:
 * - The session lives in Postgres, so it can be revoked server-side.
 * - The browser only holds an opaque, httpOnly session-token cookie.
 * Reads AUTH_SECRET, AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET from the environment.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [Google],
  session: { strategy: "database" },
  pages: { signIn: "/" },
  callbacks: {
    session({ session, user }) {
      // Expose our DB user id; every query is scoped by it.
      session.user.id = user.id;
      return session;
    },
  },
});
