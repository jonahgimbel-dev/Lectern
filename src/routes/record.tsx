import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createCourse, listCourses } from "@/functions/data";
import { formatDuration } from "@/lib/format";
import {
  discardLecture,
  getLectureSession,
  saveDraftAgain,
  saveLectureSession,
  saveTypedLecture,
  startLecture,
  subscribeLectureSession,
  togglePause,
} from "@/lib/lecture-session";
import type { Course } from "@/lib/types";

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

  async function loadCourses(selectId?: string) {
    const rows = await listCourses().catch(() => [] as Course[]);
    setCourses(rows);
    setPick((current) => selectId || current || courseId || session.courseId || rows[0]?.id || "");
  }

  useEffect(() => {
    void loadCourses();
  }, [courseId]);

  useEffect(() => {
    if (!pick && courses[0]?.id) setPick(courses[0].id);
  }, [courses, pick]);

  async function rec() {
    try {
      await startLecture(pick);
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

  return (
    <AppShell>
      <AuthGate title="Record a lecture" copy="Sign in, then capture class audio into a study recap." next="/record">
        <div className="mx-auto max-w-xl space-y-5">
          <header>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Record</p>
            <h1 className="mt-1 font-display text-4xl tracking-tight">Record a lecture</h1>
            <p className="mt-2 text-muted-foreground">
              Pick a class, hit rec, then stop when class ends. Lectern files the notes for you.
            </p>
          </header>

          {courses.length === 0 ? (
            <form
              className="space-y-2 rounded-xl border border-border bg-surface p-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (!name.trim()) return;
                void createCourse({ data: { name } })
                  .then((result) => {
                    if (!result.ok) return;
                    setName("");
                    toast.success("Class added.");
                    return loadCourses(result.id);
                  })
                  .catch(() => toast.error("Could not add class."));
              }}
            >
              <p className="text-sm text-muted-foreground">Add a class, then you can record.</p>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Class name" />
              <Button type="submit" size="sm">
                Add class
              </Button>
            </form>
          ) : (
            <label className="block text-sm">
              <span className="text-muted-foreground">Class</span>
              <select
                className="mt-1 min-h-11 w-full rounded-lg border border-border bg-surface px-3"
                value={pick}
                disabled={live || busy}
                onChange={(e) => setPick(e.target.value)}
              >
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.code} · {course.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {!live && !session.draft ? (
            <Button disabled={busy || !pick} onClick={() => void rec()}>
              {session.starting ? "Starting…" : "Rec"}
            </Button>
          ) : live ? (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void stopSave()} disabled={busy}>
                {session.saving ? "Saving…" : "Stop & save"}
              </Button>
              <Button variant="outline" onClick={() => togglePause()} disabled={busy}>
                {session.paused ? "Resume" : "Pause"}
              </Button>
              <Button variant="ghost" onClick={() => discardLecture()} disabled={busy}>
                Discard
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => void saveDraftAgain().then(finish)}>
                {session.saving ? "Saving…" : "Save lecture"}
              </Button>
              <Button variant="ghost" onClick={() => discardLecture()} disabled={busy}>
                Discard
              </Button>
            </div>
          )}

          <div className="flex items-end justify-between gap-3">
            <p className="font-display text-5xl tabular-nums">{formatDuration(session.seconds)}</p>
            {live ? (
              <span className="mb-2 inline-flex items-center gap-2 text-sm font-medium text-accent">
                <span
                  className={`h-2.5 w-2.5 rounded-full bg-accent ${session.paused ? "opacity-40" : "animate-pulse"}`}
                />
                {session.paused ? "Paused" : "REC"}
              </span>
            ) : null}
          </div>

          {live ? (
            <div className="flex h-10 items-end gap-[3px] rounded-xl border border-border bg-surface px-3 py-2">
              {session.levels.map((level, i) => (
                <span
                  key={i}
                  className={`w-1.5 rounded-full ${session.hearing ? "bg-accent" : "bg-primary/40"}`}
                  style={{ height: `${Math.round(18 + level * 82)}%` }}
                />
              ))}
            </div>
          ) : null}

          <div className="min-h-24 rounded-xl border border-border bg-surface p-4 text-sm">
            {shown || session.lastError || "Captions will appear here as you talk."}
          </div>
          <p className="text-sm text-muted-foreground">{session.status}</p>

          {!live ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Mic acting up? Type a few notes and save those instead.</p>
              <Textarea value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="What did class cover?" />
              <Button
                variant="outline"
                disabled={busy || !pick || !typed.trim()}
                onClick={() => void saveTypedLecture(typed, pick).then(finish)}
              >
                Save notes
              </Button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              You can open Canvas in another tab. Come back here and tap Stop & save.
            </p>
          )}
        </div>
      </AuthGate>
    </AppShell>
  );
}
