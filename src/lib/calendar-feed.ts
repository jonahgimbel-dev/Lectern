const JUNK =
  /\b(quiz|homework|hw\b|assignment|exam|midterm|final|lab due|discussion|announcement|office hours|holiday|break)\b/i;

export type CalendarEvent = {
  summary: string;
  description: string;
  start: string;
  courseHint: string;
};

export type CoursePlan = {
  code: string;
  name: string;
  events: { title: string; examOn: string }[];
};

function unfold(ics: string): string {
  return ics.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
}

function unescapeIcs(value: string): string {
  return value
    .replace(/\\n/g, " ")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

function icsDate(value: string): string | null {
  const match = value.match(/(\d{4})(\d{2})(\d{2})/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function parseIcsEvents(ics: string): CalendarEvent[] {
  const body = unfold(ics);
  const blocks = body.split(/BEGIN:VEVENT/i).slice(1);
  const events: CalendarEvent[] = [];
  for (const block of blocks) {
    const summary = unescapeIcs((block.match(/^SUMMARY(?:;[^:]*)?:(.*)$/im)?.[1] ?? "").trim());
    const description = unescapeIcs((block.match(/^DESCRIPTION(?:;[^:]*)?:(.*)$/im)?.[1] ?? "").trim());
    const startRaw =
      block.match(/^DTSTART(?:;[^:]*)?:(\d{8}(?:T\d{6}Z?)?)/im)?.[1] ??
      block.match(/^DTSTART;VALUE=DATE:(\d{8})/im)?.[1] ??
      "";
    const start = icsDate(startRaw) ?? "";
    if (!summary || !start) continue;
    events.push({
      summary,
      description,
      start,
      courseHint: courseFromText(`${summary} ${description}`),
    });
  }
  return events;
}

function courseFromText(text: string): string {
  const labeled = text.match(/\b([A-Z]{2,6})\s*[- ]?\s*(\d{3,4})\b/);
  if (labeled) return `${labeled[1]} ${labeled[2]}`.toUpperCase();
  const bracket = text.match(/\[([^\]]{3,40})\]/);
  if (bracket) return bracket[1].trim();
  return "";
}

function prettyName(code: string, samples: string[]): string {
  const votes = new Map<string, number>();
  for (const sample of samples) {
    const cleaned = sample
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/\b([A-Z]{2,6})\s*[- ]?\s*\d{3,4}\b/g, " ")
      .replace(/\b(quiz|homework|hw|assignment|exam|due|lab)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length < 4 || JUNK.test(cleaned)) continue;
    votes.set(cleaned, (votes.get(cleaned) ?? 0) + 1);
  }
  const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  return best?.[0] ?? code;
}

export function parseCalendarPlan(ics: string): CoursePlan[] {
  const events = parseIcsEvents(ics);
  const groups = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = event.courseHint || (JUNK.test(event.summary) ? "" : event.summary.slice(0, 40));
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(event);
    groups.set(key, list);
  }
  const plans: CoursePlan[] = [];
  for (const [key, list] of groups) {
    if (list.length === 1 && JUNK.test(list[0].summary) && !list[0].courseHint) continue;
    const code = courseFromText(key) || key.slice(0, 16).toUpperCase();
    if (JUNK.test(code) && !/\b[A-Z]{2,6}\s*\d{3,4}\b/.test(code)) continue;
    const name = prettyName(code, list.map((item) => item.summary));
    const dueEvents = list
      .filter((item) => JUNK.test(`${item.summary} ${item.description}`) || /due/i.test(item.summary))
      .map((item) => ({
        title: item.summary.slice(0, 80),
        examOn: item.start,
      }));
    plans.push({ code, name, events: dueEvents });
  }
  return plans
    .sort((a, b) => b.events.length - a.events.length)
    .slice(0, 8);
}
