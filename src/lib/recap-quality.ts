export function clipWords(text: string, max = 14): string {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length <= max) return words.join(" ");
  return words.slice(0, max).join(" ");
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.replace(/^[\s•\-–]+/, "").trim())
    .filter((item) => item.length > 12);
}

const FILLER =
  /^(ok|okay|alright|so+|um+|uh+|yeah|yep|right|hello|hey|hi|good (morning|afternoon|evening)|can (you|everyone|y'all)|let's (get|go|start|jump|dive)|let us|today (we|i|i'll|we're)|last (time|class|week|lecture)|before we|real quick|as you (all )?know|welcome|thanks for|sorry|hold on|one second|quick recap|we're going to (talk|look|go over|cover|start)|i('m| am) going to|this lecture (will|covers)|we (will|discussed|talked about)|the (professor|teacher|instructor) (said|talked)|don't forget to|make sure (to|you)|any questions)\b/i;

export function isFillerLine(line: string): boolean {
  const text = line.replace(/^[^a-zA-Z0-9]+/, "").trim();
  if (text.length < 22) return true;
  if (FILLER.test(text)) return true;
  if (/\b(unmute|zoom|microsoft teams|attendance|clicker|syllabus day)\b/i.test(text)) return true;
  if (/^(we discussed|this lecture covers|today's topic is|the main idea is)\b/i.test(text)) return true;
  return false;
}

export function recapScore(line: string): number {
  let score = 0;
  if (/\b(is|are|means|equals|defined as|called|causes|because|therefore|whereas|versus|compared to)\b/i.test(line)) {
    score += 2;
  }
  if (/\d/.test(line)) score += 1;
  if (/\b(formula|rate|cost|margin|theorem|principle|law|model|ratio|equation|debit|credit|variance|derivative|integral|hypothesis|sample)\b/i.test(line)) {
    score += 2;
  }
  if (/[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}/.test(line)) score += 1;
  if (isFillerLine(line)) return 0;
  return score;
}

export function groundedInTranscript(line: string, transcript: string): boolean {
  if (!transcript.trim()) return true;
  const hay = transcript.toLowerCase();
  const words = line
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 4);
  if (words.length < 2) return false;
  const hits = words.filter((word) => hay.includes(word)).length;
  return hits / words.length >= 0.4;
}

export function pickRecapFromTranscript(transcript: string, max = 5): string[] {
  const ranked = splitSentences(transcript)
    .map((sentence, index) => ({ sentence, index, score: recapScore(sentence) }))
    .filter((row) => row.score > 0);
  const strong = ranked.filter((row) => row.score >= 2);
  const pool = (strong.length >= 3 ? strong : ranked).sort((a, b) => a.index - b.index);
  const out: string[] = [];
  for (const row of pool) {
    const line = clipWords(row.sentence, 16);
    if (out.some((item) => item.toLowerCase() === line.toLowerCase())) continue;
    out.push(line);
    if (out.length >= max) break;
  }
  return out;
}

export function cleanRecap(lines: string[], transcript: string, max = 5): string[] {
  const cleaned: string[] = [];
  for (const raw of lines) {
    const line = clipWords(raw, 16);
    if (isFillerLine(line)) continue;
    if (transcript && !groundedInTranscript(line, transcript)) continue;
    if (cleaned.some((item) => item.toLowerCase() === line.toLowerCase())) continue;
    cleaned.push(line);
    if (cleaned.length >= max) break;
  }
  if (cleaned.length >= 3) return cleaned;
  for (const line of pickRecapFromTranscript(transcript, max)) {
    if (cleaned.some((item) => item.toLowerCase() === line.toLowerCase())) continue;
    cleaned.push(line);
    if (cleaned.length >= max) break;
  }
  return cleaned;
}
