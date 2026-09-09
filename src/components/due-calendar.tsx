import { Link } from "@tanstack/react-router";
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
  const [selected, setSelected] = useState(todayIso());
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
  const selectedItems = selected ? byDay.get(selected) ?? [] : [];
  const upcoming = exams
    .filter((exam) => !courseId || exam.courseId === courseId)
    .filter((exam) => exam.examOn >= todayIso())
    .slice(0, compact ? 5 : 8);
  const shown = selected ? selectedItems : upcoming;
  const monthLabel = new Date(`${anchor}T12:00:00`).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  function pickDay(iso: string) {
    setSelected(iso);
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-xl">Due dates</h2>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setAnchor((v) => shiftMonth(v, -1));
            }}
          >
            Prev
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setAnchor((v) => shiftMonth(v, 1));
            }}
          >
            Next
          </Button>
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{monthLabel} · tap a day</p>
      <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
        {days.map((d, i) => (
          <div key={`${d}-${i}`}>{d}</div>
        ))}
        {cells.map((iso, i) => {
          if (!iso) return <div key={`empty-${i}`} />;
          const items = byDay.get(iso) ?? [];
          const isToday = iso === todayIso();
          const isSelected = iso === selected;
          const dayNum = Number(iso.slice(8));
          return (
            <button
              key={iso}
              type="button"
              onClick={() => pickDay(iso)}
              className={`flex flex-col rounded-md text-left transition-colors ${
                compact ? "min-h-10 items-center justify-center py-1" : "min-h-16 p-1 lg:min-h-[4.5rem]"
              } ${
                isSelected
                  ? "bg-primary text-primary-fg"
                  : isToday
                    ? "bg-bg ring-1 ring-primary"
                    : items.length
                      ? "bg-secondary hover:bg-primary/10"
                      : "bg-bg hover:bg-secondary"
              }`}
            >
              <span className={`tabular-nums text-xs ${isSelected ? "font-medium" : ""}`}>{dayNum}</span>
              {compact ? (
                items.length > 0 ? (
                  <span
                    className={`mt-0.5 rounded-full px-1.5 text-[10px] font-medium tabular-nums ${
                      isSelected ? "bg-primary-fg/20" : "bg-accent/15 text-accent"
                    }`}
                  >
                    {items.length}
                  </span>
                ) : null
              ) : (
                items.slice(0, 2).map((item) => (
                  <span
                    key={item.id}
                    className={`mt-0.5 truncate rounded px-1 text-[10px] ${
                      isSelected ? "bg-primary-fg/15" : "bg-primary/10 text-primary"
                    }`}
                  >
                    {courseById.get(item.courseId)?.code ?? item.title}
                  </span>
                ))
              )}
              {!compact && items.length > 2 ? (
                <span className={`text-[10px] ${isSelected ? "opacity-80" : "text-muted-foreground"}`}>
                  +{items.length - 2}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {selected ? daysLabel(selected) : "Coming up"}
        </p>
        {selected ? (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-fg"
            onClick={() => setSelected("")}
          >
            Show all
          </button>
        ) : null}
      </div>
      <ul className="mt-2 space-y-2">
        {shown.length === 0 ? (
          <li className="text-sm text-muted-foreground">
            {selected ? "Nothing due this day. Add one below." : "Nothing due yet."}
          </li>
        ) : (
          shown.map((exam) => (
            <li key={exam.id} className="flex items-start justify-between gap-2 rounded-lg bg-bg px-2 py-2 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{exam.title}</p>
                <p className="text-xs text-muted-foreground">
                  {daysLabel(exam.examOn)} ·{" "}
                  {courseId ? (
                    courseById.get(exam.courseId)?.code ?? "Class"
                  ) : (
                    <Link to="/class/$id" params={{ id: exam.courseId }} className="underline-offset-2 hover:underline">
                      {courseById.get(exam.courseId)?.code ?? "Class"}
                    </Link>
                  )}
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

      <AddDueForm
        courses={courses}
        courseId={courseId}
        examOn={selected || todayIso()}
        onChange={onChange}
      />
    </section>
  );
}

function AddDueForm({
  courses,
  courseId,
  examOn,
  onChange,
}: {
  courses: Course[];
  courseId?: string;
  examOn: string;
  onChange: () => void;
}) {
  const [title, setTitle] = useState("");
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
            toast.success("Added to the calendar.");
            onChange();
          })
          .catch(() => toast.error("Could not add that."));
      }}
    >
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add due date" />
      <div className="flex flex-wrap gap-2">
        <span className="inline-flex min-h-11 items-center rounded-lg border border-border bg-bg px-3 text-sm tabular-nums">
          {examOn}
        </span>
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
