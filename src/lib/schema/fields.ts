/**
 * The single source of truth for what fields exist, what category each belongs
 * to, and how each should be rendered.
 *
 * Both the /knowledge review UI and the read-only Detailed view on
 * /knowledge/view are driven off this registry, which is what lets them share
 * one set of category-display components instead of maintaining two hand-written
 * copies of a forty-field form.
 */

import type { CategoryGroupId } from "@/types/knowledge";

/** 1 = deterministic, 2 = narrative/synthesis, 3 = structured list. */
export type FieldCategory = 1 | 2 | 3;

export type FieldKind =
  | "text"
  | "longText"
  | "number"
  | "url"
  | "stringList"
  | "objectList"
  | "structured"
  | "language";

/**
 * Extractive fields lift one passage more or less verbatim, so one snippet is
 * shown expanded. Synthesis fields deliberately bundle several snippets from
 * different page types (to avoid single-page tone bias), so they collapse.
 */
export type SnippetDisplay = "expanded" | "collapsed";

/**
 * What a Category 2 field's evidence panel holds.
 *
 * `snippets` for all but one field. `images` for Art Style, which is a vision
 * task rather than a text-extraction one: the scraper can locate the candidate
 * images but nothing in this pipeline can look at them, so it carries the
 * pictures and leaves the describing to a vision model or a human.
 */
export type EvidenceKind = "snippets" | "images";

export type SubFieldSpec = {
  key: string;
  label: string;
  kind: "text" | "longText" | "number" | "url" | "stringList";
};

/**
 * Read-mode presentation for a Category 3 list whose entries have a distinctive
 * house format in the reference profiles. Affects display only — editing always
 * uses the generic labelled inputs, which is the right shape for a form.
 */
export type EntryFormat = "person" | "offering" | "logo";

export type FieldSpec = {
  /** Dot path into KnowledgeBaseDraft / KnowledgeBase. Stable identifier. */
  path: string;
  label: string;
  group: CategoryGroupId;
  category: FieldCategory;
  kind: FieldKind;
  /** Only Overview, Pitch and at least one Offering are required (§5). */
  required?: boolean;
  /** Category 2 only. */
  snippetDisplay?: SnippetDisplay;
  /** Category 2 only. Defaults to "snippets" when unset. */
  evidence?: EvidenceKind;
  /** Category 3 / structured only: describes each entry's editable sub-fields. */
  subFields?: SubFieldSpec[];
  /** Category 3 only: use a house-format renderer in read mode. */
  entryFormat?: EntryFormat;
  /**
   * One short sentence, rendered muted directly under the label — in the
   * **review UI only**, never in the read-only Detailed view.
   *
   * This is a disambiguation aid, not documentation. It exists for the fields a
   * reviewer could plausibly confuse with a neighbour (Overview vs Pitch, Ideal
   * Persona vs Demographic Detail, Differentiators vs Values) or whose scope is
   * not obvious from the label (Current Promotions being a scan-time snapshot).
   *
   * Fields whose label already says everything — Website, Industry, Year Founded
   * — deliberately have none. A description there is noise competing with the
   * value itself.
   */
  help?: string;
};

const PERSON_SUBFIELDS: SubFieldSpec[] = [
  { key: "name", label: "Name", kind: "text" },
  { key: "title", label: "Title", kind: "text" },
  { key: "gender", label: "Gender", kind: "text" },
  { key: "bio", label: "Bio", kind: "longText" },
  { key: "credentials", label: "Credentials", kind: "stringList" },
];

const OFFERING_SUBFIELDS: SubFieldSpec[] = [
  { key: "name", label: "Name", kind: "text" },
  { key: "category", label: "Category", kind: "text" },
  { key: "description", label: "Description", kind: "longText" },
  { key: "features", label: "Features", kind: "stringList" },
  { key: "pricing", label: "Pricing", kind: "text" },
];

export const FIELD_SPECS: FieldSpec[] = [
  /* ---------------- Company Foundation ---------------- */
  {
    path: "companyFoundation.overview",
    label: "Overview",
    group: "foundation",
    category: 2,
    kind: "longText",
    required: true,
    snippetDisplay: "expanded",
    help: "Factual, third-person description of what the company does — not persuasive.",
  },
  {
    path: "companyFoundation.companyName",
    label: "Company Name",
    group: "foundation",
    category: 1,
    kind: "text",
  },
  {
    path: "companyFoundation.website",
    label: "Website",
    group: "foundation",
    category: 1,
    kind: "url",
  },
  {
    path: "companyFoundation.industry",
    label: "Industry",
    group: "foundation",
    category: 1,
    kind: "text",
  },
  {
    path: "companyFoundation.businessModel",
    label: "Business Model",
    group: "foundation",
    category: 1,
    kind: "text",
    help: "How it charges or operates, e.g. subscription, flat rate, by appointment.",
  },
  {
    path: "companyFoundation.companyRole",
    label: "Company Role",
    group: "foundation",
    category: 1,
    kind: "text",
    help: "What kind of operation it is — retailer, manufacturer, service provider.",
  },
  {
    path: "companyFoundation.yearFounded",
    label: "Year Founded",
    group: "foundation",
    category: 1,
    kind: "number",
  },
  {
    path: "companyFoundation.legalEntityType",
    label: "Legal Entity Type",
    group: "foundation",
    category: 1,
    kind: "text",
  },
  {
    path: "companyFoundation.employeeCount",
    label: "Employee Count",
    group: "foundation",
    category: 1,
    kind: "text",
  },
  {
    path: "companyFoundation.mainAddress",
    label: "Main Address",
    group: "foundation",
    category: 1,
    kind: "text",
  },
  {
    path: "companyFoundation.otherLocations",
    label: "Other Locations",
    group: "foundation",
    category: 3,
    kind: "objectList",
    subFields: [
      { key: "label", label: "Label", kind: "text" },
      { key: "address", label: "Address", kind: "text" },
    ],
  },
  {
    path: "companyFoundation.serviceLocations",
    label: "Service Locations",
    group: "foundation",
    category: 3,
    kind: "stringList",
    help: "Areas the business says it serves.",
  },
  {
    path: "companyFoundation.alternativeCompanyNames",
    label: "Alternative Company Names",
    group: "foundation",
    category: 3,
    kind: "stringList",
  },

  /* ---------------- Positioning ---------------- */
  {
    path: "positioning.pitch",
    label: "Pitch",
    group: "positioning",
    category: 2,
    kind: "longText",
    required: true,
    snippetDisplay: "expanded",
    help: "Persuasive, second-person appeal to a prospective customer — not the factual Overview.",
  },
  {
    path: "positioning.foundingStory",
    label: "Founding Story",
    group: "positioning",
    category: 2,
    kind: "longText",
    snippetDisplay: "expanded",
    help: "How and why the company started, if it says so; Overview covers what it does now.",
  },

  /* ---------------- Market & Customers ---------------- */
  {
    path: "marketAndCustomers.targetBuyers",
    label: "Target Buyers",
    group: "market",
    category: 2,
    kind: "longText",
    snippetDisplay: "collapsed",
    help: "Who the company says it sells to.",
  },
  {
    path: "marketAndCustomers.customerNeeds",
    label: "Customer Needs",
    group: "market",
    category: 2,
    kind: "longText",
    snippetDisplay: "collapsed",
    help: "The problems customers come to them with.",
  },
  {
    path: "marketAndCustomers.idealCustomerPersona",
    label: "Ideal Customer Persona",
    group: "market",
    category: 2,
    kind: "longText",
    snippetDisplay: "collapsed",
    help: "Narrative portrait of the ideal customer; Demographic Detail holds the structured version.",
  },
  {
    path: "marketAndCustomers.industryGroupings",
    label: "Industry Groupings",
    group: "market",
    category: 3,
    kind: "stringList",
    help: "The company's own service taxonomy.",
  },
  {
    path: "marketAndCustomers.industryOutlook",
    label: "Industry Outlook",
    group: "market",
    category: 2,
    kind: "longText",
    snippetDisplay: "collapsed",
    help: "What the company says about its own market, if anything.",
  },
  {
    path: "marketAndCustomers.channels",
    label: "Channels",
    group: "market",
    category: 3,
    kind: "stringList",
    help: "How the business reaches market, e.g. phone, online booking, in person.",
  },
  {
    path: "marketAndCustomers.funnels",
    label: "Funnels",
    group: "market",
    category: 3,
    kind: "stringList",
    help: "Named conversion mechanisms; the CTAs field holds the actual links.",
  },
  {
    path: "marketAndCustomers.ctas",
    label: "CTAs",
    group: "market",
    category: 3,
    kind: "objectList",
    subFields: [
      { key: "label", label: "Label", kind: "text" },
      { key: "href", label: "Target", kind: "text" },
      { key: "kind", label: "Kind", kind: "text" },
    ],
    help: "The business's own calls to action, including numbers written as plain text.",
  },
  {
    path: "marketAndCustomers.suppliersPartners",
    label: "Suppliers & Partners",
    group: "market",
    category: 3,
    kind: "objectList",
    subFields: [
      { key: "name", label: "Name", kind: "text" },
      { key: "domain", label: "Domain", kind: "text" },
      { key: "detectedVia", label: "Detected via", kind: "text" },
    ],
    help: "Detected from third-party scripts and embeds, not from prose.",
  },

  /* ---------------- Branding & Style ---------------- */
  {
    path: "brandingAndStyle.writingStyle",
    label: "Writing Style",
    group: "branding",
    category: 2,
    kind: "longText",
    snippetDisplay: "collapsed",
    help: "Sampled across several page types so one page's tone doesn't dominate.",
  },
  {
    path: "brandingAndStyle.artStyle",
    label: "Art Style",
    group: "branding",
    category: 2,
    kind: "longText",
    evidence: "images",
    help: "The scan can find the brand's images but cannot see them — describe what you see below.",
  },
  {
    path: "brandingAndStyle.fonts",
    label: "Fonts",
    group: "branding",
    category: 1,
    kind: "stringList",
  },
  {
    path: "brandingAndStyle.brandColors",
    label: "Brand Colors",
    group: "branding",
    category: 1,
    kind: "stringList",
  },
  {
    path: "brandingAndStyle.logos",
    label: "Logos",
    group: "branding",
    category: 3,
    kind: "objectList",
    subFields: [
      { key: "url", label: "URL", kind: "url" },
      { key: "alt", label: "Alt text", kind: "text" },
      { key: "detectedVia", label: "Detected via", kind: "text" },
    ],
    // Read mode renders the actual image with a save link, rather than a bare
    // URL string. These are the same images Art Style carries as evidence, and
    // the persisted record is the only place they survive — see `LogoEntryView`.
    entryFormat: "logo",
    help: "The same images Art Style is described from, kept so it can be checked against them.",
  },

  /* ---------------- Online Presence ---------------- */
  {
    path: "onlinePresence.socialMediaLinks",
    label: "Social Media Links",
    group: "presence",
    category: 3,
    kind: "objectList",
    subFields: [
      { key: "platform", label: "Platform", kind: "text" },
      { key: "url", label: "URL", kind: "url" },
    ],
  },

  /* ---------------- Key People ---------------- */
  {
    path: "keyPeople",
    label: "Key People",
    group: "people",
    category: 3,
    kind: "objectList",
    subFields: PERSON_SUBFIELDS,
    entryFormat: "person",
    help: "Read only from Team and About pages; gender comes from pronouns, never from a name.",
  },

  /* ---------------- Offerings ---------------- */
  {
    path: "offerings",
    label: "Offerings",
    group: "offerings",
    category: 3,
    kind: "objectList",
    required: true,
    subFields: OFFERING_SUBFIELDS,
    entryFormat: "offering",
    help: "At least one is required to save.",
  },

  /* ---------------- Extended Signals ---------------- */
  {
    path: "extensions.siteLanguage",
    label: "Languages",
    group: "extensions",
    category: 1,
    kind: "language",
    help: "From the page's own lang and hreflang tags only, never from language names in prose.",
  },
  {
    path: "extensions.demographicDetail",
    label: "Demographic Detail",
    group: "extensions",
    category: 1,
    kind: "structured",
    subFields: [
      { key: "ageRange", label: "Age range", kind: "text" },
      { key: "incomeBracket", label: "Income bracket", kind: "text" },
      { key: "householdType", label: "Household type", kind: "text" },
    ],
    help: "Structured age, income and household data — the filterable counterpart to the prose persona.",
  },
  {
    path: "extensions.valuesAndSocialPositioning",
    label: "Values & Social Positioning",
    group: "extensions",
    category: 2,
    kind: "longText",
    snippetDisplay: "collapsed",
    help: "Community, sustainability and values-driven messaging — not competitive claims.",
  },
  {
    path: "extensions.testimonials",
    label: "Testimonials & Social Proof",
    group: "extensions",
    category: 3,
    kind: "objectList",
    subFields: [
      { key: "quote", label: "Quote", kind: "longText" },
      { key: "attributedTo", label: "Attributed to", kind: "text" },
      { key: "source", label: "Source", kind: "text" },
    ],
    help: "Quotes the company chose to publish — curated, not a representative sample.",
  },
  {
    path: "extensions.faq",
    label: "FAQ & Common Objections",
    group: "extensions",
    category: 3,
    kind: "objectList",
    subFields: [
      { key: "question", label: "Question", kind: "text" },
      { key: "answer", label: "Answer", kind: "longText" },
    ],
    help: "Objections the company pre-empts; a site never publishes its actual complaints.",
  },
  {
    path: "extensions.differentiators",
    label: "Differentiators & USPs",
    group: "extensions",
    category: 2,
    kind: "longText",
    snippetDisplay: "collapsed",
    help: "Points of difference the company claims against competitors.",
  },
  {
    path: "extensions.certifications",
    label: "Certifications, Awards & Credentials",
    group: "extensions",
    category: 3,
    kind: "objectList",
    subFields: [
      { key: "name", label: "Name", kind: "text" },
      { key: "issuer", label: "Issuer", kind: "text" },
      { key: "year", label: "Year", kind: "number" },
    ],
    help: "Organisation-level only; an individual's credentials live on their Key People entry.",
  },
  {
    path: "extensions.contentThemes",
    label: "Content Themes",
    group: "extensions",
    category: 3,
    kind: "objectList",
    subFields: [
      { key: "theme", label: "Theme", kind: "text" },
      { key: "mentions", label: "Mentions", kind: "number" },
      { key: "examples", label: "Seen in", kind: "stringList" },
    ],
    help: "Subjects the site returns to repeatedly — a topic list for blogs and posts.",
  },
  {
    path: "extensions.legalAndCompliance",
    label: "Legal & Compliance Language",
    group: "extensions",
    category: 3,
    kind: "objectList",
    subFields: [
      { key: "kind", label: "Kind", kind: "text" },
      { key: "text", label: "Clause", kind: "longText" },
    ],
    help: "Published commitments that generated copy must not contradict, stored word for word.",
  },
  {
    path: "extensions.currentPromotions",
    label: "Current Promotions",
    group: "extensions",
    category: 2,
    kind: "longText",
    snippetDisplay: "expanded",
    help: "A snapshot of what was on the site at scan time, not a recurring seasonal pattern.",
  },
];

/* ------------------------------------------------------------------ *
 * Derived lookups
 * ------------------------------------------------------------------ */

export const FIELD_SPECS_BY_PATH: Record<string, FieldSpec> = Object.fromEntries(
  FIELD_SPECS.map((spec) => [spec.path, spec]),
);

export function fieldsInGroup(group: CategoryGroupId): FieldSpec[] {
  return FIELD_SPECS.filter((spec) => spec.group === group);
}

export function category2Fields(): FieldSpec[] {
  return FIELD_SPECS.filter((spec) => spec.category === 2);
}

export function requiredFields(): FieldSpec[] {
  return FIELD_SPECS.filter((spec) => spec.required === true);
}

export function getFieldSpec(path: string): FieldSpec | undefined {
  return FIELD_SPECS_BY_PATH[path];
}
