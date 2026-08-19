/**
 * Snippet bundling primitives.
 *
 * The rule that governs all of these (§8): the scraper bundles candidate
 * snippets, it does not judge them. There is no word-count floor, no readability
 * score, no "this looks like filler" filter. The only gate is "is there any text
 * here at all", because an empty string genuinely carries no information.
 *
 * `absent` therefore means *nothing matched*, never *what matched looked weak*.
 * That distinction is what lets the review UI tell a reviewer the truth about why
 * a field is empty.
 */

import type { Category2Field, Snippet } from "@/types/knowledge";
import { dedupeBy, isNonEmpty } from "@/lib/utils/text";

/** How many snippets a synthesis field bundles before we stop adding more. */
export const MAX_SYNTHESIS_SNIPPETS = 6;
/** Extractive fields lift a passage; two is plenty to give the reviewer a choice. */
export const MAX_EXTRACTIVE_SNIPPETS = 2;
/**
 * Overview and Pitch, which draw from one shared pool (`positioningPool`).
 *
 * Equal depth on purpose. They previously took two and three, which was
 * harmless while they had separate pools and is not now: with one pool and two
 * orderings, a smaller cap means one field systematically sees less of the same
 * evidence, and the field that sees less would be the required, factual one.
 */
export const MAX_POSITIONING_SNIPPETS = MAX_EXTRACTIVE_SNIPPETS + 1;

export const ABSENT: Category2Field = { status: "absent" };

/**
 * The single constructor for Category 2 values. Empty in ⇒ absent out; anything
 * else is bundled verbatim.
 */
export function bundle(snippets: Snippet[], limit = MAX_SYNTHESIS_SNIPPETS): Category2Field {
  const usable = dedupeBy(
    snippets.filter((snippet) => isNonEmpty(snippet.text)),
    (snippet) => snippet.text.slice(0, 160).toLowerCase(),
  ).slice(0, limit);

  if (usable.length === 0) return ABSENT;
  return { status: "found", snippets: usable };
}

/** Case-insensitive "does this passage contain any of these signal phrases". */
export function matchesAnySignal(text: string, signals: string[]): boolean {
  const haystack = text.toLowerCase();
  return signals.some((signal) => haystack.includes(signal.toLowerCase()));
}

export function snippetsMatching(snippets: Snippet[], signals: string[]): Snippet[] {
  return snippets.filter((snippet) => matchesAnySignal(snippet.text, signals));
}

/**
 * Spreads selection across distinct page types before taking a second snippet
 * from any one page. Synthesis fields (Writing Style, Ideal Persona) rely on
 * this: a bundle drawn entirely from one page would describe that page's tone,
 * not the site's.
 */
export function spreadAcrossSources(snippets: Snippet[], limit: number): Snippet[] {
  const bySource = new Map<string, Snippet[]>();
  for (const snippet of snippets) {
    const existing = bySource.get(snippet.source) ?? [];
    existing.push(snippet);
    bySource.set(snippet.source, existing);
  }

  const out: Snippet[] = [];
  let round = 0;
  while (out.length < limit) {
    let addedThisRound = false;
    for (const group of bySource.values()) {
      const snippet = group[round];
      if (!snippet) continue;
      out.push(snippet);
      addedThisRound = true;
      if (out.length >= limit) break;
    }
    if (!addedThisRound) break;
    round += 1;
  }
  return out;
}

/** First non-null value, used throughout Category 1 resolution. */
export function firstDefined<T>(...values: (T | null | undefined)[]): T | null {
  for (const value of values) {
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

/** Trims to null so "" never masquerades as a found Category 1 value. */
export function nullIfBlank(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
