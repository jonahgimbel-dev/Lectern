import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { parseCalendarPlan } from "@/lib/calendar-feed";
import { getSql } from "@/lib/db";
import { parseRosterPaste } from "@/lib/paste-roster";
import { uid } from "@/lib/utils";

async function upsertCourse(
  sql: Awaited<ReturnType<typeof getSql>>,
  userId: string,
  input: { code: string; name: string; provider?: string; lmsId?: string },
): Promise<string> {
  const code = input.code.trim() || input.name.slice(0, 12);
  const [existing] = await sql<{ id: string }>`
    select id from courses
    where user_id = ${userId} and (lower(code) = ${code.toLowerCase()} or lower(name) = ${input.name.toLowerCase()})
    limit 1
  `;
  if (existing) {
    await sql`
      update courses set
        name = ${input.name},
        lms_provider = coalesce(${input.provider ?? null}, lms_provider),
        lms_course_id = coalesce(${input.lmsId ?? null}, lms_course_id)
      where id = ${existing.id} and user_id = ${userId}
    `;
    return existing.id;
  }
  const id = uid("class");
  await sql`
    insert into courses (id, user_id, name, code, lms_provider, lms_course_id)
    values (${id}, ${userId}, ${input.name}, ${code}, ${input.provider ?? null}, ${input.lmsId ?? null})
  `;
  return id;
}

async function importIcsForUser(userId: string, ics: string) {
  const plans = parseCalendarPlan(ics);
  if (!plans.length) return { ok: false as const, error: "No classes found in that calendar." };
  const sql = await getSql();
  let classes = 0;
  let dues = 0;
  for (const plan of plans) {
    const courseId = await upsertCourse(sql, userId, {
      code: plan.code,
      name: plan.name,
      provider: "canvas-ics",
      lmsId: plan.code,
    });
    classes += 1;
    for (const event of plan.events) {
      const [exists] = await sql<{ n: number }>`
        select count(*) as n from exams
        where user_id = ${userId} and course_id = ${courseId}
          and exam_on = ${event.examOn} and title = ${event.title}
      `;
      if (Number(exists?.n) > 0) continue;
      await sql`
        insert into exams (id, user_id, course_id, title, exam_on, notes, source)
        values (${uid("due")}, ${userId}, ${courseId}, ${event.title}, ${event.examOn}, ${""}, ${"canvas"})
      `;
      dues += 1;
    }
  }
  await sql`
    insert into lms_connections (id, user_id, provider, base_url, token)
    values (${uid("lms")}, ${userId}, ${"canvas-ics"}, ${"ics"}, ${"feed"})
    on conflict (user_id, provider) do update set last_synced_at = now()
  `;
  return { ok: true as const, classes, dues };
}

export const importCalendarFeed = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ ics: z.string().min(20).max(400_000) }).parse(data))
  .handler(async ({ context, data }) => importIcsForUser(context.userId, data.ics));

export const importRosterPaste = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ text: z.string().min(4).max(20_000) }).parse(data))
  .handler(async ({ context, data }) => {
    const rows = parseRosterPaste(data.text);
    if (!rows.length) return { ok: false as const, error: "Could not find course names in that paste." };
    const sql = await getSql();
    for (const row of rows) {
      await upsertCourse(sql, context.userId, { code: row.code, name: row.name, provider: "canvas-paste" });
    }
    return { ok: true as const, classes: rows.length };
  });

export const fetchCalendarUrl = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ url: z.string().url().max(500) }).parse(data))
  .handler(async ({ context, data }) => {
    if (!/^https?:\/\//i.test(data.url) || /localhost|127\.|0\.0\.0\.0/i.test(data.url)) {
      return { ok: false as const, error: "Paste a Canvas calendar feed URL." };
    }
    const res = await fetch(data.url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { ok: false as const, error: "Could not fetch that calendar." };
    const ics = await res.text();
    if (!/BEGIN:VCALENDAR/i.test(ics)) return { ok: false as const, error: "That URL is not a calendar feed." };
    return importIcsForUser(context.userId, ics);
  });

