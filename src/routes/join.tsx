import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { redeemInvite } from "@/functions/invites";

export const Route = createFileRoute("/join")({
  validateSearch: (search: Record<string, unknown>): { code?: string } => ({
    code: typeof search.code === "string" ? search.code : undefined,
  }),
  component: JoinPage,
});

function JoinPage() {
  const { code } = Route.useSearch();
  const [value, setValue] = useState(code ?? "");
  const navigate = useNavigate();
  return (
    <AppShell>
      <AuthGate title="Redeem a code" copy="Sign in first, then paste the Lectern code." next="/join">
        <div className="mx-auto max-w-sm space-y-4 rounded-xl border border-border bg-surface p-6">
          <h1 className="font-display text-3xl tracking-tight">Join Lectern</h1>
          <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="LECT-XXXXXX" />
          <Button
            className="w-full"
            onClick={() => {
              void redeemInvite({ data: { code: value } }).then((result) => {
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                toast.success("Pro unlocked.");
                void navigate({ to: "/classes" });
              });
            }}
          >
            Redeem
          </Button>
        </div>
      </AuthGate>
    </AppShell>
  );
}
