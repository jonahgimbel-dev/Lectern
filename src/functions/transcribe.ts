import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";

const MAX_BYTES = 4_500_000;

function asBlob(data: FormData | { base64: string; mimeType: string; filename: string }): {
  blob: Blob;
  filename: string;
} | null {
  if (data instanceof FormData) {
    const file = data.get("file");
    if (typeof file !== "object" || file === null || !("arrayBuffer" in file) || !("size" in file)) {
      return null;
    }
    const blob = file as Blob;
    const filename = file instanceof File && file.name ? file.name : "lecture.wav";
    return { blob, filename };
  }
  const binary = Buffer.from(data.base64, "base64");
  const blob = new Blob([binary], { type: data.mimeType || "audio/wav" });
  return { blob, filename: data.filename || "lecture.wav" };
}

async function transcribeBlob(apiKey: string, blob: Blob, filename: string): Promise<string> {
  const type = blob.type || "audio/wav";
  const file = new File([blob], filename, { type });

  const primary = new FormData();
  primary.set("language", "en");
  primary.set("format", "true");
  primary.set("file", file);
  const stt = await fetch("https://api.x.ai/v1/stt", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: primary,
    signal: AbortSignal.timeout(90_000),
  });
  if (stt.ok) {
    const body = (await stt.json()) as { text?: string; transcript?: string };
    const text = (body.text ?? body.transcript ?? "").trim();
    if (text) return text;
  }

  const fallback = new FormData();
  fallback.set("model", "grok-stt");
  fallback.set("language", "en");
  fallback.set("file", file);
  const compat = await fetch("https://api.x.ai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: fallback,
    signal: AbortSignal.timeout(90_000),
  });
  if (!compat.ok) return "";
  const body = (await compat.json()) as { text?: string };
  return (body.text ?? "").trim();
}

export const transcribeAudio = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) => {
    if (data instanceof FormData) return data;
    return z
      .object({
        base64: z.string().min(8).max(6_000_000),
        mimeType: z.string().max(80).default("audio/wav"),
        filename: z.string().max(80).default("lecture.wav"),
      })
      .parse(data);
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false as const, error: "Transcription is not available here." };
    const parsed = asBlob(data);
    if (!parsed) return { ok: false as const, error: "No audio file was sent." };
    if (parsed.blob.size === 0) return { ok: false as const, error: "Audio file is empty." };
    if (parsed.blob.size > MAX_BYTES) {
      return { ok: false as const, error: "That clip is too large. Record in shorter segments." };
    }
    try {
      const text = await transcribeBlob(apiKey, parsed.blob, parsed.filename);
      if (!text) return { ok: false as const, error: "No speech was heard in that clip." };
      return { ok: true as const, text };
    } catch {
      return { ok: false as const, error: "Could not transcribe that clip. Try again." };
    }
  });
