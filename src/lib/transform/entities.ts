/**
 * Category 3 resolution: Key People, Offerings, Testimonials, FAQ, Certifications.
 *
 * These take the raw per-page candidates and merge them across the crawl. Every
 * sub-field stays independently nullable, and an empty array is a valid final
 * state — a business with no named staff on its website genuinely has no Key
 * People, and saying so is more useful than manufacturing one.
 */

import type {
  CertificationEntry,
  FaqEntry,
  OfferingEntry,
  PersonEntry,
  TestimonialEntry,
} from "@/types/knowledge";
import { dedupeBy } from "@/lib/utils/text";
import { pagesOfType, type TransformContext } from "./context";

/**
 * Gender is resolved ONLY from pronouns the bio itself uses, and only when those
 * pronouns are unambiguous. A bio containing both "he" and "they" resolves to
 * null rather than picking the more frequent one.
 *
 * Labels are `"Male"` / `"Female"` to match the format used by the reference
 * profiles, so the output drops straight into the existing standard.
 *
 * Two deliberate differences from those reference profiles:
 *
 *  - **A name is never evidence.** Several reference entries are people known
 *    only from customer reviews, with gender apparently inferred from the first
 *    name. That is wrong often enough to be harmful, and it is invisible when it
 *    is wrong, so this returns null instead and lets a reviewer fill it in.
 *  - **They/them alone resolves to null, not to a third label.** Singular "they"
 *    is used both by non-binary people and, generically, for someone whose
 *    gender the writer simply didn't state. Reading an identity out of that
 *    ambiguity would be inventing a fact about a real person.
 */
function genderFromPronouns(pronouns: string[]): string | null {
  const set = new Set(pronouns.map((value) => value.toLowerCase()));
  const masculine = ["he", "him", "his"].some((value) => set.has(value));
  const feminine = ["she", "her", "hers"].some((value) => set.has(value));
  const neutral = ["they", "them", "their", "theirs"].some((value) => set.has(value));

  if (masculine && !feminine && !neutral) return "Male";
  if (feminine && !masculine && !neutral) return "Female";
  return null;
}

/** Team pages first: a person listed there is more reliably a key person. */
function orderedPages(context: TransformContext, preferred: Parameters<typeof pagesOfType>[1]) {
  const preferredPages = pagesOfType(context, preferred);
  const rest = context.pages.filter((page) => !preferredPages.includes(page));
  return [...preferredPages, ...rest];
}

/**
 * Key People is read ONLY from pages classified `team` or `about`.
 *
 * Every other Category 3 list falls back to "any fetched page" because a stray
 * testimonial or FAQ on the wrong page is still a real testimonial or FAQ. Key
 * People is different: the person-detection heuristic keys on a heading that
 * looks like a name followed by a short line and a paragraph, and that is
 * *precisely* the shape of a product card. On a merch store, `h3` product titles
 * like "Techno Sword Earrings" are three capitalised words with no digits, so
 * they pass a name test, and the "Regular price $30.00" underneath becomes the
 * bio.
 *
 * The fix is page-type scoping rather than a cleverer name test, for consistency
 * with how the rest of this system decides things: where a field is read from is
 * a structural fact about the site, while whether a phrase sounds like a person
 * is a guess about content. `isOfferingLike` in the parse layer is the second
 * line of defence, for a small business whose About page also lists products.
 *
 * The trade-off, stated plainly: a founder introduced only on the homepage is now
 * missed. That is the correct direction to fail — an absent Key People list is
 * visible in the review UI and one click to add manually, whereas a list of
 * hoodies presented as staff is a fabrication a reviewer might not catch.
 */
export const PEOPLE_PAGE_TYPES = ["team", "about"] as const;

export function transformKeyPeople(context: TransformContext): PersonEntry[] {
  const pages = context.pages.filter((page) =>
    PEOPLE_PAGE_TYPES.some((pageType) => page.pageTypes.includes(pageType)),
  );
  // Team pages first, so a person listed there wins the dedupe over an About mention.
  pages.sort((a, b) => Number(b.pageTypes.includes("team")) - Number(a.pageTypes.includes("team")));

  const people: PersonEntry[] = [];

  for (const page of pages) {
    for (const candidate of page.candidates.people) {
      people.push({
        name: candidate.name,
        title: candidate.title,
        gender: genderFromPronouns(candidate.pronounsFound),
        bio: candidate.bio,
        credentials: candidate.credentials,
        sourceUrl: page.url,
      });
    }
  }

  return dedupeBy(people, (person) =>
    (person.name ?? person.title ?? "").toLowerCase().trim(),
  ).slice(0, 40);
}

export function transformOfferings(context: TransformContext): OfferingEntry[] {
  const pages = orderedPages(context, "services");
  const offerings: OfferingEntry[] = [];

  for (const page of pages) {
    for (const candidate of page.candidates.offerings) {
      offerings.push({
        name: candidate.name,
        category: candidate.category,
        features: candidate.features,
        description: candidate.description,
        pricing: candidate.priceText,
        sourceUrl: page.url,
      });
    }
  }

  return dedupeBy(offerings, (offering) => (offering.name ?? "").toLowerCase().trim()).slice(0, 60);
}

export function transformTestimonials(context: TransformContext): TestimonialEntry[] {
  const pages = orderedPages(context, "testimonials");
  const testimonials: TestimonialEntry[] = [];

  for (const page of pages) {
    for (const candidate of page.candidates.testimonials) {
      testimonials.push({
        quote: candidate.quote,
        attributedTo: candidate.attributedTo,
        // "source" records where the quote was published, which is the site
        // itself unless the markup says otherwise. Review-platform provenance
        // would require an external integration (see Knowledge Enrichment Ideas).
        source: "Company website",
        sourceUrl: page.url,
      });
    }
  }

  return dedupeBy(testimonials, (item) =>
    (item.quote ?? "").slice(0, 120).toLowerCase(),
  ).slice(0, 30);
}

export function transformFaq(context: TransformContext): FaqEntry[] {
  const pages = orderedPages(context, "faq");
  const entries: FaqEntry[] = [];

  for (const page of pages) {
    for (const candidate of page.candidates.faq) {
      entries.push({
        question: candidate.question,
        answer: candidate.answer,
        sourceUrl: page.url,
      });
    }
  }

  return dedupeBy(entries, (entry) => (entry.question ?? "").toLowerCase().trim()).slice(0, 40);
}

export function transformCertifications(context: TransformContext): CertificationEntry[] {
  const entries: CertificationEntry[] = [];

  for (const page of context.pages) {
    for (const candidate of page.candidates.certifications) {
      entries.push({
        name: candidate.name,
        issuer: candidate.issuer,
        year: candidate.year,
        sourceUrl: page.url,
      });
    }
  }

  return dedupeBy(entries, (entry) => (entry.name ?? "").toLowerCase().trim()).slice(0, 25);
}
