import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { askDesk, searchDesk, type AskResult, type SearchHit, type SearchKind } from "@/functions/search";
import { formatExamOn, formatLectureDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/search")({ component: SearchPage });

const FILTERS: { id: "all" | SearchKind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "lecture", label: "Lectures" },
  { id: "class", label: "Classes" },
  { id: "card", label: "Cards" },
  { id: "due", label: "Due" },
];

const SUGGEST = [
  "What will they ask on the exam?",
  "Accounts receivable",
  "What's due this week?",
  "Last lecture recap",
];

const KIND_LABEL: Record<SearchKind, string> = {
  lecture: "Lecture",
  class: "Class",
  card: "Card",
  due: "Due",
};

const RECENT_KEY = "lectern-search-recent";

function loadRecent(): string[] {
  try {
    const raw = sessionStorage.getItem(RECENT_KEY);
    const value = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
}

function saveRecent(q: string) {
  const next = [q, ...loadRecent().filter((item) => item.toLowerCase() !== q.toLowerCase())].slice(0, 6);
  sessionStorage.setItem(RECENT_KEY, JSON.stringify(next));
}

function Mark({ text, q }: { text: string; q: string }) {
  const term = q.trim();
  if (!term || term.length < 2) return <>{text}</>;
  const low = text.toLowerCase();
  const needle = term.toLowerCase();
  const at = low.indexOf(needle);
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-sm bg-secondary px-0.5 text-fg">{text.slice(at, at + term.length)}</mark>
      {text.slice(at + term.length)}
    </>
  );
}

function SearchPage() {
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"find" | "ask">("find");
  const [filter, setFilter] = useState<"all" | SearchKind>("all");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [asking, setAsking] = useState(false);
  const [ask, setAsk] = useState<AskResult | null>(null);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    setRecent(loadRecent());
  }, []);

  useEffect(() => {
    if (mode !== "find") return;
    const value = q.trim();
    if (value.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const handle = window.setTimeout(() => {
      void searchDesk({ data: { q: value } })
        .then((result) => setHits(result.hits))
        .catch(() => setHits([]))
        .finally(() => setLoading(false));
    }, 220);
    return () => window.clearTimeout(handle);
  }, [q, mode]);

  const shown = useMemo(
    () => (filter === "all" ? hits : hits.filter((hit) => hit.kind === filter)),
    [hits, filter],
  );

  async function runAsk(question: string) {
    const value = question.trim();
    if (value.length < 3) return;
    setMode("ask");
    setQ(value);
    setAsking(true);
    setAsk(null);
    saveRecent(value);
    setRecent(loadRecent());
    try {
      setAsk(await askDesk({ data: { q: value } }));
    } catch {
      setAsk({
        answer: "Couldn’t reach study search. Try again in a moment.",
        cites: [],
      });
    } finally {
      setAsking(false);
    }
  }

  return (
    <AppShell>
      <AuthGate title="Search your desk" copy="Sign in to find lectures and ask them questions." next="/search">
        <div className="space-y-6">
          <header>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">Desk</p>
            <h1 className="mt-1 font-display text-4xl tracking-tight">Search</h1>
            <p className="mt-2 max-w-xl text-muted-foreground">
              Find a phrase, or ask your lectures. Answers stay on your notes.
            </p>
          </header>

          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              if (mode === "ask") void runAsk(q);
              else if (q.trim().length >= 2) {
                saveRecent(q.trim());
                setRecent(loadRecent());
              }
            }}
          >
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={mode === "ask" ? "Ask your lectures anything" : "Find a class, recap, term, or due date"}
              className="flex-1"
              autoFocus
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant={mode === "find" ? "default" : "outline"}
                onClick={() => {
                  setMode("find");
                  setAsk(null);
                }}
              >
                Find
              </Button>
              <Button type="submit" variant={mode === "ask" ? "accent" : "outline"} disabled={asking || q.trim().length < 3}>
                {asking ? "Reading…" : "Ask lectures"}
              </Button>
            </div>
          </form>

          {mode === "find" ? (
            <div className="flex flex-wrap gap-2">
              {FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFilter(item.id)}
                  className={cn(
                    "min-h-11 rounded-lg px-3 text-sm",
                    filter === item.id ? "bg-primary text-primary-fg" : "bg-surface text-muted-foreground hover:text-fg",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}

          {q.trim().length < 2 && !ask ? (
            <div className="space-y-4">
              {recent.length ? (
                <section>
                  <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Recent</p>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {recent.map((item) => (
                      <li key={item}>
                        <button
                          type="button"
                          className="min-h-11 rounded-lg bg-surface px-3 text-sm text-fg"
                          onClick={() => setQ(item)}
                        >
                          {item}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              <section>
                <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Try asking</p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {SUGGEST.map((item) => (
                    <li key={item}>
                      <button
                        type="button"
                        className="min-h-11 rounded-lg border border-border bg-surface px-3 text-sm"
                        onClick={() => void runAsk(item)}
                      >
                        {item}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          ) : null}

          {mode === "ask" ? (
            asking ? (
              <div className="h-40 animate-pulse rounded-xl bg-secondary" />
            ) : ask ? (
              <section className="rounded-xl border border-border bg-surface p-5 space-y-4">
                <p className="text-xs uppercase tracking-[0.14em] text-accent">From your lectures</p>
                <div className="space-y-2 text-base leading-relaxed">
                  {ask.answer.split("\n").map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
                {ask.cites.length ? (
                  <ul className="divide-y divide-border border-t border-border pt-2">
                    {ask.cites.map((cite) => (
                      <li key={cite.lectureId} className="py-3">
                        <Link to="/lecture/$id" params={{ id: cite.lectureId }} className="font-medium hover:text-primary">
                          {cite.title}
                        </Link>
                        <p className="text-sm text-muted-foreground">{cite.course}</p>
                        {cite.quote ? <p className="mt-1 text-sm">{cite.quote}</p> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : null
          ) : null}

          {mode === "find" && q.trim().length >= 2 ? (
            loading ? (
              <div className="h-40 animate-pulse rounded-xl bg-secondary" />
            ) : shown.length === 0 ? (
              <p className="rounded-xl border border-border bg-surface p-5 text-muted-foreground">
                Nothing matched. Try a class code, a term from recap, or ask your lectures.
              </p>
            ) : (
              <ul className="space-y-2">
                {shown.map((hit) => (
                  <li key={`${hit.kind}-${hit.id}`}>
                    <Link
                      to={hit.kind === "lecture" ? "/lecture/$id" : "/class/$id"}
                      params={{ id: hit.kind === "lecture" ? hit.id : (hit.courseId ?? hit.id) }}
                      className="block rounded-xl border border-border bg-surface p-4 hover:border-primary"
                    >
                      <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
                        {KIND_LABEL[hit.kind]}
                        {hit.course ? ` · ${hit.course}` : ""}
                      </p>
                      <p className="mt-1 font-medium">
                        <Mark text={hit.title} q={q} />
                      </p>
                      {hit.snippet ? (
                        <p className="mt-1 text-sm text-muted-foreground">
                          <Mark text={hit.snippet} q={q} />
                        </p>
                      ) : null}
                      {hit.when ? (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {hit.kind === "due" ? formatExamOn(hit.when) : formatLectureDate(Date.parse(hit.when))}
                        </p>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>
      </AuthGate>
    </AppShell>
  );
}
