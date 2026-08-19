/**
 * Generic UI chrome, excluded once for every field.
 *
 * ## Why this is central rather than a filter inside the CTA parser
 *
 * A scan of a Shopify store surfaced "Skip to content", "Close", "Menu" and
 * "Cart 0" as calls to action. The obvious fix is a check inside
 * `extractCtas` — and it would have been wrong in the same way the Industry
 * Groupings fix was nearly wrong: the noise is not a property of CTAs, it is a
 * property of *page text*. The same strings reach Pitch as snippets, and can
 * reach headings, list items, offering names and FAQ questions by the same
 * route. Filtering one consumer leaves the rest.
 *
 * So the exclusion runs in `parsePage`, at the point where candidate text and
 * links are gathered, above every extractor. One list, one call site per
 * candidate stream, and a field added later inherits it.
 *
 * ## Why a static list rather than a heuristic
 *
 * The tempting rule is "short generic-sounding labels are chrome". That is a
 * judgment about tone, and this codebase decides things structurally wherever it
 * can: "Shop All", "Learn More" and "Notify Me!" are short and generic-sounding
 * and are real calls to action on a store. A curated list is auditable — you can
 * read it and see exactly what is being thrown away — and wrong in a way someone
 * can fix by editing JSON.
 *
 * The cost is honest: this list is finite and English-only. It will miss chrome
 * on a site whose theme words things differently, and the failure mode there is
 * noise in the review UI, which a reviewer can delete. That is the right
 * direction to fail — the opposite error, silently deleting a real CTA, is
 * invisible.
 */

import noiseFile from "@/data/ui-noise.json";
import { hasAlphanumeric, hasVisibleText, visibleText } from "@/lib/utils/text";

const EXACT = new Set(noiseFile.exact);
const CONTAINS = noiseFile.contains;

/**
 * Lowercase, strip punctuation, and drop a trailing counter.
 *
 * The counter matters: a cart link renders as "Cart 0", "Cart (0)" or "Cart · 2"
 * depending on the theme, and all three are the same control. Normalising them
 * onto "cart" is what lets one list entry cover every variant instead of
 * enumerating them.
 */
export function normalizeUiLabel(text: string): string {
  return visibleText(text)
    .toLowerCase()
    .replace(/[（(\[][^）)\]]*[）)\]]/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+\d+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type UiNoiseReason = "empty" | "no-letters" | "exact-match" | "banner-phrase" | null;

/**
 * Why this string is chrome, or `null` if it is not.
 *
 * Returns the reason rather than a boolean so `scripts/scrape-cli.ts` can print
 * what was dropped and why. A filter that silently removes things is a filter
 * nobody can debug.
 */
export function uiNoiseReason(text: string): UiNoiseReason {
  // Order matters: normalisation strips punctuation, so a divider like "———"
  // normalises to the empty string and would be reported as "empty" if these two
  // were the other way round. They are genuinely different findings — one is a
  // zero-width artefact, the other is a decorative rule a theme put in an `h2` —
  // and the CLI prints the reason, so conflating them would make the diagnostic
  // lie about what it saw.
  if (!hasVisibleText(text)) return "empty";
  if (!hasAlphanumeric(text)) return "no-letters";

  const normalized = normalizeUiLabel(text);
  if (normalized.length === 0) return "empty";
  if (EXACT.has(normalized)) return "exact-match";
  if (CONTAINS.some((phrase) => normalized.includes(phrase))) return "banner-phrase";
  return null;
}

export function isUiNoise(text: string): boolean {
  return uiNoiseReason(text) !== null;
}

/** Convenience for the candidate streams in `parsePage`. */
export function withoutUiNoise(items: string[]): string[] {
  return items.filter((item) => !isUiNoise(item));
}
