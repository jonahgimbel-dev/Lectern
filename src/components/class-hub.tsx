import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { DueCalendar } from "@/components/due-calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createCourse, deleteCourse, updateCourse } from "@/functions/data";
import { formatLectureDate } from "@/lib/format";
import type { Desk } from "@/lib/types";

export function ClassHub({ desk, onReload }: { desk: Desk; onReload: () => void }) {
  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_18.5rem]">
      <div className="space-y-8">
        <section>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Class hub</p>
          <h1 className="mt-1 font-display text-4xl tracking-tight">Your desk</h1>
          <p className="mt-2 max-w-xl text-muted-foreground">
            Every class, lecture, and due date in one place.
          </p>
        </section>
        {desk.courses.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface p-6">
            <h2 className="font-display text-2xl tracking-tight">Your desk is empty</h2>
            <p className="mt-2 max-w-md text-muted-foreground">
              Add a class below, or bring them in from Canvas. Nothing from other students shows up here.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button asChild>
                <Link to="/connect">Connect Canvas</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to="/record">Record a lecture</Link>
              </Button>
            </div>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {desk.courses.map((course) => (
              <li key={course.id} className="rounded-lg border border-border bg-surface p-5 lift transition-opacity duration-150 hover:opacity-95">
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{course.code}</p>
                <h2 className="mt-1 font-display text-2xl tracking-tight">{course.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {desk.lectures.filter((l) => l.courseId === course.id).length} lectures
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button asChild size="sm">
                    <Link to="/class/$id" params={{ id: course.id }}>
                      Open
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link to="/record" search={{ courseId: course.id }}>
                      Record
                    </Link>
                  </Button>
                  <RenameClass
                    id={course.id}
                    name={course.name}
                    code={course.code}
                    onDone={onReload}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      void deleteCourse({ data: { id: course.id } }).then(() => {
                        toast.success("Class deleted.");
                        onReload();
                      });
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <AddClassForm onDone={onReload} />
        {desk.lectures.length > 0 ? (
          <section>
            <h2 className="font-display text-xl">Recent lectures</h2>
            <ul className="mt-3 divide-y divide-border rounded-xl border border-border bg-surface">
              {desk.lectures.slice(0, 6).map((lecture) => (
                <li key={lecture.id}>
                  <Link
                    to="/lecture/$id"
                    params={{ id: lecture.id }}
                    className="block px-4 py-3 hover:bg-secondary"
                  >
                    <p className="font-medium">{lecture.title}</p>
                    <p className="text-sm text-muted-foreground">{formatLectureDate(lecture.startedAt)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      <aside className="lg:sticky lg:top-20">
        <DueCalendar compact courses={desk.courses} exams={desk.exams} onChange={onReload} />
      </aside>
    </div>
  );
}

function AddClassForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  return (
    <form
      className="flex flex-wrap gap-2 rounded-xl border border-border bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        void createCourse({ data: { name, code } })
          .then((result) => {
            if (!result.ok) return;
            setName("");
            setCode("");
            toast.success("Class added.");
            onDone();
          })
          .catch(() => toast.error("Could not add class."));
      }}
    >
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Class name" className="max-w-xs" />
      <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code" className="w-28" />
      <Button type="submit">Add class</Button>
    </form>
  );
}

function RenameClass({
  id,
  name,
  code,
  onDone,
}: {
  id: string;
  name: string;
  code: string;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [nextName, setNextName] = useState(name);
  const [nextCode, setNextCode] = useState(code);
  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Rename
      </Button>
    );
  }
  return (
    <form
      className="flex flex-wrap gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        void updateCourse({ data: { id, name: nextName, code: nextCode } }).then(() => {
          setOpen(false);
          onDone();
        });
      }}
    >
      <Input value={nextName} onChange={(e) => setNextName(e.target.value)} className="w-36" />
      <Input value={nextCode} onChange={(e) => setNextCode(e.target.value)} className="w-24" />
      <Button size="sm" type="submit">
        Save
      </Button>
    </form>
  );
}
