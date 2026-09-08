import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { parseRosterPaste } from "@/lib/paste-roster";

export const parseCanvasSnapshot = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: unknown) =>
    z.object({ image: z.string().min(40).max(6_000_000) }).parse(data),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false as const, error: "Vision is not available here. Paste the roster instead." };
    const image = data.image.startsWith("data:") ? data.image : `data:image/png;base64,${data.image}`;
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "grok-4.5",
        max_tokens: 700,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "This is a Canvas dashboard screenshot. List each course. The gray line is the course name (e.g. AI for Mustangs). Return JSON {courses:[{code,name}]}. Code like ACCT 2302 when present. Skip announcements, calendar, inbox, to-do.",
              },
              { type: "image_url", image_url: { url: image } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return { ok: false as const, error: "Could not read that screenshot." };
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = body.choices?.[0]?.message?.content ?? "";
    const match = raw.match(/\{[\s\S]*\}/);
    let text = raw;
    if (match) {
      try {
        const parsed = JSON.parse(match[0]) as { courses?: { code?: string; name?: string }[] };
        text = (parsed.courses ?? [])
          .map((row) => `${row.code ?? ""} ${row.name ?? ""}`.trim())
          .join("\n");
      } catch {
        /* use raw */
      }
    }
    const courses = parseRosterPaste(text);
    if (!courses.length) return { ok: false as const, error: "No classes seen. Try a closer shot of the course cards." };
    return { ok: true as const, courses };
  });
