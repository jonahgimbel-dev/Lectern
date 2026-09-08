import { duesFromLectureMaterial } from "@/lib/due-from-notes";
import {
  cleanRecap,
  clipWords,
  isFillerLine,
  pickRecapFromTranscript,
  splitSentences,
} from "@/lib/recap-quality";
import type { TermCard } from "@/lib/types";

export {
  cleanRecap,
  clipWords,
  isFillerLine,
  pickRecapFromTranscript,
  splitSentences,
} from "@/lib/recap-quality";

export function shortLines(value: unknown, maxItems: number, maxWords: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const line = clipWords(item, maxWords);
    if (line && !out.includes(line)) out.push(line);
    if (out.length >= maxItems) break;
  }
  return out;
}

export type LectureNotes = {
  title: string;
  recap: string[];
  theyWillAsk: string[];
  terms: string[];
  termCards: TermCard[];
  actionItems: string[];
  traps: string[];
};

export function notesFromTranscript(transcript: string, courseCode: string): LectureNotes {
  const recap = pickRecapFromTranscript(transcript, 5);
  const sentences = splitSentences(transcript);
  const terms: TermCard[] = [];
  const seen = new Set<string>();
  for (const sentence of sentences) {
    if (isFillerLine(sentence)) continue;
    const match = sentence.match(
      /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s+(?:is|are|means)\s+(.{12,80})/i,
    );
    if (!match) continue;
    const term = match[1].trim();
    if (seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    terms.push({ term, definition: clipWords(match[2], 12) });
    if (terms.length >= 8) break;
  }
  const theyWillAsk = (
    terms.length
      ? terms.slice(0, 3).map((card) => `Explain ${card.term} in one line`)
      : recap.slice(0, 3).map((line) => `How would you use: ${clipWords(line, 8)}`)
  ).slice(0, 3);
  const dated = duesFromLectureMaterial({ transcript });
  return {
    title: clipWords(recap[0] || `${courseCode} lecture`, 6),
    recap: recap.length ? recap : [`${courseCode} lecture - tap Rebuild`],
    theyWillAsk,
    terms: terms.map((card) => card.term),
    termCards: terms,
    actionItems: dated.map((due) => `${due.title} due ${due.examOn}`),
    traps: [],
  };
}

export function recapForLecture(lecture: {
  outline: string[];
  summary: string;
  transcript: string;
}): string[] {
  const fromOutline = cleanRecap(lecture.outline, lecture.transcript, 5);
  if (fromOutline.length >= 3) return fromOutline;
  const fromSummary = cleanRecap(splitSentences(lecture.summary), lecture.transcript, 5);
  if (fromSummary.length >= 3) return fromSummary;
  return pickRecapFromTranscript(lecture.transcript, 5);
}
