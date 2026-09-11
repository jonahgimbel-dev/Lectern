import { createFileRoute } from "@tanstack/react-router";
import { Camera, ImageUp } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { parseCanvasSnapshot } from "@/functions/canvas-vision";
import { fetchCalendarUrl, importCalendarFeed, importRosterPaste } from "@/functions/lms";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/connect")({ component: ConnectPage });

function ConnectPage() {
  const [url, setUrl] = useState("");
  const [ics, setIcs] = useState("");
  const [roster, setRoster] = useState("");
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <AppShell>
      <AuthGate title="Connect Canvas" copy="Sign in to pull classes from Canvas without an API token." next="/connect">
        <div className="mx-auto max-w-2xl space-y-8">
          <header>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Canvas</p>
            <h1 className="mt-1 font-display text-4xl tracking-tight">Bring in your classes</h1>
            <p className="mt-2 text-muted-foreground">
              Easiest: screenshot your Canvas dashboard. No API keys. We read the gray class names on each card.
            </p>
          </header>

          <section className="rounded-2xl border border-primary bg-primary p-6 text-primary-fg md:p-8">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-primary-fg/70">Do this</p>
            <h2 className="mt-1 font-display text-3xl tracking-tight">Screenshot your Canvas dashboard</h2>

            <ol className="mt-6 space-y-4 text-sm leading-relaxed">
              <li className="flex gap-3">
                <Step n="1" />
                <div>
                  <p className="font-medium">Open Canvas in another tab</p>
                  <p className="mt-0.5 text-primary-fg/70">Go to Dashboard — the page with your class cards. Not Calendar, Inbox, or one class.</p>
                </div>
              </li>
              <li className="flex gap-3">
                <Step n="2" />
                <div>
                  <p className="font-medium">Take a screenshot of that window</p>
                  <ul className="mt-1 space-y-1 text-primary-fg/70">
                    <li>Mac: press Shift + Command + 4, then Space, then click the Canvas window.</li>
                    <li>Windows: press Windows + Shift + S, then click the Canvas window.</li>
                    <li>Phone: screenshot Dashboard, then send the photo to this computer.</li>
                  </ul>
                </div>
              </li>
              <li className="flex gap-3">
                <Step n="3" />
                <div>
                  <p className="font-medium">Upload it here</p>
                  <p className="mt-0.5 text-primary-fg/70">We look for the gray titles on each card — those are the class names.</p>
                </div>
              </li>
            </ol>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {["AI for Mustangs", "Creative Entrepreneurship", "Intro to Computing"].map((name) => (
                <div key={name} className="rounded-xl bg-primary-fg/10 px-3 py-3">
                  <p className="text-[10px] uppercase tracking-wider text-primary-fg/50">Course</p>
                  <p className="mt-1 text-sm text-primary-fg/80">{name}</p>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-primary-fg/60">Those gray lines are what we need. Skip To Do, Announcements, and Inbox.</p>

            <input
              ref={fileRef}
              type="file"
              accept="image/*,.heic"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void useScreenshot(file);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={busy === "snap"}
              onClick={() => fileRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragOver(false);
                const file = event.dataTransfer.files[0];
                if (file) void useScreenshot(file);
              }}
              className={cn(
                "mt-6 flex min-h-36 w-full flex-col items-center justify-center rounded-2xl border border-dashed px-4 text-center transition-colors",
                dragOver ? "border-accent bg-accent/20" : "border-primary-fg/25 bg-primary-fg/5",
              )}
            >
              <ImageUp className="h-6 w-6" />
              <span className="mt-2 font-display text-xl">{busy === "snap" ? "Reading your screenshot…" : "Drop screenshot or click to upload"}</span>
              <span className="mt-1 text-sm text-primary-fg/70">PNG, JPG, or a phone photo</span>
            </button>

            {preview ? (
              <img src={preview} alt="Canvas screenshot you uploaded" className="mt-4 max-h-56 w-full rounded-xl object-contain bg-primary-fg/10" />
            ) : null}

            <Button
              type="button"
              variant="outline"
              className="mt-4 border-primary-fg/20 bg-transparent text-primary-fg hover:bg-primary-fg/10"
              disabled={busy === "snap"}
              onClick={() => {
                setBusy("snap");
                void captureTab()
                  .catch((error: Error) => toast.error(error.message))
                  .finally(() => setBusy(""));
              }}
            >
              <Camera className="h-4 w-4" />
              {busy === "snap" ? "Reading…" : "Or share the Canvas tab instead"}
            </Button>
            <p className="mt-2 text-xs text-primary-fg/60">
              If you share a tab: click the Chrome tab that says Canvas, then Share. Stay on Dashboard.
            </p>
          </section>

          <section className="rounded-xl border border-border bg-surface p-5 space-y-3">
            <h2 className="font-display text-xl">Want due dates too?</h2>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
              <li>In Canvas, open Calendar.</li>
              <li>Click Calendar Feed (usually on the right).</li>
              <li>Copy the URL and paste it below.</li>
            </ol>
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
            <h2 className="font-display text-xl">Or type the class names</h2>
            <p className="text-sm text-muted-foreground">One class per line. Copy the gray titles from your dashboard.</p>
            <Textarea value={roster} onChange={(e) => setRoster(e.target.value)} placeholder={"AI for Mustangs\nCreative Entrepreneurship\nCS 1340 Intro to Computing"} />
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
        </div>
      </AuthGate>
    </AppShell>
  );

  async function useScreenshot(file: File) {
    if (!file.type.startsWith("image/") && !file.name.toLowerCase().endsWith(".heic")) {
      toast.error("Pick a photo of your Canvas dashboard.");
      return;
    }
    setBusy("snap");
    try {
      const image = await fileToDataUrl(file);
      setPreview(image);
      await importFromImage(image);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read that screenshot.");
    } finally {
      setBusy("");
    }
  }
}

function Step({ n }: { n: string }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent font-display text-sm text-primary-fg">
      {n}
    </span>
  );
}

async function fileToDataUrl(file: File) {
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not open that file."));
    reader.readAsDataURL(file);
  });
  return shrinkImage(raw);
}

async function shrinkImage(dataUrl: string) {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Could not read that picture."));
    el.src = dataUrl;
  });
  const max = 1600;
  const scale = Math.min(1, max / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

async function importFromImage(image: string) {
  const parsed = await parseCanvasSnapshot({ data: { image } });
  if (!parsed.ok) throw new Error(parsed.error);
  const text = parsed.courses.map((row) => `${row.code} ${row.name}`).join("\n");
  const imported = await importRosterPaste({ data: { text } });
  if (!imported.ok) throw new Error(imported.error);
  toast.success(`Added ${imported.classes} classes from your screenshot.`);
}

async function captureTab() {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  const video = document.createElement("video");
  video.srcObject = stream;
  await video.play();
  await new Promise((resolve) => window.setTimeout(resolve, 250));
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
  await importFromImage(image);
}
