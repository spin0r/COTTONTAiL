export function tokenize(str: string): string {
  if (!str) return "";
  return str
    .replace(/[._\-\[\](){}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractKeywords(fileName: string, caption: string | null): string {
  const combined = `${tokenize(fileName)} ${tokenize(caption ?? "")}`;
  const tokens = combined.split(/\s+/).filter(Boolean);
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const t of tokens) {
    const lower = t.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    keywords.push(t);
  }
  return keywords.join(" ");
}

export function normalizeQuery(query: string): string {
  if (!query) return "";
  const tokens = tokenize(query)
    .split(/\s+/)
    .filter((t) => t.length >= 1);
  if (!tokens.length) return "";
  return tokens.map((t) => `"${t}"*`).join(" ");
}
