export function parseBannerCourseId(raw: string): { code: string; name: string } | null {
  const text = raw.replace(/\s+/g, " ").trim();
  const labeled = text.match(/\b([A-Z]{2,6})\s*[- ]?\s*(\d{3,4})(?:[- ](\d{2,4}))?\b/);
  if (!labeled) return null;
  const code = `${labeled[1]} ${labeled[2]}`.replace(/\s+/g, " ");
  const rest = text.replace(labeled[0], " ").replace(/\s+/g, " ").trim();
  const name = rest.replace(/^[-–:|]+\s*/, "").slice(0, 80) || code;
  return { code, name };
}

export function normalizeCapturedCode(value: string): string {
  return value.replace(/\s+/g, " ").trim().toUpperCase();
}

export function parseRosterPaste(raw: string): { code: string; name: string }[] {
  const lines = raw.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const out: { code: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const parsed = parseBannerCourseId(line);
    if (!parsed) continue;
    const key = normalizeCapturedCode(parsed.code);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(parsed);
  }
  return out;
}
