import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { DueCalendar } from "@/components/due-calendar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { deleteCard, getCourse, getDesk, listCards, listLectures, updateCourse } from "@/functions/data";
import { generateCram, generateQuiz } from "@/functions/study";
import { formatLectureDate } from "@/lib/format";
import type { CramSheet, Course, Desk, Flashcard, Lecture, QuizItem } from "@/lib/types";

export const Route = createFileRoute("/class/$id")({ component: ClassPage });

function ClassPage() {
  const { id } = Route.useParams();
  const [course, setCourse] = useState<Course | null>(null);
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [desk, setDesk] = useState<Desk | null>(null);
  const [quiz, setQuiz] = useState<QuizItem[] | null>(null);
  const [cram, setCram] = useState<CramSheet | null>(null);
  const [busy, setBusy] = useState("");
  const [syllabus, setSyllabus] = useState("");

  async function load() {
    const [next, list, deck, all] = await Promise.all([
      getCourse({ data: { id } }),
      listLectures({ data: { courseId: id } }),
      listCards({ data: { courseId: id } }),
      getDesk(),
    ]);
    setCourse(next);
    setLectures(list);
    setCards(deck);
    setDesk(all);
    setSyllabus(next?.syllabus ?? "");
  }

  useEffect(() => {
    void load().catch(() => setCourse(null));
  }, [id]);

  return (
    <AppShell>
      <AuthGate title="Open this class" copy="Sign in to study this course.">
        {!course ? (
          <div className="h-48 rounded-xl bg-secondary" />
        ) : (
          <div className="space-y-8">
            <header className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{course.code}</p>
                <h1 className="font-display text-4xl tracking-tight">{course.name}</h1>
              </div>
              <Button asChild>
                <Link to="/record" search={{ courseId: course.id }}>
                  Record lecture
                </Link>
              </Button>
            </header>
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18.5rem]">
              <div className="space-y-6">
                <section className="rounded-xl border border-border bg-surface p-5">
                  <h2 className="font-display text-xl">Lectures</h2>
                  {lectures.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">No lectures yet.</p>
                  ) : (
                    <ul className="mt-3 divide-y divide-border">
                      {lectures.map((lecture) => (
                        <li key={lecture.id}>
                          <Link to="/lecture/$id" params={{ id: lecture.id }} className="block py-3 hover:text-primary">
                            <p className="font-medium">{lecture.title}</p>
                            <p className="text-sm text-muted-foreground">{formatLectureDate(lecture.startedAt)}</p>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section className="rounded-xl border border-border bg-surface p-5">
                  <h2 className="font-display text-xl">Study tools</h2>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      disabled={busy === "quiz"}
                      onClick={() => {
                        setBusy("quiz");
                        void generateQuiz({ data: { courseId: id } })
                          .then((result) => {
                            if (!result.ok) {
                              toast.error(result.error);
                              return;
                            }
                            setQuiz(result.items);
                          })
                          .finally(() => setBusy(""));
                      }}
                    >
                      {busy === "quiz" ? "Building…" : "Practice quiz"}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy === "cram"}
                      onClick={() => {
                        setBusy("cram");
                        void generateCram({ data: { courseId: id } })
                          .then((result) => {
                            if (!result.ok) {
                              toast.error(result.error);
                              return;
                            }
                            setCram(result.sheet);
                          })
                          .finally(() => setBusy(""));
                      }}
                    >
                      {busy === "cram" ? "Building…" : "Exam cram"}
                    </Button>
                  </div>
                  {quiz ? (
                    <ol className="mt-4 space-y-3">
                      {quiz.map((item, i) => (
                        <li key={i}>
                          <p className="font-medium">{item.prompt}</p>
                          <ul className="mt-1 text-sm text-muted-foreground">
                            {item.choices.map((choice, ci) => (
                              <li key={choice}>{ci === item.answer ? `→ ${choice}` : choice}</li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ol>
                  ) : null}
                  {cram ? (
                    <div className="mt-4 space-y-2 text-sm">
                      {cram.mustKnow.map((line) => (
                        <p key={line}>{line}</p>
                      ))}
                    </div>
                  ) : null}
                </section>
                <section className="rounded-xl border border-border bg-surface p-5">
                  <h2 className="font-display text-xl">Cards</h2>
                  {cards.length === 0 ? (
                    <p className="mt-2 text-sm text-muted-foreground">No cards yet.</p>
                  ) : (
                    <ul className="mt-3 space-y-2">
                      {cards.map((card) => (
                        <li key={card.id} className="flex items-start justify-between gap-2 rounded-lg bg-bg px-3 py-2">
                          <span>
                            <strong>{card.front}</strong> — {card.back}
                          </span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              void deleteCard({ data: { id: card.id } }).then(() => load());
                            }}
                          >
                            Delete
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section className="rounded-xl border border-border bg-surface p-5">
                  <h2 className="font-display text-xl">Syllabus</h2>
                  <form
                    className="mt-3 space-y-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void updateCourse({ data: { id, syllabus } }).then(() => toast.success("Syllabus saved."));
                    }}
                  >
                    <Textarea value={syllabus} onChange={(e) => setSyllabus(e.target.value)} placeholder="Paste syllabus notes" />
                    <Button type="submit" size="sm">
                      Save syllabus
                    </Button>
                  </form>
                </section>
              </div>
              <DueCalendar
                courses={desk?.courses ?? [course]}
                exams={desk?.exams ?? []}
                courseId={course.id}
                onChange={() => void load()}
              />
            </div>
          </div>
        )}
      </AuthGate>
    </AppShell>
  );
}
