import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
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

  return (
    <AppShell>
      <AuthGate title="Record a lecture" copy="Sign in, then capture class audio into a study recap." next="/record">
        <div className="mx-auto max-w-xl space-y-6">
          <header>
            <h1 className="font-display text-4xl tracking-tight">Record a lecture</h1>
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
            <select
              className="min-h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm"
              value={pick}
              disabled={live || session.saving}
              onChange={(e) => setPick(e.target.value)}
            >
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.code} · {course.name}
                </option>
              ))}
            </select>
          )}

          {!live && !session.draft ? (
            <Button disabled={session.saving || !pick} onClick={() => void rec()}>
              Rec
            </Button>
          ) : live ? (
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void stopSave()} disabled={session.saving}>
                {session.saving ? "Saving…" : "Stop & save"}
              </Button>
              <Button variant="outline" onClick={() => togglePause()} disabled={session.saving}>
                {session.paused ? "Resume" : "Pause"}
              </Button>
              <Button variant="ghost" onClick={() => discardLecture()} disabled={session.saving}>
                Discard
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button disabled={session.saving} onClick={() => void saveDraftAgain().then(finish)}>
                {session.saving ? "Saving…" : "Save lecture"}
              </Button>
              <Button variant="ghost" onClick={() => discardLecture()} disabled={session.saving}>
                Discard
              </Button>
            </div>
          )}

          <p className="font-display text-5xl tabular-nums">{formatDuration(session.seconds)}</p>
          <p className="min-h-16 text-muted-foreground">{shown || "Captions will appear here as you talk."}</p>
          <p className="text-sm text-muted-foreground">{session.status}</p>

          {!live ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Mic acting up? Type a few notes and save those instead.</p>
              <Textarea value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="What did class cover?" />
              <Button
                variant="outline"
                disabled={session.saving || !pick || !typed.trim()}
                onClick={() => void saveTypedLecture(typed, pick).then(finish)}
              >
                Save notes
              </Button>
            </div>
          ) : null}
        </div>
      </AuthGate>
    </AppShell>
  );
}
