import { Suspense } from "react";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { requireUser, type CurrentUser } from "@/lib/session";
import { Card, PageShell } from "@/components/ui";
import { DashboardClient } from "./dashboard-client";
import { LogoutButton } from "./logout-button";

export default function DashboardPage() {
  return (
    <PageShell>
      <Suspense fallback={<DashboardSkeleton />}>
        <Dashboard />
      </Suspense>
    </PageShell>
  );
}

async function Dashboard() {
  const user = await requireUser(); // signed out -> "/"
  if (!user.favoriteMovie) redirect("/onboarding"); // first-time user

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <>
      <Card className="flex flex-wrap items-center justify-between gap-4">
        <Profile user={user} />
        <LogoutButton userId={user.id} action={logout} />
      </Card>
      <DashboardClient userId={user.id} initialMovie={user.favoriteMovie} />
    </>
  );
}

function Profile({ user }: { user: CurrentUser }) {
  // Google may omit the name and/or photo, so fall back gracefully.
  const displayName = user.name?.trim() || user.email?.split("@")[0] || "Movie fan";
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <div className="flex min-w-0 items-center gap-4">
      {user.image ? (
        // Plain <img>: a 48px avatar doesn't need the image optimiser, and
        // no-referrer avoids Google's avatar CDN rejecting hotlinked requests.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.image} alt="" width={48} height={48} referrerPolicy="no-referrer" className="h-12 w-12 rounded-full" />
      ) : (
        <div
          aria-hidden
          className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-lg font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
        >
          {initial}
        </div>
      )}
      <div className="min-w-0">
        <p className="truncate font-semibold">{displayName}</p>
        {user.email && <p className="truncate text-sm text-stone-500">{user.email}</p>}
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading dashboard">
      {[80, 96, 128].map((h) => (
        <div key={h} style={{ height: h }} className="animate-pulse rounded-2xl bg-stone-200/70 dark:bg-stone-800/70" />
      ))}
    </div>
  );
}
