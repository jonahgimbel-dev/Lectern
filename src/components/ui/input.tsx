import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "flex min-h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm outline-none ring-primary/30 placeholder:text-muted-foreground focus:ring-2",
        className,
      )}
      {...props}
    />
  );
}
