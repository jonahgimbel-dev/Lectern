import { useRef, type ReactNode } from "react";
import { useCurrentUserState, type AppUser } from "@/lib/auth/use-current-user";

export function SessionReady({
  children,
}: {
  children: (user: AppUser | null) => ReactNode;
}) {
  const { user, isPending } = useCurrentUserState();
  const lastUser = useRef<AppUser | null>(user);
  if (user) lastUser.current = user;
  if (!isPending && !user) lastUser.current = null;
  if (isPending && !lastUser.current) {
    return (
      <div className="space-y-3">
        <div className="h-4 w-24 rounded bg-secondary" />
        <div className="h-10 w-64 rounded bg-secondary" />
        <div className="h-40 rounded-xl bg-secondary" />
      </div>
    );
  }
  return <>{children(user ?? lastUser.current)}</>;
}
