import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";

export type SearchKind = "class" | "lecture" | "card" | "due";

export type SearchHit = {
  kind: SearchKind;
  id: string;
  href: string;
  courseId?: string;
  course: string;
  title: string;
  snippet: string;
  when?: string;
  score: number;
};

export type AskCite = {
  lectureId: string;
  title: string;
  course: string;
  quote: string;
};

export type AskResult = {
  answer: string;
  cites: AskCite[];
};

function parseList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function needle(q: string) {
  return q.trim().replace(/[%_]/g, " ").replace(/\s+/g, " ").slice(0, 80);
}

function tokens(q: string) {
  return needle(q)
    .toLowerCase()
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.length > 1);
}

function hay(...parts: Array<string | null | undefined>) {
  return parts.filter(Boolean).join(" \n ");
}

function snippet(text: string, q: string, max = 160) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const low = clean.toLowerCase();
  const terms = tokens(q);
  let at = -1;
  for (const term of terms) {
    at = low.indexOf(term);
    if (at >= 0) break;
  }
  if (at < 0) return clean.slice(0, max);
  const start = Math.max(0, at - 42);
  const end = Math.min(clean.length, at + max - 42);
  return `${start > 0 ? "…" : ""}${clean.slice(start, end)}${end < clean.length ? "…" : ""}`;
}

function scoreField(text: string, q: string, weight: number) {
  const low = text.toLowerCase();
  const n = needle(q).toLowerCase();
  if (!n) return 0;
  if (low === n) return weight * 3;
  if (low.startsWith(n)) return weight * 2;
  if (low.includes(n)) return weight;
  let hits = 0;
  for (const term of tokens(q)) if (low.includes(term)) hits += 1;
  return hits ? (weight * hits) / Math.max(tokens(q).length, 1) : 0;
}

async function grokAsk(prompt: string): Promise<string> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return "";
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "grok-4.5",
      temperature: 0.2,
      max_tokens: 700,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are Lectern search. Answer ONLY from the student's lecture notes. Return JSON {answer, cites:[{lectureId, quote}]}. Answer in 3-6 short sentences or bullets. Quote a short phrase that actually appears. If the notes do not cover it, say so and suggest recording that class. Never invent due dates, formulas, or claims.",
        },
        { role: "user", content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) return "";
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return body.choices?.[0]?.message?.content ?? "";
}

function parseAsk(raw: string, fallback: AskResult): AskResult {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return fallback;
  try {
    const parsed = JSON.parse(match[0]) as { answer?: unknown; cites?: unknown };
    const answer = typeof parsed.answer === "string" ? parsed.answer.trim() : "";
    const cites = Array.isArray(parsed.cites)
      ? parsed.cites
          .map((row) => {
            if (!row || typeof row !== "object") return null;
            const item = row as { lectureId?: unknown; quote?: unknown };
            if (typeof item.lectureId !== "string" || typeof item.quote !== "string") return null;
            return { lectureId: item.lectureId, quote: item.quote.trim().slice(0, 180) };
          })
          .filter((row): row is { lectureId: string; quote: string } => Boolean(row))
      : [];
    if (!answer) return fallback;
    return { answer, cites: cites.slice(0, 4).map((cite) => {
      const known = fallback.cites.find((row) => row.lectureId === cite.lectureId);
      return {
        lectureId: cite.lectureId,
        title: known?.title ?? "Lecture",
        course: known?.course ?? "",
        quote: cite.quote || known?.quote || "",
      };
    }) };
  } catch {
    return fallback;
  }
}

export const searchDesk = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ q: z.string().max(80) }).parse(data))
  .handler(async ({ context, data }): Promise<{ hits: SearchHit[] }> => {
    const q = needle(data.q);
    if (q.length < 2) return { hits: [] };
    const like = `%${q}%`;
    const sql = await getSql();
    const courses = await sql<{
      id: string;
      name: string;
      code: string;
      instructor: string;
      syllabus: string;
      master_summary: string;
    }>`
      select id, name, code, instructor, syllabus, master_summary
      from courses
      where user_id = ${context.userId}
        and (name ilike ${like} or code ilike ${like} or instructor ilike ${like}
          or syllabus ilike ${like} or master_summary ilike ${like})
      limit 24
    `;
    const lectures = await sql<{
      id: string;
      course_id: string;
      title: string;
      started_at: string;
      summary: string;
      transcript: string;
      outline_json: string;
      terms_json: string;
      asks_json: string;
      actions_json: string;
    }>`
      select id, course_id, title, started_at::text as started_at, summary, transcript,
        outline_json, terms_json, asks_json, actions_json
      from lectures
      where user_id = ${context.userId}
        and (title ilike ${like} or summary ilike ${like} or transcript ilike ${like}
          or outline_json ilike ${like} or terms_json ilike ${like}
          or asks_json ilike ${like} or actions_json ilike ${like})
      order by started_at desc
      limit 40
    `;
    const cards = await sql<{ id: string; course_id: string; front: string; back: string }>`
      select id, course_id, front, back
      from cards
      where user_id = ${context.userId} and (front ilike ${like} or back ilike ${like})
      limit 20
    `;
    const dues = await sql<{ id: string; course_id: string; title: string; exam_on: string; notes: string }>`
      select id, course_id, title, exam_on, notes
      from exams
      where user_id = ${context.userId} and (title ilike ${like} or notes ilike ${like})
      limit 20
    `;
    const names = new Map<string, string>();
    try {
      const all = await sql<{ id: string; name: string; code: string }>`
        select id, name, code from courses where user_id = ${context.userId}
      `;
      for (const row of all) names.set(row.id, `${row.code} · ${row.name}`);
    } catch {
      /* lectures still rank */
    }
    const hits: SearchHit[] = [];
    for (const row of courses) {
      const text = hay(row.name, row.code, row.instructor, row.syllabus, row.master_summary);
      hits.push({
        kind: "class",
        id: row.id,
        href: `/class/${row.id}`,
        courseId: row.id,
        course: `${row.code} · ${row.name}`,
        title: row.name,
        snippet: snippet(text, q) || row.instructor || row.code,
        score: 40 + scoreField(row.name, q, 50) + scoreField(row.code, q, 40) + scoreField(row.instructor, q, 12),
      });
    }
    for (const row of lectures) {
      const recap = parseList(row.outline_json).join(" ");
      const terms = parseList(row.terms_json).join(" ");
      const asks = parseList(row.asks_json).join(" ");
      const text = hay(row.title, recap, row.summary, terms, asks, row.transcript);
      const started = Date.parse(row.started_at);
      hits.push({
        kind: "lecture",
        id: row.id,
        href: `/lecture/${row.id}`,
        courseId: row.course_id,
        course: names.get(row.course_id) ?? "",
        title: row.title,
        snippet: snippet(hay(recap, row.summary, row.transcript, row.title), q),
        when: Number.isFinite(started) ? row.started_at : undefined,
        score:
          20 +
          scoreField(row.title, q, 50) +
          scoreField(recap, q, 28) +
          scoreField(row.summary, q, 18) +
          scoreField(row.transcript, q, 10),
      });
    }
    for (const row of cards) {
      hits.push({
        kind: "card",
        id: row.id,
        href: `/class/${row.course_id}`,
        courseId: row.course_id,
        course: names.get(row.course_id) ?? "",
        title: row.front,
        snippet: snippet(hay(row.front, row.back), q),
        score: 8 + scoreField(row.front, q, 30) + scoreField(row.back, q, 16),
      });
    }
    for (const row of dues) {
      hits.push({
        kind: "due",
        id: row.id,
        href: `/class/${row.course_id}`,
        courseId: row.course_id,
        course: names.get(row.course_id) ?? "",
        title: row.title,
        snippet: snippet(hay(row.title, row.notes, row.exam_on), q),
        when: row.exam_on,
        score: 12 + scoreField(row.title, q, 36) + scoreField(row.notes, q, 12),
      });
    }
    hits.sort((a, b) => b.score - a.score);
    return { hits: hits.slice(0, 30) };
  });

export const askDesk = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ q: z.string().min(3).max(200) }).parse(data))
  .handler(async ({ context, data }): Promise<AskResult> => {
    const q = needle(data.q);
    const sql = await getSql();
    const lectures = await sql<{
      id: string;
      course_id: string;
      title: string;
      started_at: string;
      summary: string;
      transcript: string;
      outline_json: string;
      asks_json: string;
      terms_json: string;
    }>`
      select l.id, l.course_id, l.title, l.started_at::text as started_at, l.summary, l.transcript,
        l.outline_json, l.asks_json, l.terms_json
      from lectures l
      where l.user_id = ${context.userId}
      order by l.started_at desc
      limit 40
    `;
    const courses = await sql<{ id: string; name: string; code: string }>`
      select id, name, code from courses where user_id = ${context.userId}
    `;
    const names = new Map(courses.map((row) => [row.id, `${row.code} · ${row.name}`]));
    const ranked = lectures
      .map((row) => {
        const recap = parseList(row.outline_json).join(" ");
        const text = hay(row.title, recap, row.summary, parseList(row.terms_json).join(" "), parseList(row.asks_json).join(" "), row.transcript);
        const score =
          scoreField(row.title, q, 50) +
          scoreField(recap, q, 28) +
          scoreField(row.summary, q, 18) +
          scoreField(row.transcript, q, 10);
        return { row, recap, text, score };
      })
      .sort((a, b) => b.score - a.score);
    const picked = (ranked[0]?.score ?? 0) > 4 ? ranked.slice(0, 6) : ranked.slice(0, 4);
    if (!picked.length) {
      return {
        answer: "You don’t have lectures on your desk yet. Record a class, then ask again.",
        cites: [],
      };
    }
    const cites: AskCite[] = picked.slice(0, 4).map((item) => ({
      lectureId: item.row.id,
      title: item.row.title,
      course: names.get(item.row.course_id) ?? "",
      quote: snippet(hay(item.recap, item.row.summary, item.row.transcript), q, 140) || item.recap.slice(0, 140),
    }));
    const fallback: AskResult = {
      answer:
        cites.length && (ranked[0]?.score ?? 0) > 4
          ? `From your notes: ${cites.map((cite) => cite.quote).filter(Boolean).join(" ")}`
          : "Your lectures don’t clearly cover that. Try a class name, a term from recap, or record the session that did.",
      cites: (ranked[0]?.score ?? 0) > 4 ? cites : [],
    };
    const packed = picked
      .map((item, index) => {
        const course = names.get(item.row.course_id) ?? "";
        return [
          `LECTURE ${index + 1}`,
          `id: ${item.row.id}`,
          `title: ${item.row.title}`,
          `course: ${course}`,
          `recap: ${item.recap || item.row.summary}`,
          `asks: ${parseList(item.row.asks_json).join("; ")}`,
          `notes: ${item.row.transcript.replace(/\s+/g, " ").slice(0, 1800)}`,
        ].join("\n");
      })
      .join("\n\n");
    const raw = await grokAsk(`Question: ${q}\n\nStudent lecture notes:\n${packed}`);
    if (!raw) return fallback;
    return parseAsk(raw, fallback);
  });
