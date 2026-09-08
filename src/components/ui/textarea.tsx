import type { TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-28 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none ring-primary/30 placeholder:text-muted-foreground focus:ring-2",
        className,
      )}
      {...props}
    />
  );
}
