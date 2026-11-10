import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { Card, PageShell } from "@/components/ui";
import { OnboardingForm } from "./onboarding-form";

export default function OnboardingPage() {
  return (
    <PageShell>
      <div className="flex flex-1 flex-col justify-center">
        <Card className="space-y-6">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Welcome to Movie Memory</h1>
            <p className="text-stone-600 dark:text-stone-400">One quick question before we start.</p>
          </div>
          <Suspense fallback={<div className="h-32 animate-pulse rounded-lg bg-stone-100 dark:bg-stone-800" />}>
            <OnboardingGate />
          </Suspense>
        </Card>
      </div>
    </PageShell>
  );
}

async function OnboardingGate() {
  const user = await requireUser(); // signed out -> "/"
  if (user.favoriteMovie) redirect("/dashboard"); // returning user
  return <OnboardingForm />;
}
