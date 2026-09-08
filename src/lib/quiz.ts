import type { QuizItem } from "@/lib/types";

export function parseQuizItems(raw: unknown): QuizItem[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && "items" in raw
    ? (raw as { items: unknown }).items
    : [];
  if (!Array.isArray(list)) return [];
  const out: QuizItem[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const prompt = String(rec.prompt ?? rec.q ?? "").trim();
    const choices = Array.isArray(rec.choices)
      ? rec.choices.filter((c): c is string => typeof c === "string").slice(0, 4)
      : [];
    const answer = Number(rec.answer ?? rec.correct ?? 0);
    if (!prompt || choices.length < 2) continue;
    out.push({
      prompt,
      choices,
      answer: Number.isFinite(answer) ? Math.max(0, Math.min(choices.length - 1, answer)) : 0,
      why: String(rec.why ?? rec.explain ?? "").slice(0, 160),
    });
    if (out.length >= 8) break;
  }
  return out;
}

export function quizFromMaterial(text: string): QuizItem[] {
  const lines = text
    .split(/[\n.;]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 24)
    .slice(0, 8);
  if (!lines.length) {
    return [
      {
        prompt: "What should you do with this class before the next exam?",
        choices: ["Re-read the recap out loud", "Skip the notes", "Only memorize dates", "Delete the lecture"],
        answer: 0,
        why: "Active recall from your own recap beats rereading.",
      },
    ];
  }
  return lines.slice(0, 5).map((line, index) => {
    const stem = line.slice(0, 90);
    return {
      prompt: `Which is true from this class: ${stem}${stem.length >= 90 ? "…" : ""}`,
      choices: [stem, "This was never said in class", "Only the syllabus matters", "Skip this topic"],
      answer: 0,
      why: "Pulled from your recap, cards, or transcript.",
    };
  });
}
