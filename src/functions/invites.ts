import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { applyPlan } from "@/functions/billing";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { identityIsOwner } from "@/lib/owner";
import { uid } from "@/lib/utils";

export type InviteRow = {
  id: string;
  code: string;
  label: string;
  maxUses: number;
  uses: number;
  revoked: boolean;
  createdAt: string;
};

export type StudentRow = {
  id: string;
  email: string;
  name: string;
  plan: string;
  status: string;
  isOwner: boolean;
  classes: number;
  lectures: number;
  cards: number;
  school: string;
  grade: string;
  lastSeen: string | null;
  lastLectureAt: string | null;
  signedIn: boolean;
  canvas: boolean;
  createdAt: string;
};

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function assertOwner(sql: Awaited<ReturnType<typeof getSql>>, userId: string) {
  const [user] = await sql<{ email: string | null; name: string | null }>`
    select email, name from "user" where id = ${userId} limit 1
  `;
  if (identityIsOwner({ email: user?.email, name: user?.name })) return true;
  const [row] = await sql<{ is_owner: boolean }>`select is_owner from profiles where user_id = ${userId}`;
  if (!row?.is_owner) throw new Error("Owner only.");
  return true;
}

function mintCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let tail = "";
  for (let i = 0; i < 6; i += 1) tail += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `LECT-${tail}`;
}

export const listInvites = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<InviteRow[]> => {
    const sql = await getSql();
    await assertOwner(sql, context.userId);
    const rows = await sql<{
      id: string;
      code: string;
      label: string;
      max_uses: number | string;
      uses: number | string;
      revoked_at: string | null;
      created_at: string;
    }>`
      select id, code, label, max_uses, uses, revoked_at::text as revoked_at, created_at::text as created_at
      from invite_codes where owner_id = ${context.userId} order by created_at desc
    `;
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      label: row.label,
      maxUses: num(row.max_uses),
      uses: num(row.uses),
      revoked: Boolean(row.revoked_at),
      createdAt: row.created_at,
    }));
  });

export const createInvite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) =>
    z.object({ label: z.string().max(80).default(""), maxUses: z.number().int().min(1).max(500).default(1) }).parse(data),
  )
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await assertOwner(sql, context.userId);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const code = mintCode();
      try {
        await sql`
          insert into invite_codes (id, owner_id, code, label, max_uses)
          values (${uid("invite")}, ${context.userId}, ${code}, ${data.label.trim()}, ${data.maxUses})
        `;
        return { ok: true as const, code };
      } catch {
        /* unique collision */
      }
    }
    return { ok: false as const, error: "Could not mint a code. Try again." };
  });

export const revokeInvite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ id: z.string() }).parse(data))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await assertOwner(sql, context.userId);
    await sql`
      update invite_codes set revoked_at = now()
      where id = ${data.id} and owner_id = ${context.userId} and revoked_at is null
    `;
    return { ok: true as const };
  });

export const listStudents = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<StudentRow[]> => {
    const sql = await getSql();
    await assertOwner(sql, context.userId);
    const rows = await sql<{
      id: string;
      email: string;
      name: string;
      plan: string | null;
      plan_status: string | null;
      is_owner: boolean | null;
      classes: number | string;
      lectures: number | string;
      cards: number | string;
      school: string | null;
      grade: string | null;
      last_seen: string | null;
      last_lecture: string | null;
      signed_in: boolean | number | string | null;
      canvas: boolean | number | string | null;
      created_at: string;
    }>`
      select
        u.id, u.email, u.name, p.plan, p.plan_status, p.is_owner,
        coalesce(p.school, '') as school, coalesce(p.grade, '') as grade,
        (select count(*) from courses c where c.user_id = u.id) as classes,
        (select count(*) from lectures l where l.user_id = u.id) as lectures,
        (select count(*) from cards k where k.user_id = u.id) as cards,
        (select max(l.started_at)::text from lectures l where l.user_id = u.id) as last_lecture,
        greatest(
          u."updatedAt",
          (select max(s."updatedAt") from "session" s where s."userId" = u.id),
          (select max(l.started_at) from lectures l where l.user_id = u.id)
        )::text as last_seen,
        exists (
          select 1 from "session" s
          where s."userId" = u.id and s."expiresAt" > now() and s."updatedAt" >= now() - interval '15 minutes'
        ) as signed_in,
        exists (select 1 from lms_connections m where m.user_id = u.id) as canvas,
        u."createdAt"::text as created_at
      from "user" u
      left join profiles p on p.user_id = u.id
      order by last_seen desc nulls last, u."createdAt" desc
      limit 200
    `;
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      plan: row.plan ?? "free",
      status: row.plan_status ?? "none",
      isOwner: Boolean(row.is_owner) || identityIsOwner({ email: row.email, name: row.name }),
      classes: num(row.classes),
      lectures: num(row.lectures),
      cards: num(row.cards),
      school: row.school ?? "",
      grade: row.grade ?? "",
      lastSeen: row.last_seen,
      lastLectureAt: row.last_lecture,
      signedIn: Boolean(row.signed_in),
      canvas: Boolean(row.canvas),
      createdAt: row.created_at,
    }));
  });

export const grantPro = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ userId: z.string() }).parse(data))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    await assertOwner(sql, context.userId);
    const [target] = await sql<{ id: string }>`select id from "user" where id = ${data.userId}`;
    if (!target) return { ok: false as const, error: "Student not found." };
    await applyPlan(sql, data.userId, { plan: "pro", status: "invite" });
    return { ok: true as const };
  });

export const redeemInvite = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ code: z.string().min(4).max(24) }).parse(data))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const code = data.code.trim().toUpperCase().replace(/\s+/g, "");
    const [invite] = await sql<{
      id: string;
      max_uses: number | string;
      uses: number | string;
      revoked_at: string | null;
    }>`
      select id, max_uses, uses, revoked_at::text as revoked_at
      from invite_codes where code = ${code} limit 1
    `;
    if (!invite || invite.revoked_at) return { ok: false as const, error: "That code is not valid." };
    if (num(invite.uses) >= num(invite.max_uses)) return { ok: false as const, error: "That code is used up." };
    await sql`update invite_codes set uses = uses + 1 where id = ${invite.id}`;
    await applyPlan(sql, context.userId, { plan: "pro", status: "invite" });
    return { ok: true as const };
  });
