export function joinInviteText(origin: string, code: string): string {
  return [
    `Join Lectern with this code: ${code}`,
    `${origin}/join?code=${encodeURIComponent(code)}`,
    "",
    "Sign in, paste the code, then connect Canvas from Calendar → Calendar Feed (no API token needed).",
  ].join("\n");
}
