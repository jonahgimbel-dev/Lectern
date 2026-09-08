export function safeNextPath(value: string | null | undefined, fallback = "/classes"): string {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}
