/**
 * Key People candidates.
 *
 * Three sources, in descending confidence: schema.org Person nodes, explicit
 * team-card markup, then heading+paragraph pairs on a team page.
 *
 * On gender: we record only the pronouns literally present in the person's own
 * bio text. We never infer gender from a first name or a photo. Name-based
 * inference is wrong often enough to be harmful, and it would be exactly the
 * kind of plausible-sounding fabrication this system is built to avoid. If no
 * pronouns appear, gender stays null and the reviewer can fill it in.
 */

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import signalFile from "@/data/content-signals.json";
import type { RawPersonCandidate } from "@/types/scrape";
import { collapseWhitespace, dedupeBy } from "@/lib/utils/text";

const CREDENTIAL_PATTERN =
  /\b(?:CPA|CFP|CFA|MBA|PhD|Ph\.D\.|MD|M\.D\.|DDS|DVM|RN|LPN|NP|PA-C|Esq\.?|JD|J\.D\.|LEED\s?AP|PMP|LCSW|LMFT|LMT|PE|AIA|RA|CCIE|CISSP|EA)\b/g;

const TITLE_HINTS =
  /\b(owner|founder|co-?founder|president|principal|partner|director|manager|lead|head of|chief|ceo|coo|cfo|cto|cmo|attorney|lawyer|agent|broker|realtor|stylist|technician|therapist|coach|consultant|engineer|designer|chef|instructor|dentist|doctor|nurse|specialist|supervisor|administrator|associate|advisor)\b/i;

const PRONOUN_PATTERN = /\b(he|him|his|she|her|hers|they|them|their|theirs)\b/gi;

/**
 * Commerce markers that identify a block as a product listing rather than a
 * person. Second line of defence behind page-type scoping — see
 * `isOfferingLike` for why both exist.
 */
const OFFERING_SIGNALS: string[] = signalFile.offeringSignals;

/**
 * Would this "person" actually be a product?
 *
 * Two independent tests, both factual rather than interpretive:
 *
 *  1. **The name is already an extracted offering on this page.** The strongest
 *     signal there is — the offering extractor, looking at the same markup with
 *     different rules, concluded this is something the business sells.
 *  2. **The surrounding markup is a commerce block** — "Regular price",
 *     "Add to cart", "Sold out" sitting next to the heading.
 *
 * Deliberately NOT tested: whether the words sound product-ish. "Techno Sword
 * Earrings" reads like merchandise to a human, but a rule that guesses from
 * vocabulary would also throw away real people with unusual names, and it is the
 * content-shape guessing this system avoids everywhere else.
 */
export function isOfferingLike(
  name: string | null,
  nearbyText: string,
  offeringNames: ReadonlySet<string>,
): boolean {
  if (name && offeringNames.has(name.trim().toLowerCase())) return true;
  const haystack = nearbyText.toLowerCase();
  return OFFERING_SIGNALS.some((signal) => haystack.includes(signal));
}

/** A plausible personal name: 2–4 capitalised words, no digits, not a sentence. */
export function looksLikePersonName(value: string): boolean {
  const cleaned = collapseWhitespace(value).replace(/[,.].*$/, "");
  if (cleaned.length < 4 || cleaned.length > 60) return false;
  if (/\d/.test(cleaned)) return false;
  const words = cleaned.split(" ");
  if (words.length < 2 || words.length > 4) return false;
  return words.every((word) => /^[A-Z][A-Za-z'’.-]*$/.test(word));
}

function pronounsIn(text: string | null): string[] {
  if (!text) return [];
  const matches = text.match(PRONOUN_PATTERN) ?? [];
  return Array.from(new Set(matches.map((value) => value.toLowerCase())));
}

function credentialsIn(text: string | null): string[] {
  if (!text) return [];
  const matches = text.match(CREDENTIAL_PATTERN) ?? [];
  return Array.from(new Set(matches.map((value) => value.replace(/\.$/, ""))));
}

function fromJsonLd(jsonLd: Record<string, unknown>[]): RawPersonCandidate[] {
  const people: RawPersonCandidate[] = [];

  const consider = (node: unknown) => {
    if (typeof node !== "object" || node === null) return;
    const record = node as Record<string, unknown>;
    const type = record["@type"];
    const types = Array.isArray(type) ? type : [type];
    if (!types.some((value) => typeof value === "string" && value.toLowerCase() === "person")) {
      return;
    }
    const name = typeof record["name"] === "string" ? collapseWhitespace(record["name"]) : null;
    const title =
      typeof record["jobTitle"] === "string" ? collapseWhitespace(record["jobTitle"]) : null;
    const bio =
      typeof record["description"] === "string"
        ? collapseWhitespace(record["description"])
        : null;
    if (!name && !title) return;
    people.push({
      name,
      title,
      bio,
      pronounsFound: pronounsIn(bio),
      credentials: credentialsIn(`${name ?? ""} ${title ?? ""} ${bio ?? ""}`),
    });
  };

  for (const node of jsonLd) {
    consider(node);
    for (const key of ["employee", "founder", "member", "author"]) {
      const value = node[key];
      if (Array.isArray(value)) value.forEach(consider);
      else consider(value);
    }
  }

  return people;
}

function fromCards(
  $: cheerio.CheerioAPI,
  offeringNames: ReadonlySet<string>,
): RawPersonCandidate[] {
  const people: RawPersonCandidate[] = [];
  const cardSelector = [
    '[class*="team-member" i]',
    '[class*="teammember" i]',
    '[class*="staff-member" i]',
    '[class*="person" i]',
    '[class*="bio-card" i]',
    '[itemtype*="Person" i]',
  ].join(", ");

  $(cardSelector).each((_, el) => {
    const card = $(el);
    const heading = collapseWhitespace(card.find("h1,h2,h3,h4,h5,strong,b").first().text());
    const name = looksLikePersonName(heading) ? heading : null;

    const titleCandidate = collapseWhitespace(
      card.find('[class*="title" i], [class*="role" i], [class*="position" i], em, small').first().text(),
    );
    const title = titleCandidate && titleCandidate !== name ? titleCandidate : null;

    const bio = collapseWhitespace(card.find("p").not('[class*="title" i]').first().text()) || null;

    if (!name && !title) return;
    if (isOfferingLike(name, collapseWhitespace(card.text()), offeringNames)) return;
    people.push({
      name,
      title,
      bio,
      pronounsFound: pronounsIn(bio),
      credentials: credentialsIn(`${name ?? ""} ${title ?? ""} ${bio ?? ""}`),
    });
  });

  return people;
}

function fromHeadings(
  $: cheerio.CheerioAPI,
  offeringNames: ReadonlySet<string>,
): RawPersonCandidate[] {
  const people: RawPersonCandidate[] = [];

  $("h2, h3, h4").each((_, el) => {
    const heading = collapseWhitespace($(el).text());
    if (!looksLikePersonName(heading)) return;

    // A product card is exactly this shape: an h3 title followed by a price. The
    // enclosing block is checked rather than the heading alone, because the
    // commerce markers live in the siblings, not in the title.
    const block = $(el).closest(
      '[class*="card" i], [class*="product" i], [class*="item" i], li, article',
    );
    const context = collapseWhitespace(
      (block.length > 0 ? block : $(el).parent()).text(),
    );
    if (isOfferingLike(heading, context, offeringNames)) return;

    // Walk forward through siblings collecting the first title-ish line and the
    // first real paragraph, stopping at the next heading.
    let title: string | null = null;
    let bio: string | null = null;
    let node: AnyNode | null = $(el).next().get(0) ?? null;
    let hops = 0;

    while (node && hops < 4) {
      const element = $(node);
      const tag = (node as { tagName?: string }).tagName?.toLowerCase();
      if (tag && /^h[1-6]$/.test(tag)) break;
      const text = collapseWhitespace(element.text());
      if (text) {
        if (!title && text.length < 90 && TITLE_HINTS.test(text)) title = text;
        else if (!bio && text.length >= 40) bio = text;
      }
      node = element.next().get(0) ?? null;
      hops += 1;
    }

    if (!title && !bio) return;
    people.push({
      name: heading,
      title,
      bio,
      pronounsFound: pronounsIn(bio),
      credentials: credentialsIn(`${heading} ${title ?? ""} ${bio ?? ""}`),
    });
  });

  return people;
}

/**
 * @param offeringNames Names the offering extractor already claimed on this page,
 *   lower-cased. Anything matching is a product, not a person.
 */
export function extractPeople(
  $: cheerio.CheerioAPI,
  jsonLd: Record<string, unknown>[],
  offeringNames: ReadonlySet<string> = new Set(),
): RawPersonCandidate[] {
  const all = [
    // schema.org Person is an explicit declaration and needs no filtering.
    ...fromJsonLd(jsonLd),
    ...fromCards($, offeringNames),
    ...fromHeadings($, offeringNames),
  ];
  return dedupeBy(all, (person) =>
    (person.name ?? person.title ?? "").toLowerCase().trim(),
  ).slice(0, 30);
}
