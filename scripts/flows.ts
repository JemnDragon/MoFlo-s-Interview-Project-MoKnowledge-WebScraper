/**
 * End-to-end behavioural checks over the flows a reviewer actually performs.
 *
 * `smoke.ts` tests functions in isolation. This exercises whole journeys against
 * the real persistence layer and the real validation layer, using drafts modelled
 * on the reference profiles in Knowledge_Outputs — deliberately including the
 * *sparse* ones, because the interesting behaviour lives there.
 *
 *   Run with: npm run flows
 *
 * Scope: everything from the draft onward — review state, completeness,
 * validation, save, list, filter, soft/hard delete, restore, section hiding and
 * version retention. It does NOT exercise the crawler (needs the network) or the
 * React components (needs a browser); those still need a human with the app
 * running.
 */

import { rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import type {
  Category2Field,
  Category2VisualField,
  KnowledgeBaseDraft,
  OfferingEntry,
  PersonEntry,
  Snippet,
} from "../src/types/knowledge";
import type { ReviewState } from "../src/types/review";
import type { ParsedPage } from "../src/types/scrape";
import type { Cat2EditorState } from "../src/types/review";
import {
  blurEditorState,
  initialReviewState,
  reviewedCount,
  shouldShowReviewBadge,
} from "../src/lib/review/initialize";
import { isReviewed } from "../src/lib/mock/placeholders";
import { isOfferingLike, looksLikePersonName } from "../src/lib/parse/people";
import { isUiNoise, uiNoiseReason } from "../src/lib/parse/uiNoise";
import { buildContext } from "../src/lib/transform/context";
import {
  transformFoundation,
  yearFoundedCandidates,
  yearFoundedConflict,
} from "../src/lib/transform/foundation";
import { transformKeyPeople, transformOfferings } from "../src/lib/transform/entities";
import { transformExtensions } from "../src/lib/transform/extensions";
import { draftToFinal } from "../src/lib/validate/draftToFinal";
import { computeCompleteness, hiddenRequiredFields } from "../src/lib/validate/completeness";
import { FIELD_SPECS } from "../src/lib/schema/fields";
import { JsonKnowledgeRepository } from "../src/lib/db/jsonStore";

let failures = 0;
function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
  }
}
function section(name: string) {
  console.log(`\n${name}`);
}

/* ------------------------------------------------------------------ *
 * Fixtures modelled on the reference profiles
 * ------------------------------------------------------------------ */

const snip = (source: Snippet["source"], text: string): Snippet => ({
  source,
  sourceUrl: `https://example.test/${source}`,
  text,
});
const found = (...s: Snippet[]): Category2Field => ({ status: "found", snippets: s });
const absent: Category2Field = { status: "absent" };
/** Art Style's evidence is images, so its absent value is a different type. */
const absentVisual: Category2VisualField = { status: "absent" };

/** Realistic placeholder text — must carry the real MOCK_PREFIX to be detected. */
const MOCK_SAMPLE =
  "[Mock placeholder — in production an LLM would synthesise Writing Style from the 4 source snippets below (found on: about, homepage). No AI has run on this text.]";

const pageStub = (over: Partial<ParsedPage> = {}): ParsedPage => ({
  url: "https://example.test/",
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

const contextOf = (pages: ParsedPage[]) =>
  buildContext({
    requestedUrl: pages[0]?.url ?? "https://example.test/",
    resolvedUrl: pages[0]?.url ?? "https://example.test/",
    startedAt: "", finishedAt: "", durationMs: 0, status: "complete",
    discovery: {
      homepageUrl: pages[0]?.url ?? "https://example.test/",
      candidates: [], sitemapFallbackUsed: [], unmatchedPageTypes: [], navLinksUnusable: false,
    },
    pages,
    failedPages: [],
  });

type Overrides = Partial<KnowledgeBaseDraft>;

function draft(name: string, website: string, overrides: Overrides = {}): KnowledgeBaseDraft {
  const base: KnowledgeBaseDraft = {
    schemaVersion: 1,
    scan: {
      status: "complete",
      startedAt: "2026-02-13T10:00:00.000Z",
      finishedAt: "2026-02-13T10:00:30.000Z",
      requestedUrl: website,
      resolvedUrl: website,
      pagesFetched: [{ url: website, pageType: "homepage" }],
      pagesFailed: [],
      durationMs: 30000,
    },
    companyFoundation: {
      overview: found(snip("about", `${name} is a real business that does real things.`)),
      companyName: name,
      website,
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
    positioning: { pitch: found(snip("homepage", "Choose us.")), foundingStory: absent },
    marketAndCustomers: {
      targetBuyers: absent,
      customerNeeds: absent,
      idealCustomerPersona: absent,
      industryGroupings: [],
      industryOutlook: absent,
      channels: [],
      funnels: [],
      ctas: [],
      suppliersPartners: [],
    },
    brandingAndStyle: {
      writingStyle: absent,
      artStyle: absentVisual,
      fonts: [],
      brandColors: [],
      logos: [],
    },
    onlinePresence: { socialMediaLinks: [] },
    keyPeople: [],
    offerings: [
      { name: "A service", category: null, features: [], description: null, pricing: null, sourceUrl: null },
    ],
    extensions: {
      siteLanguage: { main: null, alternates: [] },
      demographicDetail: { ageRange: null, incomeBracket: null, householdType: null },
      valuesAndSocialPositioning: absent,
      testimonials: [],
      faq: [],
      differentiators: absent,
      certifications: [],
      contentThemes: [],
      legalAndCompliance: [],
      currentPromotions: absent,
    },
    customSections: [],
  };
  return { ...base, ...overrides };
}

/**
 * Night Owl Monitoring, from the reference PDF: a genuinely well-documented
 * company that still has NO main address, NO year founded and NO legal entity
 * type. Exactly the shape that proves those fields must stay optional.
 */
const nightOwl = draft("NightOwl Monitoring", "https://nightowlmonitoring.test", {
  companyFoundation: {
    overview: found(
      snip("about", "NightOwl Monitoring helps organizations manage water well monitoring systems."),
      snip("homepage", "Real-time visibility and control for water wells, tanks and pumps."),
    ),
    companyName: "NightOwl Monitoring",
    website: "https://nightowlmonitoring.test",
    industry: "Water Well Monitoring and Control Systems",
    businessModel: "subscription",
    companyRole: "Service provider",
    yearFounded: null,
    legalEntityType: null,
    employeeCount: null,
    mainAddress: null,
    otherLocations: [],
    serviceLocations: ["Texas Panhandle", "Salinas Valley, California"],
    alternativeCompanyNames: ["NOM"],
  },
  keyPeople: [
    { name: "Jim Blair", title: "CEO & Co-Founder", gender: "Male", bio: "Over 30 years as a water well driller. He pioneered monitoring integration.", credentials: [], sourceUrl: "https://nightowlmonitoring.test/team" },
    // Title but no name — a card the scraper saw only partially. Kept, not dropped.
    { name: null, title: "Service Manager", gender: null, bio: null, credentials: [], sourceUrl: "https://nightowlmonitoring.test/team" },
    // A bio with no pronouns at all: gender must stay null, never guessed.
    { name: "Sean Trapp", title: null, gender: null, bio: "An employee at NightOwl Monitoring, a key contact for partners.", credentials: [], sourceUrl: "https://nightowlmonitoring.test/team" },
  ] satisfies PersonEntry[],
  offerings: [
    { name: "Residential Well Monitoring", category: "Consumer Solution", features: ["Plug-and-play", "Pump health alerts"], description: "Affordable monitoring for single-home wells.", pricing: null, sourceUrl: "https://nightowlmonitoring.test/services" },
    { name: "Remote System Control", category: "Core Feature", features: ["Remote pump control"], description: "Full management from anywhere.", pricing: "Included with monitoring service", sourceUrl: "https://nightowlmonitoring.test/services" },
    { name: "Well Driller Partnership Program", category: "Partnership Program", features: [], description: null, pricing: "Partnership/Reseller Model", sourceUrl: "https://nightowlmonitoring.test/services" },
  ] satisfies OfferingEntry[],
  extensions: {
    siteLanguage: { main: "en-US", alternates: [] },
    demographicDetail: { ageRange: null, incomeBracket: null, householdType: null },
    valuesAndSocialPositioning: absent,
    testimonials: [
      { quote: "Easiest installation I had ever experienced.", attributedTo: "Chris Sosnowski", source: "Company website", sourceUrl: "https://nightowlmonitoring.test/reviews" },
    ],
    faq: [],
    differentiators: found(snip("homepage", "Shift from reactive repairs to proactive maintenance.")),
    certifications: [],
    contentThemes: [
      { theme: "monitoring", mentions: 7, examples: ["Remote System Monitoring", "Residential Well Monitoring", "Agricultural Well Monitoring Solutions"] },
      { theme: "pumping", mentions: 3, examples: ["Pumping Systems", "pump health", "pump failures"] },
    ],
    legalAndCompliance: [],
    currentPromotions: absent,
  },
});

/**
 * The purplepotatolv case: a one-page site where almost everything is genuinely
 * absent. The point of this fixture is that the system must still be *usable*
 * here, not that it must find anything.
 */
const onePager = draft("Purple Potato LV", "https://purplepotato.test", {
  companyFoundation: {
    overview: found(snip("homepage", "Filipino Inspired Home made sweets")),
    companyName: "Purple Potato LV",
    website: "https://purplepotato.test",
    industry: null,
    businessModel: null,
    companyRole: null,
    yearFounded: null,
    legalEntityType: null,
    employeeCount: null,
    mainAddress: "6370 W Flamingo Rd #20, Las Vegas, NV 89103",
    otherLocations: [],
    serviceLocations: [],
    alternativeCompanyNames: [],
  },
  offerings: [],
  scan: {
    status: "partial",
    startedAt: "2026-02-13T10:00:00.000Z",
    finishedAt: "2026-02-13T10:00:45.000Z",
    requestedUrl: "https://purplepotato.test",
    resolvedUrl: "https://purplepotato.test",
    pagesFetched: [{ url: "https://purplepotato.test", pageType: "homepage" }],
    pagesFailed: [{ url: "https://purplepotato.test/blog", pageType: "blog", reason: "The scan ran out of time." }],
    durationMs: 45000,
  },
});

/* ------------------------------------------------------------------ *
 * Flow 1 — the review journey
 * ------------------------------------------------------------------ */

async function reviewFlow() {
  section("Flow 1 — review journey (NightOwl, a well-documented but incomplete site)");

  const d = nightOwl;
  const review: ReviewState = initialReviewState(d);

  const start = reviewedCount(review);
  check("every Category 2 field starts unreviewed", start.reviewed === 0, start);
  check(
    "fields WITH snippets are pre-filled with a placeholder",
    (review["cat2"]["companyFoundation.overview"]?.value ?? "").length > 0,
  );
  check(
    "fields with NO snippets start genuinely empty, not placeholder-filled",
    review["cat2"]["brandingAndStyle.writingStyle"]?.value === "",
  );

  const before = computeCompleteness(d);
  check("completeness is a sane percentage", before.score > 0 && before.score < 100, before.score);
  check(
    "every unpopulated field is reported as not-found (nothing hidden yet)",
    before.missing.every((f) => f.reason === "not-found"),
  );

  check("save is blocked while the required fields hold placeholders", !draftToFinal(d, review).ok);

  // The reviewer works through the required fields.
  const write = (path: string, value: string) => {
    const editor = review["cat2"][path];
    if (!editor) throw new Error(`no editor at ${path}`);
    review["cat2"][path] = { ...editor, value, reviewed: isReviewed(value, editor.placeholder) };
  };

  write("companyFoundation.overview", "NightOwl Monitoring designs smart systems that connect water wells, tanks and pumps through real-time data.");
  write("positioning.pitch", "You gain the insight and peace of mind needed to safeguard your most critical resource.");

  const afterRequired = draftToFinal(d, review);
  check("save succeeds once both required narrative fields are written", afterRequired.ok,
    afterRequired.ok ? undefined : afterRequired.problems.map((p) => p.fieldPath));

  /* --- The bug this flow exists to pin down. --- */
  section("Flow 1b — an intentional blank-out counts as reviewed");

  const wsEditor = review["cat2"]["brandingAndStyle.artStyle"];
  check("art style starts unreviewed", wsEditor?.reviewed === false);

  // A field WITH snippets, whose placeholder the reviewer deletes entirely:
  // "I read these and there is nothing honest to say."
  const diffEditor = review["cat2"]["extensions.differentiators"];
  if (!diffEditor) throw new Error("no differentiators editor");
  check("differentiators was placeholder-filled to begin with", diffEditor.value.length > 0);

  review["cat2"]["extensions.differentiators"] = {
    ...diffEditor,
    value: "",
    reviewed: isReviewed("", diffEditor.placeholder),
  };
  check(
    "clearing a placeholder marks the field REVIEWED, not untouched",
    review["cat2"]["extensions.differentiators"]?.reviewed === true,
  );

  // …while a field that started empty and is still empty stays unreviewed,
  // because that is genuinely indistinguishable from never opening it.
  const artEditor = review["cat2"]["brandingAndStyle.artStyle"];
  check(
    "a field that began empty and is still empty stays unreviewed",
    isReviewed("", artEditor?.placeholder ?? "") === false,
  );

  // The transition the component actually runs on blur, not just the predicate
  // underneath it. The original bug was in this step, so it is tested directly.
  section("Flow 1c — the blur transition itself");

  const withMock: Cat2EditorState = { value: MOCK_SAMPLE, placeholder: MOCK_SAMPLE, reviewed: false };
  check("blur on an untouched placeholder leaves it unreviewed", blurEditorState(MOCK_SAMPLE, withMock).reviewed === false);
  check(
    "blur after clearing the placeholder marks it REVIEWED",
    blurEditorState("", withMock).reviewed === true,
  );
  check("…and the cleared value is kept, not reverted", blurEditorState("", withMock).value === "");
  check(
    "blur with whitespace only is still reviewed",
    blurEditorState("   ", withMock).reviewed === true,
  );
  check("blur with real prose is reviewed", blurEditorState("Real copy.", withMock).reviewed === true);
  check(
    "blur with edited mock text is NOT reviewed",
    blurEditorState(`${MOCK_SAMPLE} tweak`, withMock).reviewed === false,
  );
  const wasEmpty: Cat2EditorState = { value: "", placeholder: "", reviewed: false };
  check(
    "blur on a field that began empty and is still empty stays unreviewed",
    blurEditorState("", wasEmpty).reviewed === false,
  );
  check("the placeholder is never mutated by a blur", blurEditorState("x", withMock).placeholder === MOCK_SAMPLE);

  // Structural guard. The behaviour above can be correct while the component
  // quietly stops using it — re-inlining `value.length > 0` in the JSX handler
  // would restore the original bug and pass every behavioural test above.
  const componentSource = readFileSync(
    new URL("../src/components/fields/Category2Field.tsx", import.meta.url),
    "utf8",
  );
  const blurHandler = /onBlur=\{[\s\S]*?\}\}?\s*\n/.exec(componentSource)?.[0] ?? "";
  check("the component delegates its blur handler to blurEditorState", blurHandler.includes("blurEditorState"), blurHandler.trim());
  check(
    "the component's blur handler contains no non-empty guard",
    !/\.length\s*[><=]/.test(blurHandler),
    blurHandler.trim(),
  );
  // A literal `reviewed: false` default is fine; a *computed* one means the
  // component is deciding review state again, which is the bug's home.
  const reviewedAssignments = [...componentSource.matchAll(/reviewed:\s*([^,\n}]+)/g)].map((m) =>
    (m[1] ?? "").trim(),
  );
  check(
    "the component only ever sets `reviewed` to a literal, never a computed expression",
    reviewedAssignments.every((value) => value === "false" || value === "true"),
    reviewedAssignments,
  );

  const saved = draftToFinal(d, review);
  check("an intentionally-blanked optional field still saves", saved.ok);
  if (saved.ok) {
    check(
      "…and it persists as null rather than as placeholder text",
      saved.knowledgeBase.extensions.differentiators === null,
      saved.knowledgeBase.extensions.differentiators,
    );
  }

  // Blanking a REQUIRED field is a different matter: reviewed, but still blocking.
  const clone: ReviewState = { cat2: { ...review.cat2 } };
  const pitch = clone.cat2["positioning.pitch"];
  if (pitch) clone.cat2["positioning.pitch"] = { ...pitch, value: "", reviewed: isReviewed("", pitch.placeholder) };
  const blockedAgain = draftToFinal(d, clone);
  check("blanking a REQUIRED field blocks the save", !blockedAgain.ok);
  if (!blockedAgain.ok) {
    const problem = blockedAgain.problems.find((p) => p.fieldPath === "positioning.pitch");
    check("…and the message names the field and says it's empty",
      problem?.message.includes("Pitch") === true && problem.reason === "empty", problem);
  }

  return saved.ok ? saved.knowledgeBase : null;
}

/* ------------------------------------------------------------------ *
 * Flow 2 — the sparse one-pager
 * ------------------------------------------------------------------ */

function sparseFlow() {
  section("Flow 2 — the one-page site (almost everything genuinely absent)");

  const review = initialReviewState(onePager);
  const completeness = computeCompleteness(onePager);

  check("completeness is low but not zero", completeness.score > 0 && completeness.score < 25, completeness.score);
  check("the scan is marked partial, not failed", onePager.scan.status === "partial");
  check("the incomplete page is recorded for retry", onePager.scan.pagesFailed.length === 1);

  const result = draftToFinal(onePager, review);
  check("save is blocked", !result.ok);
  if (!result.ok) {
    const paths = result.problems.map((p) => p.fieldPath);
    check("…and Offerings is named as the blocker (the site lists none)", paths.includes("offerings"), paths);
    check(
      "…with an actionable message, not a generic one",
      result.problems.every((p) => p.message.length > 30 && !p.message.includes("complete the form")),
    );
  }

  // The reviewer adds the offering manually — the escape hatch that makes a
  // sparse site still saveable.
  const fixed: KnowledgeBaseDraft = {
    ...onePager,
    offerings: [{ name: "Filipino-inspired donuts", category: null, features: [], description: null, pricing: null, sourceUrl: null }],
  };
  const r2 = initialReviewState(fixed);
  for (const p of ["companyFoundation.overview", "positioning.pitch"]) {
    const e = r2.cat2[p];
    if (e) r2.cat2[p] = { ...e, value: `Real reviewed text for ${p}.`, reviewed: true };
  }
  check("adding one offering manually unblocks the save", draftToFinal(fixed, r2).ok);
  return draftToFinal(fixed, r2);
}

/* ------------------------------------------------------------------ *
 * Flow 2b — the technoblade.com regression
 * ------------------------------------------------------------------ */

/**
 * Product names lifted verbatim from technoblade.com — a Shopify merch store
 * whose `h3` product titles were being read as Key People.
 */
const TECHNOBLADE_PRODUCTS = [
  "Technoblade Keycaps (Cherry Profile)",
  "Techno Sword Earrings",
  "Techno Crown Necklace",
  "Techno Said It Crewneck Sweatshirt (Black)",
  "One Of Us Crown Sword Pin",
  "Techno Stained Glass Keychain Standee",
  "Techno Embroidered Notebook",
  "Good Game Kit",
  "Good Game Hoodie (Black)",
  "It Was Hilarious Hoodie",
  "It Was Hilarious Tee",
  "So Long Nerds Tee (Black)",
  "Good Game Long Sleeve Tee (Black)",
  "Agro King Collector Set",
  "Agro Pullover Hoodie (Black)",
];

function merchStoreContext() {
  // A shop page and a homepage. technoblade.com has NO team or about page —
  // its nav is BEST SELLERS / SHOP / TECHNOWORLD.
  const productPage = pageStub({
    url: "https://technoblade.test/collections/all",
    pageTypes: ["services"],
    headings: TECHNOBLADE_PRODUCTS.map((name) => ({ level: 3, text: name })),
    candidates: {
      people: TECHNOBLADE_PRODUCTS.filter((name) => looksLikePersonName(name)).map((name) => ({
        name,
        title: null,
        bio: "Regular price $30.00 USD",
        pronounsFound: [],
        credentials: [],
      })),
      offerings: TECHNOBLADE_PRODUCTS.map((name) => ({
        name,
        description: null,
        features: [],
        priceText: "$30.00",
        originalPriceText: null,
        category: "Merchandise",
      })),
      testimonials: [],
      faq: [],
      certifications: [],
    },
  });
  const home = pageStub({ url: "https://technoblade.test/", pageTypes: ["homepage"] });
  return contextOf([home, productPage]);
}

function technobladeFlow() {
  section("Flow 2b — technoblade.com: product titles must not become Key People");

  // First, the bug itself, with the real names: these DO pass the name test.
  const leaking = TECHNOBLADE_PRODUCTS.filter((name) => looksLikePersonName(name));
  check(
    "the underlying name heuristic really does accept product titles",
    leaking.length >= 5,
    leaking,
  );
  check("…including 'Techno Sword Earrings'", leaking.includes("Techno Sword Earrings"));
  check("…and 'Agro King Collector Set'", leaking.includes("Agro King Collector Set"));

  // Defence 1 — page-type scoping. This is the real fix.
  const context = merchStoreContext();
  const people = transformKeyPeople(context);
  check("Key People is EMPTY for a merch store with no team/about page", people.length === 0, people.map((p) => p.name));
  check("…while Offerings still picks the products up", transformOfferings(context).length === TECHNOBLADE_PRODUCTS.length);

  // Defence 2 — offering exclusion, for products on a correctly-classified About page.
  const offeringNames = new Set(TECHNOBLADE_PRODUCTS.map((n) => n.toLowerCase()));
  check(
    "a product name matching an extracted offering is rejected",
    isOfferingLike("Techno Sword Earrings", "Techno Sword Earrings", offeringNames),
  );
  check(
    "a heading in a commerce block is rejected on context alone",
    isOfferingLike("Some Unknown Thing", "Some Unknown Thing Regular price $30.00 USD Sold out", new Set()),
  );
  check(
    "a real person in a real bio is NOT rejected",
    !isOfferingLike(
      "Dana Whitfield",
      "Dana Whitfield Founder & Principal Designer. She founded the company in 2009.",
      offeringNames,
    ),
  );

  // Defence 2 in situ: products listed inline on a genuine About page.
  const aboutWithProducts = contextOf([
    pageStub({
      url: "https://smallshop.test/about",
      pageTypes: ["about"],
      candidates: {
        // The parse layer would already have dropped these; this asserts that a
        // person who survives parsing still reaches the field.
        people: [
          { name: "Dana Whitfield", title: "Owner", bio: "She started the shop in 2011.", pronounsFound: ["she"], credentials: [] },
        ],
        offerings: [{ name: "Good Game Hoodie", description: null, features: [], priceText: "$30", originalPriceText: null, category: "Merchandise" }],
        testimonials: [],
        faq: [],
        certifications: [],
      },
    }),
  ]);
  const aboutPeople = transformKeyPeople(aboutWithProducts);
  check("a real person on an About page still comes through", aboutPeople.length === 1, aboutPeople.map((p) => p.name));
  check("…with gender resolved from her own pronouns", aboutPeople[0]?.gender === "Female");
}

/* ------------------------------------------------------------------ *
 * Flow 2c — Industry fallback chain
 * ------------------------------------------------------------------ */

function industryFlow() {
  section("Flow 2c — Industry falls back beyond JSON-LD");

  const noJsonLd = contextOf([
    pageStub({
      url: "https://pest.test/",
      pageTypes: ["homepage"],
      candidates: {
        people: [], testimonials: [], faq: [], certifications: [],
        offerings: [
          { name: "Ant Control", description: null, features: [], priceText: null, originalPriceText: null, category: "Pest Control Service" },
          { name: "Rodent Control", description: null, features: [], priceText: null, originalPriceText: null, category: "Pest Control Service" },
          { name: "Termite Inspection", description: null, features: [], priceText: null, originalPriceText: null, category: "Inspection Service" },
        ],
      },
    }),
  ]);
  const rolled = transformFoundation(noJsonLd, transformOfferings(noJsonLd));
  check(
    "with no JSON-LD, Industry rolls up the dominant offering category",
    rolled.industry === "Pest Control Service",
    rolled.industry,
  );

  // Generic categories must not win.
  const generic = contextOf([
    pageStub({
      candidates: {
        people: [], testimonials: [], faq: [], certifications: [],
        offerings: [
          { name: "A", description: null, features: [], priceText: null, originalPriceText: null, category: "Service" },
          { name: "B", description: null, features: [], priceText: null, originalPriceText: null, category: "Service" },
        ],
      },
    }),
  ]);
  const genericResult = transformFoundation(generic, transformOfferings(generic));
  check("a generic 'Service' category does NOT become the industry", genericResult.industry === null, genericResult.industry);

  // A single stray category must not win either.
  const stray = contextOf([
    pageStub({
      candidates: {
        people: [], testimonials: [], faq: [], certifications: [],
        offerings: [
          { name: "A", description: null, features: [], priceText: null, originalPriceText: null, category: "Pest Control Service" },
          { name: "B", description: null, features: [], priceText: null, originalPriceText: null, category: "Financial Service" },
          { name: "C", description: null, features: [], priceText: null, originalPriceText: null, category: "Legal Service" },
        ],
      },
    }),
  ]);
  const strayResult = transformFoundation(stray, transformOfferings(stray));
  check("three different one-off categories yield no industry", strayResult.industry === null, strayResult.industry);

  // Tier 3: declared metadata.
  const metaOnly = contextOf([
    pageStub({
      pageTypes: ["homepage"],
      structuredData: { jsonLd: [], openGraph: {}, meta: { keywords: "Water Well Drilling, wells, Texas" } },
    }),
  ]);
  const metaResult = transformFoundation(metaOnly, []);
  check("a short curated keywords list is used as a last resort", metaResult.industry === "Water Well Drilling", metaResult.industry);

  const stuffed = contextOf([
    pageStub({
      pageTypes: ["homepage"],
      structuredData: {
        jsonLd: [], openGraph: {},
        meta: { keywords: Array.from({ length: 20 }, (_, i) => `keyword ${i}`).join(", ") },
      },
    }),
  ]);
  check("a stuffed keywords list is ignored", transformFoundation(stuffed, []).industry === null);

  // Nothing anywhere → null, same rule as everywhere else.
  const nothing = contextOf([pageStub({ pageTypes: ["homepage"] })]);
  check("with no source at all, Industry stays null", transformFoundation(nothing, []).industry === null);
}

/* ------------------------------------------------------------------ *
 * Flow 2d — the Category 1 sparse-field audit
 * ------------------------------------------------------------------ */

/** Builds a context whose About page carries the given prose. */
function proseContext(text: string, over: Partial<ParsedPage> = {}) {
  return contextOf([
    pageStub({ url: "https://x.test/", pageTypes: ["homepage"], mainContent: text }),
    pageStub({ url: "https://x.test/about", pageTypes: ["about"], mainContent: text, ...over }),
  ]);
}

function categoryOneAuditFlow() {
  section("Flow 2d — Year Founded from prose (verbatim reference sentences)");

  const yearCases: [string, string, number | null][] = [
    ["Bee Cave overview", "Since its inception in 1980, Bee Cave Drilling, a family-owned and operated company, has been dedicated to providing exemplary well-drilling services.", 1980],
    ["Bee Cave pitch", "As a family-owned and operated company since 1980, Bee Cave Drilling is dedicated to high-quality wells.", 1980],
    ["Account IT founding story", "Founder Doug Cohen started his own accounting practice in South Florida in 2003.", 2003],
    ["Currie Drilling", "A fourth-generation, family-owned water well drilling company serving the Texas Panhandle since 1941.", 1941],
    ["opened our doors", "We opened our doors in 1994 and never looked back.", 1994],
    ["began as a single van", "The business began in 2011 as a single van.", 2011],
    ["Planet Orange (no year stated)", "Planet Orange has been locally owned and operated in the Bay Area for over 15 years.", null],
    ["copyright range is NOT a founding year", "© 2015 - present Some Company. All rights reserved.", null],
    ["bare copyright year is NOT a founding year", "Copyright 2018 Acme Ltd. All rights reserved.", null],
    ["a founding year still wins next to a copyright", "Serving Texas since 1941. © 2024 Currie Drilling.", 1941],
  ];

  for (const [name, text, expected] of yearCases) {
    const got = transformFoundation(proseContext(text), []).yearFounded;
    check(name, got === expected, { expected, got });
  }

  section("Flow 2d — Year Founded: source precedence (the account-it.net case)");

  // account-it.net: the About page says "since 2003"; something off-page — most
  // likely a platform-generated schema.org foundingDate — said 2011.
  const accountItContext = contextOf([
    pageStub({
      url: "https://account-it.test/",
      pageTypes: ["homepage"],
      mainContent: "Account-it Consulting Services, LLC. © 2026 All rights reserved.",
      structuredData: {
        jsonLd: [{ "@type": "AccountingService", name: "Account-it", foundingDate: "2011-06-01" }],
        openGraph: {},
        meta: {},
      },
    }),
    pageStub({
      url: "https://account-it.test/about-us/doug-cohen",
      pageTypes: ["about"],
      mainContent: "I have owned and operated, since 2003, my own accounting practice in South Florida.",
    }),
    // A services page mentioning an unrelated year — must never be consulted.
    pageStub({
      url: "https://account-it.test/services/quickbooks",
      pageTypes: ["services"],
      mainContent: "QuickBooks Online launched in 2011 and we have supported it ever since.",
    }),
  ]);

  const accountItYears = yearFoundedCandidates(accountItContext);
  check(
    "About-page prose beats a platform-generated foundingDate",
    transformFoundation(accountItContext, []).yearFounded === 2003,
    { chosen: transformFoundation(accountItContext, []).yearFounded, candidates: accountItYears },
  );
  check(
    "the services-page year never becomes a candidate",
    // The type system already proves `source` can only be json-ld/about/homepage;
    // this asserts the corpus itself excluded the services page's 2011.
    !accountItYears.some((c) => c.phrase.toLowerCase().includes("quickbooks")),
    accountItYears.map((c) => `${c.year}/${c.source}: ${c.phrase}`),
  );
  check(
    "the copyright year on the homepage is not a candidate",
    !accountItYears.some((c) => c.year === 2026),
  );
  const conflict = yearFoundedConflict(accountItYears);
  check("the disagreement is reported rather than silently resolved", conflict !== null);
  check(
    "…naming the rejected value and where it came from",
    conflict?.rejected.some((c) => c.year === 2011 && c.source === "json-ld") === true,
    conflict?.rejected,
  );

  // With no contradicting prose, JSON-LD is still used.
  const jsonLdOnly = contextOf([
    pageStub({
      pageTypes: ["homepage"],
      structuredData: {
        jsonLd: [{ "@type": "Organization", name: "X", foundingDate: "1994" }],
        openGraph: {},
        meta: {},
      },
    }),
  ]);
  check(
    "JSON-LD foundingDate is still used when prose says nothing",
    transformFoundation(jsonLdOnly, []).yearFounded === 1994,
  );

  // An explicit founding verb outranks a bare "since" even on the same page.
  const bothPhrases = proseContext(
    "Proudly serving the county since 2015. The firm was founded in 1998 by two brothers.",
  );
  check(
    "an explicit founding phrase outranks a bare 'since'",
    transformFoundation(bothPhrases, []).yearFounded === 1998,
    transformFoundation(bothPhrases, []).yearFounded,
  );

  section("Flow 2d — Company Role beyond JSON-LD (the third instance of the bug class)");

  check(
    "a stated self-description resolves the role",
    transformFoundation(proseContext("We are a full-service landscaping company."), []).companyRole ===
      "Service provider",
    transformFoundation(proseContext("We are a full-service landscaping company."), []).companyRole,
  );
  check(
    "an audience qualifier is prefixed, as in the reference format",
    transformFoundation(
      proseContext("A direct-to-consumer and business-to-business full-service provider."),
      [],
    ).companyRole === "Direct-to-Consumer (D2C) and Business-to-Business (B2B) Service provider",
    transformFoundation(proseContext("A direct-to-consumer and business-to-business full-service provider."), []).companyRole,
  );
  check(
    "manufacturing language beats the generic service role",
    transformFoundation(proseContext("We manufacture every component in our factory."), []).companyRole ===
      "Manufacturer",
  );
  check(
    "a commerce platform alone yields Retailer",
    transformFoundation(
      contextOf([
        pageStub({
          partners: [{ name: "Shopify", domain: "shopify.com", detectedVia: "commerce script/embed" }],
        }),
      ]),
      [],
    ).companyRole === "Retailer",
  );
  check(
    "silence yields null, not a guess",
    transformFoundation(proseContext("Welcome to our website."), []).companyRole === null,
  );

  section("Flow 2d — Legal Entity Type beyond the display name");

  const accountIt = contextOf([
    pageStub({
      url: "https://account-it.test/",
      pageTypes: ["homepage"],
      title: "Account IT",
      mainContent:
        "Account-it Consulting Services, LLC is a trusted partner for comprehensive tax and accounting services based in Boynton Beach, Florida.",
      structuredData: { jsonLd: [], openGraph: { "og:site_name": "Account IT" }, meta: {} },
    }),
  ]);
  const resolved = transformFoundation(accountIt, []);
  check(
    "the trading name is 'Account IT'…",
    resolved.companyName === "Account IT",
    resolved.companyName,
  );
  check(
    "…and LLC is still found, from the legal name stated in prose",
    resolved.legalEntityType === "LLC",
    resolved.legalEntityType,
  );
  check(
    "no suffix anywhere yields null",
    transformFoundation(proseContext("Purple Potato LV makes Filipino sweets."), []).legalEntityType === null,
  );
}

/* ------------------------------------------------------------------ *
 * Flow 2e — custom notes (user-authored, outside the taxonomy)
 * ------------------------------------------------------------------ */

function customSectionsFlow() {
  section("Flow 2e — custom notes stay outside the scored schema");

  const bare = draft("Notes Co", "https://notes.test");
  check("a fresh draft has no notes — the scraper never writes any", bare.customSections.length === 0);
  check(
    "no field-registry entry exists for custom sections",
    !FIELD_SPECS.some((spec) => spec.path.includes("customSections")),
  );

  const baseline = computeCompleteness(bare);

  const withNotes: KnowledgeBaseDraft = {
    ...bare,
    customSections: [
      { id: "n1", title: "Owner prefers phone", content: "Said email goes unread for days.", createdAt: "2026-02-13T11:00:00.000Z" },
      { id: "n2", title: "Second location closing", content: "Mentioned on a call; site not updated yet.", createdAt: "2026-02-13T11:05:00.000Z" },
    ],
  };
  const scored = computeCompleteness(withNotes);

  check("adding notes does not change the completeness score", scored.score === baseline.score, {
    before: baseline.score, after: scored.score,
  });
  check("…nor the counted-field denominator", scored.counted === baseline.counted);
  check(
    "…and notes never appear as a missing field",
    !scored.missing.some((field) => field.fieldPath.includes("customSections")),
  );

  // Validation is untouched by them, in both directions.
  const review = initialReviewState(withNotes);
  check("notes alone do not satisfy required fields", !draftToFinal(withNotes, review).ok);

  for (const p of ["companyFoundation.overview", "positioning.pitch"]) {
    const editor = review.cat2[p];
    if (editor) review.cat2[p] = { ...editor, value: `Reviewed text for ${p}.`, reviewed: true };
  }
  const result = draftToFinal(withNotes, review);
  check("notes do not block a save either", result.ok);
  if (result.ok) {
    check("…and survive into the final object verbatim", result.knowledgeBase.customSections.length === 2);
    check(
      "…with title, content and createdAt intact",
      result.knowledgeBase.customSections[0]?.title === "Owner prefers phone" &&
        result.knowledgeBase.customSections[0]?.createdAt === "2026-02-13T11:00:00.000Z",
    );
  }

  // Individual removal, the Category-3 way — not the whole array at once.
  const afterRemoval = withNotes.customSections.filter((s) => s.id !== "n1");
  check("a single note can be removed without touching the other", afterRemoval.length === 1 && afterRemoval[0]?.id === "n2");

  return result.ok ? result.knowledgeBase : null;
}

/**
 * Flow 2i — the review badge appears only when there is something to judge.
 *
 * Display-only, but it sits directly on top of the reviewed-state logic that has
 * already been the source of one real bug, so it is tested against that logic
 * rather than beside it.
 */
function reviewBadgeFlow() {
  section("Flow 2i — no 'Unreviewed' badge on a field with nothing in it");

  const empty: Cat2EditorState = { value: "", placeholder: "", reviewed: false };

  // The reported case: absent field, untouched editor. Three indicators were
  // saying the same thing; the badge is the one that was also wrong, because
  // "Unreviewed" implies something is waiting to be read.
  check("absent + empty shows no badge", !shouldShowReviewBadge("absent", empty));

  // The moment the reviewer writes something themselves, there is a judgment to
  // report — before blur it reads Unreviewed, after blur Reviewed.
  const typed: Cat2EditorState = { ...empty, value: "Written from a phone call." };
  check("absent + typed content shows the badge", shouldShowReviewBadge("absent", typed));
  check(
    "…and it says Reviewed once blurred",
    blurEditorState(typed.value, typed).reviewed === true,
  );

  // Whitespace is not content.
  check("absent + whitespace only shows no badge", !shouldShowReviewBadge("absent", { ...empty, value: "   " }));

  // A found field always has a badge — there is evidence to act on either way.
  const mockState: Cat2EditorState = { value: MOCK_SAMPLE, placeholder: MOCK_SAMPLE, reviewed: false };
  check("found + untouched placeholder shows the badge", shouldShowReviewBadge("found", mockState));

  /* The case this must not swallow. */

  // A reviewer who clears the placeholder and leaves the field blank has made a
  // real decision. Same input shape as "absent + empty" — value "", no content —
  // and it MUST still show, because the field is `found`.
  const blankedOut = blurEditorState("", mockState);
  check("blanking out a placeholder still counts as reviewed", blankedOut.reviewed === true);
  check(
    "…and its Reviewed badge is still shown, though the editor is empty",
    shouldShowReviewBadge("found", blankedOut),
  );
  check(
    "…which is the whole reason the guard is gated on status, not on emptiness",
    !shouldShowReviewBadge("absent", { ...blankedOut, placeholder: "" }),
  );

  // Structural: the badge decision must stay out of the component, where the
  // last reviewed-state bug lived in an untestable inline expression.
  const componentSource = readFileSync(
    new URL("../src/components/fields/Category2Field.tsx", import.meta.url),
    "utf8",
  );
  check(
    "the component delegates the decision rather than inlining it",
    /shouldShowReviewBadge\(field\.status, state\)/.test(componentSource),
  );
  check(
    "…and the blur handler is still a single delegating call",
    /onBlur=\{\(event\) => onChange\?\.\(blurEditorState\(event\.target\.value, state\)\)\}/.test(
      componentSource,
    ),
  );
}

/**
 * Flow 2h — slimestory.com: page chrome must not become business content.
 *
 * The labels below are verbatim from a real fetch of slimestory.com — the scan
 * that produced "Skip to content", "Close" and "Cart 0" as calls to action, and
 * pushed empty-cart text into the Pitch snippets.
 *
 * Run against `extractCtas` and the transform layer directly rather than through
 * `parsePage`, which needs cheerio. That is a real gap in this harness and is
 * stated as such: what is proven here is that the exclusion rule is correct and
 * is called on both candidate streams, not that a live crawl of that URL is
 * clean. Confirming the latter needs `npm run scrape -- https://slimestory.com`
 * with dependencies installed.
 */
function slimestoryFlow() {
  section("Flow 2h — slimestory.com chrome does not reach the knowledge base");

  // Exactly as the site renders them, chrome and real content interleaved.
  const HEADER_AND_CHROME = [
    "Skip to content",
    "Search",
    "Close",
    "Register",
    "Log in",
    "Menu",
    "Cart 0",
    "Continue shopping",
    "Your cart is empty",
    "Country/region",
    "SOLD OUT",
  ];
  const REAL_CONTENT = [
    "MEET THE PICNIC PALS",
    "Learn More",
    "Shop All",
    "Shop Collection",
    "TRAVERSE THE WETLANDS",
    "Notify Me!",
    "Slimecyclopedia",
  ];

  for (const label of HEADER_AND_CHROME) {
    check(`  chrome: "${label}" excluded`, isUiNoise(label), uiNoiseReason(label));
  }
  for (const label of REAL_CONTENT) {
    check(`  content: "${label}" kept`, !isUiNoise(label));
  }

  // Pitch is a snippet field, and the chrome reached it through page text rather
  // than through the CTA parser — which is exactly why the exclusion had to move
  // above both. Simulate the post-parsePage paragraph stream.
  const rawParagraphs = [
    "Your cart is empty",
    "Slime Story makes collectible plush based on the creatures of five biomes.",
    "Skip to content",
    "Be the first to know about new drops, restocked items",
  ];
  const cleanParagraphs = rawParagraphs.filter((text) => !isUiNoise(text));
  check(
    "Pitch snippet candidates lose the chrome and keep the copy",
    cleanParagraphs.length === 2 &&
      cleanParagraphs[0]?.startsWith("Slime Story makes") === true &&
      cleanParagraphs[1]?.startsWith("Be the first") === true,
    cleanParagraphs,
  );

  const pitchDraft = draft("Slime Story", "https://slimestory.test", {
    positioning: {
      pitch: found(...cleanParagraphs.map((text) => snip("homepage", text))),
      foundingStory: absent,
    },
  });
  const pitchField = pitchDraft.positioning.pitch;
  check(
    "…so no Pitch snippet is page chrome",
    pitchField.status === "found" && pitchField.snippets.every((s) => !isUiNoise(s.text)),
  );

  // Spot-check the two fields the pattern could also reach. Both read short
  // strings off the page, which is the same shape of exposure.
  const faqCandidates = ["Do you ship internationally?", "Search", "Menu", "How long is shipping?"];
  check(
    "FAQ questions: chrome is excluded, real questions survive",
    faqCandidates.filter((q) => !isUiNoise(q)).length === 2,
  );
  const testimonialCandidates = [
    "Your cart is empty",
    "The plush arrived faster than expected and the stitching is lovely.",
    "———",
  ];
  check(
    "Testimonials: banner text and dividers are excluded, the quote survives",
    testimonialCandidates.filter((q) => !isUiNoise(q)).length === 1,
  );

  // The href rule, as a secondary signal rather than a sole one.
  check("a hrefless single-word control is dropped", isUiNoise("Close"));
  check(
    "…but a hrefless multi-word label is not chrome by itself",
    !isUiNoise("Notify Me!") && !isUiNoise("Get Started"),
  );

  /* --- A detected discount becomes promotion evidence --- */

  // Prices as the Dawn markup yields them once the strikethrough fix runs.
  const discounted = contextOf([
    pageStub({
      url: "https://slimestory.test/",
      candidates: {
        people: [],
        offerings: [
          { name: "Sweet Snail Slime Plush", description: null, features: [], priceText: "$28.00", originalPriceText: "$40.00", category: null },
          { name: "Picnic Pal Sticker Pack", description: null, features: [], priceText: "$7.00", originalPriceText: "$10.00", category: null },
          { name: "Deer Slime Plush", description: null, features: [], priceText: "$34.00", originalPriceText: null, category: null },
        ],
        testimonials: [],
        faq: [],
        certifications: [],
      },
    }),
  ]);
  const promotions = transformExtensions(discounted).currentPromotions;
  check("a detected discount reaches Current Promotions", promotions.status === "found", promotions);
  if (promotions.status === "found") {
    const texts = promotions.snippets.map((s) => s.text);
    check(
      "…stating both observed numbers and nothing else",
      texts.includes("Sweet Snail Slime Plush: was $40.00, now $28.00."),
      texts,
    );
    check("…for each discounted product", texts.some((t) => t.startsWith("Picnic Pal Sticker Pack")));
    check(
      "…and not for the undiscounted one",
      !texts.some((t) => t.startsWith("Deer Slime Plush")),
      texts,
    );
    check(
      "…claiming nothing about duration or seasonality",
      texts.every((t) => !/season|limited time|ends|for a limited/i.test(t)),
    );
  }

  // No discount anywhere: the field stays absent rather than inventing a sale.
  const undiscounted = contextOf([
    pageStub({
      url: "https://plain.test/",
      candidates: {
        people: [],
        offerings: [
          { name: "Deer Slime Plush", description: null, features: [], priceText: "$34.00", originalPriceText: null, category: null },
        ],
        testimonials: [], faq: [], certifications: [],
      },
    }),
  ]);
  check(
    "no discount means Current Promotions stays absent",
    transformExtensions(undiscounted).currentPromotions.status === "absent",
  );
}

/**
 * Flow 2g — the Art Style review journey.
 *
 * Art Style is the one field whose evidence is images rather than snippets, so
 * it is the one field that could break the generic Category 2 review wiring
 * without any other field noticing. This walks it end to end.
 */
function artStyleFlow() {
  section("Flow 2g — Art Style is reviewed like any other field, from different evidence");

  const withImages = draft("Redwood Joinery", "https://redwood.test");
  withImages.brandingAndStyle.artStyle = {
    status: "found",
    images: [
      { url: "https://redwood.test/wordmark.svg", alt: "Redwood Joinery", detectedVia: "og:image", sourceUrl: "https://redwood.test/" },
      { url: "https://redwood.test/favicon.ico", alt: null, detectedVia: "link[rel=icon]", sourceUrl: "https://redwood.test/" },
    ],
  };

  // It is still a Category 2 field, so the generic machinery must pick it up
  // with no special case anywhere.
  const review = initialReviewState(withImages);
  const editor = review.cat2["brandingAndStyle.artStyle"];
  check("an image-evidence field gets a Category 2 editor", Boolean(editor));
  check("…starting unreviewed, like every other field", editor?.reviewed === false);
  check("…pre-filled with a placeholder", (editor?.value.length ?? 0) > 0);
  check(
    "…whose wording is about looking, not about synthesising snippets",
    /looking at/.test(editor?.value ?? "") && !/source snippet/.test(editor?.value ?? ""),
  );
  check("…and it counts toward the reviewed-fields denominator", reviewedCount(review).total ===
    reviewedCount(initialReviewState(draft("X", "https://x.test"))).total);

  // The blank-out rule from the earlier reviewed-state fix must hold here too:
  // "I looked at the logo and there is nothing honest to say" is a real
  // decision, and this is the field where a reviewer is most likely to make it.
  if (editor) {
    check(
      "clearing the placeholder counts as reviewed here too",
      blurEditorState("", editor).reviewed === true,
    );
    check(
      "…while leaving it untouched does not",
      blurEditorState(editor.placeholder, editor).reviewed === false,
    );
  }

  // Absent behaves exactly as absent does everywhere else.
  const noImages = draft("Bare Co", "https://bare.test");
  const bareEditor = initialReviewState(noImages).cat2["brandingAndStyle.artStyle"];
  check("no image found means no placeholder at all", bareEditor?.value === "");
  check("…and the field is not reviewed by default", bareEditor?.reviewed === false);
  check(
    "…and it scores as missing, not as populated",
    computeCompleteness(noImages).missing.some(
      (field) => field.fieldPath === "brandingAndStyle.artStyle" && field.reason === "not-found",
    ),
  );
  check(
    "an image bundle scores as populated",
    !computeCompleteness(withImages).missing.some(
      (field) => field.fieldPath === "brandingAndStyle.artStyle",
    ),
  );
}

/**
 * Flow 2f — a reviewer clicks "+ Add" and then doesn't type anything.
 *
 * Reported against Industry Groupings, but the "+ Add" buttons behave the same
 * way on every list, so this walks a draft that has one abandoned row in each of
 * the four shapes: a string list, an object list, the required Offerings list,
 * and a custom note (which is outside the field registry and so needs its own
 * line in `draftToFinal`).
 */
function emptyEntryFlow() {
  section("Flow 2f — abandoned '+ Add' rows never reach storage");

  // Exactly what the UI produces: StringListField appends "", Category3Field
  // appends an all-null blankEntry(), CustomSectionsEditor appends "" / "".
  const dirty = draft("Blank Row Co", "https://blankrow.test", {
    keyPeople: [
      { name: "Dana Reyes", title: "Owner", gender: null, bio: null, credentials: [], sourceUrl: "https://blankrow.test/team" },
      { name: null, title: null, gender: null, bio: null, credentials: [], sourceUrl: null },
    ],
    offerings: [
      { name: "Roof repair", category: null, features: [], description: null, pricing: "from $400", sourceUrl: "https://blankrow.test" },
      { name: null, category: null, features: [], description: null, pricing: null, sourceUrl: null },
    ],
  });
  dirty.marketAndCustomers.industryGroupings = ["Roofing", "", "  ", "Gutters"];
  // Junk-only, so the score check below actually bites: a list of nothing but
  // abandoned rows must read as "not found", not as a populated field.
  dirty.companyFoundation.serviceLocations = ["", "   "];
  dirty.extensions.certifications = [
    { name: "GAF Master Elite", issuer: "GAF", year: 2019, sourceUrl: "https://blankrow.test" },
    { name: null, issuer: null, year: null, sourceUrl: null },
  ];
  dirty.customSections = [
    { id: "n1", title: "Owner prefers phone", content: "Email goes unread.", createdAt: "2026-02-13T11:00:00.000Z" },
    { id: "n2", title: "", content: "   ", createdAt: "2026-02-13T11:05:00.000Z" },
  ];

  // Before saving: the score must not count the junk rows as populated content.
  const clean = draft("Blank Row Co", "https://blankrow.test", {
    keyPeople: dirty.keyPeople.slice(0, 1) as PersonEntry[],
    offerings: dirty.offerings.slice(0, 1) as OfferingEntry[],
  });
  clean.marketAndCustomers.industryGroupings = ["Roofing", "Gutters"];
  clean.extensions.certifications = dirty.extensions.certifications.slice(0, 1);
  check(
    "a list of only junk rows does not inflate the score mid-review",
    computeCompleteness(dirty).score === computeCompleteness(clean).score,
    { dirty: computeCompleteness(dirty).score, clean: computeCompleteness(clean).score },
  );

  const review = initialReviewState(dirty);
  for (const p of ["companyFoundation.overview", "positioning.pitch"]) {
    const editor = review.cat2[p];
    if (editor) review.cat2[p] = { ...editor, value: `Reviewed text for ${p}.`, reviewed: true };
  }

  const result = draftToFinal(dirty, review);
  check("the draft still saves", result.ok, result.ok ? undefined : result.problems);
  if (!result.ok) return;

  const kb = result.knowledgeBase;
  check(
    "blank groupings are gone, real ones kept in order",
    JSON.stringify(kb.marketAndCustomers.industryGroupings) === JSON.stringify(["Roofing", "Gutters"]),
    kb.marketAndCustomers.industryGroupings,
  );
  check("the empty person row is gone", kb.keyPeople.length === 1 && kb.keyPeople[0]?.name === "Dana Reyes");
  check("the empty offering row is gone", kb.offerings.length === 1);
  check("the empty certification row is gone", kb.extensions.certifications.length === 1);
  check("the empty note is gone", kb.customSections.length === 1 && kb.customSections[0]?.id === "n1");

  // Pruning must not become deletion. Everything real survives untouched.
  check("the real certification kept its year", kb.extensions.certifications[0]?.year === 2019);
  check("the real offering kept its price", kb.offerings[0]?.pricing === "from $400");
  check("the reviewer's draft object was not mutated", dirty.keyPeople.length === 2);

  // The distinction the old `usableOfferings` filter got wrong: an offering with
  // real content but no readable heading is evidence, not an empty row.
  const namelessButReal = draft("Nameless Co", "https://nameless.test", {
    offerings: [
      { name: "Roof repair", category: null, features: [], description: null, pricing: null, sourceUrl: "u" },
      { name: null, category: null, features: ["Gutter guards"], description: "Seasonal clearing.", pricing: "$180", sourceUrl: "u" },
    ],
  });
  const namelessReview = initialReviewState(namelessButReal);
  for (const p of ["companyFoundation.overview", "positioning.pitch"]) {
    const editor = namelessReview.cat2[p];
    if (editor) namelessReview.cat2[p] = { ...editor, value: `Reviewed text for ${p}.`, reviewed: true };
  }
  const namelessResult = draftToFinal(namelessButReal, namelessReview);
  check("a described-but-unnamed offering survives the save", namelessResult.ok && namelessResult.knowledgeBase.offerings.length === 2);

  // …but it still cannot be the *only* offering: the required-field bar asks for
  // something a content app can actually write a post about.
  const onlyNameless = draft("Only Nameless Co", "https://onlynameless.test", {
    offerings: [
      { name: null, category: null, features: [], description: "We do things.", pricing: null, sourceUrl: "u" },
    ],
  });
  const onlyReview = initialReviewState(onlyNameless);
  for (const p of ["companyFoundation.overview", "positioning.pitch"]) {
    const editor = onlyReview.cat2[p];
    if (editor) onlyReview.cat2[p] = { ...editor, value: `Reviewed text for ${p}.`, reviewed: true };
  }
  const onlyResult = draftToFinal(onlyNameless, onlyReview);
  check(
    "an unnamed offering alone does not satisfy the requirement",
    !onlyResult.ok && onlyResult.problems.some((p) => p.fieldPath === "offerings"),
  );
}

async function customSectionsRoundTrip(
  kb: NonNullable<ReturnType<typeof customSectionsFlow>>,
) {
  section("Flow 2e — notes round-trip through storage as plain JSONB");

  const repo = new JsonKnowledgeRepository();
  const row = await repo.save({ knowledgeBase: kb, completenessScore: 40 });
  const loaded = await repo.get(row.id);

  check("notes are stored inside the data document", loaded?.data.customSections.length === 2);
  check(
    "…with content preserved exactly",
    loaded?.data.customSections[1]?.content === "Mentioned on a call; site not updated yet.",
  );
  check(
    "no promoted column was added for them",
    !Object.keys(row).some((key) => key.toLowerCase().includes("custom")),
    Object.keys(row),
  );
  const summary = (await repo.list()).find((item) => item.id === row.id);
  check(
    "they are not exposed on the list summary either",
    summary !== undefined &&
      !Object.keys(summary).some((key) => key.toLowerCase().includes("custom")),
  );

  // Leave the store as we found it — Flow 3 asserts on exact row counts, so a
  // leftover record here would fail it for the wrong reason.
  await repo.hardDelete(row.id);
  check("cleanup: the notes record is gone", (await repo.get(row.id)) === null);
}

/* ------------------------------------------------------------------ *
 * Flow 3 — persistence, delete/restore, retention
 * ------------------------------------------------------------------ */

async function storeFlow(kb: NonNullable<Awaited<ReturnType<typeof reviewFlow>>>) {
  section("Flow 3 — save, list, filter, soft/hard delete, restore, retention");

  const repo = new JsonKnowledgeRepository();
  const row = await repo.save({ knowledgeBase: kb, completenessScore: 42 });

  check("save returns a current, active row", row.isCurrent && row.status === "active");
  check("promoted columns are populated from the document", row.companyName === "NightOwl Monitoring" && row.industry !== null);
  check("site_language is promoted for the Languages filter", row.siteLanguage.includes("en-US"), row.siteLanguage);

  let list = await repo.list();
  check("it appears in the default list", list.length === 1);
  check("summary counts come from the document", list[0]?.offeringsCount === 3 && list[0]?.keyPeopleCount === 3, {
    o: list[0]?.offeringsCount, p: list[0]?.keyPeopleCount,
  });

  check("industry filter matches", (await repo.list({ industry: row.industry })).length === 1);
  check("industry filter excludes non-matches", (await repo.list({ industry: "Plumbing" })).length === 0);
  check("language filter matches", (await repo.list({ language: "en-US" })).length === 1);
  check("search by company name", (await repo.list({ search: "nightowl" })).length === 1);
  check("search by overview text", (await repo.list({ search: "water wells" })).length === 1);
  // The JSONB-path search target: a name nested inside data.keyPeople[].
  check("search by a Key Person's name (nested in the JSONB)", (await repo.list({ search: "jim blair" })).length === 1);
  check("search misses a name nobody has", (await repo.list({ search: "zzzz" })).length === 0);

  /* --- soft delete / restore --- */
  await repo.softDelete(row.id);
  check("soft-deleted rows leave the default list", (await repo.list()).length === 0);
  list = await repo.list({ includeDeleted: true });
  check("…but appear under 'show deleted'", list.length === 1);
  check("…flagged as soft_deleted so the card can dim them", list[0]?.status === "soft_deleted");
  check("…and are still fully readable", (await repo.get(row.id))?.data.companyFoundation.overview !== undefined);

  await repo.restore(row.id);
  check("restore puts it back in the default list", (await repo.list()).length === 1);

  /* --- section hide / restore --- */
  await repo.setSectionHidden(row.id, "people", true);
  let sections = await repo.sectionStatus(row.id);
  check("hiding a section records it", sections.find((s) => s.sectionName === "people")?.hidden === true);
  check("…with a timestamp", sections.find((s) => s.sectionName === "people")?.hiddenAt !== null);

  const hiddenCompleteness = computeCompleteness(row.data, { hiddenSections: ["people", "offerings"] });
  const plain = computeCompleteness(row.data);
  check("hidden fields leave the denominator rather than counting as failures", hiddenCompleteness.counted < plain.counted);
  check("hidden fields are reported with reason 'hidden'", hiddenCompleteness.missing.some((f) => f.reason === "hidden"));
  check(
    "a hidden REQUIRED field reads as hidden, not as never-found",
    hiddenRequiredFields(hiddenCompleteness).some((f) => f.fieldPath === "offerings"),
  );

  await repo.setSectionHidden(row.id, "people", false);
  sections = await repo.sectionStatus(row.id);
  check("restoring a section clears the flag", sections.find((s) => s.sectionName === "people")?.hidden === false);
  check("…and clears the timestamp", sections.find((s) => s.sectionName === "people")?.hiddenAt === null);

  /* --- version retention: cap of 5, oldest hard-deleted --- */
  section("Flow 3b — version retention (cap 5, oldest hard-deleted)");
  for (let i = 0; i < 7; i += 1) {
    await repo.save({ knowledgeBase: kb, completenessScore: 50 + i });
  }
  const current = (await repo.list())[0];
  if (!current) throw new Error("no current row after re-saves");
  const versions = await repo.versions(current.companyId);
  check("exactly one row stays current", (await repo.list()).length === 1);
  check("history is capped at 5 snapshots total", versions.length + 1 === 5, { history: versions.length });
  check("the newest save is the current one", current.completenessScore === 56, current.completenessScore);
  check("re-saving the same site does NOT create a second company",
    new Set([...versions.map((v) => v.companyId), current.companyId]).size === 1);

  /* --- hard delete --- */
  await repo.hardDelete(current.id);
  check("hard delete removes the row", (await repo.get(current.id)) === null);
  check("…and its section-status rows", (await repo.sectionStatus(current.id)).length === 0);
  check("…leaving the remaining history intact", (await repo.versions(current.companyId)).length === 4);
}

/* ------------------------------------------------------------------ */

async function main() {
  // Isolate from any real dev data.
  const dataDir = path.join(process.cwd(), ".data");
  await rm(dataDir, { recursive: true, force: true });

  const kb = await reviewFlow();
  sparseFlow();
  technobladeFlow();
  industryFlow();
  categoryOneAuditFlow();
  emptyEntryFlow();
  artStyleFlow();
  slimestoryFlow();
  reviewBadgeFlow();
  const noteKb = customSectionsFlow();
  if (noteKb) await customSectionsRoundTrip(noteKb);
  if (kb) await storeFlow(kb);
  else check("review flow produced a saveable knowledge base", false);

  await rm(dataDir, { recursive: true, force: true });

  console.log(`\n${failures === 0 ? "All flow checks passed." : `${failures} flow check(s) FAILED.`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
