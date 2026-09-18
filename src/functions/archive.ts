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

export async function snapshotKnowledge(sql: Sql): Promise<number> {
  const rows = await sql<{ id: string }>`select id from lectures where length(trim(transcript)) > 0`;
  let n = 0;
  for (const row of rows) {
    if (await archiveLectureById(sql, row.id, "snapshot")) n += 1;
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
    const rows = await sql<{
      lecture_id: string;
      user_email: string;
      user_name: string;
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
      archived_at: string;
    }>`
      select a.lecture_id, a.user_email, a.user_name, a.course_name, a.course_code,
        a.title, a.started_at::text as started_at, a.duration_sec, a.transcript, a.summary,
        a.outline_json, a.terms_json, a.actions_json, a.asks_json, a.traps_json, a.source,
        a.archived_at::text as archived_at
      from lecture_archive a
      inner join (
        select lecture_id, max(archived_at) as latest
        from lecture_archive
        group by lecture_id
      ) latest on latest.lecture_id = a.lecture_id and latest.latest = a.archived_at
      order by a.archived_at desc
    `;
    return {
      ok: true as const,
      exportedAt: new Date().toISOString(),
      lectures: rows.map((row) => ({
        lectureId: row.lecture_id,
        email: row.user_email,
        name: row.user_name,
        course: row.course_name,
        code: row.course_code,
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
        archivedAt: row.archived_at,
      })),
    };
  });
