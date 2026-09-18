import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { SignedIn, SignedOut, UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getOwnerState } from "@/functions/usage";
import { formatDuration } from "@/lib/format";
import { getLectureSession, subscribeLectureSession } from "@/lib/lecture-session";
import { cn } from "@/lib/utils";

const LINKS = [
  ["Classes", "/classes"],
  ["Record", "/record"],
  ["Search", "/search"],
  ["Connect", "/connect"],
  ["Pricing", "/pricing"],
] as const;

export function AppShell({ children, home = false }: { children: ReactNode; home?: boolean }) {
  const { user, isPending } = useCurrentUserState();
  const [isOwner, setIsOwner] = useState(false);
  const [menu, setMenu] = useState(false);
  const rec = useSyncExternalStore(subscribeLectureSession, getLectureSession, getLectureSession);
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    if (!user) {
      setIsOwner(false);
      return;
    }
    void getOwnerState()
      .then((state) => setIsOwner(state.isOwner))
      .catch(() => setIsOwner(false));
  }, [user?.id]);

  useEffect(() => {
    setMenu(false);
  }, [pathname]);

  return (
    <div className="min-h-screen bg-bg text-fg">
      {rec.live ? (
        <Link to="/record" className="block border-b border-accent/30 bg-accent text-primary-fg">
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
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="inline-flex items-center gap-2 font-display text-xl tracking-tight">
            <span className="size-2 rounded-full bg-accent" aria-hidden />
            Lectern
          </Link>
          <nav className="hidden items-center gap-1 text-sm md:flex">
            {LINKS.map(([label, href]) => (
              <Link
                key={href}
                to={href}
                className={cn(
                  "rounded-lg px-3 py-2 text-muted-foreground transition-colors duration-150 hover:text-fg",
                  pathname === href && "bg-secondary font-medium text-fg",
                )}
              >
                {label}
              </Link>
            ))}
            {isOwner ? (
              <Link
                to="/usage"
                className={cn(
                  "rounded-lg px-3 py-2 font-medium text-primary",
                  pathname === "/usage" && "bg-secondary",
                )}
              >
                Owner
              </Link>
            ) : null}
          </nav>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="min-h-11 rounded-lg px-3 text-sm md:hidden"
              onClick={() => setMenu((open) => !open)}
              aria-expanded={menu}
            >
              {menu ? "Close" : "Menu"}
            </button>
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
        {menu ? (
          <nav className="border-t border-border bg-surface px-4 py-3 md:hidden">
            <ul className="space-y-1">
              {LINKS.map(([label, href]) => (
                <li key={href}>
                  <Link
                    to={href}
                    className={cn(
                      "block min-h-11 rounded-lg px-3 py-2 text-muted-foreground",
                      pathname === href && "bg-secondary font-medium text-fg",
                    )}
                  >
                    {label}
                  </Link>
                </li>
              ))}
              {isOwner ? (
                <li>
                  <Link to="/usage" className="block min-h-11 rounded-lg px-3 py-2 font-medium text-primary">
                    Owner
                  </Link>
                </li>
              ) : null}
            </ul>
          </nav>
        ) : null}
      </header>
      <main className={cn(home ? "" : "mx-auto max-w-6xl px-4 py-8")}>{children}</main>
      <footer className={cn("border-t border-border", home ? "" : "mt-8")}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted-foreground">
          <p>Lectern · study from the lecture, not a wall of notes.</p>
          <div className="flex flex-wrap gap-4">
            <Link to="/privacy" className="hover:text-fg">
              Privacy
            </Link>
            <Link to="/pricing" className="hover:text-fg">
              Pricing
            </Link>
            <Link to="/join" className="hover:text-fg">
              Have a code?
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
