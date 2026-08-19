/**
 * Discovery tier 3: direct path probing.
 *
 * WHY THIS EXISTS — and it is a narrow reason, not a general "try harder".
 *
 * Tiers 1 and 2 both assume the site tells us where its pages are: tier 1 reads
 * nav/footer links out of the returned HTML, tier 2 reads sitemap.xml. This
 * crawler fetches HTML but does not execute JavaScript, so a site that renders
 * its navigation client-side — an SPA, a JS-driven mega-menu, a Shopify theme
 * that builds its header in script — returns markup with no nav links in it at
 * all. Tier 1 then finds nothing, and if the site also has no usable sitemap,
 * discovery concludes the pages do not exist when in fact it simply never saw
 * them. That is a blind spot in the fetch strategy, not a fact about the site,
 * and this tier exists specifically to hedge against it.
 *
 * It is deliberately constrained:
 *
 *  - **Last resort only.** Runs only for categories that produced no candidate
 *    from nav links AND none from sitemap.
 *  - **Required-field categories only.** Just the categories feeding Overview,
 *    Pitch and Offerings. Optional fields do not get speculative requests spent
 *    on them, consistent with how the homepage fallback in the transform layer
 *    is also reserved for required fields.
 *  - **Capped at a few guesses each**, because most guesses 404 and the crawl
 *    budget should be spent on confirmed content.
 *  - **Derived from the existing keyword file**, not a second hand-maintained
 *    list that could drift out of sync with classification.
 *
 * Guessing *where to look* carries no fabrication risk: a wrong guess 404s and
 * contributes nothing. Guessing what a page *says* would be a different matter,
 * and nothing here does that.
 */

import type { PageType } from "@/types/knowledge";
import { keywordsFor } from "./classify";

/**
 * Categories that feed a required field (§5). Only these get probed.
 *
 * Two entries covers all three required fields, which is worth tracing because
 * "about + services" looks like it might be missing Pitch:
 *
 *   Overview  ← `about` pages, falling back to homepage narrative.
 *   Pitch     ← homepage hero and og:description, falling back to `about`.
 *   Offerings ← `services` pages, falling back to any other fetched page.
 *
 * The homepage is fetched unconditionally, so it never needs probing, and Pitch's
 * only other source is About — already covered. Adding `pitch` as its own entry
 * would be meaningless (no site has a `/pitch` page) and adding `contact`,
 * `team` or `blog` would spend speculative requests on optional fields, which is
 * exactly the line this tier is drawn on.
 */
export const PROBED_PAGE_TYPES: PageType[] = ["about", "services"];

export const MAX_PROBES_PER_TYPE = 3;

/**
 * Turns classification keywords into path guesses.
 *
 * Single-word keywords rank first because they are overwhelmingly the ones that
 * appear as real URL slugs — sites use `/about` and `/services`, rarely
 * `/about-our-company`. Two-word keywords follow as hyphenated slugs. Anything
 * longer is dropped: `/what-we-offer` exists occasionally, but not often enough
 * to be worth a request when the budget only allows three.
 */
export function candidatePathsFor(
  pageType: PageType,
  limit = MAX_PROBES_PER_TYPE,
): string[] {
  const keywords = keywordsFor(pageType);

  const singleWord: string[] = [];
  const twoWord: string[] = [];

  for (const keyword of keywords) {
    const words = keyword.split(" ").filter(Boolean);
    if (words.length === 1 && words[0]) singleWord.push(words[0]);
    else if (words.length === 2) twoWord.push(words.join("-"));
  }

  const ordered = [...singleWord, ...twoWord];
  const unique = Array.from(new Set(ordered)).slice(0, limit);
  return unique.map((slug) => `/${slug}`);
}

/** Absolute probe URLs for one category, resolved against the site root. */
export function probeUrlsFor(
  pageType: PageType,
  siteUrl: string,
  limit = MAX_PROBES_PER_TYPE,
): string[] {
  const urls: string[] = [];
  for (const path of candidatePathsFor(pageType, limit)) {
    try {
      urls.push(new URL(path, siteUrl).toString());
    } catch {
      // A path that cannot be resolved is simply not probed.
    }
  }
  return urls;
}

/**
 * Guards against soft-404s.
 *
 * A hard 404 is handled by the fetch layer. The dangerous case is a site that
 * answers every unknown path with HTTP 200 — usually by serving the homepage or
 * a styled "page not found". Accepting that would file homepage marketing copy
 * as the About page's content, which is exactly the kind of quiet fabrication
 * this system is built to avoid. Cheaper and more reliable than a heuristic on
 * the text: compare against the homepage we already have.
 */
export function looksLikeSoftFourOhFour(html: string, homepageHtml: string): boolean {
  if (html.trim().length === 0) return true;

  // Byte-identical, or within 2% of the homepage's length with the same title,
  // means we were almost certainly handed the homepage again.
  if (html === homepageHtml) return true;

  const sizeRatio = Math.abs(html.length - homepageHtml.length) / (homepageHtml.length || 1);
  if (sizeRatio < 0.02 && titleOf(html) === titleOf(homepageHtml)) return true;

  const title = (titleOf(html) ?? "").toLowerCase();
  return /\b(404|not found|page not found|page unavailable|doesn'?t exist)\b/.test(title);
}

function titleOf(html: string): string | null {
  const match = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(html);
  return match?.[1] ? match[1].replace(/\s+/g, " ").trim() : null;
}
