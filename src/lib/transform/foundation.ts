/**
 * Company Foundation.
 *
 * Almost all of this group is Category 1 — deterministic facts, found or null.
 * Where a value is derived from prose rather than from markup, we store the
 * literal matched phrase ("serving the greater Tacoma area") rather than a tidied
 * interpretation of it, so a reviewer can see exactly what the site said.
 */

import signals from "@/data/content-signals.json";
import type {
  DraftCompanyFoundation,
  LocationEntry,
  OfferingEntry,
  Snippet,
} from "@/types/knowledge";
import { collapseWhitespace, dedupe, isNonEmpty } from "@/lib/utils/text";
import { findJsonLdByType, jsonLdString } from "@/lib/parse/structuredData";
import {
  bundle,
  firstDefined,
  MAX_EXTRACTIVE_SNIPPETS,
  MAX_POSITIONING_SNIPPETS,
  nullIfBlank,
} from "./helpers";
import { orderPositioning, pageSnippets, pagesOfType, type TransformContext } from "./context";

const ORG_TYPES = [
  "Organization",
  "LocalBusiness",
  "Corporation",
  "ProfessionalService",
  "Store",
  "Restaurant",
  "MedicalBusiness",
  "HomeAndConstructionBusiness",
  "LegalService",
  "FinancialService",
  "AutomotiveBusiness",
  "HealthAndBeautyBusiness",
  "FoodEstablishment",
  "EntertainmentBusiness",
  "ChildCare",
  "RealEstateAgent",
];

/**
 * Founding-year patterns.
 *
 * The verb and the year are frequently separated on real sites — "Founder Doug
 * Cohen started his own accounting practice in South Florida in 2003" — so the
 * gap is allowed but bounded, and bounded *within a sentence* (`[^.!?\n]`) so a
 * founding verb in one sentence cannot capture a year from the next.
 *
 * A `YYYY – present` pattern was removed rather than guarded. Its legitimate
 * use — a history timeline — is rare, while its common real-world appearance is
 * a copyright range in a footer, which is not a founding date and is exactly the
 * false positive worth refusing outright.
 */
const YEAR_FOUNDED_PATTERNS = [
  /\b(?:founded|establish(?:ed)?|est\.|incorporated|inception|started|began|launched|opened|in business)\b[^.!?\n]{0,60}?\b((?:18|19|20)\d{2})\b/i,
  /\bsince\s+((?:18|19|20)\d{2})\b/i,
];

/**
 * A year preceded closely by a copyright marker is a copyright year, not a
 * founding year. The window is deliberately short: "Serving Texas since 1941 ·
 * © 2024" must still yield 1941, so only a marker immediately before the year
 * disqualifies it.
 */
const COPYRIGHT_MARKER = /(?:©|\(c\)|copyright|all rights reserved)[^a-z0-9]{0,20}$/i;

/**
 * Where a founding-year candidate came from, and how strong the evidence is.
 *
 * `explicit` — a founding verb near the year ("founded in 1994", "started … in
 * 2003"). `since` — a bare "since YYYY", which is weaker because it is equally
 * often a service claim ("serving Boynton Beach since 2015") rather than a
 * founding date.
 */
export type YearFoundedCandidate = {
  year: number;
  source: "json-ld" | "about" | "homepage";
  strength: "explicit" | "since";
  phrase: string;
};

/** Lower sorts first. Prose outranks JSON-LD — see `pickYearFounded`. */
const YEAR_RANK: Record<string, number> = {
  "about:explicit": 0,
  "homepage:explicit": 1,
  "about:since": 2,
  "homepage:since": 3,
  "json-ld:explicit": 4,
  "json-ld:since": 4,
};

function scanYears(
  haystack: string,
  source: YearFoundedCandidate["source"],
): YearFoundedCandidate[] {
  const thisYear = new Date().getFullYear();
  const out: YearFoundedCandidate[] = [];

  const tiers: [YearFoundedCandidate["strength"], RegExp][] = [
    ["explicit", YEAR_FOUNDED_PATTERNS[0] as RegExp],
    ["since", YEAR_FOUNDED_PATTERNS[1] as RegExp],
  ];

  for (const [strength, pattern] of tiers) {
    const global = new RegExp(pattern.source, "gi");
    let match: RegExpExecArray | null;

    while ((match = global.exec(haystack)) !== null) {
      const captured = match[1];
      if (!captured) continue;
      const year = Number(captured);
      if (year < 1700 || year > thisYear) continue;

      const yearIndex = match.index + match[0].lastIndexOf(captured);
      if (COPYRIGHT_MARKER.test(haystack.slice(Math.max(0, yearIndex - 25), yearIndex))) continue;

      out.push({ year, source, strength, phrase: collapseWhitespace(match[0]).slice(0, 120) });
    }
  }
  return out;
}

/**
 * Every founding-year candidate the site offers, strongest first.
 *
 * Two things this deliberately does NOT do, both of which were bugs:
 *
 *  - **It no longer reads every crawled page.** Only About and homepage copy,
 *    which is what the field's own description always claimed. A year in a blog
 *    post, a services page or vendor legal boilerplate is not a founding date,
 *    and letting those into the corpus is the same page-scoping mistake that put
 *    products into Key People.
 *  - **It no longer lets pattern order beat source quality.** Previously the
 *    explicit-verb pattern was swept across the entire corpus before the "since"
 *    pattern was tried at all, so a weak match on a far page beat a strong one on
 *    the About page. Candidates are now collected from every source and ranked
 *    once.
 */
export function yearFoundedCandidates(context: TransformContext): YearFoundedCandidate[] {
  const candidates: YearFoundedCandidate[] = [];

  const node = findOrganizationNode(context.jsonLd);
  const founding = jsonLdString(node, "foundingDate");
  if (founding) {
    const match = /((?:18|19|20)\d{2})/.exec(founding);
    const year = match?.[1] ? Number(match[1]) : null;
    if (year && year >= 1700 && year <= new Date().getFullYear()) {
      candidates.push({ year, source: "json-ld", strength: "explicit", phrase: founding });
    }
  }

  const textOf = (pages: typeof context.pages) =>
    pages
      .flatMap((page) => [page.mainContent ?? "", ...page.headings.map((h) => h.text)])
      .filter((text) => text.length > 0)
      .join(". ");

  candidates.push(...scanYears(textOf(pagesOfType(context, "about")), "about"));
  candidates.push(
    ...scanYears(textOf(context.homepage ? [context.homepage] : []), "homepage"),
  );

  return candidates.sort(
    (a, b) =>
      (YEAR_RANK[`${a.source}:${a.strength}`] ?? 9) -
      (YEAR_RANK[`${b.source}:${b.strength}`] ?? 9),
  );
}

/**
 * Prose outranks JSON-LD for this field specifically, which is the opposite of
 * how Industry resolves — worth justifying rather than assuming.
 *
 * `foundingDate` on a hosted SMB platform is frequently auto-populated with the
 * *account* creation date rather than the business's founding year, and it
 * arrives as a bare value with no context to sanity-check. "I have run my own
 * practice since 2003" is the business making a claim about itself in a full
 * sentence, on its own About page. When the two disagree, the sentence is the
 * better evidence — and the disagreement is surfaced to the reviewer rather than
 * quietly resolved (see `yearFoundedConflict`).
 */
export function pickYearFounded(candidates: YearFoundedCandidate[]): number | null {
  return candidates[0]?.year ?? null;
}

/** A disagreement worth telling the reviewer about, or null when sources agree. */
export function yearFoundedConflict(
  candidates: YearFoundedCandidate[],
): { chosen: YearFoundedCandidate; rejected: YearFoundedCandidate[] } | null {
  const chosen = candidates[0];
  if (!chosen) return null;
  const rejected = candidates.filter((candidate) => candidate.year !== chosen.year);
  return rejected.length > 0 ? { chosen, rejected } : null;
}

const EMPLOYEE_PATTERNS = [
  /\bteam of (?:over |more than |nearly |about )?(\d{1,5})\b/i,
  /\b(\d{1,5})[+\s-]*(?:employees|staff members|team members|technicians|professionals)\b/i,
];

/**
 * schema.org's business subtypes double as an industry label; that is markup the
 * owner wrote, so it counts as a stated fact. We never guess an industry from
 * page copy — a wrong industry silently mis-targets every downstream campaign.
 */
function industryFromJsonLd(context: TransformContext): string | null {
  const node = findOrganizationNode(context.jsonLd);
  if (!node) return null;

  const explicit = jsonLdString(node, "industry") ?? jsonLdString(node, "knowsAbout");
  if (explicit) return explicit;

  const additional = node["additionalType"];
  if (typeof additional === "string" && additional.trim()) {
    return humanizeType(additional.split("/").pop() ?? additional);
  }

  const rawType = node["@type"];
  const types = (Array.isArray(rawType) ? rawType : [rawType]).filter(
    (value): value is string => typeof value === "string",
  );
  const specific = types.find(
    (type) => !["Organization", "LocalBusiness", "Corporation"].includes(type),
  );
  return specific ? humanizeType(specific) : null;
}

/**
 * schema.org has well over a hundred LocalBusiness subtypes — AccountingService,
 * Plumber, Dentist, Electrician, RoofingContractor and so on. Enumerating them
 * is the same hardcoded-list blind spot as everything else in this file: an
 * accountancy's `AccountingService` node was being skipped entirely, taking
 * Industry, Company Role and Year Founded down with it.
 *
 * So the explicit list is tried first (it is ordered, and order matters for
 * picking the most specific node), then any type whose name looks like a
 * business entity. Both are still schema.org declarations — this widens which
 * declarations are read, not what is inferred from them.
 */
const ORG_TYPE_PATTERN =
  /(?:Business|Service|Store|Shop|Agency|Organization|Corporation|Company|Practice|Clinic|Restaurant|Hotel|School|Contractor|Dentist|Physician|Plumber|Electrician|Attorney|Realtor)$/i;

function findOrganizationNode(
  jsonLd: Record<string, unknown>[],
): Record<string, unknown> | null {
  const explicit = findJsonLdByType(jsonLd, ORG_TYPES);
  if (explicit) return explicit;

  for (const node of jsonLd) {
    const rawType = node["@type"];
    const types = (Array.isArray(rawType) ? rawType : [rawType]).filter(
      (value): value is string => typeof value === "string",
    );
    if (types.some((type) => ORG_TYPE_PATTERN.test(type))) return node;
  }
  return null;
}

const GENERIC_CATEGORIES = new Set<string>(signals.genericOfferingCategories);

/**
 * Tier 2 — roll the offerings' own categories up into an industry.
 *
 * This is the fallback that matters, because the tier above it fails silently on
 * most of the real web: a site with no schema.org Organization node yields
 * nothing, and Shopify, Wix and Squarespace sites frequently have none. Offering
 * categories, by contrast, are written by the business about its own catalogue —
 * a stated fact, not an inference from prose — and when eight offerings are all
 * categorised "Pest Control Service", the industry is not in doubt.
 *
 * Two guards keep it honest:
 *
 *  - **Generic categories are discarded.** "Service" is technically the dominant
 *    category on a lot of sites and tells a downstream app nothing.
 *  - **The winner must recur**, unless it is the only category present. One
 *    stray "Financial Service" among ten pest-control offerings must not become
 *    the industry.
 *
 * The category is stored exactly as the site wrote it. No pluralising, no
 * title-casing — normalising a stated fact is a small way of misquoting it.
 */
function industryFromOfferingCategories(offerings: OfferingEntry[]): string | null {
  const counts = new Map<string, { label: string; count: number }>();

  for (const offering of offerings) {
    const raw = offering.category?.trim();
    if (!raw) continue;
    const key = raw.toLowerCase();
    if (GENERIC_CATEGORIES.has(key)) continue;
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { label: raw, count: 1 });
  }

  if (counts.size === 0) return null;

  const ranked = [...counts.values()].sort((a, b) => b.count - a.count);
  const winner = ranked[0];
  if (!winner) return null;

  const isOnlyCategory = counts.size === 1;
  return winner.count >= 2 || isOnlyCategory ? winner.label : null;
}

/**
 * Tier 3 — declared metadata, then breadcrumbs.
 *
 * Weaker than the tiers above and ordered last on purpose. Both are still
 * *declarations* rather than readings of prose, which is what keeps them
 * admissible at all, but each has a failure mode worth naming:
 *
 *  - **meta keywords** are frequently stuffed with dozens of terms, at which
 *    point the first one means nothing. Only short, curated lists are trusted.
 *  - **breadcrumbs** describe where a page sits in the site, which on a store is
 *    a product collection ("Hoodies") rather than an industry. Only the first
 *    crumb below the root is considered, and only when the trail is shallow.
 */
function industryFromDeclaredMetadata(context: TransformContext): string | null {
  const meta = context.homepage?.structuredData.meta ?? {};
  const keywords = meta["keywords"];
  if (keywords) {
    const terms = keywords
      .split(",")
      .map((term) => collapseWhitespace(term))
      .filter((term) => term.length >= 3 && term.length <= 40);
    // A curated list is a statement; a stuffed one is SEO noise.
    if (terms.length > 0 && terms.length <= 8) return terms[0] ?? null;
  }

  const crumbs = breadcrumbTrail(context);
  if (crumbs.length >= 2 && crumbs.length <= 4) {
    const first = crumbs.find((crumb) => !/^(home|homepage|start)$/i.test(crumb));
    if (first && first.length >= 3 && first.length <= 40) return first;
  }

  return null;
}

function breadcrumbTrail(context: TransformContext): string[] {
  const node = findJsonLdByType(context.jsonLd, ["BreadcrumbList"]);
  const items = node?.["itemListElement"];
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => {
      if (typeof item !== "object" || item === null) return null;
      const record = item as Record<string, unknown>;
      if (typeof record["name"] === "string") return collapseWhitespace(record["name"]);
      const nested = record["item"];
      if (typeof nested === "object" && nested !== null) {
        const name = (nested as Record<string, unknown>)["name"];
        if (typeof name === "string") return collapseWhitespace(name);
      }
      return null;
    })
    .filter((value): value is string => Boolean(value));
}

/**
 * Industry, resolved through a fallback chain rather than a single source.
 *
 * schema.org markup → the offerings' own category rollup → declared metadata.
 * If all three come up empty the field stays `null` — better-exhausted
 * fallbacks, same absent-not-fabricated rule. Nothing here reads page copy and
 * decides the business "sounds like" a bakery.
 */
function industryOf(context: TransformContext, offerings: OfferingEntry[]): string | null {
  return firstDefined(
    industryFromJsonLd(context),
    industryFromOfferingCategories(offerings),
    industryFromDeclaredMetadata(context),
  );
}

function humanizeType(type: string): string {
  return type
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

type RoleSignal = { label: string; phrases: string[] };

/**
 * Tier 2 for Company Role — the business's own description of what kind of
 * operation it is.
 *
 * Same blind spot as Industry had: schema.org alone yields nothing on most real
 * sites. These phrases are self-descriptions ("we manufacture", "full-service",
 * "direct-to-consumer"), so matching them reads a stated fact rather than
 * inferring a role from what the company happens to sell. The first role in
 * priority order wins; an audience qualifier is prefixed when one is also
 * stated, mirroring the reference format.
 */
function companyRoleFromText(context: TransformContext): string | null {
  const haystack = context.pages
    .map((page) => page.mainContent ?? "")
    .join(" ")
    .toLowerCase();

  const roles: RoleSignal[] = signals.companyRoles;
  const audiences: RoleSignal[] = signals.companyRoleAudiences;

  const role = roles.find((candidate) =>
    candidate.phrases.some((phrase) => haystack.includes(phrase)),
  );
  if (!role) return null;

  const matchedAudiences = audiences
    .filter((audience) => audience.phrases.some((phrase) => haystack.includes(phrase)))
    .map((audience) => audience.label);

  return matchedAudiences.length > 0
    ? `${matchedAudiences.join(" and ")} ${role.label}`
    : role.label;
}

/**
 * Tier 3 — structural. A site running a commerce platform is selling directly,
 * which is a fact about the site rather than a reading of its copy.
 */
function companyRoleFromCommerce(context: TransformContext): string | null {
  const vendors = new Set(
    context.pages.flatMap((page) => page.partners.map((partner) => partner.name)),
  );
  const commerce = ["Shopify", "Square", "Toast", "Etsy"];
  return commerce.some((vendor) => vendors.has(vendor)) ? "Retailer" : null;
}

function companyRoleOf(context: TransformContext): string | null {
  return firstDefined(
    companyRoleFromJsonLd(context),
    companyRoleFromText(context),
    companyRoleFromCommerce(context),
  );
}

function companyRoleFromJsonLd(context: TransformContext): string | null {
  const node = findOrganizationNode(context.jsonLd);
  if (!node) return null;
  const rawType = node["@type"];
  const types = (Array.isArray(rawType) ? rawType : [rawType]).filter(
    (value): value is string => typeof value === "string",
  );
  if (types.some((type) => /Store|Retail|ShoppingCenter/i.test(type))) return "Retailer";
  if (types.some((type) => /Restaurant|FoodEstablishment|Bakery|Cafe/i.test(type))) {
    return "Food service operator";
  }
  if (types.some((type) => /Service|Contractor|Agent|Practice|Clinic/i.test(type))) {
    return "Service provider";
  }
  if (types.some((type) => /Manufacturer|Factory/i.test(type))) return "Manufacturer";
  return null;
}

function companyNameOf(context: TransformContext): string | null {
  const node = findOrganizationNode(context.jsonLd);
  const fromJsonLd = jsonLdString(node, "name") ?? jsonLdString(node, "legalName");
  const fromOg = context.homepage?.structuredData.openGraph["og:site_name"];

  // Page titles are usually "Name | Tagline"; the first segment is the name.
  const fromTitle = context.homepage?.title
    ? collapseWhitespace(context.homepage.title.split(/[|–—·-]/)[0] ?? "")
    : null;

  return firstDefined(
    nullIfBlank(fromJsonLd),
    nullIfBlank(fromOg),
    nullIfBlank(fromTitle && fromTitle.length <= 60 ? fromTitle : null),
  );
}

/** Does this name carry a legal-entity suffix? Returns the suffix as written. */
function suffixInName(name: string | null): string | null {
  if (!name) return null;
  const words = name.replace(/[,]/g, " ").split(/\s+/);
  for (const suffix of signals.legalEntitySuffixes) {
    const normalized = suffix.toLowerCase().replace(/\./g, "");
    if (words.some((word) => word.toLowerCase().replace(/\./g, "") === normalized)) {
      return suffix;
    }
  }
  return null;
}

/** A legal name stated in prose: "Account-it Consulting Services, LLC is …". */
const LEGAL_NAME_IN_TEXT =
  /\b[A-Z][\w&.'-]*(?:[\s-]+[A-Z][\w&.'-]*){0,5},?\s+(LLC|L\.L\.C\.|Inc\.?|Incorporated|Corp\.?|Corporation|Ltd\.?|Limited|LLP|LP|PLLC|P\.C\.|GmbH|Pty Ltd)\b/;

/**
 * Legal Entity Type.
 *
 * Previously read only from the resolved company name, which is a narrower
 * version of the same blind spot: the display name is usually the *trading*
 * name. Account IT's reference profile shows exactly this — the company name is
 * "Account IT" while the legal entity "Account-it Consulting Services, LLC"
 * appears only in the alternative names and the body copy. So alternative names
 * are checked next, and a stated legal name in prose last.
 */
function legalEntityTypeFrom(
  companyName: string | null,
  alternativeNames: string[],
  context: TransformContext,
): string | null {
  const fromNames = firstDefined(
    suffixInName(companyName),
    ...alternativeNames.map((name) => suffixInName(name)),
  );
  if (fromNames) return fromNames;

  const prose = context.pages.map((page) => page.mainContent ?? "").join(" ");
  const match = LEGAL_NAME_IN_TEXT.exec(prose);
  return match?.[1] ? match[1] : null;
}

function yearFoundedFrom(context: TransformContext): number | null {
  return pickYearFounded(yearFoundedCandidates(context));
}

function employeeCountFrom(context: TransformContext): string | null {
  const node = findOrganizationNode(context.jsonLd);
  const structured = node?.["numberOfEmployees"];
  if (typeof structured === "number") return String(structured);
  if (typeof structured === "string" && structured.trim()) return collapseWhitespace(structured);
  if (typeof structured === "object" && structured !== null) {
    const value = (structured as Record<string, unknown>)["value"];
    if (typeof value === "number" || typeof value === "string") return String(value);
  }

  const haystack = context.pages.map((page) => page.mainContent ?? "").join(" ");
  for (const pattern of EMPLOYEE_PATTERNS) {
    const match = pattern.exec(haystack);
    if (match?.[0]) return collapseWhitespace(match[0]);
  }
  return null;
}

function addressesOf(context: TransformContext): { main: string | null; others: LocationEntry[] } {
  // Contact pages state the address most reliably; fall back to any page.
  const ordered = [
    ...pagesOfType(context, "contact"),
    ...context.pages.filter((page) => !page.pageTypes.includes("contact")),
  ];
  const all = dedupe(ordered.flatMap((page) => page.contact.addresses));
  const [main, ...rest] = all;
  return {
    main: main ?? null,
    others: rest.slice(0, 8).map((address) => ({ label: null, address })),
  };
}

/** Keeps the sentence the site actually wrote, e.g. "Proudly serving Pierce County". */
function serviceLocationsOf(context: TransformContext): string[] {
  const sentences = context.pages
    .flatMap((page) => (page.mainContent ?? "").split(/(?<=[.!?])\s+/))
    .map(collapseWhitespace)
    .filter((sentence) => sentence.length > 12 && sentence.length < 220);

  const matched = sentences.filter((sentence) => {
    const lower = sentence.toLowerCase();
    return signals.serviceArea.some((signal) => lower.includes(signal.toLowerCase()));
  });

  return dedupe(matched).slice(0, 8);
}

function businessModelOf(context: TransformContext): string | null {
  const haystack = context.pages.map((page) => page.mainContent ?? "").join(" ").toLowerCase();
  const matched = signals.businessModel.filter((phrase) => haystack.includes(phrase.toLowerCase()));
  return matched.length > 0 ? dedupe(matched).slice(0, 3).join(", ") : null;
}

function alternativeNamesOf(context: TransformContext, primary: string | null): string[] {
  const node = findOrganizationNode(context.jsonLd);
  const names: string[] = [];

  const alternate = node?.["alternateName"];
  if (typeof alternate === "string") names.push(collapseWhitespace(alternate));
  if (Array.isArray(alternate)) {
    names.push(...alternate.filter((value): value is string => typeof value === "string"));
  }

  const legal = jsonLdString(node, "legalName");
  if (legal) names.push(legal);

  const siteName = context.homepage?.structuredData.openGraph["og:site_name"];
  if (siteName) names.push(collapseWhitespace(siteName));

  // "doing business as" is an explicit statement of an alternative name.
  const dba = /\b(?:d\/?b\/?a|doing business as)\s+([A-Z][\w&.,' -]{2,60})/i.exec(
    context.pages.map((page) => page.mainContent ?? "").join(" "),
  );
  if (dba?.[1]) names.push(collapseWhitespace(dba[1]));

  return dedupe(names.filter(isNonEmpty)).filter(
    (name) => name.toLowerCase() !== (primary ?? "").toLowerCase(),
  );
}

/**
 * Overview shares one candidate pool with Pitch and orders it its own way:
 * About prose first, the homepage hero slogan last. See `positioningPool`.
 *
 * The §8 homepage fallback is now structural rather than special-cased. There is
 * no "if no About page was found, try the homepage" branch any more, because
 * homepage passages are always in the pool — they simply rank below About prose
 * and only surface when there is little or none. The previous version returned
 * About prose and stopped, which meant a two-line About page starved a required
 * field while a rich homepage sat unread.
 */
function overviewSnippets(context: TransformContext): Snippet[] {
  return orderPositioning(context, "overview");
}

/**
 * @param offerings Already-resolved offerings. Industry rolls their categories up
 *   as its second-tier fallback, so they must be computed before this runs.
 */
export function transformFoundation(
  context: TransformContext,
  offerings: OfferingEntry[],
): DraftCompanyFoundation {
  const companyName = companyNameOf(context);
  const alternativeNames = alternativeNamesOf(context, companyName);
  const { main, others } = addressesOf(context);

  return {
    overview: bundle(overviewSnippets(context), MAX_POSITIONING_SNIPPETS),
    companyName,
    website: context.raw.resolvedUrl,
    industry: industryOf(context, offerings),
    businessModel: businessModelOf(context),
    companyRole: companyRoleOf(context),
    yearFounded: yearFoundedFrom(context),
    legalEntityType: legalEntityTypeFrom(companyName, alternativeNames, context),
    employeeCount: employeeCountFrom(context),
    mainAddress: main,
    otherLocations: others,
    serviceLocations: serviceLocationsOf(context),
    alternativeCompanyNames: alternativeNames,
  };
}
