import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql, type Sql } from "@/lib/db";
import { identityIsOwner } from "@/lib/owner";
import { uid } from "@/lib/utils";

export type ArchiveHit = {
  id: string;
  lectureId: string;
  userEmail: string;
  userName: string;
  courseName: string;
  courseCode: string;
  title: string;
  startedAt: string | null;
  durationSec: number;
  reason: string;
  archivedAt: string;
  live: boolean;
  words: number;
};

type LiveLecture = {
  id: string;
  user_id: string;
  course_id: string;
  title: string;
  started_at: string | null;
  duration_sec: number | string;
  transcript: string;
  summary: string;
  outline_json: string;
  terms_json: string;
  actions_json: string;
  asks_json: string;
  traps_json: string;
  source: string;
  course_name: string;
  course_code: string;
  user_email: string | null;
  user_name: string | null;
};

async function assertOwner(sql: Sql, userId: string) {
  const [user] = await sql<{ email: string | null; name: string | null }>`
    select email, name from "user" where id = ${userId} limit 1
  `;
  if (identityIsOwner({ email: user?.email, name: user?.name })) return;
  const [row] = await sql<{ is_owner: boolean }>`select is_owner from profiles where user_id = ${userId}`;
  if (!row?.is_owner) throw new Error("Owner only.");
}

function parseTerms(raw: string): { term: string; definition: string }[] {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => {
        if (typeof item === "string") return { term: item, definition: "" };
        if (item && typeof item === "object") {
          const row = item as { term?: unknown; definition?: unknown };
          if (typeof row.term === "string") {
            return { term: row.term, definition: typeof row.definition === "string" ? row.definition : "" };
          }
        }
        return null;
      })
      .filter((item): item is { term: string; definition: string } => Boolean(item));
  } catch {
    return [];
  }
}

async function loadLive(sql: Sql, lectureId: string): Promise<LiveLecture | null> {
  const [row] = await sql<LiveLecture>`
    select
      l.id, l.user_id, l.course_id, l.title, l.started_at::text as started_at,
      l.duration_sec, l.transcript, l.summary, l.outline_json, l.terms_json,
      l.actions_json, l.asks_json, l.traps_json, l.source,
      coalesce(c.name, '') as course_name, coalesce(c.code, '') as course_code,
      u.email as user_email, u.name as user_name
    from lectures l
    left join courses c on c.id = l.course_id
    left join "user" u on u.id = l.user_id
    where l.id = ${lectureId}
    limit 1
  `;
  return row ?? null;
}

export async function archiveLectureById(sql: Sql, lectureId: string, reason: string): Promise<boolean> {
  const live = await loadLive(sql, lectureId);
  if (!live?.transcript.trim()) return false;
  const [last] = await sql<{ transcript: string; outline_json: string }>`
    select transcript, outline_json from lecture_archive
    where lecture_id = ${lectureId}
    order by archived_at desc
    limit 1
  `;
  if (last && last.transcript === live.transcript && last.outline_json === live.outline_json && reason !== "delete") {
    return false;
  }
  await sql`
    insert into lecture_archive (
      id, lecture_id, user_id, user_email, user_name, course_id, course_name, course_code,
      title, started_at, duration_sec, transcript, summary, outline_json, terms_json,
      actions_json, asks_json, traps_json, source, reason
    ) values (
      ${uid("kb")}, ${live.id}, ${live.user_id}, ${live.user_email ?? ""}, ${live.user_name ?? ""},
      ${live.course_id}, ${live.course_name}, ${live.course_code}, ${live.title},
      ${live.started_at}::timestamptz, ${Number(live.duration_sec) || 0}, ${live.transcript},
      ${live.summary}, ${live.outline_json}, ${live.terms_json}, ${live.actions_json},
      ${live.asks_json}, ${live.traps_json}, ${live.source}, ${reason}
    )
  `;
  return true;
}

export async function archiveCourseById(sql: Sql, courseId: string): Promise<boolean> {
  const [row] = await sql<{
    id: string;
    user_id: string;
    name: string;
    code: string;
    term: string;
    instructor: string;
    syllabus: string;
    master_summary: string;
    user_email: string | null;
    user_name: string | null;
  }>`
    select c.id, c.user_id, c.name, c.code, c.term, c.instructor, c.syllabus, c.master_summary,
      u.email as user_email, u.name as user_name
    from courses c
    left join "user" u on u.id = c.user_id
    where c.id = ${courseId}
    limit 1
  `;
  if (!row) return false;
  const [last] = await sql<{ name: string; syllabus: string }>`
    select name, syllabus from course_archive where course_id = ${courseId} order by archived_at desc limit 1
  `;
  if (last && last.name === row.name && last.syllabus === row.syllabus) return false;
  await sql`
    insert into course_archive (
      id, course_id, user_id, user_email, user_name, name, code, term, instructor, syllabus, master_summary
    ) values (
      ${uid("kbc")}, ${row.id}, ${row.user_id}, ${row.user_email ?? ""}, ${row.user_name ?? ""},
      ${row.name}, ${row.code}, ${row.term}, ${row.instructor}, ${row.syllabus}, ${row.master_summary}
    )
  `;
  return true;
}

export async function snapshotKnowledge(sql: Sql): Promise<number> {
  let n = 0;
  const lectures = await sql<{ id: string }>`select id from lectures where length(trim(transcript)) > 0`;
  for (const row of lectures) {
    if (await archiveLectureById(sql, row.id, "snapshot")) n += 1;
  }
  try {
    const courses = await sql<{ id: string }>`select id from courses`;
    for (const row of courses) {
      if (await archiveCourseById(sql, row.id)) n += 1;
    }
    const exams = await sql<{
      id: string;
      user_id: string;
      course_id: string;
      title: string;
      exam_on: string;
      notes: string;
      user_email: string | null;
      user_name: string | null;
      course_name: string;
      course_code: string;
    }>`
      select e.id, e.user_id, e.course_id, e.title, e.exam_on, e.notes,
        u.email as user_email, u.name as user_name,
        coalesce(c.name, '') as course_name, coalesce(c.code, '') as course_code
      from exams e
      left join "user" u on u.id = e.user_id
      left join courses c on c.id = e.course_id
    `;
    for (const row of exams) {
      const [last] = await sql<{ notes: string; exam_on: string }>`
        select notes, exam_on from exam_archive where exam_id = ${row.id} order by archived_at desc limit 1
      `;
      if (last && last.notes === row.notes && last.exam_on === row.exam_on) continue;
      await sql`
        insert into exam_archive (
          id, exam_id, user_id, user_email, user_name, course_id, course_name, course_code, title, exam_on, notes
        ) values (
          ${uid("kbe")}, ${row.id}, ${row.user_id}, ${row.user_email ?? ""}, ${row.user_name ?? ""},
          ${row.course_id}, ${row.course_name}, ${row.course_code}, ${row.title}, ${row.exam_on}, ${row.notes}
        )
      `;
      n += 1;
    }
  } catch {
    /* older DBs without vault tables still keep lecture copies */
  }
  return n;
}

async function findRestoreUser(sql: Sql, email: string, name: string, fallbackId: string): Promise<string> {
  const mail = email.trim().toLowerCase();
  if (mail) {
    const [byEmail] = await sql<{ id: string }>`
      select id from "user" where lower(trim(email)) = ${mail} limit 1
    `;
    if (byEmail) return byEmail.id;
  }
  const person = name.trim().toLowerCase().replace(/\s+/g, " ");
  if (person.includes(" ")) {
    const [byName] = await sql<{ id: string }>`
      select id from "user"
      where lower(trim(regexp_replace(coalesce(name, ''), '\s+', ' ', 'g'))) = ${person}
      limit 1
    `;
    if (byName) return byName.id;
  }
  return fallbackId;
}

async function ensureCourse(
  sql: Sql,
  userId: string,
  courseId: string,
  name: string,
  code: string,
): Promise<string> {
  const [sameId] = await sql<{ id: string }>`
    select id from courses where id = ${courseId} and user_id = ${userId}
  `;
  if (sameId) return sameId.id;
  const [named] = await sql<{ id: string }>`
    select id from courses
    where user_id = ${userId}
      and lower(name) = ${name.trim().toLowerCase()}
      and lower(code) = ${code.trim().toLowerCase()}
    limit 1
  `;
  if (named) return named.id;
  const id = courseId || uid("crs");
  const [taken] = await sql<{ id: string }>`select id from courses where id = ${id}`;
  const nextId = taken ? uid("crs") : id;
  await sql`
    insert into courses (id, user_id, name, code)
    values (${nextId}, ${userId}, ${name || "Restored class"}, ${code || ""})
  `;
  return nextId;
}

export const listKnowledge = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ q: z.string().max(80).optional() }).parse(data ?? {}))
  .handler(async ({ context, data }): Promise<{ hits: ArchiveHit[]; total: number }> => {
    const sql = await getSql();
    await assertOwner(sql, context.userId);
    try {
      await snapshotKnowledge(sql);
    } catch {
      /* list whatever is already stored */
    }
    const q = (data.q ?? "").trim();
    const like = `%${q.replace(/[%_]/g, " ")}%`;
    const rows = await sql<{
      id: string;
      lecture_id: string;
      user_email: string;
      user_name: string;
      course_name: string;
      course_code: string;
      title: string;
      started_at: string | null;
      duration_sec: number | string;
      reason: string;
      archived_at: string;
      live: boolean | number | string | null;
      words: number | string;
    }>`
      select a.id, a.lecture_id, a.user_email, a.user_name, a.course_name, a.course_code,
        a.title, a.started_at::text as started_at, a.duration_sec, a.reason,
        a.archived_at::text as archived_at,
        exists (select 1 from lectures l where l.id = a.lecture_id) as live,
        (length(a.transcript) + 1) / 6 as words
      from lecture_archive a
      inner join (
        select lecture_id, max(archived_at) as latest
        from lecture_archive
        group by lecture_id
      ) latest on latest.lecture_id = a.lecture_id and latest.latest = a.archived_at
      where ${q} = ''
        or a.title ilike ${like}
        or a.user_email ilike ${like}
        or a.user_name ilike ${like}
        or a.course_name ilike ${like}
        or a.course_code ilike ${like}
      order by a.archived_at desc
      limit 200
    `;
    const [count] = await sql<{ n: number | string }>`
      select count(distinct lecture_id) as n from lecture_archive
    `;
    return {
      total: Number(count?.n) || 0,
      hits: rows.map((row) => ({
        id: row.id,
        lectureId: row.lecture_id,
        userEmail: row.user_email,
        userName: row.user_name,
        courseName: row.course_name,
        courseCode: row.course_code,
        title: row.title,
        startedAt: row.started_at,
        durationSec: Number(row.duration_sec) || 0,
        reason: row.reason,
        archivedAt: row.archived_at,
        live: Boolean(row.live),
        words: Number(row.words) || 0,
      })),
    };
  });

export const snapshotNow = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await assertOwner(sql, context.userId);
    const archived = await snapshotKnowledge(sql);
    const [count] = await sql<{ n: number | string }>`
      select count(distinct lecture_id) as n from lecture_archive
    `;
    return { ok: true as const, archived, total: Number(count?.n) || 0 };
  });

export const restoreKnowledge = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ id: z.string().min(1) }).parse(data))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await assertOwner(sql, context.userId);
    const [row] = await sql<{
      lecture_id: string;
      user_id: string;
      user_email: string;
      user_name: string;
      course_id: string;
      course_name: string;
      course_code: string;
      title: string;
      started_at: string | null;
      duration_sec: number | string;
      transcript: string;
      summary: string;
      outline_json: string;
      terms_json: string;
      actions_json: string;
      asks_json: string;
      traps_json: string;
      source: string;
    }>`
      select lecture_id, user_id, user_email, user_name, course_id, course_name, course_code,
        title, started_at::text as started_at, duration_sec, transcript, summary,
        outline_json, terms_json, actions_json, asks_json, traps_json, source
      from lecture_archive where id = ${data.id} limit 1
    `;
    if (!row) return { ok: false as const, error: "That copy is gone." };
    const userId = await findRestoreUser(sql, row.user_email, row.user_name, row.user_id || context.userId);
    const [existsUser] = await sql<{ id: string }>`select id from "user" where id = ${userId}`;
    const target = existsUser?.id ?? context.userId;
    const courseId = await ensureCourse(sql, target, row.course_id, row.course_name, row.course_code);
    const [live] = await sql<{ id: string }>`select id from lectures where id = ${row.lecture_id}`;
    if (live) {
      await sql`
        update lectures set
          user_id = ${target},
          course_id = ${courseId},
          title = ${row.title},
          duration_sec = ${Number(row.duration_sec) || 0},
          transcript = ${row.transcript},
          summary = ${row.summary},
          outline_json = ${row.outline_json},
          terms_json = ${row.terms_json},
          actions_json = ${row.actions_json},
          asks_json = ${row.asks_json},
          traps_json = ${row.traps_json},
          source = ${row.source}
        where id = ${row.lecture_id}
      `;
    } else {
      await sql`
        insert into lectures (
          id, user_id, course_id, title, started_at, duration_sec, transcript, summary,
          outline_json, terms_json, actions_json, asks_json, traps_json, source
        ) values (
          ${row.lecture_id}, ${target}, ${courseId}, ${row.title},
          ${row.started_at}::timestamptz, ${Number(row.duration_sec) || 0}, ${row.transcript},
          ${row.summary}, ${row.outline_json}, ${row.terms_json}, ${row.actions_json},
          ${row.asks_json}, ${row.traps_json}, ${row.source}
        )
      `;
    }
    await sql`delete from cards where lecture_id = ${row.lecture_id}`;
    for (const card of parseTerms(row.terms_json).slice(0, 24)) {
      await sql`
        insert into cards (id, user_id, course_id, lecture_id, front, back)
        values (${uid("card")}, ${target}, ${courseId}, ${row.lecture_id}, ${card.term}, ${card.definition || card.term})
      `;
    }
    return {
      ok: true as const,
      lectureId: row.lecture_id,
      onto: target === context.userId ? "your desk" : row.user_name || row.user_email || "the student",
    };
  });

export const exportKnowledge = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await assertOwner(sql, context.userId);
    await snapshotKnowledge(sql).catch(() => 0);
    const people = await sql<{ id: string; email: string | null; name: string | null }>`
      select id, email, name from "user"
    `;
    const courses = await sql<{
      id: string;
      user_id: string;
      name: string;
      code: string;
      term: string;
      instructor: string;
      syllabus: string;
      master_summary: string;
    }>`
      select id, user_id, name, code, term, instructor, syllabus, master_summary from courses
    `;
    const lectures = await sql<{
      id: string;
      user_id: string;
      course_id: string;
      title: string;
      started_at: string | null;
      duration_sec: number | string;
      transcript: string;
      summary: string;
      outline_json: string;
      terms_json: string;
      actions_json: string;
      asks_json: string;
      traps_json: string;
      source: string;
    }>`
      select id, user_id, course_id, title, started_at::text as started_at, duration_sec, transcript, summary,
        outline_json, terms_json, actions_json, asks_json, traps_json, source
      from lectures
    `;
    const cards = await sql<{
      id: string;
      user_id: string;
      course_id: string;
      lecture_id: string | null;
      front: string;
      back: string;
    }>`
      select id, user_id, course_id, lecture_id, front, back from cards
    `;
    const exams = await sql<{
      id: string;
      user_id: string;
      course_id: string;
      title: string;
      exam_on: string;
      notes: string;
    }>`
      select id, user_id, course_id, title, exam_on, notes from exams
    `;
    const desks = people
      .map((person) => {
        const mineCourses = courses.filter((row) => row.user_id === person.id);
        const mineLectures = lectures.filter((row) => row.user_id === person.id);
        const mineCards = cards.filter((row) => row.user_id === person.id);
        const mineExams = exams.filter((row) => row.user_id === person.id);
        if (!mineCourses.length && !mineLectures.length) return null;
        return {
          email: person.email || "",
          name: person.name || "",
          courses: mineCourses.map((row) => ({
            id: row.id,
            name: row.name,
            code: row.code,
            term: row.term,
            instructor: row.instructor,
            syllabus: row.syllabus,
            masterSummary: row.master_summary,
          })),
          lectures: mineLectures.map((row) => ({
            lectureId: row.id,
            courseId: row.course_id,
            title: row.title,
            startedAt: row.started_at,
            durationSec: Number(row.duration_sec) || 0,
            transcript: row.transcript,
            summary: row.summary,
            outline: row.outline_json,
            terms: row.terms_json,
            actions: row.actions_json,
            asks: row.asks_json,
            traps: row.traps_json,
            source: row.source,
          })),
          cards: mineCards.map((row) => ({
            id: row.id,
            courseId: row.course_id,
            lectureId: row.lecture_id,
            front: row.front,
            back: row.back,
          })),
          exams: mineExams.map((row) => ({
            id: row.id,
            courseId: row.course_id,
            title: row.title,
            examOn: row.exam_on,
            notes: row.notes,
          })),
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    return {
      ok: true as const,
      version: 2 as const,
      kind: "lectern-vault",
      exportedAt: new Date().toISOString(),
      desks,
      lectures: desks.flatMap((desk) =>
        desk.lectures.map((lecture) => ({
          lectureId: lecture.lectureId,
          email: desk.email,
          name: desk.name,
          course: desk.courses.find((course) => course.id === lecture.courseId)?.name ?? "",
          code: desk.courses.find((course) => course.id === lecture.courseId)?.code ?? "",
          title: lecture.title,
          startedAt: lecture.startedAt,
          durationSec: lecture.durationSec,
          transcript: lecture.transcript,
          summary: lecture.summary,
          outline: lecture.outline,
          terms: lecture.terms,
          actions: lecture.actions,
          asks: lecture.asks,
          traps: lecture.traps,
          source: lecture.source,
        })),
      ),
    };
  });

const VaultLecture = z.object({
  lectureId: z.string().max(80).optional(),
  courseId: z.string().max(80).optional(),
  email: z.string().max(200).optional(),
  name: z.string().max(120).optional(),
  course: z.string().max(120).optional(),
  code: z.string().max(40).optional(),
  title: z.string().max(200),
  startedAt: z.string().nullable().optional(),
  durationSec: z.number().optional(),
  transcript: z.string().max(80_000).optional(),
  summary: z.string().max(20_000).optional(),
  outline: z.string().max(20_000).optional(),
  terms: z.string().max(20_000).optional(),
  actions: z.string().max(20_000).optional(),
  asks: z.string().max(20_000).optional(),
  traps: z.string().max(20_000).optional(),
  source: z.string().max(20).optional(),
});

const VaultDesk = z.object({
  email: z.string().max(200).optional(),
  name: z.string().max(120).optional(),
  courses: z
    .array(
      z.object({
        id: z.string().max(80).optional(),
        name: z.string().max(120),
        code: z.string().max(40).optional(),
        term: z.string().max(40).optional(),
        instructor: z.string().max(80).optional(),
        syllabus: z.string().max(20_000).optional(),
        masterSummary: z.string().max(20_000).optional(),
      }),
    )
    .max(80)
    .optional(),
  lectures: z.array(VaultLecture).max(400).optional(),
  cards: z
    .array(
      z.object({
        courseId: z.string().max(80).optional(),
        lectureId: z.string().max(80).nullable().optional(),
        front: z.string().max(200),
        back: z.string().max(2000),
      }),
    )
    .max(800)
    .optional(),
  exams: z
    .array(
      z.object({
        courseId: z.string().max(80).optional(),
        title: z.string().max(200),
        examOn: z.string().max(40),
        notes: z.string().max(4000).optional(),
      }),
    )
    .max(400)
    .optional(),
});

const VaultFile = z.object({
  version: z.number().optional(),
  kind: z.string().optional(),
  desks: z.array(VaultDesk).max(200).optional(),
  lectures: z.array(VaultLecture).max(2000).optional(),
});

export const importKnowledge = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => VaultFile.parse(data))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await assertOwner(sql, context.userId);
    const desks =
      data.desks && data.desks.length
        ? data.desks
        : groupFlatLectures(data.lectures ?? []);
    let courses = 0;
    let lectures = 0;
    for (const desk of desks) {
      const userId = await findRestoreUser(sql, desk.email ?? "", desk.name ?? "", context.userId);
      const [exists] = await sql<{ id: string }>`select id from "user" where id = ${userId}`;
      const target = exists?.id ?? context.userId;
      const courseMap = new Map<string, string>();
      for (const course of desk.courses ?? []) {
        const id = await ensureCourse(sql, target, course.id || uid("crs"), course.name, course.code || "");
        courseMap.set(course.id || course.name, id);
        if (course.syllabus || course.instructor || course.term) {
          await sql`
            update courses set
              syllabus = case when ${course.syllabus ?? ""} = '' then syllabus else ${course.syllabus ?? ""} end,
              instructor = case when ${course.instructor ?? ""} = '' then instructor else ${course.instructor ?? ""} end,
              term = case when ${course.term ?? ""} = '' then term else ${course.term ?? ""} end
            where id = ${id} and user_id = ${target}
          `;
        }
        courses += 1;
      }
      for (const lecture of desk.lectures ?? []) {
        if (!lecture.transcript?.trim() && !lecture.title) continue;
        const courseId =
          (lecture.courseId ? courseMap.get(lecture.courseId) : undefined) ||
          (lecture.course ? [...courseMap.values()][0] : undefined) ||
          (await ensureCourse(sql, target, lecture.courseId || uid("crs"), lecture.course || "Restored class", lecture.code || ""));
        const lectureId = lecture.lectureId || uid("lec");
        const [live] = await sql<{ id: string }>`select id from lectures where id = ${lectureId}`;
        const outline = lecture.outline ?? "[]";
        const terms = lecture.terms ?? "[]";
        const actions = lecture.actions ?? "[]";
        const asks = lecture.asks ?? "[]";
        const traps = lecture.traps ?? "[]";
        const transcript = lecture.transcript ?? "";
        const summary = lecture.summary ?? "";
        const title = lecture.title;
        const duration = lecture.durationSec ?? 0;
        const source = lecture.source ?? "vault";
        if (live) {
          await sql`
            update lectures set
              user_id = ${target}, course_id = ${courseId}, title = ${title},
              duration_sec = ${duration}, transcript = ${transcript}, summary = ${summary},
              outline_json = ${outline}, terms_json = ${terms}, actions_json = ${actions},
              asks_json = ${asks}, traps_json = ${traps}, source = ${source}
            where id = ${lectureId}
          `;
        } else {
          await sql`
            insert into lectures (
              id, user_id, course_id, title, started_at, duration_sec, transcript, summary,
              outline_json, terms_json, actions_json, asks_json, traps_json, source
            ) values (
              ${lectureId}, ${target}, ${courseId}, ${title},
              ${lecture.startedAt}::timestamptz, ${duration}, ${transcript}, ${summary},
              ${outline}, ${terms}, ${actions}, ${asks}, ${traps}, ${source}
            )
          `;
        }
        lectures += 1;
      }
      for (const exam of desk.exams ?? []) {
        const courseId =
          (exam.courseId ? courseMap.get(exam.courseId) : undefined) ||
          [...courseMap.values()][0];
        if (!courseId) continue;
        const [existsExam] = await sql<{ n: number | string }>`
          select count(*) as n from exams
          where user_id = ${target} and course_id = ${courseId} and exam_on = ${exam.examOn} and title = ${exam.title}
        `;
        if (Number(existsExam?.n) > 0) continue;
        await sql`
          insert into exams (id, user_id, course_id, title, exam_on, notes)
          values (${uid("due")}, ${target}, ${courseId}, ${exam.title}, ${exam.examOn}, ${exam.notes ?? ""})
        `;
      }
    }
    return { ok: true as const, desks: desks.length, courses, lectures };
  });

function groupFlatLectures(rows: z.infer<typeof VaultLecture>[]): z.infer<typeof VaultDesk>[] {
  const map = new Map<string, z.infer<typeof VaultDesk>>();
  for (const row of rows) {
    const key = `${(row.email ?? "").toLowerCase()}::${(row.name ?? "").toLowerCase()}`;
    const desk = map.get(key) ?? { email: row.email ?? "", name: row.name ?? "", courses: [], lectures: [] };
    if (row.course && !desk.courses?.some((course) => course.name === row.course && course.code === (row.code || ""))) {
      desk.courses = [...(desk.courses ?? []), { name: row.course, code: row.code || "", id: row.courseId }];
    }
    desk.lectures = [...(desk.lectures ?? []), row];
    map.set(key, desk);
  }
  return [...map.values()];
}
