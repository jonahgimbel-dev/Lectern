import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { Button } from "@/components/ui/button";
import { deleteLecture, getCourse, getLecture, listCards, patchLecture, rebuildLecture } from "@/functions/data";
import { formatDuration, formatLectureDate } from "@/lib/format";
import { recapForLecture } from "@/lib/study-shape";
import type { Course, Flashcard, Lecture } from "@/lib/types";

export const Route = createFileRoute("/lecture/$id")({ component: LecturePage });

function LecturePage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const [lecture, setLecture] = useState<Lecture | null | undefined>(undefined);
  const [course, setCourse] = useState<Course | null>(null);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [rebuilding, setRebuilding] = useState(false);
  const [flip, setFlip] = useState<number | null>(null);

  async function reload() {
    const row = await getLecture({ data: { id } });
    setLecture(row);
    if (row) {
      const [next, deck] = await Promise.all([
        getCourse({ data: { id: row.courseId } }),
        listCards({ data: { courseId: row.courseId } }).catch(() => []),
      ]);
      setCourse(next);
      setCards(deck.filter((card) => card.lectureId === row.id));
    }
  }

  useEffect(() => {
    void reload().catch(() => setLecture(null));
  }, [id]);

  return (
    <AppShell>
      <AuthGate title="Open this lecture" copy="Sign in to study the recap from this recording.">
        {lecture === undefined ? (
          <div className="h-48 rounded-xl bg-secondary" />
        ) : lecture === null ? (
          <div className="rounded-xl border border-border bg-surface p-6">
            <h1 className="font-display text-2xl">That lecture is not on this desk</h1>
            <Button asChild className="mt-4">
              <Link to="/classes">Back to class hub</Link>
            </Button>
          </div>
        ) : (
          <StudyLecture
            lecture={lecture}
            course={course}
            cards={cards}
            flip={flip}
            setFlip={setFlip}
            rebuilding={rebuilding}
            onPatch={(patch) => {
              void patchLecture({ data: { id: lecture.id, ...patch } }).then(() => reload());
            }}
            onRebuild={() => {
              setRebuilding(true);
              void rebuildLecture({ data: { id: lecture.id } })
                .then((result) => {
                  if (!result.ok) {
                    toast.error(result.error);
                    return;
                  }
                  toast.success("Study view rebuilt.");
                  return reload();
                })
                .finally(() => setRebuilding(false));
            }}
            onDelete={() => {
              void deleteLecture({ data: { id: lecture.id } }).then(() => {
                toast.success("Lecture deleted.");
                void navigate({ to: "/classes" });
              });
            }}
          />
        )}
      </AuthGate>
    </AppShell>
  );
}

function StudyLecture({
  lecture,
  course,
  cards,
  flip,
  setFlip,
  rebuilding,
  onPatch,
  onRebuild,
  onDelete,
}: {
  lecture: Lecture;
  course: Course | null;
  cards: Flashcard[];
  flip: number | null;
  setFlip: (n: number | null) => void;
  rebuilding: boolean;
  onPatch: (patch: { outline?: string[]; examAsks?: string[]; traps?: string[] }) => void;
  onRebuild: () => void;
  onDelete: () => void;
}) {
  const recap = recapForLecture(lecture);
  const asks = lecture.examAsks;
  const stale = recap.length < 2 && lecture.transcript.length > 80;
  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {course?.code ?? "Class"} · {formatLectureDate(lecture.startedAt)} · {formatDuration(lecture.durationSec)}
        </p>
        <h1 className="font-display text-4xl tracking-tight">{lecture.title}</h1>
        <div className="flex flex-wrap gap-2">
          {course ? (
            <Button asChild variant="outline">
              <Link to="/class/$id" params={{ id: course.id }}>
                Class page
              </Link>
            </Button>
          ) : null}
          {lecture.transcript ? (
            <Button variant="outline" disabled={rebuilding} onClick={onRebuild}>
              {rebuilding ? "Rebuilding…" : stale ? "Make this study-ready" : "Rebuild recap"}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onDelete}>
            Delete lecture
          </Button>
        </div>
      </header>
      <section className="rounded-xl border border-border bg-surface p-5">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">From this recording</p>
        <h2 className="mt-1 font-display text-2xl">In one minute</h2>
        {recap.length ? (
          <ol className="mt-4 space-y-3">
            {recap.map((item, index) => (
              <li key={`${index}-${item}`} className="flex items-start gap-3">
                <span className="mt-0.5 w-5 shrink-0 text-sm text-muted-foreground">{index + 1}.</span>
                <span className="flex-1 text-pretty">{item}</span>
                <Button variant="ghost" size="sm" onClick={() => onPatch({ outline: recap.filter((_, i) => i !== index) })}>
                  Remove
                </Button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Rebuild to fill this recap.</p>
        )}
      </section>
      <section className="rounded-xl border border-border bg-surface p-5">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Exam shape</p>
        <h2 className="mt-1 font-display text-2xl">They will ask</h2>
        {asks.length ? (
          <ol className="mt-4 space-y-3">
            {asks.map((item, index) => (
              <li key={`${index}-${item}`} className="flex items-start gap-3">
                <span className="mt-0.5 w-5 shrink-0 text-sm text-muted-foreground">{index + 1}.</span>
                <span className="flex-1 text-pretty">{item}</span>
                <Button variant="ghost" size="sm" onClick={() => onPatch({ examAsks: asks.filter((_, i) => i !== index) })}>
                  Remove
                </Button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">After rebuild: three exam-shaped tasks from this lecture.</p>
        )}
      </section>
      {lecture.traps.length ? (
        <section className="rounded-xl border border-border bg-surface p-5">
          <h2 className="font-display text-2xl">Easy to miss</h2>
          <ol className="mt-4 space-y-3">
            {lecture.traps.map((item, index) => (
              <li key={`${index}-${item}`} className="flex items-start gap-3">
                <span className="mt-0.5 w-5 shrink-0 text-sm text-muted-foreground">{index + 1}.</span>
                <span className="flex-1 text-pretty">{item}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onPatch({ traps: lecture.traps.filter((_, i) => i !== index) })}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
      {lecture.actions.length ? (
        <section className="rounded-xl border border-border bg-surface p-5">
          <h2 className="font-display text-2xl">Do next</h2>
          <ul className="mt-4 space-y-2 text-sm">
            {lecture.actions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="font-display text-2xl">Say it</h2>
        {cards.length ? (
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {cards.map((card, index) => {
              const show = flip === index;
              return (
                <li key={card.id}>
                  <button
                    type="button"
                    className="min-h-28 w-full rounded-lg border border-border bg-bg px-4 py-4 text-left"
                    onClick={() => setFlip(show ? null : index)}
                  >
                    <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{show ? "Answer" : "Term"}</p>
                    <p className="mt-2 font-medium text-pretty">{show ? card.back : card.front}</p>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No cards yet. Rebuild to pull terms.</p>
        )}
      </section>
      {lecture.transcript ? (
        <details className="rounded-xl border border-border bg-surface p-5">
          <summary className="cursor-pointer font-medium">Full transcript</summary>
          <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{lecture.transcript}</p>
        </details>
      ) : null}
    </div>
  );
}
