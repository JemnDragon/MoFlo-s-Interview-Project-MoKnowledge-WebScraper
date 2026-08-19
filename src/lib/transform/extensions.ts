/**
 * The think-bigger extension fields.
 *
 * These exist because the baseline schema has specific gaps that show up
 * immediately when you try to generate content from it:
 *
 *  - Languages: MoMail cannot decide what language to write in from any baseline
 *    field. Sourced deterministically from lang/hreflang only.
 *  - Demographic Detail: Ideal Persona is prose, so nothing downstream can filter
 *    or segment on it. This is the structured counterpart.
 *  - Values / Social Positioning: values-driven messaging is a distinct voice
 *    input that Writing Style does not capture.
 *  - Testimonials: the only first-party evidence of who the customers actually
 *    are, as opposed to who the company says they are.
 *  - FAQ: reframed from "complaints" — a site never publishes complaints, but the
 *    objections it pre-empts carry the same signal.
 *  - Differentiators: reframed from "competitor signals" — a company's own site is
 *    not a source on its competitors, but it is an excellent source on the claims
 *    it makes against them.
 *  - Certifications: trust signals that belong in MoSocial/MoBlogs copy.
 *  - Current Promotions: a scrape-time SNAPSHOT. One scrape cannot see a pattern
 *    over time, and nothing here pretends otherwise.
 */

import signalFile from "@/data/content-signals.json";
import type { DemographicDetail, DraftExtensions, Snippet } from "@/types/knowledge";
import { collapseWhitespace, dedupe, dedupeBy } from "@/lib/utils/text";
import { mergeLanguageSignals } from "@/lib/parse/language";
import { primaryPageType } from "@/lib/discovery/classify";
import {
  bundle,
  MAX_EXTRACTIVE_SNIPPETS,
  MAX_SYNTHESIS_SNIPPETS,
  snippetsMatching,
  spreadAcrossSources,
} from "./helpers";
import { allSnippets, type TransformContext } from "./context";
import {
  transformCertifications,
  transformFaq,
  transformTestimonials,
} from "./entities";
import { transformContentThemes } from "./themes";

/**
 * Structured demographics come from phrases the site states about who it serves.
 * Each sub-field resolves independently: a site can state an age range and say
 * nothing about income, and the result is one value and two nulls — never three
 * plausible-sounding values.
 */
function demographicDetail(context: TransformContext): DemographicDetail {
  const haystack = context.pages
    .map((page) => page.mainContent ?? "")
    .join(" ")
    .toLowerCase();

  const matchFirst = (phrases: string[]): string | null => {
    const found = phrases.filter((phrase) => haystack.includes(phrase.toLowerCase()));
    return found.length > 0 ? dedupe(found).slice(0, 3).join(", ") : null;
  };

  return {
    ageRange: matchFirst(signalFile.demographics.ageRange),
    incomeBracket: matchFirst(signalFile.demographics.incomeBracket),
    householdType: matchFirst(signalFile.demographics.householdType),
  };
}

/** Promotional language present at scrape time. Snapshot only, by construction. */
function promotionSnippets(context: TransformContext): Snippet[] {
  const fromProse = snippetsMatching(allSnippets(context), signalFile.promotions);

  // Promo banners are frequently headings or list items rather than paragraphs.
  const fromHeadings: Snippet[] = context.pages.flatMap((page) => {
    const source = page.pageTypes[0] ?? "unknown";
    return [...page.headings.map((heading) => heading.text), ...page.listItems]
      .filter((text) =>
        signalFile.promotions.some((phrase) => text.toLowerCase().includes(phrase.toLowerCase())),
      )
      .map((text) => ({ source, sourceUrl: page.url, text: collapseWhitespace(text) }));
  });

  return [...fromProse, ...discountSnippets(context), ...fromHeadings];
}

/**
 * Observed discounts, as promotion evidence.
 *
 * The strikethrough pattern is already detected in the parse layer, because the
 * pricing fix needs it: a product showing $40.00 struck through beside $28.00
 * has to be read as $28.00, and doing that means identifying the pair. Having
 * identified it, throwing it away would waste the single most time-sensitive
 * signal on the site — which is precisely what Current Promotions exists to
 * capture. The site never writes "SALE" in prose; the discount lives entirely in
 * the markup.
 *
 * The sentence is assembled rather than lifted, which is unusual here and worth
 * naming. Both numbers and the product name are observed values reproduced
 * verbatim; only the connective words are ours, and they state exactly what the
 * markup meant. Nothing is inferred about *why* the price dropped, how long it
 * lasts, or whether it is seasonal — that would be the fabrication.
 *
 * Ordered ahead of heading matches so a real discount outranks a banner that
 * merely contains the word "sale".
 */
function discountSnippets(context: TransformContext): Snippet[] {
  const snippets: Snippet[] = [];

  for (const page of context.pages) {
    const source = primaryPageType(page.pageTypes);
    for (const offering of page.candidates.offerings) {
      if (!offering.originalPriceText || !offering.priceText) continue;
      if (offering.originalPriceText === offering.priceText) continue;
      const name = offering.name ?? "This product";
      snippets.push({
        source,
        sourceUrl: page.url,
        text: `${name}: was ${offering.originalPriceText}, now ${offering.priceText}.`,
      });
    }
  }

  return dedupeBy(snippets, (snippet) => snippet.text.toLowerCase()).slice(0, MAX_DISCOUNTS);
}

/** Enough to show a sale is running without burying the reviewer in a catalogue. */
const MAX_DISCOUNTS = 6;

function differentiatorSnippets(context: TransformContext): Snippet[] {
  const fromProse = snippetsMatching(allSnippets(context), signalFile.differentiators);

  const fromLists: Snippet[] = context.pages.flatMap((page) => {
    const source = page.pageTypes[0] ?? "unknown";
    return page.listItems
      .filter((text) =>
        signalFile.differentiators.some((phrase) =>
          text.toLowerCase().includes(phrase.toLowerCase()),
        ),
      )
      .map((text) => ({ source, sourceUrl: page.url, text }));
  });

  return spreadAcrossSources([...fromProse, ...fromLists], MAX_SYNTHESIS_SNIPPETS);
}

export function transformExtensions(context: TransformContext): DraftExtensions {
  return {
    siteLanguage: mergeLanguageSignals(context.pages.map((page) => page.language)),
    demographicDetail: demographicDetail(context),
    valuesAndSocialPositioning: bundle(
      spreadAcrossSources(
        snippetsMatching(allSnippets(context), signalFile.values),
        MAX_SYNTHESIS_SNIPPETS,
      ),
      MAX_SYNTHESIS_SNIPPETS,
    ),
    testimonials: transformTestimonials(context),
    faq: transformFaq(context),
    differentiators: bundle(differentiatorSnippets(context), MAX_SYNTHESIS_SNIPPETS),
    certifications: transformCertifications(context),
    contentThemes: transformContentThemes(context),
    legalAndCompliance: dedupeBy(
      context.pages.flatMap((page) => page.legal),
      (entry) => (entry.text ?? "").slice(0, 120).toLowerCase(),
    ).slice(0, 25),
    currentPromotions: bundle(promotionSnippets(context), MAX_EXTRACTIVE_SNIPPETS + 1),
  };
}
