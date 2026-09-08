import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { assertPro } from "@/functions/billing";
import { authMiddleware } from "@/lib/auth/middleware";
import { cramFromMaterial, mergeCram, parseCram } from "@/lib/cram";
import { getSql } from "@/lib/db";
import { parseQuizItems, quizFromMaterial } from "@/lib/quiz";
import type { CramSheet, QuizItem } from "@/lib/types";

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

function lectureStudyText(row: {
  summary?: string;
  outline_json?: string;
  asks_json?: string;
  traps_json?: string;
  transcript?: string;
}): string {
  const recap = parseList(row.outline_json).join(". ");
  const asks = parseList(row.asks_json);
  const traps = parseList(row.traps_json);
  return [recap, asks.length ? `They will ask: ${asks.join("; ")}` : "", traps.length ? `Traps: ${traps.join("; ")}` : "", row.summary, row.transcript]
    .filter(Boolean)
    .join("\n")
    .slice(0, 2400);
}

function extractJson(raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

async function grokJson(prompt: string, maxTokens: number): Promise<string> {
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
      temperature: 0.3,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You help high school and college students study from their own lecture notes. Return ONLY JSON. Do not invent material that is not in the notes.",
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

async function courseMaterial(userId: string, courseId: string): Promise<string> {
  const sql = await getSql();
  const [course] = await sql<{ name: string; code: string; syllabus: string }>`
    select name, code, syllabus from courses where id = ${courseId} and user_id = ${userId}
  `;
  const lectures = await sql<{
    summary: string;
    outline_json: string;
    asks_json: string;
    traps_json: string;
    transcript: string;
  }>`
    select summary, outline_json, asks_json, traps_json, transcript
    from lectures where user_id = ${userId} and course_id = ${courseId}
    order by started_at desc limit 8
  `;
  const cards = await sql<{ front: string; back: string }>`
    select front, back from cards where user_id = ${userId} and course_id = ${courseId} limit 20
  `;
  return [
    course ? `${course.code} ${course.name}` : "",
    course?.syllabus,
    ...lectures.map(lectureStudyText),
    ...cards.map((card) => `${card.front}: ${card.back}`),
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 6000);
}

export const generateQuiz = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ courseId: z.string() }).parse(data))
  .handler(async ({ context, data }): Promise<{ ok: true; items: QuizItem[] } | { ok: false; error: string }> => {
    const gated = await assertPro(context.userId);
    if (!gated.ok) return gated;
    const material = await courseMaterial(context.userId, data.courseId);
    if (!material.trim()) return { ok: false, error: "Record a lecture first." };
    const fallback = quizFromMaterial(material);
    const raw = await grokJson(
      `Build a 5-question multiple-choice quiz from these notes. JSON: {"items":[{"prompt","choices":[4 strings],"answer":0-3,"why"}]}\n\n${material}`,
      900,
    );
    const parsed = parseQuizItems(extractJson(raw));
    return { ok: true, items: parsed.length ? parsed : fallback };
  });

export const generateCram = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => z.object({ courseId: z.string() }).parse(data))
  .handler(async ({ context, data }): Promise<{ ok: true; sheet: CramSheet } | { ok: false; error: string }> => {
    const gated = await assertPro(context.userId);
    if (!gated.ok) return gated;
    const material = await courseMaterial(context.userId, data.courseId);
    if (!material.trim()) return { ok: false, error: "Record a lecture first." };
    const fallback = cramFromMaterial(material);
    const raw = await grokJson(
      `Build an exam cram sheet from these notes. JSON: {"mustKnow":[strings],"traps":[strings],"drills":[strings]}. Short lines only.\n\n${material}`,
      700,
    );
    const parsed = parseCram(extractJson(raw));
    return { ok: true, sheet: mergeCram(parsed, fallback) };
  });
