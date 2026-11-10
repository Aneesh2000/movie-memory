import type { MeResponse } from "@/lib/api-types";
import { unauthorized, withErrorHandling } from "@/lib/http";
import { findUser, getSessionUserId } from "@/lib/session";

export const GET = withErrorHandling(async () => {
  const userId = await getSessionUserId();
  if (!userId) return unauthorized();

  const user = await findUser(userId);
  if (!user) return unauthorized();

  const body: MeResponse = { user };
  return Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
});
