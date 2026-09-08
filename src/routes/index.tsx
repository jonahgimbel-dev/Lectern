import { Link, createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const user = useCurrentUser();
  return (
    <AppShell>
      <section className="max-w-2xl space-y-5">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Study desk</p>
        <h1 className="font-display text-5xl tracking-tight">
          One class page for every course. Every lecture, ready to study.
        </h1>
        <p className="text-lg text-muted-foreground">
          Record class, get a one-minute recap, flashcards, a practice quiz, and due dates — from Canvas or from what the professor said out loud.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link to={user ? "/classes" : "/login"}>{user ? "Open class hub" : "Sign in"}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/connect">Connect Canvas</Link>
          </Button>
        </div>
      </section>
    </AppShell>
  );
}
