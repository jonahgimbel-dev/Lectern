import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  inspectRecover,
  restoreDeskToMe,
  restoreEveryDeskToMe,
  restoreMyPreviousDesk,
  type RecoverCensus,
} from "@/functions/recover";

export function RestoreDesk({
  variant,
  onRestored,
}: {
  variant: "hub" | "usage";
  onRestored?: () => void;
}) {
  const [census, setCensus] = useState<RecoverCensus | null>(null);
  const [busy, setBusy] = useState("");

  async function load() {
    setCensus(await inspectRecover());
  }

  useEffect(() => {
    void load().catch(() => setCensus(null));
  }, []);

  if (!census) return null;
  if (variant === "hub" && !census.recoverable && census.mine.classes > 0) return null;

  const hidden = variant === "hub" && !census.recoverable;
  if (hidden) return null;

  return (
    <section className="rounded-xl border-2 border-accent bg-surface p-5 space-y-3">
      <h2 className="font-display text-2xl">Restore previous Lectern data</h2>
      <p className="text-sm text-muted-foreground">
        Database: {census.backend === "neon" ? "live" : "preview"}.{" "}
        {census.orphans > 0
          ? `${census.orphans} classes are sitting on old account ids with no current sign-in.`
          : census.recoverable
            ? "Classes exist on other account ids from before this publish."
            : "No extra desks found in this database."}
      </p>
      <ul className="text-sm">
        {census.tables
          .filter((table) => ["courses", "lectures", "cards", "exams", "user"].includes(table.name))
          .map((table) => (
            <li key={table.name}>
              {table.name}: {table.rows}
            </li>
          ))}
      </ul>
      {census.desks.length > 0 ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {census.desks.map((desk) => (
            <li key={desk.userId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span>
                {desk.email || desk.name || (desk.signedIn ? "Signed-in account" : "Old account")} · {desk.classes}{" "}
                classes · {desk.lectures} lectures
                {desk.wasOwner ? " · previous owner" : ""}
              </span>
              {variant === "usage" && desk.userId !== undefined ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === desk.userId}
                  onClick={() => {
                    setBusy(desk.userId);
                    void restoreDeskToMe({ data: { fromUserId: desk.userId } })
                      .then((result) => {
                        if (!result.ok) toast.error(result.error);
                        else {
                          toast.success(`Moved ${result.moved} rows onto this account.`);
                          onRestored?.();
                          return load();
                        }
                      })
                      .finally(() => setBusy(""));
                  }}
                >
                  Attach to me
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy === "mine"}
          onClick={() => {
            setBusy("mine");
            void restoreMyPreviousDesk()
              .then((result) => {
                if (!result.ok) {
                  toast.error(result.error);
                  return;
                }
                toast.success(result.moved ? `Restored ${result.moved} rows.` : "Nothing left to attach.");
                onRestored?.();
                return load();
              })
              .finally(() => setBusy(""));
          }}
        >
          Restore my previous classes
        </Button>
        {variant === "usage" ? (
          <Button
            variant="outline"
            disabled={busy === "all"}
            onClick={() => {
              setBusy("all");
              void restoreEveryDeskToMe({ data: { confirm: "MOVE ALL DESKS" } })
                .then((result) => {
                  if (!result.ok) toast.error(result.error);
                  else {
                    toast.success(`Moved ${result.moved} rows onto this account.`);
                    onRestored?.();
                    return load();
                  }
                })
                .finally(() => setBusy(""));
            }}
          >
            Attach unsigned leftover desks
          </Button>
        ) : null}
      </div>
    </section>
  );
}
