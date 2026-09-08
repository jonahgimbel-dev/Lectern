const OWNER_EMAILS = new Set(
  [
    process.env.LECTERN_OWNER_EMAIL ?? "",
    "jonahg0505@gmail.com",
  ]
    .join(",")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean),
);

const OWNER_IDS = new Set(["jonahg0505", "1362501805159059458"]);

export type OwnerHints = {
  email?: string | null;
  name?: string | null;
  accountIds?: string[];
};

export function emailIsOwner(email: string | null | undefined): boolean {
  return identityIsOwner({ email });
}

export function identityIsOwner(hints: OwnerHints): boolean {
  const email = (hints.email ?? "").trim().toLowerCase();
  if (email && OWNER_EMAILS.has(email)) return true;
  if (email.includes("jonahgimbel") || email.includes("jonahg0505")) return true;
  if (hints.name && /jonah\s+gimbel/i.test(hints.name)) return true;
  for (const raw of hints.accountIds ?? []) {
    const id = raw.trim().toLowerCase().replace(/^@/, "");
    if (OWNER_IDS.has(id)) return true;
  }
  return false;
}
