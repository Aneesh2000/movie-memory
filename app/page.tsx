import { Suspense } from "react";
import { redirect } from "next/navigation";
import { signIn } from "@/auth";
import { getSessionUserId } from "@/lib/session";
import { Button, PageShell } from "@/components/ui";

export default function LandingPage() {
  return (
    <PageShell>
      <div className="flex flex-1 flex-col items-center justify-center gap-8 text-center">
        <span className="text-6xl" aria-hidden>
          🎬
        </span>
        <div className="space-y-3">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Movie Memory</h1>
          <p className="mx-auto max-w-md text-stone-600 dark:text-stone-400">
            Tell us your favourite movie. We&apos;ll remember it and dig up a fun fact about it.
          </p>
        </div>
        <form
          action={async () => {
            "use server";
            // Always land on /dashboard; its guard sends first-time users to onboarding.
            await signIn("google", { redirectTo: "/dashboard" });
          }}
        >
          <Button type="submit" className="px-6 py-3 text-base">
            <GoogleIcon /> Sign in with Google
          </Button>
        </form>
      </div>
      {/* Reads the session at request time, so it streams in behind a boundary. */}
      <Suspense fallback={null}>
        <RedirectIfSignedIn />
      </Suspense>
    </PageShell>
  );
}

async function RedirectIfSignedIn() {
  if (await getSessionUserId()) redirect("/dashboard");
  return null;
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.96 10.96 0 0 0 12 1 11 11 0 0 0 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}
