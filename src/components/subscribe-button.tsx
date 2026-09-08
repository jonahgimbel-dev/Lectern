import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { startCheckout } from "@/functions/billing";

export function SubscribeButton({ label = "Unlock Pro" }: { label?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void startCheckout()
          .then((result) => {
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            window.location.href = result.url;
          })
          .catch(() => toast.error("Could not start checkout."))
          .finally(() => setBusy(false));
      }}
    >
      {busy ? "Opening…" : label}
    </Button>
  );
}
