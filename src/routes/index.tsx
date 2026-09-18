import { Link, createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const user = useCurrentUser();
  const primary = user ? "/classes" : "/login";
  const primaryLabel = user ? "Open class hub" : "Get your desk";

  return (
    <AppShell home>
      <div className="space-y-20">
        <section className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="space-y-6">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">Study desk</p>
            <h1 className="font-display text-5xl tracking-tight md:text-6xl">
              Walk out of class with something you can study.
            </h1>
            <p className="max-w-xl text-lg text-muted-foreground">
              Record the lecture. Lectern files a one-minute recap, cards, and due dates onto that class — from Canvas or from what was said out loud.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="lg">
                <Link to={primary}>{primaryLabel}</Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <Link to="/connect">Connect Canvas</Link>
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">Free to try · two lectures · your desk stays yours</p>
          </div>
          <RecapCard />
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          {[
            ["01", "Record", "Hit record in class, or share the tab if the lecture is on a screen. Captions run while you listen."],
            ["02", "Recap", "Three testable facts. What they’ll ask. Cards. No wall of notes, no “today we discussed.”"],
            ["03", "Study", "Every lecture lives on that class page with due dates, a quiz, and search across your own notes."],
          ].map(([num, title, copy]) => (
            <article key={num} className="rounded-lg border border-border bg-surface p-6 lift">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">{num}</p>
              <h2 className="mt-3 font-display text-2xl tracking-tight">{title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{copy}</p>
            </article>
          ))}
        </section>

        <section className="grid gap-10 lg:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">On the class page</p>
            <h2 className="mt-2 font-display text-4xl tracking-tight">One hub per course.</h2>
            <p className="mt-3 max-w-md text-muted-foreground">
              Lectures, syllabus, flashcards, exam cram, and a calendar that picks up Canvas, recordings, and dates you add.
            </p>
          </div>
          <ul className="space-y-3">
            {[
              ["In one minute", "Closed facts you can actually be tested on."],
              ["They’ll ask", "Three exam-shaped tasks from that lecture."],
              ["Ask lectures", "Search a phrase, or ask a question — answers cite your notes."],
              ["Due dates", "Canvas feed, homework called out in class, or add it yourself."],
            ].map(([title, copy]) => (
              <li key={title} className="rounded-lg border border-border bg-surface px-5 py-4">
                <p className="font-medium">{title}</p>
                <p className="text-sm text-muted-foreground">{copy}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-lg border border-border bg-primary px-6 py-10 text-primary-fg md:px-10">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-primary-fg/70">Canvas</p>
          <h2 className="mt-2 max-w-xl font-display text-4xl tracking-tight">Bring in classes without an API key.</h2>
          <p className="mt-3 max-w-xl text-primary-fg/80">
            Screenshot the dashboard, paste class names, or drop in the calendar feed. Lectern reads the gray course titles and files homework under the right class.
          </p>
          <div className="mt-6">
            <Button asChild variant="outline" className="border-primary-fg/20 bg-surface text-fg hover:bg-secondary">
              <Link to="/connect">Open Connect</Link>
            </Button>
          </div>
        </section>

        <section className="flex flex-col items-start justify-between gap-6 rounded-lg border border-border bg-surface p-8 sm:flex-row sm:items-center">
          <div>
            <h2 className="font-display text-3xl tracking-tight">Ready when class starts.</h2>
            <p className="mt-2 max-w-md text-muted-foreground">Sign in, add a class, record. Your desk is empty until you fill it — nobody else’s notes show up.</p>
          </div>
          <Button asChild size="lg">
            <Link to={primary}>{primaryLabel}</Link>
          </Button>
        </section>
      </div>
    </AppShell>
  );
}

function RecapCard() {
  return (
    <aside className="rounded-lg border border-border bg-surface p-6 lift">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">ACCT 2302 · today</p>
      <h2 className="mt-3 font-display text-3xl tracking-tight">Receivables & aging</h2>
      <p className="mt-6 text-xs font-medium uppercase tracking-[0.18em] text-accent">In one minute</p>
      <ul className="mt-3 space-y-2 text-sm">
        <li>Accounts receivable is money customers still owe.</li>
        <li>The allowance estimates what will not be collected.</li>
        <li>Net receivables equal AR minus that allowance.</li>
      </ul>
      <p className="mt-6 text-xs font-medium uppercase tracking-[0.18em] text-accent">They’ll ask</p>
      <p className="mt-2 text-sm text-muted-foreground">Compute net receivables from the aging schedule.</p>
    </aside>
  );
}
