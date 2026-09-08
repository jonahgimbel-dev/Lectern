import { addDaysIso, todayIso } from "@/lib/format";

export type ParsedDue = { title: string; examOn: string };

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function isoFromParts(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function parseDueFromLine(line: string, relativeTo = todayIso()): ParsedDue | null {
  const text = line.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (!/\b(due|homework|hw\b|quiz|exam|test|midterm|final|project|paper|lab)\b/i.test(text)) {
    return null;
  }
  const skip = /review notes|study for|come to class|attendance/i;
  if (skip.test(text) && !/\b(due|homework|quiz|exam)\b/i.test(text)) return null;

  const [ry, rm] = relativeTo.split("-").map(Number);
  const year = ry || new Date().getFullYear();

  let examOn: string | null = null;
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) examOn = iso[0];
  const md = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(20\d{2}))?\b/i);
  if (!examOn && md) {
    const month = MONTHS[md[1].toLowerCase().replace(".", "")];
    const day = Number(md[2]);
    const y = md[3] ? Number(md[3]) : year;
    examOn = isoFromParts(y, month, day);
  }
  if (!examOn && /\btomorrow\b/i.test(text)) examOn = addDaysIso(relativeTo, 1);
  if (!examOn && /\bfriday\b/i.test(text)) {
    const d = new Date(`${relativeTo}T12:00:00`);
    const delta = (5 - d.getDay() + 7) % 7 || 7;
    examOn = addDaysIso(relativeTo, delta);
  }
  if (!examOn) return null;

  const title = text
    .replace(/\bdue\b[:\s]*/i, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return { title: title || "Assignment", examOn };
}

export function duesFromLectureMaterial(input: {
  transcript?: string;
  actions?: string[];
  relativeTo?: string;
}): ParsedDue[] {
  const relativeTo = input.relativeTo ?? todayIso();
  const lines = [
    ...(input.actions ?? []),
    ...(input.transcript ?? "")
      .split(/[\n.;]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  ];
  const out: ParsedDue[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const due = parseDueFromLine(line, relativeTo);
    if (!due) continue;
    const key = `${due.examOn}:${due.title.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(due);
  }
  return out.slice(0, 12);
}
