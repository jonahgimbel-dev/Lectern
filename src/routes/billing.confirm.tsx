import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { confirmCheckout } from "@/functions/billing";

export const Route = createFileRoute("/billing/confirm")({
  validateSearch: (search: Record<string, unknown>): { session_id?: string } => ({
    session_id: typeof search.session_id === "string" ? search.session_id : undefined,
  }),
  component: ConfirmPage,
});

function ConfirmPage() {
  const { session_id } = Route.useSearch();
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    void confirmCheckout({ data: { sessionId: session_id || undefined } })
      .then((result) => setOk(result.ok))
      .catch(() => setOk(false));
  }, [session_id]);
  return (
    <AppShell>
      <div className="mx-auto max-w-md space-y-4 rounded-xl border border-border bg-surface p-6">
        <h1 className="font-display text-3xl tracking-tight">
          {ok === null ? "Confirming…" : ok ? "Pro is on" : "Could not confirm"}
        </h1>
        <Button asChild>
          <Link to="/classes">Back to classes</Link>
        </Button>
      </div>
    </AppShell>
  );
}
