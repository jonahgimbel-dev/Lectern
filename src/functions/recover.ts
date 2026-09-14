import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { dbSource, getSql, type Sql } from "@/lib/db";
import { identityIsOwner } from "@/lib/owner";

const APP_TABLES = ["courses", "lectures", "cards", "exams", "lms_connections"] as const;

export type DeskBucket = {
  userId: string;
  email: string | null;
  name: string | null;
  classes: number;
  lectures: number;
  cards: number;
  exams: number;
  signedIn: boolean;
  wasOwner: boolean;
};

export type RecoverCensus = {
  backend: "neon" | "pglite";
  tables: { name: string; rows: number }[];
  desks: DeskBucket[];
  mine: { classes: number; lectures: number };
  orphans: number;
  recoverable: boolean;
};

async function isOwner(sql: Sql, userId: string): Promise<boolean> {
  const [user] = await sql<{ email: string | null; name: string | null }>`
    select email, name from "user" where id = ${userId} limit 1
  `;
  if (identityIsOwner({ email: user?.email, name: user?.name })) return true;
  try {
    const [row] = await sql<{ is_owner: boolean }>`select is_owner from profiles where user_id = ${userId}`;
    return Boolean(row?.is_owner);
  } catch {
    return false;
  }
}

async function tableNames(sql: Sql): Promise<Set<string>> {
  const rows = await sql<{ table_name: string }>`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  `;
  return new Set(rows.map((row) => row.table_name));
}

async function countTable(sql: Sql, name: string): Promise<number> {
  const rows = await sql.query<{ n: number }>(`select count(*)::int as n from "${name.replace(/"/g, "")}"`);
  return Number(rows[0]?.n) || 0;
}

async function loadCensus(sql: Sql, userId: string): Promise<RecoverCensus> {
  const names = await tableNames(sql);
  const tables: { name: string; rows: number }[] = [];
  for (const name of [...names].sort()) {
    if (name.startsWith("_")) continue;
    try {
      tables.push({ name, rows: await countTable(sql, name) });
    } catch {
      tables.push({ name, rows: -1 });
    }
  }

  let desks: DeskBucket[] = [];
  if (names.has("courses")) {
    const grouped = await sql<{ user_id: string; classes: number }>`
      select user_id, count(*)::int as classes from courses group by user_id order by count(*) desc
    `;
    const lectureCounts = names.has("lectures")
      ? await sql<{ user_id: string; n: number }>`select user_id, count(*)::int as n from lectures group by user_id`
      : [];
    const cardCounts = names.has("cards")
      ? await sql<{ user_id: string; n: number }>`select user_id, count(*)::int as n from cards group by user_id`
      : [];
    const examCounts = names.has("exams")
      ? await sql<{ user_id: string; n: number }>`select user_id, count(*)::int as n from exams group by user_id`
      : [];
    const lecturesBy = new Map(lectureCounts.map((row) => [row.user_id, Number(row.n) || 0]));
    const cardsBy = new Map(cardCounts.map((row) => [row.user_id, Number(row.n) || 0]));
    const examsBy = new Map(examCounts.map((row) => [row.user_id, Number(row.n) || 0]));
    const users = names.has("user")
      ? await sql<{ id: string; email: string | null; name: string | null }>`select id, email, name from "user"`
      : [];
    const byId = new Map(users.map((row) => [row.id, row]));
    let owners = new Set<string>();
    if (names.has("profiles")) {
      try {
        const rows = await sql<{ user_id: string }>`select user_id from profiles where is_owner = true`;
        owners = new Set(rows.map((row) => row.user_id));
      } catch {
        owners = new Set();
      }
    }
    desks = grouped.map((row) => {
      const user = byId.get(row.user_id);
      return {
        userId: row.user_id,
        email: user?.email ?? null,
        name: user?.name ?? null,
        classes: Number(row.classes) || 0,
        lectures: lecturesBy.get(row.user_id) ?? 0,
        cards: cardsBy.get(row.user_id) ?? 0,
        exams: examsBy.get(row.user_id) ?? 0,
        signedIn: Boolean(user),
        wasOwner: owners.has(row.user_id),
      };
    });
  }

  const mine = desks.find((desk) => desk.userId === userId);
  const orphans = desks.filter((desk) => !desk.signedIn).reduce((sum, desk) => sum + desk.classes, 0);
  return {
    backend: dbSource,
    tables,
    desks,
    mine: { classes: mine?.classes ?? 0, lectures: mine?.lectures ?? 0 },
    orphans,
    recoverable: desks.some((desk) => desk.userId !== userId && desk.classes > 0),
  };
}

async function reassign(sql: Sql, fromId: string, toId: string): Promise<number> {
  if (!fromId || fromId === toId) return 0;
  const names = await tableNames(sql);
  let moved = 0;
  if (names.has("lms_connections")) {
    await sql`
      delete from lms_connections
      where user_id = ${toId}
        and provider in (select provider from lms_connections where user_id = ${fromId})
    `;
  }
  for (const table of APP_TABLES) {
    if (!names.has(table)) continue;
    const rows = await sql.query<{ n: number }>(
      `update "${table}" set user_id = $1 where user_id = $2 returning 1 as n`,
      [toId, fromId],
    );
    moved += rows.length;
  }
  if (names.has("invite_codes")) {
    await sql`update invite_codes set owner_id = ${toId} where owner_id = ${fromId}`;
  }
  return moved;
}

export async function restoreForUser(sql: Sql, userId: string): Promise<{ moved: number; from: string[] }> {
  if (!(await isOwner(sql, userId))) return { moved: 0, from: [] };
  const census = await loadCensus(sql, userId);
  const from = census.desks
    .filter((desk) => desk.userId !== userId && !desk.signedIn)
    .map((desk) => desk.userId);
  let moved = 0;
  for (const id of from) moved += await reassign(sql, id, userId);
  return { moved, from };
}

export const inspectRecover = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<RecoverCensus> => {
    const sql = await getSql();
    const census = await loadCensus(sql, context.userId);
    if (!(await isOwner(sql, context.userId))) {
      return {
        ...census,
        desks: census.desks.filter((desk) => desk.userId === context.userId),
        orphans: 0,
        recoverable: false,
      };
    }
    return census;
  });

export const restoreMyPreviousDesk = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    if (!(await isOwner(sql, context.userId))) {
      return { ok: false as const, error: "Only the Lectern owner can restore another desk.", moved: 0, from: [] as string[] };
    }
    const result = await restoreForUser(sql, context.userId);
    return { ok: true as const, ...result };
  });

export const restoreDeskToMe = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ fromUserId: z.string().min(1) }).parse(data))
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    if (!(await isOwner(sql, context.userId))) {
      return { ok: false as const, error: "Only the Lectern owner can move someone else’s desk." };
    }
    const moved = await reassign(sql, data.fromUserId, context.userId);
    return { ok: true as const, moved };
  });

export const restoreEveryDeskToMe = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    if (!(await isOwner(sql, context.userId))) {
      return { ok: false as const, error: "Only the Lectern owner can do this." };
    }
    const census = await loadCensus(sql, context.userId);
    let moved = 0;
    for (const desk of census.desks) {
      if (desk.userId === context.userId) continue;
      moved += await reassign(sql, desk.userId, context.userId);
    }
    return { ok: true as const, moved };
  });
