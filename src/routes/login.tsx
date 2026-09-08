import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GROK_PROVIDERS, authClient, authEnabled, signIn } from "@/lib/auth/client";
import { safeNextPath } from "@/lib/next-path";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { next?: string } => ({
    next: typeof search.next === "string" ? search.next : undefined,
  }),
  component: Login,
});

function Login() {
  const { next } = Route.useSearch();
  const callbackURL = safeNextPath(next);
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"in" | "up">("in");
  const [busy, setBusy] = useState(false);

  return (
    <AppShell>
      <div className="mx-auto max-w-sm space-y-5 rounded-xl border border-border bg-surface p-6">
        <h1 className="font-display text-3xl tracking-tight">{mode === "in" ? "Sign in" : "Create an account"}</h1>
        {authEnabled ? (
          <>
            <div className="space-y-2">
              {GROK_PROVIDERS.map((p) => (
                <Button
                  key={p.providerId}
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => signIn(p.providerId, { callbackURL })}
                >
                  Continue with {p.label}
                </Button>
              ))}
            </div>
            <p className="text-center text-xs uppercase tracking-[0.14em] text-muted-foreground">or email</p>
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                setBusy(true);
                const run =
                  mode === "up"
                    ? authClient.signUp.email({ email, password, name: name || email.split("@")[0] })
                    : authClient.signIn.email({ email, password });
                void run
                  .then((result) => {
                    if (result.error) {
                      toast.error(result.error.message || "Could not sign in.");
                      return;
                    }
                    toast.success("Signed in.");
                    void navigate({ to: callbackURL });
                  })
                  .catch(() => toast.error("Could not sign in."))
                  .finally(() => setBusy(false));
              }}
            >
              {mode === "up" ? (
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
              ) : null}
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" required />
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                required
              />
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Working…" : mode === "up" ? "Create account" : "Sign in"}
              </Button>
            </form>
            <button
              type="button"
              className="text-sm text-muted-foreground underline"
              onClick={() => setMode(mode === "in" ? "up" : "in")}
            >
              {mode === "in" ? "Create an account" : "Already have an account?"}
            </button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Sign-in is disabled.</p>
        )}
      </div>
    </AppShell>
  );
}
