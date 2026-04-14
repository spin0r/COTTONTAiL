/**
 * NZB Keyword Extraction & Query Normalization
 *
 * Filenames are stored EXACTLY as received — no cleaning, no tag stripping.
 * Keywords are derived by tokenizing (splitting separators into spaces)
 * so FTS5 can match individual words within dot/underscore-separated names.
 */

/**
 * Tokenize a string for FTS5 indexing.
 * Splits on common separators (. _ - [ ] ( ) { }) → spaces.
 * Does NOT remove any words or change casing for storage.
 *
 * "The.Movie.Name.2023.1080p.WEB-DL.x264-GROUP.nzb"
 *  → "The Movie Name 2023 1080p WEB DL x264 GROUP nzb"
 *
 * @param {string} str - Raw filename or caption
 * @returns {string}   - Space-separated tokens
 */
function tokenize(str) {
  if (!str) return "";
  return str
    .replace(/[._\-\[\](){}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Extract keywords from filename + caption for FTS5 indexing.
 * Deduplicates tokens (case-insensitive) but preserves original casing.
 *
 * @param {string} fileName - Original filename
 * @param {string} caption  - Original caption text (may be null)
 * @returns {string}        - Space-separated keyword string for FTS5
 */
function extractKeywords(fileName, caption) {
  const combined = `${tokenize(fileName)} ${tokenize(caption || "")}`;
  const tokens = combined.split(/\s+/).filter(Boolean);

  // Deduplicate (case-insensitive), keep original form
  const seen = new Set();
  const keywords = [];
  for (const t of tokens) {
    const lower = t.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    keywords.push(t);
  }

  return keywords.join(" ");
}

/**
 * Normalize a search query for FTS5 MATCH.
 * Tokenizes and wraps each word for prefix matching.
 *
 * @param {string} query - User's raw search input
 * @returns {string}     - FTS5 MATCH expression
 */
function normalizeQuery(query) {
  if (!query) return "";
  const tokens = tokenize(query)
    .split(/\s+/)
    .filter((t) => t.length >= 1);
  if (!tokens.length) return "";
  // Each token with prefix matching and implicit AND
  return tokens.map((t) => `"${t}"*`).join(" ");
}

module.exports = { tokenize, extractKeywords, normalizeQuery };
