import { Link, createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { SubscribeButton } from "@/components/subscribe-button";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/pricing")({ component: PricingPage });

function PricingPage() {
  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-8">
        <header>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Pricing</p>
          <h1 className="mt-2 font-display text-4xl tracking-tight">Two lectures free. Then keep going.</h1>
          <p className="mt-2 max-w-xl text-muted-foreground">Taste the recap. Unlock unlimited lectures, quizzes, and Canvas when you’re using it in class.</p>
        </header>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-surface p-6">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Free</p>
            <h2 className="mt-2 font-display text-3xl">Taste</h2>
            <p className="mt-2 text-muted-foreground">Two lectures, recap, class hub, search.</p>
          </div>
          <div className="rounded-lg border-2 border-primary bg-surface p-6 lift">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Pro</p>
            <h2 className="mt-2 font-display text-3xl">$9 / month</h2>
            <p className="mt-2 text-muted-foreground">Unlimited lectures, quizzes, cram sheets, Canvas feed.</p>
            <div className="mt-5">
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
