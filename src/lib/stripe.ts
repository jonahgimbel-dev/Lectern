import { getSql } from "@/lib/db";

let cachedSecret: string | null | undefined;
let cachedWebhook: string | null | undefined;

export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length < 8) return "saved";
  return `${value.slice(0, 7)}…${value.slice(-4)}`;
}

export function stripeSecret(): string | null {
  return cachedSecret ?? process.env.STRIPE_SECRET_KEY ?? null;
}

export function stripeWebhookSecret(): string | null {
  return cachedWebhook ?? process.env.STRIPE_WEBHOOK_SECRET ?? null;
}

export function stripeReady(): boolean {
  return Boolean(stripeSecret());
}

export async function hydrateStripe(): Promise<void> {
  if (cachedSecret !== undefined) return;
  const sql = await getSql();
  const rows = await sql<{ key: string; value: string }>`
    select key, value from app_secrets where key in ('stripe_secret', 'stripe_webhook')
  `;
  cachedSecret = rows.find((row) => row.key === "stripe_secret")?.value ?? process.env.STRIPE_SECRET_KEY ?? null;
  cachedWebhook = rows.find((row) => row.key === "stripe_webhook")?.value ?? process.env.STRIPE_WEBHOOK_SECRET ?? null;
}

export async function saveStripeSecrets(input: {
  secretKey?: string;
  webhookSecret?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const sql = await getSql();
  if (input.secretKey?.trim()) {
    await sql`
      insert into app_secrets (key, value) values ('stripe_secret', ${input.secretKey.trim()})
      on conflict (key) do update set value = excluded.value, updated_at = now()
    `;
    cachedSecret = input.secretKey.trim();
  }
  if (input.webhookSecret?.trim()) {
    await sql`
      insert into app_secrets (key, value) values ('stripe_webhook', ${input.webhookSecret.trim()})
      on conflict (key) do update set value = excluded.value, updated_at = now()
    `;
    cachedWebhook = input.webhookSecret.trim();
  }
  return { ok: true };
}
