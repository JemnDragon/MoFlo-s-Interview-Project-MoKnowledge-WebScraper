/**
 * Page-type classification.
 *
 * Link text and URL slug are matched against a static, hand-curated keyword file
 * (`src/data/page-type-keywords.json`). Link text is the stronger signal — it is
 * written by the site owner to tell a human what the page is for — so a nav link
 * reading "Meet the team" classifies as `team` even if its URL is `/p/8821`.
 *
 * A link is allowed to match several categories, and several links are allowed
 * to match the same category. Neither is treated as a conflict.
 */

import keywordFile from "@/data/page-type-keywords.json";
import type { PageType } from "@/types/knowledge";
import { normalizeForMatch } from "@/lib/utils/text";

type KeywordMap = Record<string, string[]>;

/** Categories in crawl-priority order. Earlier types win a contested budget slot. */
export const CLASSIFIABLE_PAGE_TYPES: PageType[] = [
  "about",
  "services",
  "team",
  "contact",
  "testimonials",
  "pricing",
  "faq",
  "blog",
];

const KEYWORDS: KeywordMap = Object.fromEntries(
  Object.entries(keywordFile as Record<string, unknown>)
    .filter(([key, value]) => !key.startsWith("_") && Array.isArray(value))
    .map(([key, value]) => [key, (value as string[]).map(normalizeForMatch)]),
);

/** Word-boundary-aware substring test on already-normalised strings. */
function containsPhrase(haystack: string, phrase: string): boolean {
  if (phrase.length === 0) return false;
  const padded = ` ${haystack} `;
  return padded.includes(` ${phrase} `) || padded.includes(` ${phrase}s `);
}

function slugOf(url: string): string {
  try {
    const { pathname } = new URL(url);
    return normalizeForMatch(decodeURIComponent(pathname));
  } catch {
    return normalizeForMatch(url);
  }
}

/**
 * Returns every page type this link plausibly belongs to. Empty means unknown,
 * which is a fine and common answer — unclassified links are simply not crawled.
 */
export function classifyLink(linkText: string | null, url: string): PageType[] {
  const text = linkText ? normalizeForMatch(linkText) : "";
  const slug = slugOf(url);
  const matches: PageType[] = [];

  for (const pageType of CLASSIFIABLE_PAGE_TYPES) {
    const phrases = KEYWORDS[pageType];
    if (!phrases) continue;
    const hit = phrases.some(
      (phrase) => containsPhrase(text, phrase) || containsPhrase(slug, phrase),
    );
    if (hit) matches.push(pageType);
  }

  return matches;
}

/** Sitemap fallback matches on the URL alone — there is no anchor text there. */
export function classifyUrlOnly(url: string): PageType[] {
  return classifyLink(null, url);
}

export function keywordsFor(pageType: PageType): string[] {
  return KEYWORDS[pageType] ?? [];
}

/**
 * The page type used to tag snippets from a page. A page may serve several
 * categories; the most specific non-homepage one is the most useful provenance
 * label for a reviewer.
 *
 * Lives here rather than beside the parser so that the transform layer — and the
 * dependency-free test harness — can tag provenance without pulling in cheerio.
 */
export function primaryPageType(pageTypes: PageType[]): PageType {
  const specific = pageTypes.find((type) => type !== "homepage" && type !== "unknown");
  return specific ?? pageTypes[0] ?? "unknown";
}
