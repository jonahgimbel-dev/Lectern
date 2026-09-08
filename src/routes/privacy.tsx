import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";

export const Route = createFileRoute("/privacy")({ component: PrivacyPage });

function PrivacyPage() {
  return (
    <AppShell>
      <article className="mx-auto max-w-2xl space-y-4">
        <h1 className="font-display text-4xl tracking-tight">Privacy</h1>
        <p>Lectern stores your classes, lectures, and recaps so you can study later. Recordings are transcribed on the server, then discarded as audio. Transcripts stay on your account.</p>
        <p>Canvas calendar feeds are fetched only when you paste them. We do not log into Canvas as you. We do not sell student data.</p>
        <p>You can delete a lecture, class, card, or due date at any time. Sign-in uses Google, X, or email.</p>
      </article>
    </AppShell>
  );
}
