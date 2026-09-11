import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Mic, Pause, Square } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getBearerToken, setBearerToken } from "@/lib/auth/client";
import { formatDuration } from "@/lib/format";
import {
  discardLecture,
  getLectureSession,
  saveLectureSession,
  startLecture,
  subscribeLectureSession,
  togglePause,
} from "@/lib/lecture-session";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/record/booth")({
  validateSearch: (search: Record<string, unknown>): { courseId?: string } => ({
    courseId: typeof search.courseId === "string" ? search.courseId : undefined,
  }),
  component: BoothPage,
});

function BoothPage() {
  const { courseId } = Route.useSearch();
  const navigate = useNavigate();
  const session = useSyncExternalStore(subscribeLectureSession, getLectureSession, getLectureSession);

  useEffect(() => {
    const origin = window.location.origin;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin) return;
      const data = event.data as { source?: string; token?: string } | undefined;
      if (data?.source !== "lectern-booth" || !data.token) return;
      setBearerToken(data.token);
    };
    window.addEventListener("message", onMessage);
    window.opener?.postMessage({ source: "lectern-booth", type: "ready" }, origin);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const live = session.live;
  const shown = session.captions.trim();
  const captionCopy = shown
    ? shown
    : session.lastError
      ? session.lastError
      : live && session.hearing
        ? "Hearing you…"
        : live
          ? "Listening — talk toward the mic."
          : "This window can use your microphone. Hit Rec, then allow access.";

  async function rec() {
    try {
      await startLecture(courseId ?? session.courseId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Allow the microphone, then hit Rec.");
    }
  }

  async function stopSave() {
    const result = await saveLectureSession();
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Lecture saved.");
    const origin = window.location.origin;
    window.opener?.postMessage({ source: "lectern-booth", type: "saved", id: result.id }, origin);
    if (window.opener) {
      window.close();
      return;
    }
    void navigate({ to: "/lecture/$id", params: { id: result.id } });
  }

  return (
    <div className="min-h-screen bg-bg px-5 py-6 text-fg">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Lectern booth</p>
      <h1 className="mt-1 font-display text-3xl tracking-tight">Record</h1>
      <p className="mt-2 font-display text-5xl tabular-nums">{formatDuration(session.seconds)}</p>

      <div className="mt-8 flex justify-center">
        {!live ? (
          <button
            type="button"
            disabled={session.saving}
            onClick={() => void rec()}
            className="flex h-32 w-32 flex-col items-center justify-center rounded-full bg-accent text-primary-fg"
          >
            <Mic className="h-7 w-7" />
            <span className="mt-1 font-display text-xl">{session.starting ? "…" : "Rec"}</span>
          </button>
        ) : (
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="accent" onClick={() => void stopSave()} disabled={session.saving}>
              <Square className="h-4 w-4 fill-current" />
              {session.saving ? "Saving…" : "Stop & save"}
            </Button>
            <Button variant="outline" onClick={() => togglePause()}>
              <Pause className="h-4 w-4" />
              {session.paused ? "Resume" : "Pause"}
            </Button>
            <Button variant="outline" onClick={() => discardLecture()}>
              Discard
            </Button>
          </div>
        )}
      </div>

      {live ? (
        <div className="mt-6 flex h-14 items-end gap-1 rounded-xl bg-primary px-3 py-2">
          {session.levels.map((level, i) => (
            <span
              key={i}
              className={cn("w-full rounded-full", session.hearing ? "bg-accent" : "bg-primary-fg/40")}
              style={{ height: `${Math.round(18 + level * 82)}%` }}
            />
          ))}
        </div>
      ) : null}

      <div className="mt-5 min-h-32 rounded-xl border border-border bg-surface p-4 text-sm leading-relaxed">
        {captionCopy}
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{session.status}</p>
      {!getBearerToken() && !live ? (
        <p className="mt-4 text-sm text-muted-foreground">Keep this window open while class is going.</p>
      ) : null}
    </div>
  );
}
