import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";

const MAX_BYTES = 4_500_000;

function asBlob(data: { base64: string; mimeType: string; filename: string }): {
  blob: Blob;
  filename: string;
} {
  const binary = Buffer.from(data.base64, "base64");
  const blob = new Blob([binary], { type: data.mimeType || "audio/wav" });
  return { blob, filename: data.filename || "lecture.wav" };
}

async function transcribeWav(apiKey: string, blob: Blob, filename: string): Promise<string> {
  const file = new File([blob], filename.endsWith(".wav") ? filename : "lecture.wav", {
    type: "audio/wav",
  });
  const form = new FormData();
  form.set("model", "grok-stt");
  form.set("language", "en");
  form.set("format", "json");
  form.set("file", file);
  const res = await fetch("https://api.x.ai/v1/stt", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(90_000),
  });
  const raw = await res.text();
  let body: { text?: string; transcript?: string; error?: string | { message?: string } } = {};
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    if (!res.ok) throw new Error(`Transcription failed (${res.status}).`);
    return "";
  }
  if (!res.ok) {
    const detail = typeof body.error === "string" ? body.error : body.error?.message;
    throw new Error(detail || `Transcription failed (${res.status}).`);
  }
  return (body.text ?? body.transcript ?? "").trim();
}

export const transcribeAudio = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) =>
    z
      .object({
        base64: z.string().min(8).max(6_000_000),
        mimeType: z.string().max(80).default("audio/wav"),
        filename: z.string().max(80).default("lecture.wav"),
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false as const, error: "Transcription is not available here." };
    const parsed = asBlob(data);
    if (parsed.blob.size === 0) return { ok: false as const, error: "Audio file is empty." };
    if (parsed.blob.size > MAX_BYTES) {
      return { ok: false as const, error: "That clip is too large. Record in shorter segments." };
    }
    try {
      const text = await transcribeWav(apiKey, parsed.blob, parsed.filename);
      if (!text) return { ok: false as const, error: "No speech was heard in that clip." };
      return { ok: true as const, text };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not transcribe that clip.";
      return { ok: false as const, error: message };
    }
  });
