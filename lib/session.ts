import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

/**
 * Data access layer for "who is calling". The user id ALWAYS comes from the
 * server-side session, never from a request body, query string or route param.
 * That one rule is what stops users from reading or changing each other's data.
 */
export async function getSessionUserId(): Promise<string | null> {
  // Sessions are per request: opt out of prerendering before Auth.js runs
  // (it touches crypto before reading cookies, which Cache Components flags).
  await connection();
  const session = await auth();
  return session?.user?.id ?? null;
}

export type CurrentUser = {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
  favoriteMovie: string | null;
};

export async function findUser(userId: string): Promise<CurrentUser | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, image: true, favoriteMovie: true },
  });
}

/** For pages: returns the signed-in user or redirects to the landing page. */
export async function requireUser(): Promise<CurrentUser> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/");
  const user = await findUser(userId);
  if (!user) redirect("/");
  return user;
}
