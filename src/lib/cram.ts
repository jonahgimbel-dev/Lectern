import { clipWords, splitSentences } from "@/lib/recap-quality";
import type { CramSheet } from "@/lib/types";

export function parseCram(raw: unknown): CramSheet | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const mustKnow = asLines(rec.mustKnow ?? rec.must_know);
  const traps = asLines(rec.traps);
  const drills = asLines(rec.drills);
  if (!mustKnow.length && !traps.length && !drills.length) return null;
  return { mustKnow, traps, drills };
}

export function parseTermLines(raw: unknown): string[] {
  return asLines(raw);
}

export function parseActionLines(raw: unknown): string[] {
  return asLines(raw);
}

function asLines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => clipWords(item, 18))
    .filter(Boolean)
    .slice(0, 8);
}

export function mergeCram(primary: CramSheet | null, fallback: CramSheet): CramSheet {
  if (!primary) return fallback;
  return {
    mustKnow: primary.mustKnow.length ? primary.mustKnow : fallback.mustKnow,
    traps: primary.traps.length ? primary.traps : fallback.traps,
    drills: primary.drills.length ? primary.drills : fallback.drills,
  };
}

export function cramFromMaterial(text: string): CramSheet {
  const lines = splitSentences(text).map((item) => clipWords(item, 16)).filter(Boolean);
  const mustKnow = lines.slice(0, 6);
  return {
    mustKnow: mustKnow.length ? mustKnow : ["Rebuild a lecture recap, then cram from those lines."],
    traps: lines.slice(6, 8),
    drills: mustKnow.slice(0, 3).map((line) => `Say this without looking: ${clipWords(line, 10)}`),
  };
}
