/**
 * Dependency-free smoke checks over the pure logic (URL validation, page-type
 * classification, snippet bundling, completeness, validation).
 *
 * Deliberately does not touch cheerio/jsdom, so it runs without a browser or a
 * network. Run with: npx tsx scripts/smoke.ts
 */

import { readFileSync } from "node:fs";
import { validateUrl, canonicalizeUrl, absolutize } from "../src/lib/utils/url";
import {
  normalizeForMatch,
  dedupeBy,
  toParagraphs,
  hasAlphanumeric,
  hasVisibleText,
  visibleText,
} from "../src/lib/utils/text";
import { getAtPath, setAtPath } from "../src/lib/utils/paths";
import { classifyLink } from "../src/lib/discovery/classify";
import {
  isSitemapIndex,
  parseSitemapUrls,
  rankChildSitemaps,
} from "../src/lib/discovery/sitemap";
import {
  PROBED_PAGE_TYPES,
  candidatePathsFor,
  looksLikeSoftFourOhFour,
  probeUrlsFor,
} from "../src/lib/discovery/probePaths";
import { normalizeLangTag, mergeLanguageSignals, languageCodes } from "../src/lib/parse/language";
import { isMockText, isReviewed, mockPlaceholderFor } from "../src/lib/mock/placeholders";
import { looksLikeOptionList, priceIn } from "../src/lib/parse/offerings";
import { bundle, spreadAcrossSources } from "../src/lib/transform/helpers";
import {
  buildContext,
  isSubstantiveSnippet,
  looksTruncated,
  orderPositioning,
  positioningPool,
} from "../src/lib/transform/context";
import { deriveChannels, deriveFunnels } from "../src/lib/transform/funnels";
import { transformBranding } from "../src/lib/transform/branding";
import { transformFoundation } from "../src/lib/transform/foundation";
import { transformPositioning } from "../src/lib/transform/positioning";
import { industryGroupingCandidates, transformMarket } from "../src/lib/transform/market";
import { isUiNoise, normalizeUiLabel, uiNoiseReason } from "../src/lib/parse/uiNoise";
import type { ParsedPage } from "../src/types/scrape";
import { computeCompleteness } from "../src/lib/validate/completeness";
import { draftToFinal } from "../src/lib/validate/draftToFinal";
import {
  isEmptyEntry,
  pruneEmptyEntries,
  pruneStringList,
  subFieldHasContent,
  type PruneReport,
} from "../src/lib/validate/emptyEntries";
import { initialReviewState } from "../src/lib/review/initialize";
import { FIELD_SPECS } from "../src/lib/schema/fields";
import type { KnowledgeBaseDraft, Snippet } from "../src/types/knowledge";

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
  }
}

console.log("\nURL validation");
check("bare domain gets https", validateUrl("example.com").ok);
check("rejects spaces", !validateUrl("exa mple.com").ok);
check("rejects single-label host", !validateUrl("localhost").ok);
check("rejects javascript:", !validateUrl("javascript:alert(1)").ok);
check("rejects empty", !validateUrl("   ").ok);
check("accepts subdomain + path", validateUrl("https://shop.example.co.uk/a/b").ok);
check(
  "canonicalize drops trailing slash",
  canonicalizeUrl("https://a.com/x/") === "https://a.com/x",
  canonicalizeUrl("https://a.com/x/"),
);
check("absolutize resolves relative", absolutize("/about", "https://a.com/x") === "https://a.com/about");
check("absolutize rejects mailto", absolutize("mailto:a@b.com", "https://a.com") === null);

console.log("\nPage-type classification");
check("'Meet the team' → team", classifyLink("Meet the team", "https://a.com/p/8821").includes("team"));
check("URL slug /about-us → about", classifyLink(null, "https://a.com/about-us").includes("about"));
check(
  "'About our team' matches both",
  ["about", "team"].every((t) => classifyLink("About our team", "https://a.com/x").includes(t as never)),
);
check("unrelated link matches nothing", classifyLink("Log in", "https://a.com/login").length === 0);
check("'Our Services' → services", classifyLink("Our Services", "https://a.com/s").includes("services"));
check("normalizeForMatch collapses", normalizeForMatch("  About-Us / Our_Story ") === "about us our story");

console.log("\nSitemap indexes (Shopify / Yoast / Squarespace all serve one)");
const SITEMAP_INDEX = `<?xml version="1.0"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://x.com/sitemap_products_1.xml</loc></sitemap>
  <sitemap><loc>https://x.com/sitemap_pages_1.xml?from=1&amp;to=2</loc></sitemap>
  <sitemap><loc>https://x.com/sitemap_collections_1.xml</loc></sitemap>
  <sitemap><loc>https://x.com/sitemap_blogs_1.xml</loc></sitemap>
</sitemapindex>`;
const SITEMAP_URLSET = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://x.com/about-us</loc></url>
  <url><loc>https://x.com/contact</loc></url>
</urlset>`;
check("index is detected as an index", isSitemapIndex(SITEMAP_INDEX));
check("plain urlset is not", !isSitemapIndex(SITEMAP_URLSET));
check("index children are extracted", parseSitemapUrls(SITEMAP_INDEX).length === 4);
const ranked = rankChildSitemaps(parseSitemapUrls(SITEMAP_INDEX), 3);
check("pages sitemap ranks first", ranked[0]?.includes("pages") === true, ranked);
check("products sitemap is dropped by the cap", !ranked.some((u) => u.includes("products")), ranked);
check("ranking respects the cap", ranked.length === 3);

console.log("\nPath probing (tier 3)");
const aboutPaths = candidatePathsFor("about");
const servicePaths = candidatePathsFor("services");
check("about probes are slug-shaped", aboutPaths.every((p) => /^\/[a-z-]+$/.test(p)), aboutPaths);
check("about probes /about first", aboutPaths[0] === "/about", aboutPaths);
check("service probes reach a catalog path", servicePaths.some((p) => ["/products", "/shop", "/menu", "/collections"].includes(p)), servicePaths);
check("probes are capped at 3", aboutPaths.length <= 3 && servicePaths.length <= 3);
check("probes derive from the keyword file, no duplicates", new Set(aboutPaths).size === aboutPaths.length);
check(
  "only required-field categories are probed",
  PROBED_PAGE_TYPES.length === 2 &&
    PROBED_PAGE_TYPES.includes("about") &&
    PROBED_PAGE_TYPES.includes("services"),
);
check(
  "probe URLs resolve against the site root",
  probeUrlsFor("about", "https://x.com/some/deep/page")[0] === "https://x.com/about",
  probeUrlsFor("about", "https://x.com/some/deep/page"),
);

console.log("\nSoft-404 guard (a 200 that is really the homepage)");
const HOME = "<html><head><title>Purple Potato LV</title></head><body>" + "x".repeat(4000) + "</body></html>";
check("identical body is rejected", looksLikeSoftFourOhFour(HOME, HOME));
check("empty body is rejected", looksLikeSoftFourOhFour("   ", HOME));
check(
  "same title + same size is rejected",
  looksLikeSoftFourOhFour(HOME.replace("xxx", "xyx"), HOME),
);
check(
  "an explicit 404 title is rejected",
  looksLikeSoftFourOhFour("<html><head><title>404 Page Not Found</title></head><body>no</body></html>", HOME),
);
check(
  "a real different page is accepted",
  !looksLikeSoftFourOhFour(
    "<html><head><title>About Us | Purple Potato</title></head><body>" + "y".repeat(900) + "</body></html>",
    HOME,
  ),
);

console.log("\nReviewed-state transitions");
const MOCK = "[Mock placeholder — in production an LLM would synthesise Writing Style…]";
check("untouched placeholder is not reviewed", isReviewed(MOCK, MOCK) === false);
check("edited-but-still-mock text is not reviewed", isReviewed(`${MOCK} extra`, MOCK) === false);
check("real prose is reviewed", isReviewed("Warm and plain-spoken.", MOCK) === true);
// The case that matters: clearing the placeholder is a judgment, not a no-op.
check("clearing the placeholder IS reviewed", isReviewed("", MOCK) === true);
check("whitespace-only after clearing is still reviewed", isReviewed("   ", MOCK) === true);
check("a field that began empty and is still empty is NOT reviewed", isReviewed("", "") === false);
check("a field that began empty and now has prose IS reviewed", isReviewed("Written by hand.", "") === true);

console.log("\nChannels & Funnels derivation (evidence-driven, never from prose)");
const pageStub = (over: Partial<ParsedPage> = {}): ParsedPage => ({
  url: "https://x.test/",
  pageTypes: ["homepage"],
  title: null,
  mainContent: "",
  paragraphs: [],
  headings: [],
  listItems: [],
  structuredData: { jsonLd: [], openGraph: {}, meta: {} },
  brand: { colors: [], fonts: [], logos: [] },
  language: { htmlLang: null, hreflang: [] },
  socialLinks: [],
  ctas: [],
  partners: [],
  legal: [],
  candidates: { people: [], offerings: [], testimonials: [], faq: [], certifications: [] },
  contact: { emails: [], phones: [], addresses: [] },
  ...over,
});
const ctx = (pages: ParsedPage[]) =>
  buildContext({
    requestedUrl: "https://x.test/",
    resolvedUrl: "https://x.test/",
    startedAt: "", finishedAt: "", durationMs: 0, status: "complete",
    discovery: { homepageUrl: "https://x.test/", candidates: [], sitemapFallbackUsed: [], unmatchedPageTypes: [], navLinksUnusable: false },
    pages,
    failedPages: [],
  });

const bare = ctx([pageStub()]);
check("a site with no evidence yields no channels", deriveChannels(bare).length === 0, deriveChannels(bare));
check("…and no funnels", deriveFunnels(bare).length === 0, deriveFunnels(bare));

const rich = ctx([
  pageStub({
    ctas: [
      { label: "Contact form", href: null, kind: "form", sourceUrl: "https://x.test/" },
      { label: "(702) 555-0100", href: "tel:+17025550100", kind: "tel", sourceUrl: "https://x.test/" },
      { label: "Get a free estimate", href: "/quote", kind: "link", sourceUrl: "https://x.test/" },
      { label: "Subscribe to our newsletter", href: null, kind: "form", sourceUrl: "https://x.test/" },
    ],
    contact: { emails: ["a@b.com"], phones: ["(702) 555-0100"], addresses: ["1 Main St, Reno, NV 89501"] },
    socialLinks: [{ platform: "Facebook", url: "https://facebook.com/x" }],
    partners: [{ name: "Calendly", domain: "calendly.com", detectedVia: "scheduling script/embed" }],
    mainContent: "Financing available on all installs.",
    candidates: { people: [], offerings: [], testimonials: [{ quote: "Great work, they were fast and tidy.", attributedTo: "Sam" }], faq: [], certifications: [] },
  }),
  pageStub({ url: "https://x.test/blog", pageTypes: ["blog"] }),
]);
const channels = deriveChannels(rich);
const funnels = deriveFunnels(rich);
check("a tel: link yields the Phone channel", channels.includes("Phone"), channels);
check("a form yields the Online channel", channels.includes("Online (website forms)"), channels);
check("a published address yields the In person channel", channels.includes("In person (physical location)"), channels);
check("a booking vendor yields Online booking", channels.includes("Online booking"), channels);
check("channels are deduped", new Set(channels).size === channels.length);
check("newsletter wording yields Newsletter signup", funnels.includes("Newsletter signup"), funnels);
check("'free estimate' yields Quote / estimate request", funnels.includes("Quote / estimate request"), funnels);
check("a discovered blog page yields Content marketing", funnels.includes("Content marketing (blog)"), funnels);
check("a testimonial yields Testimonials and social proof", funnels.includes("Testimonials and social proof"), funnels);
check("financing prose yields Financing options", funnels.includes("Financing options"), funnels);
// The honesty gate: a blog *mention* is not a blog.
const blogWord = ctx([pageStub({ mainContent: "Read our blog for tips about drainage." })]);
check(
  "merely mentioning a blog does NOT yield Content marketing",
  !deriveFunnels(blogWord).includes("Content marketing (blog)"),
  deriveFunnels(blogWord),
);

console.log("\nPricing extraction (reference profiles are mostly non-currency)");
check("currency wins when present", priceIn("Just $850 per project") === "$850 per project", priceIn("Just $850 per project"));
check("'from $850' keeps its hedge", priceIn("Design from $850") === "from $850", priceIn("Design from $850"));
check("'Per Project' is captured", (priceIn("Pricing: Per Project") ?? "").toLowerCase().startsWith("per project"), priceIn("Pricing: Per Project"));
check("'By Quote/Estimate' is captured", priceIn("Pricing: By Quote/Estimate") !== null, priceIn("Pricing: By Quote/Estimate"));
check("'Included with monitoring service' is captured", (priceIn("Pricing: Included with monitoring service") ?? "").toLowerCase().includes("included with"), priceIn("Pricing: Included with monitoring service"));
check("'Free Inspection' is captured", priceIn("Pricing: Free Inspection — 0") !== null, priceIn("Pricing: Free Inspection — 0"));
check("'Partnership/Reseller Model' is captured", priceIn("Pricing: Partnership/Reseller Model") !== null);
check("prose with no price returns null", priceIn("We drill water wells in the Texas Hill Country.") === null);

console.log("\nLanguage (declaration-only)");
check("normalizes en_us", normalizeLangTag("en_us") === "en-US");
check("rejects garbage", normalizeLangTag("not a lang") === null);
check(
  "merge picks main + alternates",
  JSON.stringify(
    mergeLanguageSignals([
      { htmlLang: "en-US", hreflang: ["es-US", "en-US"] },
      { htmlLang: null, hreflang: ["fr-CA"] },
    ]),
  ) === JSON.stringify({ main: "en-US", alternates: ["es-US", "fr-CA"] }),
);
check(
  "codes dedupe to language part",
  languageCodes({ main: "en-US", alternates: ["en-GB", "es-MX"] }).join(",") === "EN,ES",
);

console.log("\nSnippet bundling");
const snips: Snippet[] = [
  { source: "about", sourceUrl: "u1", text: "a1" },
  { source: "about", sourceUrl: "u1", text: "a2" },
  { source: "homepage", sourceUrl: "u2", text: "h1" },
  { source: "services", sourceUrl: "u3", text: "s1" },
];
check("empty in → absent out", bundle([]).status === "absent");
check("blank text is not content", bundle([{ source: "about", sourceUrl: "u", text: "   " }]).status === "absent");
check("found when text exists", bundle(snips).status === "found");
check(
  "spread hits distinct sources first",
  spreadAcrossSources(snips, 3)
    .map((s) => s.source)
    .join(",") === "about,homepage,services",
  spreadAcrossSources(snips, 3).map((s) => s.source),
);
check("dedupeBy keeps first", dedupeBy([{ k: 1 }, { k: 1 }, { k: 2 }], (x) => String(x.k)).length === 2);
check("toParagraphs splits on blank lines", toParagraphs("one\n\ntwo\n\n\nthree").length === 3);

console.log("\nPath helpers");
const obj = { a: { b: { c: 1 } } };
check("getAtPath deep", getAtPath(obj, "a.b.c") === 1);
check("getAtPath missing → undefined", getAtPath(obj, "a.z.c") === undefined);
const next = setAtPath(obj, "a.b.c", 2);
check("setAtPath is immutable", obj.a.b.c === 1 && getAtPath(next, "a.b.c") === 2);

console.log("\nDraft → final validation");
const emptyDraft: KnowledgeBaseDraft = {
  schemaVersion: 1,
  scan: {
    status: "complete",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:00:10.000Z",
    requestedUrl: "https://a.com",
    resolvedUrl: "https://a.com/",
    pagesFetched: [],
    pagesFailed: [],
    durationMs: 10000,
  },
  companyFoundation: {
    overview: { status: "found", snippets: [{ source: "about", sourceUrl: "u", text: "We do things." }] },
    companyName: "A Co",
    website: "https://a.com/",
    industry: null,
    businessModel: null,
    companyRole: null,
    yearFounded: null,
    legalEntityType: null,
    employeeCount: null,
    mainAddress: null,
    otherLocations: [],
    serviceLocations: [],
    alternativeCompanyNames: [],
  },
  positioning: {
    pitch: { status: "found", snippets: [{ source: "homepage", sourceUrl: "u", text: "Pick us." }] },
    foundingStory: { status: "absent" },
  },
  marketAndCustomers: {
    targetBuyers: { status: "absent" },
    customerNeeds: { status: "absent" },
    idealCustomerPersona: { status: "absent" },
    industryGroupings: [],
    industryOutlook: { status: "absent" },
    channels: [],
    funnels: [],
    ctas: [],
    suppliersPartners: [],
  },
  brandingAndStyle: {
    writingStyle: { status: "absent" },
    artStyle: { status: "absent" },
    fonts: [],
    brandColors: [],
    logos: [],
  },
  onlinePresence: { socialMediaLinks: [] },
  keyPeople: [],
  offerings: [],
  extensions: {
    siteLanguage: { main: null, alternates: [] },
    demographicDetail: { ageRange: null, incomeBracket: null, householdType: null },
    valuesAndSocialPositioning: { status: "absent" },
    testimonials: [],
    faq: [],
    differentiators: { status: "absent" },
    certifications: [],
    contentThemes: [],
    legalAndCompliance: [],
    currentPromotions: { status: "absent" },
  },
  customSections: [],
};

const review = initialReviewState(emptyDraft);
const blocked = draftToFinal(emptyDraft, review);
check("unreviewed placeholders block the save", !blocked.ok);
if (!blocked.ok) {
  const reasons = blocked.problems.map((p) => `${p.fieldPath}:${p.reason}`);
  check(
    "overview blocked as unreviewed placeholder",
    reasons.includes("companyFoundation.overview:unreviewed-placeholder"),
    reasons,
  );
  check("offerings blocked as no-entries", reasons.includes("offerings:no-entries"), reasons);
  check("no generic message", blocked.problems.every((p) => p.message.length > 30));
}

// Now satisfy the three required fields the way a reviewer would.
review.cat2["companyFoundation.overview"] = {
  value: "A Co is a real business that does real things.",
  placeholder: review.cat2["companyFoundation.overview"]!.placeholder,
  reviewed: true,
};
review.cat2["positioning.pitch"] = {
  value: "You get things done properly.",
  placeholder: review.cat2["positioning.pitch"]!.placeholder,
  reviewed: true,
};
const withOffering: KnowledgeBaseDraft = {
  ...emptyDraft,
  offerings: [
    { name: "Thing", category: null, features: [], description: null, pricing: null, sourceUrl: null },
  ],
};
const passing = draftToFinal(withOffering, review);
check("saves once the three required fields are satisfied", passing.ok);
if (passing.ok) {
  check("narrative resolves to a plain string", typeof passing.knowledgeBase.companyFoundation.overview === "string");
  check("optional absent field resolves to null", passing.knowledgeBase.positioning.foundingStory === null);
}

// A reviewed flag must not let mock text through.
const sneaky = structuredClone(review);
sneaky.cat2["companyFoundation.overview"] = {
  value: review.cat2["companyFoundation.overview"]!.placeholder,
  placeholder: review.cat2["companyFoundation.overview"]!.placeholder,
  reviewed: true,
};
check("mock text never saves even if flagged reviewed", !draftToFinal(withOffering, sneaky).ok);

console.log("\nCompleteness");
const completeness = computeCompleteness(emptyDraft);
check("counts every registered field", completeness.counted === FIELD_SPECS.length, {
  counted: completeness.counted,
  specs: FIELD_SPECS.length,
});
check("score is 0-100", completeness.score >= 0 && completeness.score <= 100);
check(
  "absent fields are reported as not-found",
  completeness.missing.every((f) => f.reason === "not-found"),
);
const hidden = computeCompleteness(emptyDraft, { hiddenSections: ["people", "offerings"] });
check("hidden fields leave the denominator", hidden.counted < completeness.counted);
check("hidden fields are reported distinctly", hidden.missing.some((f) => f.reason === "hidden"));
check(
  "hidden required field is flagged as hidden, not missing",
  hidden.missing.some((f) => f.fieldPath === "offerings" && f.reason === "hidden" && f.required),
);

console.log("\nField registry");
check("every path is unique", new Set(FIELD_SPECS.map((s) => s.path)).size === FIELD_SPECS.length);
check(
  "exactly three required fields",
  FIELD_SPECS.filter((s) => s.required).length === 3,
  FIELD_SPECS.filter((s) => s.required).map((s) => s.path),
);
check(
  "every cat3/structured field declares subFields",
  FIELD_SPECS.filter((s) => s.kind === "objectList" || s.kind === "structured").every(
    (s) => (s.subFields?.length ?? 0) > 0,
  ),
);
// Every snippet-evidence Category 2 field needs a display mode; an
// image-evidence one must NOT declare one, because there are no snippets to
// expand or collapse and a stale value would be a lie about what renders.
check(
  "every snippet-based cat2 field declares a snippet display",
  FIELD_SPECS.filter((s) => s.category === 2 && (s.evidence ?? "snippets") === "snippets").every(
    (s) => Boolean(s.snippetDisplay),
  ),
);
check(
  "image-based cat2 fields declare no snippet display",
  FIELD_SPECS.filter((s) => s.evidence === "images").every((s) => s.snippetDisplay === undefined),
);
check(
  "Art Style is the only image-evidence field",
  JSON.stringify(FIELD_SPECS.filter((s) => s.evidence === "images").map((s) => s.path)) ===
    JSON.stringify(["brandingAndStyle.artStyle"]),
);
check(
  "…and it is still Category 2 — the saved value is prose either way",
  FIELD_SPECS.find((s) => s.path === "brandingAndStyle.artStyle")?.category === 2,
);

console.log("\nField descriptions (review-UI disambiguation aids)");
const described = FIELD_SPECS.filter((s) => s.help);
check("descriptions exist but not on every field", described.length > 10 && described.length < FIELD_SPECS.length);
check(
  "each is one short sentence",
  described.every((s) => (s.help ?? "").length <= 100 && !/\.\s+[A-Z]/.test(s.help ?? "")),
  described.filter((s) => (s.help ?? "").length > 100 || /\.\s+[A-Z]/.test(s.help ?? "")).map((s) => s.label),
);
check("none ends in a full stop pile-up or trailing space", described.every((s) => (s.help ?? "").trim() === s.help));
// The pairs a reviewer is most likely to confuse must each carry one.
for (const path of [
  "companyFoundation.overview",
  "positioning.pitch",
  "positioning.foundingStory",
  "marketAndCustomers.targetBuyers",
  "marketAndCustomers.idealCustomerPersona",
  "extensions.demographicDetail",
  "extensions.differentiators",
  "extensions.valuesAndSocialPositioning",
  "extensions.currentPromotions",
]) {
  const spec = FIELD_SPECS.find((s) => s.path === path);
  check(`  ${spec?.label} is described`, Boolean(spec?.help), path);
}
check(
  "Overview and Pitch descriptions contrast with each other",
  /third-person|factual/i.test(FIELD_SPECS.find((s) => s.path === "companyFoundation.overview")?.help ?? "") &&
    /second-person|persuasive/i.test(FIELD_SPECS.find((s) => s.path === "positioning.pitch")?.help ?? ""),
);
check(
  "Current Promotions says it is a snapshot",
  /snapshot/i.test(FIELD_SPECS.find((s) => s.path === "extensions.currentPromotions")?.help ?? ""),
);
check(
  "self-explanatory labels carry no description",
  ["companyFoundation.website", "companyFoundation.industry", "companyFoundation.yearFounded"].every(
    (path) => !FIELD_SPECS.find((s) => s.path === path)?.help,
  ),
);
// Structural: descriptions must not leak into the read-only Detailed view.
const fieldRowSource = readFileSync(
  new URL("../src/components/fields/FieldRow.tsx", import.meta.url),
  "utf8",
);
check(
  "the renderer gates descriptions to edit mode",
  /mode === "edit" && spec\.help/.test(fieldRowSource),
  fieldRowSource.match(/.*spec\.help.*/)?.[0]?.trim(),
);

/* ------------------------------------------------------------------ *
 * Empty list entries
 *
 * The reported symptom was blank Industry Groupings, but the rule is
 * schema-wide, so these checks are written against the shared predicate and the
 * registry rather than against that one field.
 * ------------------------------------------------------------------ */

console.log("\nEmpty list entries");

check("a blank string has no content", !subFieldHasContent(""));
check("whitespace has no content", !subFieldHasContent("   "));
check("null has no content", !subFieldHasContent(null));
check("an empty list has no content", !subFieldHasContent([]));
check("a list of blanks has no content", !subFieldHasContent(["", "  "]));
// 0 is what an untouched numeric input collapses to, and "seen zero times" is
// not a fact. A real number is content even when it stands alone.
check("zero has no content", !subFieldHasContent(0));
check("a real number has content", subFieldHasContent(2019));
check("text has content", subFieldHasContent("Roofing"));

const personSubFields = FIELD_SPECS.find((s) => s.path === "keyPeople")?.subFields ?? [];
check(
  "an all-null person entry is empty",
  isEmptyEntry({ name: null, title: null, gender: null, bio: null, credentials: [] }, personSubFields),
);
check(
  "a person with only a title is NOT empty",
  !isEmptyEntry({ name: null, title: "Office Manager", gender: null, bio: null, credentials: [] }, personSubFields),
);
// The bug that made the naive test useless: provenance is always populated, so
// "every key is null" never fires. sourceUrl is not a content sub-field.
check(
  "an entry carrying only provenance is still empty",
  isEmptyEntry(
    { name: null, title: null, gender: null, bio: null, credentials: [], sourceUrl: "https://x.test/team" },
    personSubFields,
  ),
);
check(
  "an unknown entry shape is empty",
  isEmptyEntry(null, personSubFields) && isEmptyEntry("nope", personSubFields),
);
// Refuses to judge rather than wiping a list it knows nothing about.
check("no sub-field spec means nothing is pruned", !isEmptyEntry({}, []));

check("blank strings are dropped from a string list",
  JSON.stringify(pruneStringList(["Roofing", "", "  ", "Siding"])) === JSON.stringify(["Roofing", "Siding"]));
check("survivors are trimmed", JSON.stringify(pruneStringList([" Roofing "])) === JSON.stringify(["Roofing"]));

// Regression, written to fail against the old code: this is the exact state the
// review UI produces when a reviewer clicks "+ Add" on Industry Groupings and on
// Key People and then saves without typing anything.
const dirtyDraft: KnowledgeBaseDraft = {
  ...emptyDraft,
  marketAndCustomers: {
    ...emptyDraft.marketAndCustomers,
    industryGroupings: ["Roofing", "", "  ", "Gutters"],
    channels: [""],
  },
  keyPeople: [
    { name: "Dana Reyes", title: "Owner", gender: null, bio: null, credentials: [], sourceUrl: "https://x.test/team" },
    { name: null, title: null, gender: null, bio: null, credentials: [], sourceUrl: "https://x.test/team" },
  ],
  offerings: [
    { name: "Roof repair", category: null, features: [], description: null, pricing: null, sourceUrl: "u" },
    { name: null, category: null, features: [], description: null, pricing: null, sourceUrl: "u" },
  ],
};

const pruneReport: PruneReport = [];
const cleaned = pruneEmptyEntries(dirtyDraft, pruneReport);
check(
  "blank groupings are gone and real ones survive",
  JSON.stringify(cleaned.marketAndCustomers.industryGroupings) === JSON.stringify(["Roofing", "Gutters"]),
  cleaned.marketAndCustomers.industryGroupings,
);
check("a string list of only blanks empties out", cleaned.marketAndCustomers.channels.length === 0);
check("the empty person entry is gone", cleaned.keyPeople.length === 1);
check("the real person survives", cleaned.keyPeople[0]?.name === "Dana Reyes");
check("the empty offering is gone", cleaned.offerings.length === 1);
check("the input draft is not mutated", dirtyDraft.keyPeople.length === 2);
check(
  "the report names every field it touched",
  ["marketAndCustomers.industryGroupings", "marketAndCustomers.channels", "keyPeople", "offerings"].every(
    (path) => pruneReport.some((entry) => entry.path === path),
  ),
  pruneReport,
);

// Completeness must not count a list that holds only junk.
const junkOnly = computeCompleteness({
  ...emptyDraft,
  marketAndCustomers: { ...emptyDraft.marketAndCustomers, industryGroupings: ["", "  "] },
});
check(
  "a list of only blanks does not count as populated",
  junkOnly.score === computeCompleteness(emptyDraft).score,
  { junk: junkOnly.score, base: computeCompleteness(emptyDraft).score },
);

/* Structural guards on the two ways this rule could silently stop working. */

// 1. An objectList with no declared sub-fields cannot be judged at all.
check(
  "every objectList field declares its sub-fields",
  FIELD_SPECS.filter((spec) => spec.kind === "objectList").every(
    (spec) => (spec.subFields?.length ?? 0) > 0,
  ),
  FIELD_SPECS.filter((spec) => spec.kind === "objectList" && !spec.subFields?.length).map((s) => s.path),
);

// 2. A constant assigned to a key that IS a content sub-field would make every
//    entry in that list look non-empty forever. `transformTestimonials` sets
//    `source: "Company website"` on every entry, and `source` is in the
//    registry — harmless only because the parser requires a real quote first.
//    If that guard is ever removed, this list becomes unprunable, so pin it.
const testimonialSubFields =
  FIELD_SPECS.find((s) => s.path === "extensions.testimonials")?.subFields ?? [];
check(
  "a testimonial with only the hardcoded source still needs a quote",
  isEmptyEntry({ quote: null, attributedTo: null, source: null }, testimonialSubFields),
);
const testimonialParser = readFileSync(
  new URL("../src/lib/parse/testimonials.ts", import.meta.url),
  "utf8",
);
check(
  "…and the parser still refuses to emit a quoteless testimonial",
  /quote\.length < \d+|body\.trim\(\)\.length === 0/.test(testimonialParser),
);

// 3. The transform must keep running the sweep, or blanks reach the reviewer.
const transformSource = readFileSync(
  new URL("../src/lib/transform/index.ts", import.meta.url),
  "utf8",
);
check("rawToDraft prunes before returning", /return pruneEmptyEntries</.test(transformSource));

/* ------------------------------------------------------------------ *
 * Art Style — a vision task, not a text-extraction gap
 * ------------------------------------------------------------------ */

console.log("\nArt Style (image evidence)");

const brandPage = (over: Partial<ParsedPage["brand"]> = {}, url = "https://x.test/") =>
  pageStub({
    url,
    brand: { colors: [], fonts: [], logos: [], ...over },
    structuredData: {
      jsonLd: [],
      openGraph: {
        "og:image": "https://x.test/social.png",
        "og:image:alt": "Hand-lettered sign above a timber storefront",
      },
      meta: {},
    },
  });

const branded = transformBranding(
  ctx([
    brandPage({
      logos: [
        { url: "https://x.test/favicon.ico", alt: null, detectedVia: "link[rel=icon]" },
        { url: "https://x.test/social.png", alt: "Company logo", detectedVia: "og:image" },
        { url: "https://x.test/header.svg", alt: "Redwood Joinery", detectedVia: "img[logo]" },
      ],
    }),
  ]),
);

check("Art Style is found when an image was located", branded.artStyle.status === "found");
if (branded.artStyle.status === "found") {
  const images = branded.artStyle.images;
  // The field carries pictures, not prose about pictures. This is the whole
  // change: alt text used to be reworded into "Image described as: …" snippets,
  // which described captions while implying the images had been examined.
  check("…and carries image URLs, not snippets", images.every((image) => image.url.startsWith("http")));
  check(
    "…with no snippet-shaped text anywhere in the bundle",
    !JSON.stringify(branded.artStyle).includes("described as"),
  );
  // og:image is what the company chose to represent itself; a favicon is 32px.
  check("the og:image ranks first", images[0]?.detectedVia === "og:image");
  check("the favicon ranks last", images[images.length - 1]?.detectedVia === "link[rel=icon]");
  check(
    "og:image:alt wins over the logo's own alt for the same URL",
    images[0]?.alt === "Hand-lettered sign above a timber storefront",
  );
  check("an image with no alt reports null, never a guess", images.some((image) => image.alt === null));
  check("provenance survives", images.every((image) => image.sourceUrl === "https://x.test/"));
}

// Rule 1 of the brief, applied here: extraction is unchanged and reuses the
// detection the Logos field already had.
check(
  "Logos and Art Style read the same candidate set",
  branded.artStyle.status === "found" &&
    branded.artStyle.images.every((image) =>
      branded.logos.some((logo) => logo.url === image.url),
    ),
);

// Same honesty rule as every other field — just "no image" instead of "no text".
const unbranded = transformBranding(ctx([pageStub({ url: "https://y.test/" })]));
check("Art Style is absent when no image was found", unbranded.artStyle.status === "absent");
check("…and absent means absent, not an empty found-bundle", !("images" in unbranded.artStyle));

/* The placeholder must not claim a text synthesis that cannot happen. */

const artPlaceholder = mockPlaceholderFor("brandingAndStyle.artStyle", branded.artStyle);
const writingPlaceholder = mockPlaceholderFor("brandingAndStyle.writingStyle", {
  status: "found",
  snippets: [{ source: "about", sourceUrl: "https://x.test/about", text: "We build by hand." }],
});

check("the Art Style placeholder is still labelled as mock", isMockText(artPlaceholder));
check(
  "…but does NOT claim an LLM would synthesise it from snippets",
  !/synthesise .* from the \d+ source snippet/.test(artPlaceholder),
  artPlaceholder,
);
check(
  "…and the generic wording is still used for the other fields",
  /synthesise .* from the \d+ source snippet/.test(writingPlaceholder),
);
check(
  "…it names the different infrastructure required",
  /vision-capable/i.test(artPlaceholder) && /prompts\/04-art-style-vision\.md/.test(artPlaceholder),
);
check(
  "…and says the scraper cannot see, only locate",
  /locate/i.test(artPlaceholder) && /looking at/i.test(artPlaceholder),
);
check(
  "an absent Art Style still pre-fills nothing at all",
  mockPlaceholderFor("brandingAndStyle.artStyle", unbranded.artStyle) === "",
);
// The branch is on the value's shape, not on a hardcoded field path — so a
// second image-evidence field would work without touching the placeholder code.
const placeholderSource = readFileSync(
  new URL("../src/lib/mock/placeholders.ts", import.meta.url),
  "utf8",
);
check(
  "the placeholder branches on evidence shape, not on a field path",
  /"images" in field/.test(placeholderSource) &&
    !/brandingAndStyle\.artStyle/.test(placeholderSource),
);

/* The saved value is still prose, so nothing downstream needs a special case. */

const artDraft: KnowledgeBaseDraft = {
  ...emptyDraft,
  brandingAndStyle: { ...emptyDraft.brandingAndStyle, artStyle: branded.artStyle },
};
const artReview = initialReviewState(artDraft);
for (const p of ["companyFoundation.overview", "positioning.pitch"]) {
  const editor = artReview.cat2[p];
  if (editor) artReview.cat2[p] = { ...editor, value: `Reviewed ${p}.`, reviewed: true };
}
const artEditor = artReview.cat2["brandingAndStyle.artStyle"];
if (artEditor) {
  artReview.cat2["brandingAndStyle.artStyle"] = {
    ...artEditor,
    value: "Warm timber tones, hand-lettered wordmark, generous whitespace.",
    reviewed: true,
  };
}
const artSaved = draftToFinal(
  { ...artDraft, offerings: [{ name: "Joinery", category: null, features: [], description: null, pricing: null, sourceUrl: null }] },
  artReview,
);
check("an image-evidence field saves as a plain string", artSaved.ok &&
  artSaved.knowledgeBase.brandingAndStyle.artStyle ===
    "Warm timber tones, hand-lettered wordmark, generous whitespace.");
check(
  "an untouched Art Style placeholder never saves",
  (() => {
    const untouched = initialReviewState(artDraft);
    for (const p of ["companyFoundation.overview", "positioning.pitch"]) {
      const editor = untouched.cat2[p];
      if (editor) untouched.cat2[p] = { ...editor, value: `Reviewed ${p}.`, reviewed: true };
    }
    const result = draftToFinal(
      { ...artDraft, offerings: [{ name: "Joinery", category: null, features: [], description: null, pricing: null, sourceUrl: null }] },
      untouched,
    );
    return result.ok && result.knowledgeBase.brandingAndStyle.artStyle === null;
  })(),
);
check(
  "completeness counts an image bundle as populated",
  computeCompleteness(artDraft).populated === computeCompleteness(emptyDraft).populated + 1,
);

/* ------------------------------------------------------------------ *
 * Invisible-but-not-whitespace characters
 *
 * The root cause of the blank rows that survived the first empty-entry sweep.
 * `String.trim()` and `\s` share a definition of whitespace that excludes
 * zero-width characters, so three zero-width spaces measure as three characters
 * of content and render as nothing.
 * ------------------------------------------------------------------ */

console.log("\nVisibly-empty text");

const ZWSP = "​";
const ZWNJ = "‌";
const SOFT_HYPHEN = "­";
const WORD_JOINER = "⁠";
const BOM = "﻿";

// The bug, stated as a test: the old condition passes on all of these.
check(
  "the old trim() test would have kept every one of these",
  [ZWSP.repeat(3), SOFT_HYPHEN.repeat(3), WORD_JOINER.repeat(3), `${ZWNJ} ${ZWNJ}`].every(
    (value) => value.trim().length > 0,
  ),
);
check(
  "…and the new test rejects all of them",
  [ZWSP.repeat(3), SOFT_HYPHEN.repeat(3), WORD_JOINER.repeat(3), `${ZWNJ} ${ZWNJ}`, BOM, "", "   "].every(
    (value) => !hasVisibleText(value),
  ),
);
check("real text is still visible", hasVisibleText("Roofing"));
check("text padded with zero-width characters is visible", hasVisibleText(`${ZWSP}Roofing${ZWSP}`));
check(
  "…and normalises to the clean string, so it dedupes against a clean copy",
  visibleText(`${ZWSP}Roofing${ZWSP}`) === "Roofing",
);
check("hasAlphanumeric rejects a decorative divider", !hasAlphanumeric("———") && !hasAlphanumeric("•••"));
check("…and accepts a colour hex, which is punctuation-led but real", hasAlphanumeric("#fff"));

// The shared prune must use the visible test, not trim.
check(
  "a zero-width-only string list entry is pruned",
  JSON.stringify(pruneStringList(["Roofing", ZWSP.repeat(3), SOFT_HYPHEN])) ===
    JSON.stringify(["Roofing"]),
);
check(
  "a Category 3 entry whose only content is zero-width is empty",
  isEmptyEntry(
    { name: ZWSP.repeat(4), title: null, gender: null, bio: null, credentials: [] },
    FIELD_SPECS.find((s) => s.path === "keyPeople")?.subFields ?? [],
  ),
);

/* ------------------------------------------------------------------ *
 * UI chrome exclusion
 * ------------------------------------------------------------------ */

console.log("\nUI-utility phrase exclusion");

// Verbatim from a real slimestory.com fetch. These are the strings that reached
// CTAs and Pitch snippets on that scan.
const SLIMESTORY_CHROME = [
  "Skip to content",
  "Close",
  "Menu",
  "Search",
  "Cart 0",
  "Log in",
  "Register",
  "Your cart is empty",
  "Continue shopping",
  "Country/region",
  "SOLD OUT",
];
for (const label of SLIMESTORY_CHROME) {
  check(`  "${label}" is excluded`, isUiNoise(label), uiNoiseReason(label));
}

// …and the real calls to action on the same page must survive. This is the half
// that matters: a noise list that also eats "Shop All" is worse than the noise.
const SLIMESTORY_REAL = [
  "Learn More",
  "Shop All",
  "Shop Collection",
  "Notify Me!",
  "Sweet Snail Slime Plush",
  "Slimecyclopedia",
  "Contact",
  "Newsletter",
];
for (const label of SLIMESTORY_REAL) {
  check(`  "${label}" survives`, !isUiNoise(label), uiNoiseReason(label));
}

// Counter variants are one control, not three.
check("cart counters normalise onto one entry", ["Cart 0", "Cart (0)", "Cart 12"].every(isUiNoise));
check("normalisation strips the counter", normalizeUiLabel("Cart (3)") === "cart");
check("…and punctuation", normalizeUiLabel("Notify Me!") === "notify me");
check("decorative dividers are excluded as chrome too", isUiNoise("———") && isUiNoise("•••"));
check("zero-width-only labels are excluded", isUiNoise(ZWSP.repeat(3)));
check("the reason is reported, for the CLI diagnostic", uiNoiseReason("Skip to content") === "exact-match");
check("…and distinguishes a banner from a button", uiNoiseReason("Your cart is empty") === "banner-phrase");
check("…and a divider from both", uiNoiseReason("———") === "no-letters");
check("a real label reports no reason", uiNoiseReason("Book a free estimate") === null);

// Structural: the exclusion must run centrally, not only in the CTA parser.
const parsePageSource = readFileSync(
  new URL("../src/lib/parse/parsePage.ts", import.meta.url),
  "utf8",
);
check(
  "parsePage filters headings, list items and paragraphs",
  /isUiNoise\(text\)/.test(parsePageSource) &&
    (parsePageSource.match(/withoutUiNoise\(/g) ?? []).length >= 2,
);
check(
  "…so the exclusion is not CTA-only",
  /withoutUiNoise\(main\.paragraphs/.test(parsePageSource),
);

// The list is data, and stays reviewable as data.
const noiseData = JSON.parse(
  readFileSync(new URL("../src/data/ui-noise.json", import.meta.url), "utf8"),
) as { exact: string[]; contains: string[] };
check("the list lives in src/data, like page-type-keywords.json", noiseData.exact.length > 40);
check(
  "every entry is already normalised, so a lookup can never silently miss",
  noiseData.exact.every((entry) => normalizeUiLabel(entry) === entry),
  noiseData.exact.filter((entry) => normalizeUiLabel(entry) !== entry),
);
check("no duplicates", new Set(noiseData.exact).size === noiseData.exact.length);
check(
  "the substring list stays small — it is the one that can eat real copy",
  noiseData.contains.length <= 25,
);

/* ------------------------------------------------------------------ *
 * Industry Groupings — the traced path, end to end
 * ------------------------------------------------------------------ */

console.log("\nIndustry Groupings extraction trace");

const groupingsContext = ctx([
  pageStub({
    url: "https://x.test/services",
    pageTypes: ["services"],
    headings: [
      { level: 2, text: "Roof Repair" },
      { level: 2, text: ZWSP.repeat(3) },
      { level: 2, text: "———" },
      { level: 3, text: `${ZWSP}Gutter Cleaning${ZWSP}` },
      { level: 2, text: "Roof Repair" },
    ],
  }),
]);
const groupingCandidates = industryGroupingCandidates(groupingsContext);
check("every raw candidate is reported, kept or not", groupingCandidates.length === 5);
check(
  "the zero-width heading is reported as not visible",
  groupingCandidates.find((c) => c.raw === ZWSP.repeat(3))?.droppedBecause === "not visible",
);
check(
  "the divider is reported separately, as having no letters",
  groupingCandidates.find((c) => c.raw === "———")?.droppedBecause === "no letters or digits",
);
check(
  "the duplicate is reported as a duplicate, not silently merged",
  groupingCandidates.filter((c) => c.droppedBecause === "duplicate").length === 1,
);
check(
  "the raw value is preserved verbatim for the log",
  groupingCandidates.some((c) => c.raw.includes(ZWSP) && c.kept),
);

const groupings = transformMarket(groupingsContext).industryGroupings;
check(
  "the field itself holds only the two real categories",
  JSON.stringify(groupings) === JSON.stringify(["Roof Repair", "Gutter Cleaning"]),
  groupings,
);
check("…with zero-width padding stripped from the survivor", groupings[1] === "Gutter Cleaning");
check("…and it is a flat string[], not an object array", groupings.every((g) => typeof g === "string"));
check(
  "the registry agrees it is a flat list",
  FIELD_SPECS.find((s) => s.path === "marketAndCustomers.industryGroupings")?.kind === "stringList",
);
// The trace question, answered as an assertion: the shared prune does reach it.
const groupingPrune: PruneReport = [];
pruneEmptyEntries(
  { marketAndCustomers: { industryGroupings: ["Real", ZWSP.repeat(2)] } },
  groupingPrune,
);
check(
  "pruneEmptyEntries does run on this field's path",
  groupingPrune.some((entry) => entry.path === "marketAndCustomers.industryGroupings"),
  groupingPrune,
);

/* ------------------------------------------------------------------ *
 * Snippet gathering — one path, shared by every Category 2 field
 * ------------------------------------------------------------------ */

console.log("\nSnippet substance and truncation");

// The bug: Readability pulls `li` as paragraphs, so a themed nav gave Overview
// and Pitch a snippet reading, in full, "Shop".
check("a one-word nav label is not a passage", !isSubstantiveSnippet("Shop"));
check("…nor is 'Ocean' or 'Biomes'", !isSubstantiveSnippet("Ocean") && !isSubstantiveSnippet("Biomes"));
check("…nor 'Shop All', which is a button", !isSubstantiveSnippet("Shop All"));
// The floor is structural, not a quality bar. Short real copy still passes.
check("'Free shipping' is a passage", isSubstantiveSnippet("Free shipping"));
check("a hero heading is a passage", isSubstantiveSnippet("MEET THE PICNIC PALS"));
check("a plain sentence is a passage", isSubstantiveSnippet("We fix roofs."));
check("zero-width padding does not inflate the count", !isSubstantiveSnippet(`Shop${ZWSP.repeat(20)}`));

// Verbatim from slimestory.com's meta description — truncated mid-word by the
// site, not by us.
const SLIMESTORY_META =
  "Discover Slime Story, the official store by Slimecicle! Explore the Picnic Pal collection, featuring four unique slimes. They're soft, weird, cuddly, and ful...";
check("a self-truncated meta description is detected", looksTruncated(SLIMESTORY_META));
check("…and a complete sentence is not", !looksTruncated("We build handmade furniture in Leeds."));
check(
  "…a stylistic ellipsis mid-length is still treated as truncated, conservatively",
  looksTruncated("And then…"),
);
check(
  "a long complete sentence ending in a full stop is not truncated",
  !looksTruncated(`${"Slime Story makes collectible plush toys for people who like weird soft things. ".repeat(3)}`.trim()),
);

// Overview and Pitch must both order it the same way, from the same function.
const truncatedContext = ctx([
  pageStub({
    url: "https://slime.test/",
    pageTypes: ["homepage"],
    paragraphs: [
      "Shop",
      "Slime Story makes collectible plush based on the creatures of five biomes.",
    ],
    headings: [{ level: 1, text: "MEET THE PICNIC PALS" }],
    structuredData: {
      jsonLd: [],
      openGraph: { "og:description": SLIMESTORY_META },
      meta: {},
    },
  }),
]);
const truncatedOverview = transformFoundation(truncatedContext, []).overview;
const truncatedPitch = transformPositioning(truncatedContext).pitch;

for (const [label, field] of [
  ["Overview", truncatedOverview],
  ["Pitch", truncatedPitch],
] as const) {
  check(`  ${label} drops the one-word "Shop" snippet`,
    field.status === "found" && field.snippets.every((s) => s.text !== "Shop"),
    field.status === "found" ? field.snippets.map((s) => s.text) : field.status);
  check(`  ${label} keeps the real paragraph`,
    field.status === "found" && field.snippets.some((s) => s.text.startsWith("Slime Story makes")));
  check(`  ${label} demotes the truncated description below real prose`,
    field.status === "found" &&
      field.snippets.length > 0 &&
      field.snippets[0]?.text !== SLIMESTORY_META,
    field.status === "found" ? field.snippets[0]?.text : field.status);
  check(`  ${label} still keeps it — it is the site's own words`,
    field.status === "found" && field.snippets.some((s) => s.text === SLIMESTORY_META));
}

// A *complete* description should still lead, or the ranking is just "always last".
const completeContext = ctx([
  pageStub({
    url: "https://good.test/",
    paragraphs: ["We have been fitting kitchens in Leeds since 1998."],
    structuredData: {
      jsonLd: [],
      openGraph: { "og:description": "Handmade fitted kitchens, made in Leeds." },
      meta: {},
    },
  }),
]);
check(
  "a complete declared description still leads",
  transformFoundation(completeContext, []).overview.status === "found" &&
    (transformFoundation(completeContext, []).overview as { snippets: Snippet[] }).snippets[0]
      ?.text === "Handmade fitted kitchens, made in Leeds.",
);

// The structural point: no field may keep its own copy of snippet gathering.
for (const moduleName of [
  "foundation",
  "positioning",
  "market",
  "branding",
  "extensions",
]) {
  // Comments stripped first: this guard is about what the code does, and the
  // comments explaining *why* the direct read was removed necessarily name it.
  const source = readFileSync(
    new URL(`../src/lib/transform/${moduleName}.ts`, import.meta.url),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  check(
    `  transform/${moduleName}.ts does not read .paragraphs directly`,
    !/\.paragraphs\b/.test(source),
    source.match(/.*\.paragraphs.*/)?.[0]?.trim(),
  );
}

/* ------------------------------------------------------------------ *
 * Offerings — sale pricing and dropdown leakage
 * ------------------------------------------------------------------ */

console.log("\nOffering pricing (discounts)");

// The failure, as a unit: concatenated text loses the distinction entirely.
check(
  "flat text still returns the first price — which is why markup is needed",
  priceIn("$40.00$28.00") === "$40.00",
);

check("looksLikeOptionList flags a country picker", looksLikeOptionList(
  ["Afghanistan (AFN ؋)", "Åland Islands (EUR €)", "Albania (ALL L)", "Algeria (DZD د.ج)", "Andorra (EUR €)"],
));
check("…and a merely long list", looksLikeOptionList(Array.from({ length: 30 }, (_, i) => `Item ${i}`)));
check("…but not a normal feature list", !looksLikeOptionList([
  "Free delivery",
  "Two-year warranty",
  "Fitted in a day",
]));
check("…nor one bullet that happens to mention a currency", !looksLikeOptionList([
  "Pricing shown in dollars (USD)",
  "Free delivery",
  "Two-year warranty",
  "Fitted in a day",
]));

/* ------------------------------------------------------------------ *
 * Writing Style on a site with no prose
 * ------------------------------------------------------------------ */

console.log("\nWriting Style sourcing (storefront with no About prose)");

// Verbatim from a fetch of slimestory.com. The h1s really are split across
// separate elements — the theme breaks the line — which is why "MEET THE" is
// eight characters and why a paragraph-length floor cannot apply to headings.
// Order matters here: the single-word "OCEAN" is deliberately first, so the
// two-word floor has to be doing the work rather than the four-heading cap
// happening to push it out of range.
const SLIME_H1 = ["OCEAN", "MEET THE", "PICNIC PALS", "TRAVERSE THE", "WETLANDS", "DIVE INTO THE"];
const SLIME_H2 = ["Sweet Snail Slime Plush", "Radalotl Slime Plush", "Fruitbat Slime Plush"];
const SLIME_H3 = ['12" tall', '11.5" long', '14.5" wide'];

const storefront = ctx([
  pageStub({
    url: "https://slimestory.test/",
    pageTypes: ["homepage"],
    // No narrative paragraphs at all. This is the whole point of the fixture.
    paragraphs: [],
    headings: [
      ...SLIME_H1.map((text) => ({ level: 1, text })),
      ...SLIME_H2.map((text) => ({ level: 2, text })),
      ...SLIME_H3.map((text) => ({ level: 3, text })),
    ],
    structuredData: {
      jsonLd: [],
      openGraph: { "og:description": SLIMESTORY_META },
      meta: {},
    },
    ctas: [{ label: "Notify Me!", href: null, kind: "form", sourceUrl: "https://slimestory.test/" }],
    candidates: {
      people: [],
      offerings: [
        { name: "Sweet Snail Slime Plush", description: null, features: [], priceText: "$28.00", originalPriceText: "$40.00", category: null },
      ],
      testimonials: [],
      faq: [],
      certifications: [],
    },
  }),
]);

const voice = transformBranding(storefront).writingStyle;
check("Writing Style is found on a site with no paragraphs", voice.status === "found", voice);

if (voice.status === "found") {
  const texts = voice.snippets.map((s) => s.text);

  // The reported failure: the field was falling through to whatever short text
  // survived instead of the section headers carrying the voice.
  check("…and bundles the section headers", texts.some((t) => SLIME_H1.includes(t)), texts);
  check(
    "…including one that is only eight characters",
    texts.includes("MEET THE"),
    texts,
  );
  check("…and the declared description, as a first-class source", texts.includes(SLIMESTORY_META));
  check(
    "…with no single-word nav-shaped label",
    texts.every((t) => t.trim().split(/\s+/).length >= 2),
    texts,
  );
  // h3 here is product spec text. Ranking by level pushes it out without a rule
  // about what a measurement looks like.
  check("…and no product spec text from h3", !texts.some((t) => SLIME_H3.includes(t)), texts);
  // One kind of text must not fill the bundle.
  check(
    "…mixing kinds rather than taking six headings",
    new Set(texts.map((t) => (t === SLIMESTORY_META ? "declared" : SLIME_H1.includes(t) || SLIME_H2.includes(t) ? "heading" : "naming"))).size >= 2,
    texts,
  );
  check("…and nothing repeats", new Set(texts).size === texts.length);
}

// A site WITH prose must be unchanged — the new tiers are additive, not a
// replacement, and a service business's paragraphs still lead.
const proseSite = ctx([
  pageStub({
    url: "https://kitchens.test/",
    pageTypes: ["homepage"],
    paragraphs: [
      "We have been fitting kitchens across Leeds for twenty-two years, one at a time, by hand.",
      "Every carcass is built in our own workshop from birch ply, never chipboard.",
    ],
    headings: [{ level: 1, text: "Handmade Kitchens" }],
    structuredData: { jsonLd: [], openGraph: {}, meta: {} },
  }),
]);
const proseVoice = transformBranding(proseSite).writingStyle;
check(
  "a site with real copy still leads with its paragraphs",
  proseVoice.status === "found" &&
    proseVoice.snippets[0]?.text.startsWith("We have been fitting") === true,
  proseVoice.status === "found" ? proseVoice.snippets.map((s) => s.text) : proseVoice.status,
);
check(
  "…and does not fall back to product naming",
  proseVoice.status === "found" && proseVoice.snippets.every((s) => s.text !== "Notify Me!"),
);

// Nothing anywhere: still honestly absent.
check(
  "a site with no text at all leaves Writing Style absent",
  transformBranding(ctx([pageStub({ url: "https://bare.test/" })])).writingStyle.status === "absent",
);

/* ------------------------------------------------------------------ *
 * Prompt 1 must obey its own rule
 *
 * A worked example that breaks the constraint it is illustrating teaches the
 * constraint is optional — few-shot examples outweigh instructions. So the
 * examples are checked against the cap the prompt states.
 * ------------------------------------------------------------------ */

console.log("\nPrompt 1 (Writing Style) self-consistency");

const promptOne = readFileSync(
  new URL("../prompts/01-writing-style.md", import.meta.url),
  "utf8",
);

check("the prompt states a hard word cap", /60[–-]90 words/.test(promptOne));
check("…and a sentence cap", /at most four sentences/.test(promptOne));
check("…and asks for 2–3 dimensions, not all four", /2[–-]3 dimensions/.test(promptOne));
check("…and requires every claim to be anchored", /Anchor every claim/.test(promptOne));
check(
  "…naming the generic descriptors that need backing",
  ["professional", "friendly", "approachable"].every((word) =>
    new RegExp(`"${word}"`).test(promptOne),
  ),
);

const exampleOutputs = [...promptOne.matchAll(/"writingStyle": "((?:[^"\\]|\\.)*)"/g)]
  .map((match) => JSON.parse(`"${match[1]}"`) as string)
  // The output-format stub at the end of the file is a schema, not an example.
  .filter((text) => text !== "string | null");

check("both worked examples were found", exampleOutputs.length === 2, exampleOutputs.length);

for (const [index, text] of exampleOutputs.entries()) {
  const words = text.split(/\s+/).filter(Boolean).length;
  const sentences = text.split(/(?<=[.!?])\s+/).filter((part) => part.trim().length > 0).length;
  check(`  example ${index + 1} is within 60–90 words`, words >= 60 && words <= 90, words);
  check(`  example ${index + 1} is at most four sentences`, sentences <= 4, sentences);
  // Anchoring: an example that asserts a voice without quoting the text is not
  // modelling the standard, whatever the prose around it claims.
  check(`  example ${index + 1} quotes the source text`, (text.match(/"/g) ?? []).length >= 4, text);
}

// The null rule must not contradict the transform layer. Writing Style now
// bundles headings and product names for a storefront with no prose; a prompt
// that returns null on "fewer than two or three sentences" would throw that away.
check(
  "the null rule is about phrasing choices, not sentence count",
  /no phrasing choices/.test(promptOne) && !/two or three sentences of connected writing/.test(promptOne),
);

/* ------------------------------------------------------------------ *
 * Overview and Pitch draw from one pool
 * ------------------------------------------------------------------ */

console.log("\nOverview / Pitch shared pool");

const ABOUT_LINE = "Slime Story is an independent studio founded by the streamer Slimecicle.";
const HOME_LINE = "Slime Story makes collectible plush based on the creatures of five biomes.";
const HERO = "MEET THE PICNIC PALS";

const bothSources = ctx([
  pageStub({
    url: "https://both.test/",
    pageTypes: ["homepage"],
    paragraphs: [HOME_LINE],
    headings: [{ level: 1, text: HERO }],
    structuredData: {
      jsonLd: [],
      openGraph: { "og:description": "Weird soft creatures, made properly." },
      meta: {},
    },
  }),
  pageStub({ url: "https://both.test/about", pageTypes: ["about"], paragraphs: [ABOUT_LINE] }),
]);

const pooled = positioningPool(bothSources);
check(
  "the pool carries all four kinds",
  new Set(pooled.map((c) => c.kind)).size === 4,
  pooled.map((c) => c.kind),
);

const ovField = transformFoundation(bothSources, []).overview;
const pitchField = transformPositioning(bothSources).pitch;
const ovTexts = ovField.status === "found" ? ovField.snippets.map((s) => s.text) : [];
const pitchTexts = pitchField.status === "found" ? pitchField.snippets.map((s) => s.text) : [];

// The bug this fixes: Overview returned About prose and stopped, so on any site
// with an About page it never saw the homepage or the declared description.
check("Overview now sees homepage prose even though an About page exists", ovTexts.includes(HOME_LINE), ovTexts);
check("…and the declared description", ovTexts.includes("Weird soft creatures, made properly."), ovTexts);
// The pool is shared; the *bundle* is a capped view of it. So membership is
// asserted against the ordering, and the cap is asserted separately — a bundle
// check alone would confuse "not in the pool" with "ranked below the cut".
const ovOrder = orderPositioning(bothSources, "overview").map((s) => s.text);
const pitchOrder = orderPositioning(bothSources, "pitch").map((s) => s.text);

check(
  "both orderings contain exactly the same passages",
  JSON.stringify([...ovOrder].sort()) === JSON.stringify([...pitchOrder].sort()),
  { ovOrder, pitchOrder },
);
check("…including About prose for Pitch, which used to need the homepage to fail", pitchOrder.includes(ABOUT_LINE));
check("…and the hero for Overview, which used to never see it", ovOrder.includes(HERO));
check("…and both are capped to the same depth", ovTexts.length === pitchTexts.length, {
  overview: ovTexts.length,
  pitch: pitchTexts.length,
});

// Same passages, opposite ordering — that is the whole design.
check("Overview leads with factual About prose", ovTexts[0] === ABOUT_LINE, ovTexts);
check("Pitch leads with the homepage hero", pitchTexts[0] === HERO, pitchTexts);
check("…and Overview ranks the hero last", ovOrder.at(-1) === HERO, ovOrder);
check("…while Pitch ranks About prose last", pitchOrder.at(-1) === ABOUT_LINE, pitchOrder);
// Which means the cap, not the pool, is what each field ends up trading away.
check("the lowest-ranked passage is the one each field drops", !ovTexts.includes(HERO) && !pitchTexts.includes(ABOUT_LINE));

// The §8 fallbacks are now structural rather than branches. No About page: the
// homepage still fills a required field, because it was always in the pool.
const homepageOnly = ctx([
  pageStub({
    url: "https://home.test/",
    pageTypes: ["homepage"],
    paragraphs: [HOME_LINE],
    headings: [{ level: 1, text: HERO }],
    structuredData: { jsonLd: [], openGraph: {}, meta: {} },
  }),
]);
const homeOnlyOverview = transformFoundation(homepageOnly, []).overview;
check(
  "with no About page, Overview still resolves from the homepage",
  homeOnlyOverview.status === "found" &&
    homeOnlyOverview.snippets.some((s) => s.text === HOME_LINE),
  homeOnlyOverview,
);

// And the reverse: an About-only site must not starve Pitch.
const aboutOnly = ctx([
  pageStub({ url: "https://about.test/", pageTypes: ["about"], paragraphs: [ABOUT_LINE] }),
]);
check(
  "with no homepage content, Pitch still resolves from About",
  transformPositioning(aboutOnly).pitch.status === "found",
);

// Truncated declared description: last in both orderings, but still present when
// the site is thin enough that nothing outranks it.
const thin = ctx([
  pageStub({
    url: "https://thin.test/",
    pageTypes: ["homepage"],
    paragraphs: [],
    headings: [],
    structuredData: { jsonLd: [], openGraph: { "og:description": SLIMESTORY_META }, meta: {} },
  }),
]);
const thinOverview = transformFoundation(thin, []).overview;
check(
  "a thin site keeps its truncated description — it is all there is",
  thinOverview.status === "found" && thinOverview.snippets[0]?.text === SLIMESTORY_META,
  thinOverview,
);
check(
  "…but it ranks last where real prose exists",
  orderPositioning(bothSources, "overview").at(-1)?.text !== undefined,
);
const truncatedRich = ctx([
  pageStub({
    url: "https://rich.test/",
    pageTypes: ["homepage"],
    paragraphs: [HOME_LINE],
    headings: [{ level: 1, text: HERO }],
    structuredData: { jsonLd: [], openGraph: { "og:description": SLIMESTORY_META }, meta: {} },
  }),
]);
check(
  "…demoted below prose and hero alike",
  orderPositioning(truncatedRich, "overview").at(-1)?.text === SLIMESTORY_META &&
    orderPositioning(truncatedRich, "pitch").at(-1)?.text === SLIMESTORY_META,
  orderPositioning(truncatedRich, "overview").map((s) => s.text.slice(0, 24)),
);

// Structural: the difference between the two fields must stay one line of data.
const contextSource = readFileSync(
  new URL("../src/lib/transform/context.ts", import.meta.url),
  "utf8",
);
check(
  "the two orderings are declared as priority lists, not hand-written branches",
  /OVERVIEW_PRIORITY: PositioningKind\[\]/.test(contextSource) &&
    /PITCH_PRIORITY: PositioningKind\[\]/.test(contextSource),
);
for (const moduleName of ["foundation", "positioning"]) {
  const source = readFileSync(
    new URL(`../src/lib/transform/${moduleName}.ts`, import.meta.url),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  check(
    `  transform/${moduleName}.ts gathers nothing of its own for this field`,
    /orderPositioning\(context, "(overview|pitch)"\)/.test(source),
  );
}
check(
  "prompt 2 still describes one shared bundle, which is why this is pooled",
  /written from the same source\s+material/.test(
    readFileSync(new URL("../prompts/02-overview-pitch.md", import.meta.url), "utf8"),
  ),
);

/* ------------------------------------------------------------------ *
 * Logo display
 * ------------------------------------------------------------------ */

console.log("\nLogo thumbnails and save links");

const logoSpec = FIELD_SPECS.find((s) => s.path === "brandingAndStyle.logos");
check("Logos uses a house renderer rather than the generic grid", logoSpec?.entryFormat === "logo");
check(
  "…and still declares its editable sub-fields",
  (logoSpec?.subFields ?? []).map((sub) => sub.key).join(",") === "url,alt,detectedVia",
);

const cardSource = readFileSync(
  new URL("../src/components/fields/ImageCandidateCard.tsx", import.meta.url),
  "utf8",
);
const gridCardSource = readFileSync(
  new URL("../src/components/view/KnowledgeCard.tsx", import.meta.url),
  "utf8",
);
const cat3Source = readFileSync(
  new URL("../src/components/fields/Category3Field.tsx", import.meta.url),
  "utf8",
);
const entryPresentationSource = readFileSync(
  new URL("../src/components/fields/EntryPresentation.tsx", import.meta.url),
  "utf8",
);

// One container rule, shared with the card grid. Real logos in this corpus run
// 32×32 to 2500×785; anything but contain-in-a-fixed-box breaks one of them.
check("the thumbnail shrinks to fit and never stretches", /object-contain/.test(cardSource));
check("…inside a fixed square container", /h-16 w-16|h-11 w-11/.test(cardSource));
check("…the same rule the card grid uses", /object-contain/.test(gridCardSource));
check(
  "…with the cap tied to the box, so the two cannot drift apart",
  /max-h-11 max-w-11/.test(cardSource) && /max-h-16 max-w-16/.test(cardSource),
);

// Both surfaces, from one component.
check("the review UI renders a thumbnail beside the inputs", /<LogoThumbnail/.test(cat3Source));
check("the Detailed view renders one too", /ImageCandidateCard/.test(entryPresentationSource));
check(
  "…and Art Style's evidence panel reuses the same card",
  /ImageCandidateCard/.test(
    readFileSync(new URL("../src/components/fields/ImageEvidenceList.tsx", import.meta.url), "utf8"),
  ),
);
check(
  "every logo entry renders, not just the first",
  /entries\.map\(\(entry, index\)/.test(cat3Source),
);

// Graceful failure, and the URL as the fallback finding.
check("a broken image falls back to a placeholder", /Could not load/.test(cardSource));
check("…and surfaces the URL text instead", /failed && <p[\s\S]{0,120}\{image\.url\}/.test(cardSource));

// The save link points at the existing URL — no re-hosting, no new storage.
check("a per-image save link exists", /download=\{filenameFor\(image\.url\)\}/.test(cardSource));
check("…pointing at the URL already in the evidence", /href=\{image\.url\}[\s\S]{0,80}download=/.test(cardSource));
check(
  "…and is honest that cross-origin downloads may open instead",
  /cross-origin/.test(cardSource),
);

// The export must stay structured data. No binary, no base64.
const exportedExample = readFileSync(
  new URL("../examples/example-knowledge-base.json", import.meta.url),
  "utf8",
);
check("the export embeds no image data", !/data:image\/|base64,/.test(exportedExample));
check(
  "…and logos are still just url/alt/detectedVia",
  (JSON.parse(exportedExample) as { brandingAndStyle: { logos: Record<string, unknown>[] } })
    .brandingAndStyle.logos.every(
      (logo) => Object.keys(logo).sort().join(",") === "alt,detectedVia,url",
    ),
);

console.log(`\n${failures === 0 ? "All smoke checks passed." : `${failures} check(s) FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);
