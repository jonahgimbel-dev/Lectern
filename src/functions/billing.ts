import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { identityIsOwner } from "@/lib/owner";
import { hydrateStripe, stripeReady, stripeSecret } from "@/lib/stripe";

export type PlanState = {
  plan: "free" | "pro";
  status: string;
  lecturesUsed: number;
  freeLimit: number;
  isOwner: boolean;
};

const FREE_LIMIT = 2;

export async function applyPlan(
  sql: Awaited<ReturnType<typeof getSql>>,
  userId: string,
  input: { plan: string; status: string },
) {
  await sql`
    insert into profiles (user_id, plan, plan_status)
    values (${userId}, ${input.plan}, ${input.status})
    on conflict (user_id) do update set
      plan = excluded.plan,
      plan_status = excluded.plan_status
  `;
}

async function loadPlan(userId: string): Promise<PlanState> {
  const sql = await getSql();
  await sql`
    insert into profiles (user_id) values (${userId})
    on conflict (user_id) do nothing
  `;
  const [user] = await sql<{ email: string | null; name: string | null }>`
    select email, name from "user" where id = ${userId}
  `;
  const [row] = await sql<{ plan: string | null; plan_status: string | null; is_owner: boolean | null }>`
    select plan, plan_status, is_owner from profiles where user_id = ${userId}
  `;
  const [count] = await sql<{ n: number | string }>`
    select count(*) as n from lectures where user_id = ${userId}
  `;
  const isOwner = Boolean(row?.is_owner) || identityIsOwner({ email: user?.email, name: user?.name });
  const pro =
    isOwner ||
    (row?.plan === "pro" && ["active", "trialing", "past_due", "invite"].includes(row.plan_status ?? ""));
  return {
    plan: pro ? "pro" : "free",
    status: row?.plan_status ?? "none",
    lecturesUsed: Number(count?.n) || 0,
    freeLimit: FREE_LIMIT,
    isOwner,
  };
}

export async function assertPro(userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const plan = await loadPlan(userId);
  if (plan.plan === "pro") return { ok: true };
  if (plan.lecturesUsed < plan.freeLimit) return { ok: true };
  return { ok: false, error: "Free desks get two lectures. Unlock Pro to keep recording." };
}

export const getPlan = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => loadPlan(context.userId));

export const startCheckout = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    await hydrateStripe();
    if (!stripeReady() || !stripeSecret()) {
      await applyPlan(await getSql(), context.userId, { plan: "pro", status: "active" });
      return { ok: true as const, preview: true as const, url: "/billing/confirm" };
    }
    const origin = process.env.BETTER_AUTH_URL || "https://lectern.grok.me";
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecret()}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        mode: "subscription",
        success_url: `${origin}/billing/confirm?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/pricing`,
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][product_data][name]": "Lectern Pro",
        "line_items[0][price_data][recurring][interval]": "month",
        "line_items[0][price_data][unit_amount]": "900",
        "line_items[0][quantity]": "1",
        client_reference_id: context.userId,
      }),
    });
    if (!res.ok) return { ok: false as const, error: "Stripe checkout failed." };
    const body = (await res.json()) as { url?: string };
    if (!body.url) return { ok: false as const, error: "Stripe did not return a link." };
    return { ok: true as const, preview: false as const, url: body.url };
  });

export const confirmCheckout = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ sessionId: z.string().optional() }).parse(data))
  .handler(async ({ context, data }) => {
    await hydrateStripe();
    const sql = await getSql();
    if (!stripeSecret() || !data.sessionId) {
      await applyPlan(sql, context.userId, { plan: "pro", status: "active" });
      return { ok: true as const };
    }
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${data.sessionId}`, {
      headers: { Authorization: `Bearer ${stripeSecret()}` },
    });
    if (!res.ok) return { ok: false as const, error: "Could not confirm that payment." };
    const body = (await res.json()) as { payment_status?: string; client_reference_id?: string };
    if (body.client_reference_id && body.client_reference_id !== context.userId) {
      return { ok: false as const, error: "That checkout belongs to another account." };
    }
    if (body.payment_status !== "paid" && body.payment_status !== "no_payment_required") {
      return { ok: false as const, error: "Payment is not complete yet." };
    }
    await applyPlan(sql, context.userId, { plan: "pro", status: "active" });
    return { ok: true as const };
  });
