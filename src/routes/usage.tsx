import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { RestoreDesk } from "@/components/restore-desk";
import { SessionReady } from "@/components/session-ready";
import { SignInPrompt } from "@/components/sign-in-prompt";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { claimOwner, getOwnerState, getUsage, saveStripeConnect, type UsageStats } from "@/functions/usage";
import { createInvite, grantPro, listInvites, listStudents, revokeInvite, type InviteRow, type StudentRow } from "@/functions/invites";
import { formatAgo } from "@/lib/format";
import { joinInviteText } from "@/lib/join-text";
import { useCurrentUser } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/usage")({ component: UsagePage });

function UsagePage() {
  return (
    <AppShell>
      <SessionReady>
        {(user) =>
          user ? (
            <UsageDesk />
          ) : (
            <SignInPrompt title="Owner sign-in" copy="Usage is only for the person who runs Lectern." next="/usage" />
          )
        }
      </SessionReady>
    </AppShell>
  );
}

function UsageDesk() {
  const user = useCurrentUser();
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [canClaim, setCanClaim] = useState(false);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [claiming, setClaiming] = useState(false);

  async function load() {
    const owner = await getOwnerState();
    setCanClaim(owner.canClaim);
    if (!owner.isOwner) {
      setAllowed(false);
      setStats(null);
      return;
    }
    const result = await getUsage();
    if (!result.ok) {
      setAllowed(false);
      return;
    }
    setAllowed(true);
    setStats(result.stats);
  }

  useEffect(() => {
    void load().catch(() => setAllowed(false));
  }, []);

  if (allowed === null) return <div className="h-48 rounded-xl bg-secondary" />;
  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-border bg-surface p-6">
        <h1 className="font-display text-3xl tracking-tight">
          {canClaim ? "Is this your Lectern?" : "This page isn’t for students"}
        </h1>
        <div className="mt-5 flex gap-2">
          {canClaim ? (
            <Button
              disabled={claiming}
              onClick={() => {
                setClaiming(true);
                void claimOwner()
                  .then((result) => {
                    if (!result.ok) toast.error(result.error);
                    else window.location.reload();
                  })
                  .finally(() => setClaiming(false));
              }}
            >
              This is my Lectern
            </Button>
          ) : null}
          <Button asChild variant="outline">
            <Link to="/classes">Back to classes</Link>
          </Button>
        </div>
        <div className="mt-6">
          <RestoreDesk variant="usage" />
        </div>
      </div>
    );
  }
  if (!stats) return null;
  const tiles = [
    ["Active now", stats.activeNow, "Last 15 minutes"],
    ["Today", stats.activeToday, "Opened or recorded today"],
    ["This week", stats.activeWeek, "Touched Lectern in 7 days"],
    ["Students", stats.students, `${stats.newThisWeek} new this week`],
    ["Pro", stats.proStudents, `${stats.freeStudents} on Free`],
    ["Lectures", stats.lecturesThisWeek, `${stats.lecturesToday} today`],
    ["Classes", stats.classes, `${stats.cards} cards`],
    ["Canvas", stats.canvas, "Connected feeds"],
  ] as const;
  return (
    <div className="space-y-8">
      <h1 className="font-display text-4xl tracking-tight">How students use Lectern</h1>
      <p className="text-sm text-muted-foreground">Signed in as {stats.ownerEmail || user?.primaryEmail}</p>
      <RestoreDesk variant="usage" onRestored={() => void load()} />
      <StripeBox
        ready={stats.stripeReady}
        secretHint={stats.stripeSecretHint}
        webhookHint={stats.stripeWebhookHint}
        onSaved={() => void load()}
      />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map(([label, value, hint]) => (
          <li key={label} className="rounded-xl border border-border bg-surface p-5">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
            <p className="mt-2 font-display text-4xl">{value}</p>
            <p className="mt-2 text-sm text-muted-foreground">{hint}</p>
          </li>
        ))}
      </ul>
      <InviteDesk />
      <StudentDesk />
    </div>
  );
}

function StripeBox({
  ready,
  secretHint,
  webhookHint,
  onSaved,
}: {
  ready: boolean;
  secretHint: string | null;
  webhookHint: string | null;
  onSaved: () => void;
}) {
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  return (
    <section className="rounded-xl border-2 border-primary bg-surface p-5 space-y-3">
      <h2 className="font-display text-2xl">Connect Stripe</h2>
      <p className="text-sm text-muted-foreground">
        {ready ? `Secret on file: ${secretHint}` : "Paste sk_live and whsec from Stripe. Do not put them in chat."}
      </p>
      <Input value={secretKey} onChange={(e) => setSecretKey(e.target.value)} placeholder="sk_live_…" />
      <Input value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} placeholder="whsec_…" />
      <Button
        onClick={() => {
          void saveStripeConnect({ data: { secretKey, webhookSecret } }).then((result) => {
            if (!result.ok) toast.error(result.error);
            else {
              toast.success("Stripe saved.");
              onSaved();
            }
          });
        }}
      >
        Save Stripe
      </Button>
      {webhookHint ? <p className="text-xs text-muted-foreground">Webhook {webhookHint}</p> : null}
    </section>
  );
}

function InviteDesk() {
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [label, setLabel] = useState("");
  useEffect(() => {
    void listInvites().then(setInvites).catch(() => undefined);
  }, []);
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="font-display text-xl">Free access codes</h2>
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void createInvite({ data: { label, maxUses: 10 } }).then(async (result) => {
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            toast.success(`Code ${result.code}`);
            setInvites(await listInvites());
          });
        }}
      >
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" className="max-w-xs" />
        <Button type="submit">Make a code</Button>
      </form>
      <ul className="mt-4 divide-y divide-border">
        {invites.map((invite) => (
          <li key={invite.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <p className="font-mono text-sm">
              {invite.code} · {invite.uses}/{invite.maxUses}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(joinInviteText(window.location.origin, invite.code));
                  toast.success("Copied.");
                }}
              >
                Copy text
              </Button>
              {!invite.revoked ? (
                <Button size="sm" variant="ghost" onClick={() => void revokeInvite({ data: { id: invite.id } }).then(() => listInvites().then(setInvites))}>
                  Revoke
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StudentDesk() {
  const [students, setStudents] = useState<StudentRow[]>([]);
  useEffect(() => {
    void listStudents().then(setStudents).catch(() => undefined);
  }, []);
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="font-display text-xl">Who’s using it</h2>
      <ul className="mt-4 divide-y divide-border">
        {students.map((student) => (
          <li key={student.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div>
              <p className="font-medium">
                {student.signedIn ? <span className="mr-2 inline-block size-1.5 rounded-full bg-good" /> : null}
                {student.name || student.email}
              </p>
              <p className="text-xs text-muted-foreground">
                {student.email} · last seen {formatAgo(student.lastSeen)} · {student.classes} classes
              </p>
            </div>
            {!student.isOwner && student.plan !== "pro" ? (
              <Button size="sm" variant="outline" onClick={() => void grantPro({ data: { userId: student.id } }).then(() => listStudents().then(setStudents))}>
                Give Pro
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
