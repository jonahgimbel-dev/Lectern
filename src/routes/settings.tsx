import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveProfile } from "@/functions/usage";

export const Route = createFileRoute("/settings")({ component: SettingsPage });

function SettingsPage() {
  const [school, setSchool] = useState("");
  const [grade, setGrade] = useState("");
  return (
    <AppShell>
      <AuthGate title="Settings" copy="Sign in to save school and grade." next="/settings">
        <div className="mx-auto max-w-md space-y-4">
          <h1 className="font-display text-3xl tracking-tight">Settings</h1>
          <Input value={school} onChange={(e) => setSchool(e.target.value)} placeholder="School" />
          <Input value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="Year / grade" />
          <Button
            onClick={() => {
              void saveProfile({ data: { school, grade } }).then(() => toast.success("Saved."));
            }}
          >
            Save
          </Button>
          <p className="text-sm">
            <Link to="/privacy" className="underline">
              Privacy
            </Link>
            {" · "}
            <Link to="/usage" className="underline">
              Usage
            </Link>
          </p>
        </div>
      </AuthGate>
    </AppShell>
  );
}
