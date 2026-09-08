import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { Input } from "@/components/ui/input";
import { searchDesk } from "@/functions/data";
import { formatLectureDate } from "@/lib/format";
import type { Course, Lecture } from "@/lib/types";

export const Route = createFileRoute("/search")({ component: SearchPage });

function SearchPage() {
  const [q, setQ] = useState("");
  const [courses, setCourses] = useState<Course[]>([]);
  const [lectures, setLectures] = useState<Lecture[]>([]);
  return (
    <AppShell>
      <AuthGate title="Search your desk" copy="Sign in to find lectures and classes." next="/search">
        <div className="space-y-6">
          <h1 className="font-display text-4xl tracking-tight">Search</h1>
          <Input
            value={q}
            onChange={(e) => {
              const value = e.target.value;
              setQ(value);
              if (value.trim().length < 2) {
                setCourses([]);
                setLectures([]);
                return;
              }
              void searchDesk({ data: { q: value } }).then((result) => {
                setCourses(result.courses);
                setLectures(result.lectures);
              });
            }}
            placeholder="Find a class, recap, or phrase"
          />
          <ul className="space-y-2">
            {courses.map((course) => (
              <li key={course.id}>
                <Link to="/class/$id" params={{ id: course.id }} className="font-medium">
                  {course.code} · {course.name}
                </Link>
              </li>
            ))}
            {lectures.map((lecture) => (
              <li key={lecture.id}>
                <Link to="/lecture/$id" params={{ id: lecture.id }}>
                  {lecture.title}
                  <span className="ml-2 text-sm text-muted-foreground">{formatLectureDate(lecture.startedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </AuthGate>
    </AppShell>
  );
}
