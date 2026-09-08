import type { ReactNode } from "react";
import { SessionReady } from "@/components/session-ready";
import { SignInPrompt } from "@/components/sign-in-prompt";

export function AuthGate({
  title,
  copy,
  next,
  children,
}: {
  title: string;
  copy: string;
  next?: string;
  children: ReactNode;
}) {
  return (
    <SessionReady>
      {(user) => (user ? children : <SignInPrompt title={title} copy={copy} next={next} />)}
    </SessionReady>
  );
}
