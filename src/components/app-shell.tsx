import { Link } from "@tanstack/react-router";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { SignedIn, SignedOut, UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getOwnerState } from "@/functions/usage";
import { formatDuration } from "@/lib/format";
import { getLectureSession, subscribeLectureSession } from "@/lib/lecture-session";

const LINKS = [
  ["Classes", "/classes"],
  ["Record", "/record"],
  ["Search", "/search"],
  ["Connect", "/connect"],
  ["Pricing", "/pricing"],
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { user, isPending } = useCurrentUserState();
  const [isOwner, setIsOwner] = useState(false);
  const rec = useSyncExternalStore(subscribeLectureSession, getLectureSession, getLectureSession);

  useEffect(() => {
    if (!user) {
      setIsOwner(false);
      return;
    }
    void getOwnerState()
      .then((state) => setIsOwner(state.isOwner))
      .catch(() => setIsOwner(false));
  }, [user?.id]);

  return (
    <div className="min-h-screen bg-bg text-fg">
      {rec.live ? (
        <Link
          to="/record"
          className="block border-b border-accent/30 bg-accent text-primary-fg"
        >
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2 text-sm">
            <span className="inline-flex items-center gap-2 font-medium">
              <span className="h-2 w-2 animate-pulse rounded-full bg-primary-fg" />
              {rec.paused ? "Recording paused" : "Recording in the background"}
            </span>
            <span className="tabular-nums">
              {formatDuration(rec.seconds)} · back to recorder
            </span>
          </div>
        </Link>
      ) : null}
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="font-display text-xl tracking-tight">
            Lectern
          </Link>
          <nav className="hidden items-center gap-4 text-sm md:flex">
            {LINKS.map(([label, href]) => (
              <Link key={href} to={href} className="text-muted-foreground hover:text-fg">
                {label}
              </Link>
            ))}
            {isOwner ? (
              <Link to="/usage" className="font-medium text-primary">
                Owner
              </Link>
            ) : null}
          </nav>
          <div className="flex items-center gap-3">
            {isOwner ? (
              <Link to="/usage" className="text-sm font-medium text-primary md:hidden">
                Owner
              </Link>
            ) : null}
            {isPending ? (
              <div className="h-8 w-8 animate-pulse rounded-full bg-secondary" />
            ) : user ? (
              <SignedIn>
                <UserButton />
              </SignedIn>
            ) : (
              <SignedOut>
                <Link to="/login" className="text-sm font-medium">
                  Sign in
                </Link>
              </SignedOut>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
