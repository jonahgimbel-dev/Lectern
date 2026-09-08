import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addExam, deleteExam } from "@/functions/data";
import { daysLabel, monthStartIso, todayIso } from "@/lib/format";
import { monthCells, shiftMonth, WEEKDAYS } from "@/lib/month-grid";
import type { Course, Exam } from "@/lib/types";

export function DueCalendar({
  compact,
  courses,
  exams,
  courseId,
  onChange,
}: {
  compact?: boolean;
  courses: Course[];
  exams: Exam[];
  courseId?: string;
  onChange: () => void;
}) {
  const [anchor, setAnchor] = useState(monthStartIso());
  const cells = monthCells(anchor);
  const byDay = useMemo(() => {
    const map = new Map<string, Exam[]>();
    for (const exam of exams) {
      if (courseId && exam.courseId !== courseId) continue;
      const list = map.get(exam.examOn) ?? [];
      list.push(exam);
      map.set(exam.examOn, list);
    }
    return map;
  }, [exams, courseId]);
  const courseById = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);
  const days = compact ? ["S", "M", "T", "W", "T", "F", "S"] : WEEKDAYS;
  const upcoming = exams
    .filter((exam) => !courseId || exam.courseId === courseId)
    .filter((exam) => exam.examOn >= todayIso())
    .slice(0, compact ? 5 : 8);

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-xl">{compact ? "Planner" : "Due dates"}</h2>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setAnchor((v) => shiftMonth(v, -1))}>
            Prev
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAnchor((v) => shiftMonth(v, 1))}>
            Next
          </Button>
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {new Date(`${anchor}T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
      </p>
      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
        {days.map((d, i) => (
          <div key={`${d}-${i}`}>{d}</div>
        ))}
        {cells.map((iso, i) => {
          const items = iso ? byDay.get(iso) ?? [] : [];
          const isToday = iso === todayIso();
          return (
            <div
              key={`${iso}-${i}`}
              className={`flex flex-col rounded-md ${compact ? "min-h-9 items-center justify-center py-1" : "min-h-14 p-1 lg:min-h-20"} ${iso ? "bg-bg" : ""} ${isToday ? "ring-1 ring-primary" : ""}`}
            >
              {iso ? <span className="tabular-nums text-xs">{Number(iso.slice(8))}</span> : null}
              {items.length > 0 && compact ? (
                <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-medium tabular-nums text-primary">
                  {items.length}
                </span>
              ) : null}
              {!compact
                ? items.slice(0, 2).map((item) => (
                    <span key={item.id} className="mt-0.5 truncate rounded bg-primary/10 px-1 text-[10px] text-primary">
                      {courseById.get(item.courseId)?.code ?? item.title}
                    </span>
                  ))
                : null}
            </div>
          );
        })}
      </div>
      <ul className="mt-4 space-y-2">
        {upcoming.length === 0 ? (
          <li className="text-sm text-muted-foreground">Nothing due yet.</li>
        ) : (
          upcoming.map((exam) => (
            <li key={exam.id} className="flex items-start justify-between gap-2 text-sm">
              <div>
                <p className="font-medium">{exam.title}</p>
                <p className="text-xs text-muted-foreground">
                  {daysLabel(exam.examOn)} · {courseById.get(exam.courseId)?.code ?? "Class"}
                  {exam.source === "lecture" ? " · From lecture" : exam.source === "canvas" ? " · Canvas" : " · Added"}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  void deleteExam({ data: { id: exam.id } }).then(() => {
                    toast.success("Removed.");
                    onChange();
                  });
                }}
              >
                Delete
              </Button>
            </li>
          ))
        )}
      </ul>
      <AddDueForm courses={courses} courseId={courseId} onChange={onChange} />
    </section>
  );
}

function AddDueForm({
  courses,
  courseId,
  onChange,
}: {
  courses: Course[];
  courseId?: string;
  onChange: () => void;
}) {
  const [title, setTitle] = useState("");
  const [examOn, setExamOn] = useState(todayIso());
  const [pick, setPick] = useState(courseId ?? courses[0]?.id ?? "");
  if (!courses.length) return null;
  return (
    <form
      className="mt-4 space-y-2 border-t border-border pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        const id = courseId ?? pick;
        if (!id || !title.trim()) return;
        void addExam({ data: { courseId: id, title, examOn, notes: "" } })
          .then((result) => {
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            setTitle("");
            onChange();
          })
          .catch(() => toast.error("Could not add that."));
      }}
    >
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add due date" />
      <div className="flex flex-wrap gap-2">
        <Input type="date" value={examOn} onChange={(e) => setExamOn(e.target.value)} className="w-40" />
        {!courseId ? (
          <select
            className="min-h-11 rounded-lg border border-border bg-surface px-2 text-sm"
            value={pick}
            onChange={(e) => setPick(e.target.value)}
          >
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.code}
              </option>
            ))}
          </select>
        ) : null}
        <Button type="submit" size="sm">
          Add
        </Button>
      </div>
    </form>
  );
}
