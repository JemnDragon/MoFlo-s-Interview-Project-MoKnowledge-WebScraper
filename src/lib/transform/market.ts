/**
 * Market & Customers.
 *
 * Every narrative field here is a synthesis field: its snippets are spread
 * deliberately across page types so that one page's framing does not become the
 * whole answer. A services page describes the buyer very differently from a
 * testimonials page, and both are evidence.
 */

import signalFile from "@/data/content-signals.json";
import type {
  CtaEntry,
  DraftMarketAndCustomers,
  PartnerEntry,
  Snippet,
} from "@/types/knowledge";
import { collapseWhitespace, dedupeBy, hasAlphanumeric, visibleText } from "@/lib/utils/text";
import {
  bundle,
  MAX_SYNTHESIS_SNIPPETS,
  snippetsMatching,
  spreadAcrossSources,
} from "./helpers";
import { allSnippets, pageSnippets, pagesOfType, type TransformContext } from "./context";
import { deriveChannels, deriveFunnels } from "./funnels";

function synthesisBundle(snippets: Snippet[], signals: string[]) {
  const matched = snippetsMatching(snippets, signals);
  return bundle(spreadAcrossSources(matched, MAX_SYNTHESIS_SNIPPETS), MAX_SYNTHESIS_SNIPPETS);
}

/**
 * Ideal Customer Persona draws on target-buyer language, customer-need language
 * AND testimonial text at once. The testimonial contribution is what makes the
 * later actual-vs-stated comparison (prompt 3) meaningful: the same evidence is
 * available to both sides of that question.
 */
function personaSnippets(context: TransformContext): Snippet[] {
  const everything = allSnippets(context);
  const stated = snippetsMatching(everything, [
    ...signalFile.targetBuyers,
    ...signalFile.customerNeeds,
  ]);
  const testimonialVoice = pagesOfType(context, "testimonials").flatMap((page) =>
    page.candidates.testimonials
      .filter((item) => item.quote)
      .map<Snippet>((item) => ({
        source: "testimonials",
        sourceUrl: page.url,
        text: item.quote as string,
      })),
  );
  return spreadAcrossSources([...stated, ...testimonialVoice], MAX_SYNTHESIS_SNIPPETS);
}

/**
 * Industry groupings are taken from the site's own service taxonomy, not
 * invented — a flat list of short category strings, matching how every
 * reference profile writes this field. Plain `string[]`, never an object array:
 * there is no second thing to record about "Roof Repair", and giving it
 * sub-fields would invent an empty-sub-field failure mode that the data itself
 * does not have.
 */
export type IndustryGroupingCandidate = {
  /** Exactly as extracted, before any cleaning. */
  raw: string;
  origin: "schema.org category" | "services heading";
  kept: boolean;
  droppedBecause: "not visible" | "no letters or digits" | "too short" | "too long" | "duplicate" | null;
};

/**
 * Every candidate with its verdict, for `npm run scrape`.
 *
 * Split out from `industryGroupings()` so the diagnostic reports what the real
 * function actually did rather than approximating it — the list below is the
 * single source and `industryGroupings()` is a filter over it. A blank chip in
 * the UI is otherwise indistinguishable between "extracted empty" and "extracted
 * fine, stripped later", and `JSON.stringify` on `raw` makes a zero-width
 * character visible as an escape instead of printing as empty quotes.
 */
export function industryGroupingCandidates(
  context: TransformContext,
): IndustryGroupingCandidate[] {
  const raw: { raw: string; origin: IndustryGroupingCandidate["origin"] }[] = [
    ...context.jsonLd
      .map((node) => node["category"])
      .filter((value): value is string => typeof value === "string")
      .map((value) => ({ raw: value, origin: "schema.org category" as const })),
    ...pagesOfType(context, "services").flatMap((page) =>
      page.headings
        .filter((heading) => heading.level <= 3)
        .map((heading) => ({ raw: heading.text, origin: "services heading" as const })),
    ),
  ];

  const seen = new Set<string>();
  return raw.map(({ raw: value, origin }) => {
    const cleaned = visibleText(value);
    // Ordered so the reported reason is the *first* thing wrong with it, which
    // is what someone reading the log needs.
    const reason: IndustryGroupingCandidate["droppedBecause"] =
      cleaned.length === 0
        ? "not visible"
        : !hasAlphanumeric(cleaned)
          ? "no letters or digits"
          : cleaned.length <= 2
            ? "too short"
            : cleaned.length >= 60
              ? "too long"
              : seen.has(cleaned)
                ? "duplicate"
                : null;
    if (reason === null) seen.add(cleaned);
    return { raw: value, origin, kept: reason === null, droppedBecause: reason };
  });
}

function industryGroupings(context: TransformContext): string[] {
  return industryGroupingCandidates(context)
    .filter((candidate) => candidate.kept)
    .map((candidate) => visibleText(candidate.raw))
    .slice(0, 12);
}

/**
 * Phone numbers and email addresses printed as plain text.
 *
 * The parse layer has always collected these, but nothing consumed them, so on a
 * site that writes "(702) 331-3342" as text rather than as a `tel:` link the
 * number was extracted and then silently dropped. That is a real loss: on a
 * one-page site the phone number is often the *only* conversion path there is.
 *
 * They belong here rather than in a new schema field — a phone number on a
 * business website is a contact channel, which is precisely what this field
 * records. `href` is synthesised so downstream apps can use it, but the label is
 * the literal text found on the page.
 */
function contactChannels(context: TransformContext): CtaEntry[] {
  const channels: CtaEntry[] = [];

  for (const page of context.pages) {
    for (const phone of page.contact.phones) {
      channels.push({
        label: phone,
        href: `tel:${phone.replace(/[^\d+]/g, "")}`,
        kind: "tel",
        sourceUrl: page.url,
      });
    }
    for (const email of page.contact.emails) {
      channels.push({
        label: email,
        href: `mailto:${email}`,
        kind: "mailto",
        sourceUrl: page.url,
      });
    }
  }

  return channels;
}

function partners(context: TransformContext): PartnerEntry[] {
  return dedupeBy(
    context.pages.flatMap((page) => page.partners),
    (partner) => partner.name ?? "",
  );
}

export function transformMarket(context: TransformContext): DraftMarketAndCustomers {
  const everything = allSnippets(context);

  return {
    targetBuyers: synthesisBundle(everything, signalFile.targetBuyers),
    customerNeeds: synthesisBundle(everything, signalFile.customerNeeds),
    idealCustomerPersona: bundle(personaSnippets(context), MAX_SYNTHESIS_SNIPPETS),
    industryGroupings: industryGroupings(context),
    industryOutlook: synthesisBundle(
      // Blog pages first, but via `pageSnippets` like every other field — this
      // line used to map `page.paragraphs` itself, which is exactly how a field
      // ends up missing a fix applied to the shared gathering function.
      [...pagesOfType(context, "blog").flatMap(pageSnippets), ...everything],
      signalFile.industryOutlook,
    ),
    channels: deriveChannels(context),
    funnels: deriveFunnels(context),
    ctas: dedupeBy(
      [...context.pages.flatMap((page) => page.ctas), ...contactChannels(context)],
      (cta) => `${cta.kind}::${(cta.label ?? "").toLowerCase()}`,
    ).slice(0, 30),
    suppliersPartners: partners(context),
  };
}
