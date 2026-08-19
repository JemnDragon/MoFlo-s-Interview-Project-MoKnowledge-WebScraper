/** Small text helpers shared across parse and transform. No I/O, no side effects. */

export function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

/** Normalises link text and URL slugs into one comparable form for classification. */
export function normalizeForMatch(input: string): string {
  return input
    .toLowerCase()
    .replace(/[_\-/]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The only quality gate applied scraper-side: is there any text at all?
 * Deliberately trivial. Word-count or "does this read well" judgments are the
 * reviewer's job, not the scraper's (§8).
 */
export function isNonEmpty(text: string | null | undefined): text is string {
  return typeof text === "string" && hasVisibleText(text);
}

/**
 * Characters that occupy no width when rendered but are NOT whitespace to
 * JavaScript.
 *
 * This distinction is the whole reason this function exists. `String.trim()` and
 * the regex class `\s` share one definition of whitespace, and it does not
 * include zero-width spaces, joiners, soft hyphens or bidi marks. So a heading
 * whose text is three zero-width spaces has `.trim().length === 3`: it passes
 * every "is it empty" check in this codebase and then renders as a completely
 * blank chip.
 *
 * That is not hypothetical. Site builders emit `&zwnj;` and `&#8203;` as layout
 * spacers, and CMS editors leave soft hyphens behind after a copy-paste.
 *
 *   - `­` soft hyphen
 *   - `͏` combining grapheme joiner
 *   - `​-‏` zero-width space / non-joiner / joiner, LTR & RTL marks
 *   - `‪-‮` bidi embedding and override controls
 *   - `⁠-⁤` word joiner and invisible operators
 *   - `⁪-⁯` deprecated formatting controls
 *   - `︀-️` variation selectors
 *   - `﻿` byte order mark
 */
const ZERO_WIDTH = /[­͏​-‏‪-‮⁠-⁤⁪-⁯︀-️﻿]/g;

/** Strips characters that render as nothing, then reports whether anything is left. */
export function hasVisibleText(text: string): boolean {
  return text.replace(ZERO_WIDTH, "").trim().length > 0;
}

/** The visible text with zero-width characters removed and whitespace collapsed. */
export function visibleText(text: string): string {
  return collapseWhitespace(text.replace(ZERO_WIDTH, ""));
}

/**
 * Does this string contain a letter or a digit anywhere?
 *
 * A stricter test than `hasVisibleText`, for the places where a *name* is
 * expected. `"———"` and `"•••"` are visible — they render as a row of dashes or
 * dots — but they are decorative dividers a theme dropped into an `h2`, not a
 * heading. Applied to headings and to category names, not to the shared
 * list-pruning rule, because "is this punctuation meaningful" depends on what
 * the field holds: a brand colour of `#fff` is punctuation-led and perfectly
 * real.
 */
export function hasAlphanumeric(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

export function dedupe<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

export function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

/** Splits main content into paragraph-sized blocks suitable for snippets. */
export function toParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}|\r\n{2,}/)
    .map((block) => collapseWhitespace(block))
    .filter((block) => block.length > 0);
}

/** Truncates for display without cutting mid-word. Never used on stored data. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  return `${slice.slice(0, lastSpace > 0 ? lastSpace : max)}…`;
}
