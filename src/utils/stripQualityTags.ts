// stripQualityTags.ts — strips trailing scene/SEO suffix tags (end-anchored, iterative)
// e.g. "BAMVisions 21 01 01 Adria Rae A Fucktastic Time XXX 1080p MP4-WRB"
//   -> "BAMVisions 21 01 01 Adria Rae A Fucktastic Time"
// Only strips at the END of the string; "1080p My Song" and "My 1080p Video" are untouched.
export const QUALITY_TAGS = [
  '\\d{3,4}p', // 144p - 2160p, 1080p
  '4k', '8k',
  'hd', 'fullhd', 'ultrahd', 'uhd', 'fhd', 'qhd',
  'xxx', 'ktr', 'wrb', 'nbq', 'p2p', 'rarbg', 'fgt', 'kleenex', 'sparks', 'tgx', 'xc',
  'yts', 'yify', 'srg', 'eth', 'chd', 'evo', 'framestor', 'ntb', 'flux', 'rartv',
  'mp4', 'mkv', 'avi', 'wmv', 'mov', // containers (e.g. MP4-WRB / MP4-KTR)
];

// Build pattern once
const TAG = `(?:${QUALITY_TAGS.join('|')})`;
// Delimiters between tags: whitespace, dots, dashes, pipes, etc.
// Excludes []() so "My Video (Official) 720p" keeps the ")" -> "My Video (Official)"
const DELIM = String.raw`[\s\.\-_|–—•·,]+`;

// End-anchored: [delim]? tag (delim tag)* \s*$
export const TRAILING_TAGS_RE = new RegExp(
  String.raw`(?:${DELIM})?${TAG}(?:${DELIM}${TAG})*\s*$`,
  'i'
);

// For iterative safety, also single-tag version (allows [1080p] / (xxx)):
export const SINGLE_TRAILING_RE = new RegExp(
  String.raw`(?:${DELIM})?[\[\(]?${TAG}[\]\)]?\s*$`,
  'i'
);

export function stripTrailingQualityTags(title: string): string {
  if (!title) return title;
  let prev: string;
  let cur = title.trim();
  // iterative strip to handle "XXX 1080p MP4-WRB" with any delimiter
  do {
    prev = cur;
    cur = cur.replace(SINGLE_TRAILING_RE, '').trim();
  } while (cur !== prev);
  return cur;
}

// Wrapper that preserves empty -> returns original
export function cleanTitle(title: string): string {
  const cleaned = stripTrailingQualityTags(title);
  return cleaned.length ? cleaned : title.trim();
}
