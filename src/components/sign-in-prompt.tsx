import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export function SignInPrompt({
  title,
  copy,
  next = "/classes",
}: {
  title: string;
  copy: string;
  next?: string;
}) {
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-border bg-surface p-6">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Sign in</p>
      <h1 className="mt-1 font-display text-3xl tracking-tight">{title}</h1>
      <p className="mt-2 text-muted-foreground">{copy}</p>
      <Button asChild className="mt-5">
        <Link to="/login" search={{ next }}>
          Sign in
        </Link>
      </Button>
    </div>
  );
}
