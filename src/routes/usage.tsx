import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { RestoreDesk } from "@/components/restore-desk";
import { SessionReady } from "@/components/session-ready";
import { SignInPrompt } from "@/components/sign-in-prompt";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { claimOwner, getOwnerState, getUsage, saveStripeConnect, type UsageStats } from "@/functions/usage";
import {
  clearStudentDesk,
  createInvite,
  grantPro,
  listInvites,
  listStudents,
  revokeInvite,
  revokePro,
  type InviteRow,
  type StudentRow,
} from "@/functions/invites";
import { reclaimThisDesk, repairEmptyDesks, takeCoursesFromStudent } from "@/functions/recover";
import { exportKnowledge, importKnowledge, listKnowledge, restoreKnowledge, snapshotNow, type ArchiveHit } from "@/functions/archive";
import { formatAgo, formatDuration, formatLectureDate } from "@/lib/format";
import { joinInviteText } from "@/lib/join-text";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/usage")({ component: UsagePage });

const TABS = ["Overview", "Students", "Activity", "Knowledge", "Codes", "Billing"] as const;
type Tab = (typeof TABS)[number];

function UsagePage() {
  return (
    <AppShell>
      <SessionReady>
        {(user) =>
          user ? (
            <OwnerDesk />
          ) : (
            <SignInPrompt title="Owner sign-in" copy="This dashboard is only for the person who runs Lectern." next="/usage" />
          )
        }
      </SessionReady>
    </AppShell>
  );
}

function OwnerDesk() {
  const user = useCurrentUser();
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [canClaim, setCanClaim] = useState(false);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [tab, setTab] = useState<Tab>("Overview");

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
        <p className="mt-2 text-sm text-muted-foreground">Owner tools stay on your account only.</p>
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
      </div>
    );
  }
  if (!stats) return null;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Owner</p>
          <h1 className="mt-1 font-display text-4xl tracking-tight">Dashboard</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {stats.ownerEmail || user?.primaryEmail} · {stats.ownerHow === "email" ? "signed in as owner" : "claimed this Lectern"}
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          Your desk: {stats.mine.classes} classes · {stats.mine.lectures} lectures
        </p>
      </header>

      <nav className="flex flex-wrap gap-2">
        {TABS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={cn(
              "min-h-11 rounded-lg px-4 text-sm font-medium",
              tab === item ? "bg-primary text-primary-fg" : "bg-surface text-muted-foreground hover:text-fg",
            )}
          >
            {item}
          </button>
        ))}
      </nav>

      {tab === "Overview" ? <Overview stats={stats} /> : null}
      {tab === "Students" ? <StudentDesk onChanged={() => void load()} /> : null}
      {tab === "Activity" ? <ActivityFeed stats={stats} /> : null}
      {tab === "Knowledge" ? <KnowledgeDesk /> : null}
      {tab === "Codes" ? <InviteDesk /> : null}
      {tab === "Billing" ? (
        <div className="space-y-6">
          <StripeBox
            ready={stats.stripeReady}
            secretHint={stats.stripeSecretHint}
            webhookHint={stats.stripeWebhookHint}
            onSaved={() => void load()}
          />
          <RestoreDesk variant="usage" onRestored={() => void load()} />
        </div>
      ) : null}
    </div>
  );
}

function Overview({ stats }: { stats: UsageStats }) {
  const tiles = [
    ["Active now", stats.activeNow, "Last 15 minutes"],
    ["Today", stats.activeToday, "Opened or recorded today"],
    ["This week", stats.activeWeek, "Touched Lectern in 7 days"],
    ["Students", stats.students, `${stats.newThisWeek} new this week`],
    ["Pro", stats.proStudents, `${stats.freeStudents} on Free`],
    ["Lectures", stats.lectures, `${stats.lecturesToday} today · ${stats.lecturesThisWeek} this week`],
    ["Classes", stats.classes, `${stats.cards} cards · ${stats.exams} dues`],
    ["Empty desks", stats.emptyDesks, `${stats.neverRecorded} haven’t recorded`],
    ["Canvas", stats.canvas, "Connected feeds"],
  ] as const;
  const peak = Math.max(1, ...stats.daily.map((row) => row.lectures));
  return (
    <div className="space-y-6">
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map(([label, value, hint]) => (
          <li key={label} className="rounded-xl border border-border bg-surface p-5">
            <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
            <p className="mt-2 font-display text-4xl">{value}</p>
            <p className="mt-2 text-sm text-muted-foreground">{hint}</p>
          </li>
        ))}
      </ul>
      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="font-display text-xl">Lectures, last 14 days</h2>
        {stats.daily.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No lectures in this window yet.</p>
        ) : (
          <div className="mt-4 flex h-36 items-end gap-1">
            {stats.daily.map((row) => (
              <div key={row.day} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${row.day}: ${row.lectures}`}>
                <span
                  className="w-full rounded-t bg-accent"
                  style={{ height: `${Math.max(8, Math.round((row.lectures / peak) * 100))}%` }}
                />
              </div>
            ))}
          </div>
        )}
      </section>
      {stats.schools.length > 0 ? (
        <section className="rounded-xl border border-border bg-surface p-5">
          <h2 className="font-display text-xl">Schools</h2>
          <ul className="mt-3 divide-y divide-border text-sm">
            {stats.schools.map((row) => (
              <li key={row.school} className="flex justify-between py-2">
                <span>{row.school}</span>
                <span className="text-muted-foreground">{row.students}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function ActivityFeed({ stats }: { stats: UsageStats }) {
  if (!stats.recent.length) {
    return (
      <p className="rounded-xl border border-border bg-surface p-5 text-muted-foreground">
        No lectures yet. When students record, they show up here.
      </p>
    );
  }
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="font-display text-xl">Latest lectures</h2>
      <ul className="mt-4 divide-y divide-border">
        {stats.recent.map((row) => (
          <li key={row.id} className="py-3">
            <p className="font-medium">{row.title}</p>
            <p className="text-sm text-muted-foreground">
              {row.student} · {row.className} · {formatDuration(row.durationSec)} · {formatLectureDate(Date.parse(row.startedAt))}
            </p>
          </li>
        ))}
      </ul>
    </section>
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
      <h2 className="font-display text-2xl">Stripe</h2>
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
  const [maxUses, setMaxUses] = useState("10");
  useEffect(() => {
    void listInvites().then(setInvites).catch(() => undefined);
  }, []);
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="font-display text-xl">Free access codes</h2>
      <p className="mt-1 text-sm text-muted-foreground">Text a code. It unlocks Pro without Stripe.</p>
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const uses = Math.max(1, Number(maxUses) || 10);
          void createInvite({ data: { label, maxUses: uses } }).then(async (result) => {
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            toast.success(`Code ${result.code}`);
            setLabel("");
            setInvites(await listInvites());
          });
        }}
      >
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label, like AP Bio" className="max-w-xs" />
        <Input value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="Uses" className="w-24" />
        <Button type="submit">Make a code</Button>
      </form>
      <ul className="mt-4 divide-y divide-border">
        {invites.map((invite) => (
          <li key={invite.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div>
              <p className="font-mono text-sm">
                {invite.code} · {invite.uses}/{invite.maxUses}
                {invite.revoked ? " · revoked" : ""}
              </p>
              {invite.label ? <p className="text-xs text-muted-foreground">{invite.label}</p> : null}
            </div>
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

function StudentDesk({ onChanged }: { onChanged: () => void }) {
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "empty" | "free" | "pro">("all");

  async function reload() {
    setStudents(await listStudents());
    onChanged();
  }

  useEffect(() => {
    void listStudents().then(setStudents).catch(() => undefined);
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return students.filter((student) => {
      if (filter === "active" && !student.signedIn) return false;
      if (filter === "empty" && student.classes > 0) return false;
      if (filter === "free" && (student.isOwner || student.plan === "pro")) return false;
      if (filter === "pro" && student.plan !== "pro" && !student.isOwner) return false;
      if (!q) return true;
      return `${student.name} ${student.email} ${student.school}`.toLowerCase().includes(q);
    });
  }, [students, query, filter]);

  function exportCsv() {
    const header = "name,email,plan,classes,lectures,school,last_seen,canvas";
    const lines = students.map((student) =>
      [student.name, student.email, student.plan, student.classes, student.lectures, student.school, student.lastSeen ?? "", student.canvas ? "yes" : "no"]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(","),
    );
    const blob = new Blob([`${header}\n${lines.join("\n")}`], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "lectern-students.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl">Students</h2>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void repairEmptyDesks().then((result) => {
                if (!result.ok) toast.error(result.error);
                else {
                  const n = result.restored.length;
                  toast.success(n ? `Returned classes to ${n} student${n === 1 ? "" : "s"}.` : "No empty desks needed repair.");
                  return reload();
                }
              })
            }
          >
            Return missing classes
          </Button>
          <Button size="sm" variant="outline" onClick={exportCsv}>
            Export CSV
          </Button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or email" className="max-w-xs" />
        {(["all", "active", "empty", "free", "pro"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setFilter(item)}
            className={cn(
              "min-h-11 rounded-lg px-3 text-sm capitalize",
              filter === item ? "bg-primary text-primary-fg" : "bg-secondary text-muted-foreground",
            )}
          >
            {item}
          </button>
        ))}
      </div>
      <ul className="mt-4 divide-y divide-border">
        {shown.map((student) => (
          <li key={student.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
            <div>
              <p className="font-medium">
                {student.signedIn ? <span className="mr-2 inline-block size-1.5 rounded-full bg-good" /> : null}
                {student.name || student.email}
                {student.isOwner ? <span className="ml-2 text-xs uppercase tracking-wider text-accent">Owner</span> : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {student.email} · {student.plan}
                {student.school ? ` · ${student.school}` : ""} · {student.classes} classes · {student.lectures} lectures
                {student.canvas ? " · Canvas" : ""} · last seen {formatAgo(student.lastSeen)}
              </p>
              {student.courses.length ? (
                <ul className="mt-2 flex flex-wrap gap-1">
                  {student.courses.map((course) => (
                    <li key={course.id}>
                      <span className="inline-flex items-center gap-1 rounded-lg bg-secondary px-2 py-1 text-xs">
                        {course.code || course.name}
                        {!student.isOwner ? (
                          <button
                            type="button"
                            className="text-muted-foreground hover:text-fg"
                            onClick={() =>
                              void takeCoursesFromStudent({
                                data: { fromUserId: student.id, courseIds: [course.id] },
                              }).then((result) => {
                                if (!result.ok) toast.error(result.error);
                                else toast.success(`Moved ${course.code || course.name} back to your desk.`);
                                return reload();
                              })
                            }
                          >
                            Take back
                          </button>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {!student.isOwner ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={student.classes === 0 ? "accent" : "outline"}
                  onClick={() =>
                    void reclaimThisDesk({ data: { userId: student.id } }).then((result) => {
                      if (!result.ok) {
                        toast.error(result.error);
                        return;
                      }
                      if (result.takenBack) toast.success(`Moved ${result.takenBack} of your classes back to your desk.`);
                      if (result.moved) toast.success(`Merged ${result.moved} classes onto ${student.name || "this student"}.`);
                      else if (!result.takenBack && result.classes === 0) {
                        toast.message("No other login had classes for them. If a class of yours is listed here, Take back.");
                      } else if (!result.takenBack) {
                        toast.success(`${student.name || "Student"} has ${result.classes} classes.`);
                      }
                      return reload();
                    })
                  }
                >
                  Return classes
                </Button>
                {student.plan !== "pro" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void grantPro({ data: { userId: student.id } }).then((result) => {
                        if (!result.ok) toast.error(result.error);
                        else toast.success("Pro granted.");
                        return reload();
                      })
                    }
                  >
                    Give Pro
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void revokePro({ data: { userId: student.id } }).then((result) => {
                        if (!result.ok) toast.error(result.error);
                        else toast.success("Back on Free.");
                        return reload();
                      })
                    }
                  >
                    Make free
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (!window.confirm(`Clear classes and lectures for ${student.email}? Their account stays.`)) return;
                    void clearStudentDesk({ data: { userId: student.id } }).then((result) => {
                      if (!result.ok) toast.error(result.error);
                      else toast.success("Desk cleared.");
                      return reload();
                    });
                  }}
                >
                  Clear desk
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {shown.length === 0 ? <p className="py-6 text-sm text-muted-foreground">No students match that.</p> : null}
    </section>
  );
}

function KnowledgeDesk() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ArchiveHit[]>([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);

  async function load(query = q) {
    const result = await listKnowledge({ data: { q: query } });
    setHits(result.hits);
    setTotal(result.total);
  }

  useEffect(() => {
    void load("").catch(() => toast.error("Could not open the knowledge base."));
  }, []);

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl">Knowledge base</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Two copies. The list below lives with Lectern for a fast restore. The JSON file is the off-site copy — keep it in Google Drive or a folder you control. Do not put student transcripts on GitHub.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void snapshotNow()
                .then((result) => {
                  toast.success(result.archived ? `Copied ${result.archived} new lectures.` : `Knowledge base is current · ${result.total} lectures.`);
                  return load();
                })
                .catch(() => toast.error("Could not snapshot."))
                .finally(() => setBusy(false));
            }}
          >
            Snapshot now
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setBusy(true);
              void exportKnowledge()
                .then((result) => {
                  const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = `lectern-knowledge-${new Date().toISOString().slice(0, 10)}.json`;
                  link.click();
                  URL.revokeObjectURL(url);
                  toast.success(`Downloaded ${result.lectures.length} lectures.`);
                })
                .catch(() => toast.error("Could not export."))
                .finally(() => setBusy(false));
            }}
          >
            Download vault
          </Button>
          <label className="inline-flex min-h-9 cursor-pointer items-center rounded-lg border border-border bg-surface px-3 text-sm font-medium">
            Restore from file
            <input
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                setBusy(true);
                void file
                  .text()
                  .then((text) => JSON.parse(text) as unknown)
                  .then((payload) => importKnowledge({ data: payload }))
                  .then((result) => {
                    toast.success(`Restored ${result.lectures} lectures across ${result.desks} desks.`);
                    return load();
                  })
                  .catch(() => toast.error("That file could not be restored."))
                  .finally(() => setBusy(false));
              }}
            />
          </label>
        </div>
      </div>
      <p className="mt-4 text-sm text-muted-foreground">{total} lectures stored</p>
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void load(q);
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Student, class, or title" className="max-w-xs" />
        <Button type="submit" size="sm">
          Search
        </Button>
      </form>
      <ul className="mt-4 divide-y divide-border">
        {hits.map((hit) => (
          <li key={hit.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
            <div>
              <p className="font-medium">{hit.title}</p>
              <p className="text-xs text-muted-foreground">
                {hit.courseCode ? `${hit.courseCode} · ` : ""}
                {hit.courseName} · {hit.userName || hit.userEmail || "Unknown student"}
                {hit.startedAt ? ` · ${formatLectureDate(Date.parse(hit.startedAt))}` : ""} · {hit.words} words
                {hit.live ? " · on a desk" : " · missing from desks"}
              </p>
            </div>
            <Button
              size="sm"
              variant={hit.live ? "outline" : "accent"}
              onClick={() =>
                void restoreKnowledge({ data: { id: hit.id } }).then((result) => {
                  if (!result.ok) toast.error(result.error);
                  else toast.success(`Restored “${hit.title}” to ${result.onto}.`);
                  return load();
                })
              }
            >
              Restore
            </Button>
          </li>
        ))}
      </ul>
      {hits.length === 0 ? (
        <p className="py-6 text-sm text-muted-foreground">
          No copies yet. Record a lecture or click Snapshot now to copy what’s already on desks.
        </p>
      ) : null}
    </section>
  );
}
