import { Link, createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { SubscribeButton } from "@/components/subscribe-button";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/pricing")({ component: PricingPage });

function PricingPage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-8">
        <h1 className="font-display text-4xl tracking-tight">Simple pricing</h1>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-border bg-surface p-5">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Free</p>
            <h2 className="mt-1 font-display text-3xl">Taste</h2>
            <p className="mt-2 text-muted-foreground">Two lectures, recap, and a class hub.</p>
          </div>
          <div className="rounded-xl border-2 border-primary bg-surface p-5">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Pro</p>
            <h2 className="mt-1 font-display text-3xl">$9 / month</h2>
            <p className="mt-2 text-muted-foreground">Unlimited lectures, quizzes, cram sheets, Canvas feed.</p>
            <div className="mt-4">
              <SubscribeButton />
            </div>
          </div>
        </div>
        <Button asChild variant="outline">
          <Link to="/join">Have a code?</Link>
        </Button>
      </div>
    </AppShell>
  );
}
