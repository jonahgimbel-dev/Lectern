import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Mic, Pause, Square, Upload } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createCourse, listCourses } from "@/functions/data";
import { getBearerToken } from "@/lib/auth/client";
import { formatDuration } from "@/lib/format";
import {
  discardLecture,
  getLectureSession,
  saveDraftAgain,
  saveLectureSession,
  saveTypedLecture,
  saveUploadedLecture,
  setLectureCourse,
  startLecture,
  subscribeLectureSession,
  togglePause,
} from "@/lib/lecture-session";
import type { Course } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/record")({
  validateSearch: (search: Record<string, unknown>): { courseId?: string } => ({
    courseId: typeof search.courseId === "string" ? search.courseId : undefined,
  }),
  component: RecordPage,
});

function RecordPage() {
  const { courseId } = Route.useSearch();
  const navigate = useNavigate();
  const session = useSyncExternalStore(subscribeLectureSession, getLectureSession, getLectureSession);
  const [courses, setCourses] = useState<Course[]>([]);
  const [pick, setPick] = useState(courseId ?? session.courseId);
  const [name, setName] = useState("");
  const [typed, setTyped] = useState("");
  const [framed, setFramed] = useState(false);

  async function loadCourses(selectId?: string) {
    const rows = await listCourses().catch(() => [] as Course[]);
    setCourses(rows);
    setPick((current) => selectId || current || courseId || session.courseId || rows[0]?.id || "");
  }

  useEffect(() => {
    void loadCourses();
  }, [courseId]);

  useEffect(() => {
    try {
      setFramed(window.self !== window.top);
    } catch {
      setFramed(true);
    }
  }, []);

  useEffect(() => {
    const origin = window.location.origin;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== origin) return;
      const data = event.data as { source?: string; type?: string; id?: string } | undefined;
      if (data?.source !== "lectern-booth" || data.type !== "saved" || !data.id) return;
      toast.success("Lecture saved.");
      void navigate({ to: "/lecture/$id", params: { id: data.id } });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [navigate]);

  useEffect(() => {
    if (!pick && courses[0]?.id) setPick(courses[0].id);
  }, [courses, pick]);

  function rec() {
    if (pick) setLectureCourse(pick);
    let framed = false;
    try {
      framed = window.self !== window.top || window.location.hostname.endsWith(".grok-sandbox.com");
    } catch {
      framed = true;
    }
    if (framed) {
      const booth = window.open(
        `${window.location.origin}/record/booth${pick ? `?courseId=${encodeURIComponent(pick)}` : ""}`,
        `lectern-booth-${Date.now()}`,
        "popup,width=440,height=760",
      );
      if (!booth) {
        toast.error("Allow pop-ups, then hit Rec. The mic needs its own window.");
        return;
      }
      const token = getBearerToken();
      const origin = window.location.origin;
      const sendToken = (event: MessageEvent) => {
        if (event.origin !== origin) return;
        const data = event.data as { source?: string; type?: string } | undefined;
        if (data?.source !== "lectern-booth" || data.type !== "ready") return;
        if (token) booth.postMessage({ source: "lectern-booth", token }, origin);
        window.removeEventListener("message", sendToken);
      };
      window.addEventListener("message", sendToken);
      toast.message("Hit Rec in the booth window — that’s the one that can hear you.");
      return;
    }
    void startLecture(pick).catch((error) => {
      toast.error(error instanceof Error ? error.message : "Allow the microphone, then hit Rec.");
    });
  }

  async function stopSave() {
    if (pick) setLectureCourse(pick);
    const result = await saveLectureSession();
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Lecture saved.");
    void navigate({ to: "/lecture/$id", params: { id: result.id } });
  }

  async function finish(result: { ok: true; id: string } | { ok: false; error: string }) {
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Lecture saved.");
    void navigate({ to: "/lecture/$id", params: { id: result.id } });
  }

  const live = session.live;
  const shown = session.captions.trim();
  const busy = session.saving || session.starting;
  const captionCopy = shown
    ? shown
    : live && session.hearing
      ? "Hearing you…"
      : live && session.seconds >= 4 && !session.hearing
        ? "Mic is open but silent. If class is on Zoom or a video, use Share tab audio."
        : live
          ? "Listening — talk toward the mic."
          : "Captions show up here as you talk.";

  return (
    <AppShell>
      <AuthGate title="Record a lecture" copy="Sign in, then capture class into a study recap." next="/record">
        <div className="mx-auto max-w-2xl space-y-6">
          <header className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Studio</p>
              <h1 className="mt-1 font-display text-4xl tracking-tight md:text-5xl">Record</h1>
            </div>
            {live ? (
              <span className="mb-1 inline-flex items-center gap-2 text-sm font-medium text-accent">
                <span className={cn("h-2.5 w-2.5 rounded-full bg-accent", session.paused ? "opacity-40" : "animate-pulse")} />
                {session.paused ? "Paused" : "REC"}
              </span>
            ) : null}
          </header>

          {framed ? (
            <div className="rounded-2xl border border-accent/40 bg-accent/10 p-5">
              <p className="font-display text-xl">This window can’t hear you</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Browsers block the microphone in a small preview. Open the studio in its own tab, then hit Rec.
              </p>
              <Button className="mt-4" type="button" variant="accent" onClick={() => rec()}>
                Open studio
              </Button>
            </div>
          ) : null}

          <section
            className={cn(
              "rounded-2xl border p-6 md:p-8",
              live ? "border-primary bg-primary text-primary-fg" : "border-border bg-surface",
            )}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="text-sm">
                <span className={live ? "text-primary-fg/70" : "text-muted-foreground"}>Class</span>
                {courses.length === 0 ? (
                  <form
                    className="mt-1 flex gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!name.trim()) return;
                      void createCourse({ data: { name } })
                        .then((result) => {
                          if (!result.ok) return;
                          setName("");
                          return loadCourses(result.id);
                        })
                        .catch(() => toast.error("Could not add class."));
                    }}
                  >
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Add a class"
                      className="w-44 bg-bg text-fg"
                    />
                    <Button type="submit" size="sm" variant={live ? "outline" : "default"}>
                      Add
                    </Button>
                  </form>
                ) : (
                  <select
                    className="mt-1 block min-h-11 rounded-lg border border-border bg-bg px-3 text-fg"
                    value={pick}
                    onChange={(e) => {
                      setPick(e.target.value);
                      setLectureCourse(e.target.value);
                    }}
                  >
                    {courses.map((course) => (
                      <option key={course.id} value={course.id}>
                        {course.code} · {course.name}
                      </option>
                    ))}
                  </select>
                )}
              </label>
              <p className="font-display text-5xl tabular-nums md:text-6xl">{formatDuration(session.seconds)}</p>
            </div>

            <div className="mt-8 flex flex-col items-center gap-3">
              {!live && !session.draft ? (
                <>
                  <button
                    type="button"
                    disabled={session.saving}
                    onClick={() => rec()}
                    className="flex h-32 w-32 flex-col items-center justify-center rounded-full bg-accent text-primary-fg shadow-sm transition-transform hover:scale-[1.03] disabled:opacity-50"
                  >
                    <Mic className="h-7 w-7" />
                    <span className="mt-1 font-display text-xl">{session.starting ? "…" : "Rec"}</span>
                  </button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={session.saving}
                    onClick={() => {
                      if (pick) setLectureCourse(pick);
                      void startLecture(pick, { tab: true }).catch((error) => {
                        toast.error(error instanceof Error ? error.message : "Share the tab, and turn on audio.");
                      });
                    }}
                  >
                    Share tab audio
                  </Button>
                  <p className="max-w-sm text-center text-sm text-muted-foreground">
                    Rec hears the room. If the lecture is on Zoom or a video, use Share tab audio and check “Share tab audio”.
                  </p>
                </>
              ) : live ? (
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <Button
                    type="button"
                    variant="accent"
                    size="lg"
                    disabled={busy}
                    onClick={() => void stopSave()}
                  >
                    <Square className="h-4 w-4 fill-current" />
                    {session.saving ? "Saving…" : "Stop & save"}
                  </Button>
                  <Button type="button" variant="outline" disabled={busy} onClick={() => togglePause()}>
                    <Pause className="h-4 w-4" />
                    {session.paused ? "Resume" : "Pause"}
                  </Button>
                  <Button type="button" variant="outline" disabled={busy} onClick={() => discardLecture()}>
                    Discard
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy} onClick={() => void saveDraftAgain().then(finish)}>
                    {session.saving ? "Saving…" : "Save lecture"}
                  </Button>
                  <Button variant="ghost" onClick={() => discardLecture()}>
                    Discard
                  </Button>
                </div>
              )}
            </div>

            {live ? (
              <div className="mt-8 flex h-16 items-end gap-1 rounded-xl bg-primary-fg/10 px-4 py-3">
                {session.levels.map((level, i) => (
                  <span
                    key={i}
                    className={cn("w-full rounded-full", session.hearing ? "bg-accent" : "bg-primary-fg/40")}
                    style={{ height: `${Math.round(18 + level * 82)}%` }}
                  />
                ))}
              </div>
            ) : null}

            <div
              className={cn(
                "mt-6 min-h-32 rounded-xl p-4 text-sm leading-relaxed",
                live ? "bg-bg text-fg" : "border border-border bg-bg",
              )}
            >
              {captionCopy}
            </div>
            <p className={cn("mt-3 text-sm", live ? "text-primary-fg/70" : "text-muted-foreground")}>
              {framed ? "Open the studio tab to record." : session.status}
            </p>
          </section>

          {!live ? (
            <section className="rounded-2xl border border-border bg-surface p-5">
              <p className="font-display text-xl">No mic?</p>
              <p className="mt-1 text-sm text-muted-foreground">Type a few notes or upload a voice memo. Same recap either way.</p>
              <Textarea
                className="mt-3"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="What did class cover?"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={busy || !typed.trim()}
                  onClick={() => void saveTypedLecture(typed, pick).then(finish)}
                >
                  Save notes
                </Button>
                <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-sm">
                  <Upload className="h-4 w-4" />
                  Upload audio
                  <input
                    type="file"
                    accept="audio/*,video/mp4,.m4a,.mp3,.wav,.webm"
                    className="sr-only"
                    disabled={busy}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (!file) return;
                      void saveUploadedLecture(file, pick).then(finish);
                    }}
                  />
                </label>
              </div>
            </section>
          ) : (
            <p className="text-sm text-muted-foreground">Leave this tab open. Other sites are fine. Come back and tap Stop & save.</p>
          )}
        </div>
      </AuthGate>
    </AppShell>
  );
}
