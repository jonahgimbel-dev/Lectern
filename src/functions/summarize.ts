import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import {
  clipWords,
  cleanRecap,
  notesFromTranscript,
  shortLines,
  type LectureNotes,
} from "@/lib/study-shape";
import type { TermCard } from "@/lib/types";

const Input = z.object({
  transcript: z.string().min(1).max(80_000),
  courseName: z.string().max(120),
  courseCode: z.string().max(40),
});

export async function runSummarize(data: z.infer<typeof Input>): Promise<LectureNotes> {
  const fallback = notesFromTranscript(data.transcript, data.courseCode);
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) return fallback;

  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "grok-4.5",
      temperature: 0.15,
      max_tokens: 1100,
      messages: [
        {
          role: "system",
          content:
            "You write study artifacts for high school and college students, never essays. Return ONLY JSON with keys: title (max 6 words), recap (3-5 strings), theyWillAsk (exactly 3 exam-shaped tasks like 'Compute X from Y' or 'Compare A vs B' — not 'what is'), terms (array of {term, definition} where definition is max 12 words from the lecture), actionItems (homework/reading/quiz only — include the due date when the lecture said one; skip 'review notes'), traps (0-2 mix-ups from THIS lecture). Recap rules: each line is one closed, testable fact (definition, formula, mechanism, contrast, or number) in 8-16 words. Skip greetings, attendance, 'today we will', jokes, logistics, 'the professor said', restating the course name, and vague 'we discussed X'. Do not pad to 5 if only 3 facts earned it. No paragraphs. Do not invent facts or dates.",
        },
        {
          role: "user",
          content: `Course: ${data.courseCode} ${data.courseName}\n\nTranscript:\n${data.transcript.slice(0, 60000)}`,
        },
      ],
    }),
  });

  if (!res.ok) return fallback;
  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw = body.choices?.[0]?.message?.content ?? "";
  const notes = mergeNotes(parseNotes(raw, data.courseCode), fallback);
  notes.recap = cleanRecap(notes.recap, data.transcript, 5);
  if (!notes.recap.length) notes.recap = fallback.recap;
  return notes;
}

export const summarizeLecture = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => Input.parse(data))
  .handler(async ({ data }) => {
    const notes = await runSummarize(data);
    return { ok: true as const, notes };
  });

function parseNotes(raw: string, fallbackCode: string): LectureNotes {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Partial<{
        title: string;
        recap: unknown;
        outline: unknown;
        theyWillAsk: unknown;
        examAsks: unknown;
        terms: unknown;
        actionItems: unknown;
        traps: unknown;
      }>;
      const { names, cards } = asTerms(parsed.terms);
      const recap = shortLines(parsed.recap ?? parsed.outline, 5, 16);
      return {
        title: clipWords(String(parsed.title ?? `${fallbackCode} lecture`), 6),
        recap,
        theyWillAsk: shortLines(parsed.theyWillAsk ?? parsed.examAsks, 3, 16),
        terms: names,
        termCards: cards,
        actionItems: shortLines(parsed.actionItems, 6, 16),
        traps: shortLines(parsed.traps, 2, 16),
      };
    } catch {
      /* fall through */
    }
  }
  return notesFromTranscript(raw, fallbackCode);
}

function mergeNotes(primary: LectureNotes, fallback: LectureNotes): LectureNotes {
  return {
    title: primary.title || fallback.title,
    recap: primary.recap.length ? primary.recap : fallback.recap,
    theyWillAsk: primary.theyWillAsk.length ? primary.theyWillAsk : fallback.theyWillAsk,
    terms: primary.terms.length ? primary.terms : fallback.terms,
    termCards: primary.termCards.length ? primary.termCards : fallback.termCards,
    actionItems: primary.actionItems,
    traps: primary.traps,
  };
}

function asTerms(value: unknown): { names: string[]; cards: TermCard[] } {
  if (!Array.isArray(value)) return { names: [], cards: [] };
  const names: string[] = [];
  const cards: TermCard[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      names.push(clipWords(item, 6));
    } else if (item && typeof item === "object") {
      const rec = item as { term?: unknown; definition?: unknown };
      const term = clipWords(String(rec.term ?? ""), 6);
      const definition = clipWords(String(rec.definition ?? ""), 12);
      if (term) names.push(term);
      if (term && definition) cards.push({ term, definition });
    }
  }
  return { names: names.slice(0, 8), cards: cards.slice(0, 8) };
}
