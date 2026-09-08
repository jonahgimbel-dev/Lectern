import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { parseCanvasSnapshot } from "@/functions/canvas-vision";
import { fetchCalendarUrl, importCalendarFeed, importRosterPaste } from "@/functions/lms";

export const Route = createFileRoute("/connect")({ component: ConnectPage });

function ConnectPage() {
  const [url, setUrl] = useState("");
  const [ics, setIcs] = useState("");
  const [roster, setRoster] = useState("");
  const [busy, setBusy] = useState("");

  return (
    <AppShell>
      <AuthGate title="Connect Canvas" copy="Sign in to pull classes from Canvas without an API token." next="/connect">
        <div className="mx-auto max-w-2xl space-y-8">
          <header>
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Canvas</p>
            <h1 className="mt-1 font-display text-4xl tracking-tight">Bring in your classes</h1>
            <p className="mt-2 text-muted-foreground">
              Many schools block API tokens. Use the calendar feed, paste the dashboard, or snapshot the course cards.
            </p>
          </header>
          <section className="rounded-xl border border-border bg-surface p-5 space-y-3">
            <h2 className="font-display text-xl">Calendar feed</h2>
            <p className="text-sm text-muted-foreground">
              Canvas → Calendar → Calendar Feed → copy the URL. That lists real classes and due dates.
            </p>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/feeds/calendars/user_…" />
            <Button
              disabled={busy === "url"}
              onClick={() => {
                setBusy("url");
                void fetchCalendarUrl({ data: { url } })
                  .then((result) => {
                    if (!result.ok) toast.error(result.error);
                    else toast.success(`Imported ${result.classes} classes.`);
                  })
                  .finally(() => setBusy(""));
              }}
            >
              {busy === "url" ? "Reading…" : "Import feed URL"}
            </Button>
            <Textarea value={ics} onChange={(e) => setIcs(e.target.value)} placeholder="Or paste the .ics text" />
            <Button
              variant="outline"
              disabled={busy === "ics"}
              onClick={() => {
                setBusy("ics");
                void importCalendarFeed({ data: { ics } })
                  .then((result) => {
                    if (!result.ok) toast.error(result.error);
                    else toast.success(`Imported ${result.classes} classes.`);
                  })
                  .finally(() => setBusy(""));
              }}
            >
              Import pasted calendar
            </Button>
          </section>
          <section className="rounded-xl border border-border bg-surface p-5 space-y-3">
            <h2 className="font-display text-xl">Paste dashboard text</h2>
            <p className="text-sm text-muted-foreground">Copy the gray course names from Canvas and paste them here.</p>
            <Textarea value={roster} onChange={(e) => setRoster(e.target.value)} placeholder="ACCT 2302 Managerial Accounting" />
            <Button
              disabled={busy === "paste"}
              onClick={() => {
                setBusy("paste");
                void importRosterPaste({ data: { text: roster } })
                  .then((result) => {
                    if (!result.ok) toast.error(result.error);
                    else toast.success(`Added ${result.classes} classes.`);
                  })
                  .finally(() => setBusy(""));
              }}
            >
              Add classes
            </Button>
          </section>
          <section className="rounded-xl border border-border bg-surface p-5 space-y-3">
            <h2 className="font-display text-xl">Snapshot the dashboard</h2>
            <p className="text-sm text-muted-foreground">Share a tab of Canvas. Lectern reads the gray course titles.</p>
            <Button
              variant="outline"
              disabled={busy === "snap"}
              onClick={() => {
                setBusy("snap");
                void captureTab()
                  .catch((error: Error) => toast.error(error.message))
                  .finally(() => setBusy(""));
              }}
            >
              {busy === "snap" ? "Reading…" : "Capture Canvas tab"}
            </Button>
          </section>
        </div>
      </AuthGate>
    </AppShell>
  );
}

async function captureTab() {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  const video = document.createElement("video");
  video.srcObject = stream;
  await video.play();
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("Could not read the frame.");
  }
  ctx.drawImage(video, 0, 0);
  const image = canvas.toDataURL("image/jpeg", 0.7);
  stream.getTracks().forEach((track) => track.stop());
  const parsed = await parseCanvasSnapshot({ data: { image } });
  if (!parsed.ok) throw new Error(parsed.error);
  const text = parsed.courses.map((row) => `${row.code} ${row.name}`).join("\n");
  const imported = await importRosterPaste({ data: { text } });
  if (!imported.ok) throw new Error(imported.error);
  toast.success(`Added ${imported.classes} classes from the snapshot.`);
}
