import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { applyPlan } from "@/functions/billing";
import { restoreForUser } from "@/functions/recover";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { identityIsOwner } from "@/lib/owner";
import {
  hydrateStripe,
  maskSecret,
  saveStripeSecrets,
  stripeReady,
  stripeSecret,
  stripeWebhookSecret,
} from "@/lib/stripe";

export type UsageStats = {
  students: number;
  classes: number;
  lectures: number;
  lecturesToday: number;
  lecturesThisWeek: number;
  cards: number;
  exams: number;
  canvas: number;
  activeNow: number;
  activeToday: number;
  activeWeek: number;
  newThisWeek: number;
  proStudents: number;
  freeStudents: number;
  schools: { school: string; students: number }[];
  stripeReady: boolean;
  stripeSecretHint: string | null;
  stripeWebhookHint: string | null;
  ownerEmail: string | null;
  ownerHow: "email" | "claimed";
  mine: { classes: number; lectures: number; school: string; grade: string };
};

export type OwnerState = { isOwner: boolean; canClaim: boolean };

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function userEmail(sql: Awaited<ReturnType<typeof getSql>>, userId: string): Promise<string | null> {
  const [row] = await sql<{ email: string | null }>`select email from "user" where id = ${userId} limit 1`;
  return row?.email ?? null;
}

async function loadHints(
  sql: Awaited<ReturnType<typeof getSql>>,
  userId: string,
): Promise<{ email: string | null; name: string | null; accountIds: string[] }> {
  const [user] = await sql<{ email: string | null; name: string | null }>`
    select email, name from "user" where id = ${userId} limit 1
  `;
  let accountIds: string[] = [];
  try {
    const accounts = await sql<{ accountId: string; providerId: string }>`
      select "accountId" as "accountId", "providerId" as "providerId" from account where "userId" = ${userId}
    `;
    accountIds = accounts.flatMap((row) => [row.accountId, row.providerId]);
  } catch {
    accountIds = [];
  }
  return { email: user?.email ?? null, name: user?.name ?? null, accountIds };
}

async function promoteOwner(sql: Awaited<ReturnType<typeof getSql>>, userId: string) {
  await sql`
    insert into profiles (user_id, is_owner, plan, plan_status)
    values (${userId}, false, 'pro', 'active')
    on conflict (user_id) do nothing
  `;
  await sql`update profiles set is_owner = false where is_owner = true and user_id <> ${userId}`;
  await sql`
    update profiles
    set is_owner = true, plan = 'pro', plan_status = 'active'
    where user_id = ${userId}
  `;
  await applyPlan(sql, userId, { plan: "pro", status: "active" });
}

async function resolveOwner(sql: Awaited<ReturnType<typeof getSql>>, userId: string): Promise<OwnerState> {
  const hints = await loadHints(sql, userId);
  await sql`
    insert into profiles (user_id) values (${userId})
    on conflict (user_id) do nothing
  `;
  if (identityIsOwner(hints)) {
    try {
      await promoteOwner(sql, userId);
    } catch {
      /* unique owner race */
    }
    try {
      await restoreForUser(sql, userId);
    } catch {
      /* census may be empty */
    }
    return { isOwner: true, canClaim: false };
  }
  const [me] = await sql<{ is_owner: boolean }>`select is_owner from profiles where user_id = ${userId}`;
  const [owners] = await sql<{ n: number | string }>`select count(*) as n from profiles where is_owner = true`;
  const claimed = num(owners?.n) > 0;
  if (!claimed) {
    try {
      await promoteOwner(sql, userId);
      return { isOwner: true, canClaim: false };
    } catch {
      return { isOwner: false, canClaim: true };
    }
  }
  return { isOwner: Boolean(me?.is_owner), canClaim: false };
}

export const ensureProfile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await sql`
      insert into profiles (user_id) values (${context.userId})
      on conflict (user_id) do nothing
    `;
    const state = await resolveOwner(sql, context.userId);
    if (state.canClaim) {
      try {
        await sql`update profiles set is_owner = true where user_id = ${context.userId}`;
      } catch {
        /* claimed elsewhere */
      }
    }
    return { ok: true as const };
  });

export const saveProfile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) =>
    z.object({ school: z.string().max(80).default(""), grade: z.string().max(40).default("") }).parse(data),
  )
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await sql`
      insert into profiles (user_id, school, grade)
      values (${context.userId}, ${data.school.trim()}, ${data.grade.trim()})
      on conflict (user_id) do update set school = excluded.school, grade = excluded.grade
    `;
    return { ok: true as const };
  });

export const getOwnerState = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    return resolveOwner(sql, context.userId);
  });

export const claimOwner = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    const state = await resolveOwner(sql, context.userId);
    if (state.isOwner) return { ok: true as const };
    if (!state.canClaim) return { ok: false as const, error: "This Lectern already has an owner." };
    try {
      await sql`update profiles set is_owner = true where user_id = ${context.userId}`;
    } catch {
      return { ok: false as const, error: "This Lectern already has an owner." };
    }
    return { ok: true as const };
  });

export const saveStripeConnect = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) =>
    z.object({ secretKey: z.string().max(200).optional(), webhookSecret: z.string().max(200).optional() }).parse(data),
  )
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const owner = await resolveOwner(sql, context.userId);
    if (!owner.isOwner) return { ok: false as const, error: "Only the Lectern owner can connect Stripe." };
    return saveStripeSecrets({ secretKey: data.secretKey, webhookSecret: data.webhookSecret });
  });

export const getUsage = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ ok: true; stats: UsageStats } | { ok: false; error: string }> => {
    const sql = await getSql();
    const owner = await resolveOwner(sql, context.userId);
    if (!owner.isOwner) return { ok: false, error: "Usage is only for the Lectern owner." };
    const email = await userEmail(sql, context.userId);
    await hydrateStripe().catch(() => undefined);
    let site: {
      students: number;
      classes: number;
      lectures: number;
      lecturesToday: number;
      lecturesThisWeek: number;
      cards: number;
      exams: number;
      canvas: number;
      activeNow: number;
      activeToday: number;
      activeWeek: number;
      newThisWeek: number;
    } = {
      students: 0,
      classes: 0,
      lectures: 0,
      lecturesToday: 0,
      lecturesThisWeek: 0,
      cards: 0,
      exams: 0,
      canvas: 0,
      activeNow: 0,
      activeToday: 0,
      activeWeek: 0,
      newThisWeek: 0,
    };
    try {
      const [row] = await sql<{
        students: number | string;
        classes: number | string;
        lectures: number | string;
        lectures_today: number | string;
        week: number | string;
        cards: number | string;
        exams: number | string;
        canvas: number | string;
        active_now: number | string;
        active_today: number | string;
        active_week: number | string;
        new_week: number | string;
      }>`
        select
          (select count(*) from "user") as students,
          (select count(*) from courses) as classes,
          (select count(*) from lectures) as lectures,
          (select count(*) from lectures where started_at >= now() - interval '1 day') as lectures_today,
          (select count(*) from lectures where started_at >= now() - interval '7 days') as week,
          (select count(*) from cards) as cards,
          (select count(*) from exams) as exams,
          (select count(*) from lms_connections) as canvas,
          (select count(distinct "userId") from "session"
            where "expiresAt" > now() and "updatedAt" >= now() - interval '15 minutes') as active_now,
          (select count(*) from (
              select "userId" as id from "session" where "updatedAt" >= now() - interval '1 day'
              union
              select user_id from lectures where started_at >= now() - interval '1 day'
            ) today_users) as active_today,
          (select count(*) from (
              select "userId" as id from "session" where "updatedAt" >= now() - interval '7 days'
              union
              select user_id from lectures where started_at >= now() - interval '7 days'
            ) week_users) as active_week,
          (select count(*) from "user" where "createdAt" >= now() - interval '7 days') as new_week
      `;
      site = {
        students: num(row?.students),
        classes: num(row?.classes),
        lectures: num(row?.lectures),
        lecturesToday: num(row?.lectures_today),
        lecturesThisWeek: num(row?.week),
        cards: num(row?.cards),
        exams: num(row?.exams),
        canvas: num(row?.canvas),
        activeNow: num(row?.active_now),
        activeToday: num(row?.active_today),
        activeWeek: num(row?.active_week),
        newThisWeek: num(row?.new_week),
      };
    } catch {
      try {
        const [row] = await sql<{ students: number | string; classes: number | string; lectures: number | string }>`
          select
            (select count(*) from "user") as students,
            (select count(*) from courses) as classes,
            (select count(*) from lectures) as lectures
        `;
        site.students = num(row?.students);
        site.classes = num(row?.classes);
        site.lectures = num(row?.lectures);
      } catch {
        /* still show the page */
      }
    }
    let schoolRows: { school: string; n: number | string }[] = [];
    let proStudents = 0;
    let mine = { classes: 0, lectures: 0, school: "", grade: "" };
    try {
      schoolRows = await sql<{ school: string; n: number | string }>`
        select school, count(*) as n from profiles
        where school is not null and trim(school) <> ''
        group by school order by count(*) desc limit 8
      `;
    } catch {
      schoolRows = [];
    }
    try {
      const [plans] = await sql<{ pro: number | string }>`
        select
          (select count(*) from profiles where plan = 'pro' and plan_status in ('active','trialing','past_due','invite'))
            + (select count(*) from profiles where is_owner = true) as pro
      `;
      proStudents = num(plans?.pro);
    } catch {
      proStudents = 0;
    }
    try {
      const [row] = await sql<{
        classes: number | string;
        lectures: number | string;
        school: string | null;
        grade: string | null;
      }>`
        select
          (select count(*) from courses where user_id = ${context.userId}) as classes,
          (select count(*) from lectures where user_id = ${context.userId}) as lectures,
          p.school, p.grade
        from profiles p where p.user_id = ${context.userId}
      `;
      mine = {
        classes: num(row?.classes),
        lectures: num(row?.lectures),
        school: row?.school ?? "",
        grade: row?.grade ?? "",
      };
    } catch {
      /* ignore */
    }
    return {
      ok: true,
      stats: {
        students: site.students,
        classes: site.classes,
        lectures: site.lectures,
        lecturesToday: site.lecturesToday,
        lecturesThisWeek: site.lecturesThisWeek,
        cards: site.cards,
        exams: site.exams,
        canvas: site.canvas,
        activeNow: site.activeNow,
        activeToday: site.activeToday,
        activeWeek: site.activeWeek,
        newThisWeek: site.newThisWeek,
        proStudents,
        freeStudents: Math.max(0, site.students - proStudents),
        schools: schoolRows.map((row) => ({ school: row.school, students: num(row.n) })),
        stripeReady: stripeReady(),
        stripeSecretHint: maskSecret(stripeSecret()),
        stripeWebhookHint: maskSecret(stripeWebhookSecret()),
        ownerEmail: email,
        ownerHow: identityIsOwner({ email }) ? "email" : "claimed",
        mine,
      },
    };
  });
