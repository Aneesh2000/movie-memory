"use client";

import { clearFactCache } from "@/lib/fact-cache";
import { Button } from "@/components/ui";

export function LogoutButton({ userId, action }: { userId: string; action: () => Promise<void> }) {
  return (
    // Clear this user's cached fact before the server action signs them out.
    <form action={action} onSubmit={() => clearFactCache(userId)}>
      <Button type="submit" variant="secondary">
        Log out
      </Button>
    </form>
  );
}
