import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { reclaimMyDesk } from "@/functions/recover";
import { archiveCourseById, archiveLectureById } from "@/functions/archive";
import { duesFromLectureMaterial } from "@/lib/due-from-notes";
import { getSql } from "@/lib/db";
import { runSummarize } from "@/functions/summarize";
import type { Course, Desk, Exam, Flashcard, Lecture } from "@/lib/types";
import { uid } from "@/lib/utils";

function parseList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function asCourse(row: {
  id: string;
  name: string;
  code: string;
  term: string;
  instructor: string;
  accent: string;
  syllabus: string;
  master_summary: string;
  lms_provider: string | null;
  created_at: string;
}): Course {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    term: row.term,
    instructor: row.instructor,
    accent: row.accent,
    syllabus: row.syllabus,
    masterSummary: row.master_summary,
    lmsProvider: row.lms_provider,
    createdAt: row.created_at,
  };
}

function asLecture(row: {
  id: string;
  course_id: string;
  title: string;
  started_at: string;
  duration_sec: number;
  transcript: string;
  summary: string;
  outline_json: string;
  terms_json: string;
  actions_json: string;
  asks_json?: string;
  traps_json?: string;
  source: string;
}): Lecture {
  return {
    id: row.id,
    courseId: row.course_id,
    title: row.title,
    startedAt: Date.parse(row.started_at) || Date.now(),
    durationSec: Number(row.duration_sec) || 0,
    transcript: row.transcript,
    summary: row.summary,
    outline: parseList(row.outline_json),
    terms: parseList(row.terms_json),
    actions: parseList(row.actions_json),
    examAsks: parseList(row.asks_json),
    traps: parseList(row.traps_json),
    source: row.source,
  };
}

export const listCourses = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      name: string;
      code: string;
      term: string;
      instructor: string;
      accent: string;
      syllabus: string;
      master_summary: string;
      lms_provider: string | null;
      created_at: string;
    }>`
      select id, name, code, term, instructor, accent, syllabus, master_summary, lms_provider, created_at::text as created_at
      from courses where user_id = ${context.userId}
      order by created_at desc
    `;
    return rows.map(asCourse);
  });

export const getCourse = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ id: z.string() }).parse(data))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const [row] = await sql<{
      id: string;
      name: string;
      code: string;
      term: string;
      instructor: string;
      accent: string;
      syllabus: string;
      master_summary: string;
      lms_provider: string | null;
      created_at: string;
    }>`
      select id, name, code, term, instructor, accent, syllabus, master_summary, lms_provider, created_at::text as created_at
      from courses where id = ${data.id} and user_id = ${context.userId}
    `;
    return row ? asCourse(row) : null;
  });

export const createCourse = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) =>
    z
      .object({
        name: z.string().min(1).max(120),
        code: z.string().max(40).default(""),
        term: z.string().max(40).default(""),
        instructor: z.string().max(80).default(""),
      })
      .parse(data),
  )
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const id = uid("class");
    const code = data.code.trim() || data.name.slice(0, 12);
    await sql`
      insert into courses (id, user_id, name, code, term, instructor)
      values (${id}, ${context.userId}, ${data.name.trim()}, ${code}, ${data.term.trim()}, ${data.instructor.trim()})
    `;
    await archiveCourseById(sql, id).catch(() => false);
    return { ok: true as const, id };
  });

export const updateCourse = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) =>
    z
      .object({
        id: z.string(),
        name: z.string().min(1).max(120).optional(),
        code: z.string().max(40).optional(),
        term: z.string().max(40).optional(),
        instructor: z.string().max(80).optional(),
        syllabus: z.string().max(20_000).optional(),
      })
      .parse(data),
  )
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const [row] = await sql<{ id: string }>`
      select id from courses where id = ${data.id} and user_id = ${context.userId}
    `;
    if (!row) return { ok: false as const, error: "Class not found." };
    await sql`
      update courses set
        name = coalesce(${data.name ?? null}, name),
        code = coalesce(${data.code ?? null}, code),
        term = coalesce(${data.term ?? null}, term),
        instructor = coalesce(${data.instructor ?? null}, instructor),
        syllabus = coalesce(${data.syllabus ?? null}, syllabus)
      where id = ${data.id} and user_id = ${context.userId}
    `;
    return { ok: true as const };
  });

export const deleteCourse = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ id: z.string() }).parse(data))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`delete from cards where course_id = ${data.id} and user_id = ${context.userId}`;
    await sql`delete from exams where course_id = ${data.id} and user_id = ${context.userId}`;
    await sql`delete from lectures where course_id = ${data.id} and user_id = ${context.userId}`;
    await sql`delete from courses where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const getLecture = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ id: z.string() }).parse(data))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const [row] = await sql<{
      id: string;
      course_id: string;
      title: string;
      started_at: string;
      duration_sec: number;
      transcript: string;
      summary: string;
      outline_json: string;
      terms_json: string;
      actions_json: string;
      asks_json: string;
      traps_json: string;
      source: string;
    }>`
      select id, course_id, title, started_at::text as started_at, duration_sec, transcript, summary,
        outline_json, terms_json, actions_json, asks_json, traps_json, source
      from lectures where id = ${data.id} and user_id = ${context.userId}
    `;
    return row ? asLecture(row) : null;
  });

export const listLectures = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ courseId: z.string() }).parse(data))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      course_id: string;
      title: string;
      started_at: string;
      duration_sec: number;
      transcript: string;
      summary: string;
      outline_json: string;
      terms_json: string;
      actions_json: string;
      asks_json: string;
      traps_json: string;
      source: string;
    }>`
      select id, course_id, title, started_at::text as started_at, duration_sec, transcript, summary,
        outline_json, terms_json, actions_json, asks_json, traps_json, source
      from lectures
      where user_id = ${context.userId} and course_id = ${data.courseId}
      order by started_at desc
    `;
    return rows.map(asLecture);
  });

async function fileDuesFromLecture(
  sql: Awaited<ReturnType<typeof getSql>>,
  userId: string,
  courseId: string,
  lectureId: string,
  actions: string[],
  transcript: string,
) {
  const dues = duesFromLectureMaterial({ actions, transcript });
  for (const due of dues) {
    const [exists] = await sql<{ n: number }>`
      select count(*) as n from exams
      where user_id = ${userId} and course_id = ${courseId} and exam_on = ${due.examOn} and title = ${due.title}
    `;
    if (Number(exists?.n) > 0) continue;
    await sql`
      insert into exams (id, user_id, course_id, title, exam_on, notes, source)
      values (${uid("due")}, ${userId}, ${courseId}, ${due.title}, ${due.examOn}, ${`lecture:${lectureId}`}, ${"lecture"})
    `;
  }
}

export const saveLecture = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) =>
    z
      .object({
        courseId: z.string(),
        transcript: z.string().min(1).max(80_000),
        durationSec: z.number().int().min(0).max(20_000).default(0),
        source: z.string().max(20).default("mic"),
      })
      .parse(data),
  )
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const [course] = await sql<{ id: string; name: string; code: string }>`
      select id, name, code from courses where id = ${data.courseId} and user_id = ${context.userId}
    `;
    if (!course) return { ok: false as const, error: "Class not found." };
    const notes = await runSummarize({
      transcript: data.transcript,
      courseName: course.name,
      courseCode: course.code,
    });
    const id = uid("lec");
    await sql`
      insert into lectures (
        id, user_id, course_id, title, duration_sec, transcript, summary,
        outline_json, terms_json, actions_json, asks_json, traps_json, source
      ) values (
        ${id}, ${context.userId}, ${course.id}, ${notes.title}, ${data.durationSec},
        ${data.transcript}, ${notes.recap.join(" ")},
        ${JSON.stringify(notes.recap)}, ${JSON.stringify(notes.terms)},
        ${JSON.stringify(notes.actionItems)}, ${JSON.stringify(notes.theyWillAsk)},
        ${JSON.stringify(notes.traps)}, ${data.source}
      )
    `;
    for (const card of notes.termCards) {
      await sql`
        insert into cards (id, user_id, course_id, lecture_id, front, back)
        values (${uid("card")}, ${context.userId}, ${course.id}, ${id}, ${card.term}, ${card.definition})
      `;
    }
    await fileDuesFromLecture(sql, context.userId, course.id, id, notes.actionItems, data.transcript);
    await archiveLectureById(sql, id, "save").catch(() => false);
    return { ok: true as const, id };
  });

export const rebuildLecture = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ id: z.string() }).parse(data))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const [row] = await sql<{
      id: string;
      course_id: string;
      transcript: string;
      name: string;
      code: string;
    }>`
      select l.id, l.course_id, l.transcript, c.name, c.code
      from lectures l
      join courses c on c.id = l.course_id
      where l.id = ${data.id} and l.user_id = ${context.userId}
    `;
    if (!row?.transcript) return { ok: false as const, error: "No transcript to rebuild." };
    const notes = await runSummarize({
      transcript: row.transcript,
      courseName: row.name,
      courseCode: row.code,
    });
    await sql`
      update lectures set
        title = ${notes.title},
        summary = ${notes.recap.join(" ")},
        outline_json = ${JSON.stringify(notes.recap)},
        terms_json = ${JSON.stringify(notes.terms)},
        actions_json = ${JSON.stringify(notes.actionItems)},
        asks_json = ${JSON.stringify(notes.theyWillAsk)},
        traps_json = ${JSON.stringify(notes.traps)}
      where id = ${row.id} and user_id = ${context.userId}
    `;
    await sql`delete from cards where lecture_id = ${row.id} and user_id = ${context.userId}`;
    for (const card of notes.termCards) {
      await sql`
        insert into cards (id, user_id, course_id, lecture_id, front, back)
        values (${uid("card")}, ${context.userId}, ${row.course_id}, ${row.id}, ${card.term}, ${card.definition})
      `;
    }
    await fileDuesFromLecture(sql, context.userId, row.course_id, row.id, notes.actionItems, row.transcript);
    await archiveLectureById(sql, row.id, "rebuild").catch(() => false);
    return { ok: true as const };
  });

export const patchLecture = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) =>
    z
      .object({
        id: z.string(),
        outline: z.array(z.string()).optional(),
        examAsks: z.array(z.string()).optional(),
        traps: z.array(z.string()).optional(),
      })
      .parse(data),
  )
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`
      update lectures set
        outline_json = coalesce(${data.outline ? JSON.stringify(data.outline) : null}, outline_json),
        asks_json = coalesce(${data.examAsks ? JSON.stringify(data.examAsks) : null}, asks_json),
        traps_json = coalesce(${data.traps ? JSON.stringify(data.traps) : null}, traps_json)
      where id = ${data.id} and user_id = ${context.userId}
    `;
    await archiveLectureById(sql, data.id, "edit").catch(() => false);
    return { ok: true as const };
  });

export const deleteLecture = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ id: z.string() }).parse(data))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await archiveLectureById(sql, data.id, "delete").catch(() => false);
    await sql`delete from cards where lecture_id = ${data.id} and user_id = ${context.userId}`;
    await sql`delete from lectures where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const listCards = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ courseId: z.string() }).parse(data))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const rows = await sql<{
      id: string;
      course_id: string;
      lecture_id: string | null;
      front: string;
      back: string;
      box: number;
      due_at: string;
    }>`
      select id, course_id, lecture_id, front, back, box, due_at::text as due_at
      from cards where user_id = ${context.userId} and course_id = ${data.courseId}
      order by due_at
    `;
    return rows.map(
      (row): Flashcard => ({
        id: row.id,
        courseId: row.course_id,
        lectureId: row.lecture_id,
        front: row.front,
        back: row.back,
        box: Number(row.box) || 1,
        dueAt: row.due_at,
      }),
    );
  });

export const deleteCard = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ id: z.string() }).parse(data))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`delete from cards where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const addExam = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) =>
    z
      .object({
        courseId: z.string(),
        title: z.string().min(1).max(120),
        examOn: z.string().min(8).max(12),
        notes: z.string().max(400).default(""),
      })
      .parse(data),
  )
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const [course] = await sql<{ id: string }>`
      select id from courses where id = ${data.courseId} and user_id = ${context.userId}
    `;
    if (!course) return { ok: false as const, error: "Class not found." };
    const id = uid("due");
    await sql`
      insert into exams (id, user_id, course_id, title, exam_on, notes, source)
      values (${id}, ${context.userId}, ${data.courseId}, ${data.title.trim()}, ${data.examOn}, ${data.notes.trim()}, ${"manual"})
    `;
    return { ok: true as const, id };
  });

export const deleteExam = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ id: z.string() }).parse(data))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`delete from exams where id = ${data.id} and user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const getDesk = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<Desk> => {
    const sql = await getSql();
    try {
      await reclaimMyDesk(sql, context.userId);
    } catch {
      /* keep reading this account’s rows */
    }
    const courses = await sql<{
      id: string;
      name: string;
      code: string;
      term: string;
      instructor: string;
      accent: string;
      syllabus: string;
      master_summary: string;
      lms_provider: string | null;
      created_at: string;
    }>`
      select id, name, code, term, instructor, accent, syllabus, master_summary, lms_provider, created_at::text as created_at
      from courses where user_id = ${context.userId}
      order by created_at desc
    `;
    const lectures = await sql<{
      id: string;
      course_id: string;
      title: string;
      started_at: string;
      duration_sec: number;
      transcript: string;
      summary: string;
      outline_json: string;
      terms_json: string;
      actions_json: string;
      asks_json: string;
      traps_json: string;
      source: string;
    }>`
      select id, course_id, title, started_at::text as started_at, duration_sec, transcript, summary,
        outline_json, terms_json, actions_json, asks_json, traps_json, source
      from lectures
      where user_id = ${context.userId}
      order by started_at desc
      limit 40
    `;
    const exams = await sql<{
      id: string;
      course_id: string;
      title: string;
      exam_on: string;
      notes: string;
      source: string;
    }>`
      select id, course_id, title, exam_on, notes, source
      from exams
      where user_id = ${context.userId}
        and exam_on >= (current_date - 14)::text
      order by exam_on
      limit 80
    `;
    const cards = await sql<{
      id: string;
      course_id: string;
      lecture_id: string | null;
      front: string;
      back: string;
      box: number;
      due_at: string;
    }>`
      select id, course_id, lecture_id, front, back, box, due_at::text as due_at
      from cards where user_id = ${context.userId}
      order by due_at
      limit 80
    `;
    return {
      courses: courses.map(asCourse),
      lectures: lectures.map(asLecture),
      exams: exams.map((row) => ({
        id: row.id,
        courseId: row.course_id,
        title: row.title,
        examOn: row.exam_on,
        notes: row.notes,
        source: row.source,
      })),
      cards: cards.map((row) => ({
        id: row.id,
        courseId: row.course_id,
        lectureId: row.lecture_id,
        front: row.front,
        back: row.back,
        box: Number(row.box) || 1,
        dueAt: row.due_at,
      })),
    };
  });
