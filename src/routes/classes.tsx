import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { ClassHub } from "@/components/class-hub";
import { getDesk } from "@/functions/data";
import { ensureProfile } from "@/functions/usage";
import type { Desk } from "@/lib/types";

export const Route = createFileRoute("/classes")({ component: ClassesPage });

function ClassesPage() {
  const [desk, setDesk] = useState<Desk | null>(null);
  async function load() {
    await ensureProfile().catch(() => undefined);
    setDesk(await getDesk());
  }
  useEffect(() => {
    void load().catch(() => setDesk({ courses: [], lectures: [], exams: [], cards: [] }));
  }, []);
  return (
    <AppShell>
      <AuthGate title="Open your desk" copy="Sign in to see classes, lectures, and due dates." next="/classes">
        {desk ? <ClassHub desk={desk} onReload={() => void load()} /> : <div className="h-48 rounded-xl bg-secondary" />}
      </AuthGate>
    </AppShell>
  );
}
