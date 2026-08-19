/**
 * The three type families of the MoKnowledge schema.
 *
 * These are deliberately NOT expressed as `Partial<KnowledgeBase>` for the draft.
 * The draft and the final saved object diverge at the *field-shape* level, not
 * merely at optionality: a narrative field is a snippet bundle in the draft and a
 * plain string in the final object. `Partial<>` can only make keys optional; it
 * cannot change a field's type, so it cannot express this difference.
 *
 *   Category 1 — deterministic structural facts. Plain nullable values, no wrapper.
 *                Found, or `null`. There is no partial state and no guessing.
 *   Category 2 — narrative / synthesis fields. Always array-shaped snippet bundles.
 *                Extractive fields typically carry one snippet; synthesis fields
 *                carry several, drawn from multiple page types on purpose.
 *   Category 3 — structured lists. Arrays of objects whose sub-fields are each
 *                individually nullable. An empty array is a valid FINAL state,
 *                not an error and not a failure to extract.
 */

/* ------------------------------------------------------------------ *
 * Shared primitives
 * ------------------------------------------------------------------ */

/** Page-type tag describing where a snippet came from. Powers UI provenance. */
export type PageType =
  | "homepage"
  | "about"
  | "team"
  | "services"
  | "contact"
  | "blog"
  | "pricing"
  | "testimonials"
  | "faq"
  | "unknown";

export type Snippet = {
  /** Page-type this text was lifted from, e.g. "about". */
  source: PageType;
  /** Absolute URL of the page, so provenance survives outside the scan session. */
  sourceUrl: string;
  text: string;
};

/**
 * Category 2 field. `absent` means there was genuinely no candidate content —
 * never "the content we found looked too short to be good". Quality judgment is
 * the reviewer's job (in production, the LLM's), not the scraper's.
 */
export type Category2Field =
  | { status: "found"; snippets: Snippet[] }
  | { status: "absent" };

/**
 * A candidate image located by the scraper, carried as evidence rather than
 * described. Nothing in this pipeline opens the file — `alt` is the site's own
 * caption, reproduced verbatim, and `detectedVia` records how the URL was found.
 */
export type ImageEvidence = {
  url: string;
  /** The site's published alt text, or null. Never written by us. */
  alt: string | null;
  /** "og:image" | "img[logo]" | "header img" | "link[rel=icon]". */
  detectedVia: string | null;
  /** Page the image was referenced from, so provenance survives export. */
  sourceUrl: string;
};

/**
 * A Category 2 field whose evidence is images instead of text.
 *
 * Art Style is the only one, and it exists because Art Style is a *vision* task,
 * not a text-extraction gap. Fonts, Industry and Year Founded were all cases of
 * the scraper looking in too few places; describing a brand's composition,
 * colour story and typographic character is not — it requires looking at the
 * picture, which `cheerio` and Readability structurally cannot do. Bundling
 * alt-text strings and calling them "art style evidence" would have described
 * captions while implying the images had been examined.
 *
 * So extraction is scoped to what a text pipeline can honestly do — locate the
 * candidate images — and the description is left to whoever can actually see
 * them: a vision-capable model (out of scope for this build, sketched in
 * `/prompts/04-art-style-vision.md`) or the reviewer.
 *
 * The saved value is still a plain string, exactly like every other Category 2
 * field. Only the evidence type differs, which is why `draftToFinal` and
 * completeness scoring need no special case: both read `status`.
 */
export type Category2VisualField =
  | { status: "found"; images: ImageEvidence[] }
  | { status: "absent" };

/* ------------------------------------------------------------------ *
 * Category 3 entry shapes — every sub-field independently nullable
 * ------------------------------------------------------------------ */

export type PersonEntry = {
  name: string | null;
  title: string | null;
  /**
   * Never inferred from a first name or a photo. Only populated when the page
   * text itself uses unambiguous gendered pronouns for this person.
   */
  gender: string | null;
  bio: string | null;
  /** Person-level credentials (a CPA licence belongs to the person, not the org). */
  credentials: string[];
  sourceUrl: string | null;
};

export type OfferingEntry = {
  name: string | null;
  category: string | null;
  features: string[];
  description: string | null;
  pricing: string | null;
  sourceUrl: string | null;
};

export type TestimonialEntry = {
  quote: string | null;
  attributedTo: string | null;
  source: string | null;
  sourceUrl: string | null;
};

export type FaqEntry = {
  question: string | null;
  answer: string | null;
  sourceUrl: string | null;
};

export type CertificationEntry = {
  name: string | null;
  issuer: string | null;
  year: number | null;
  sourceUrl: string | null;
};

export type LogoEntry = {
  url: string | null;
  alt: string | null;
  /** "og:image" | "link[rel=icon]" | "img" — how the logo was identified. */
  detectedVia: string | null;
};

export type SocialLinkEntry = {
  /** Matched against the static known-social-domain list. */
  platform: string | null;
  url: string;
};

export type CtaEntry = {
  /** Button/link text, e.g. "Book a free estimate". */
  label: string | null;
  href: string | null;
  /** "form" | "tel" | "mailto" | "booking" | "link" */
  kind: string | null;
  sourceUrl: string | null;
};

export type PartnerEntry = {
  name: string | null;
  /**
   * Extracted by third-party script/embed detection (tracking pixels, widget
   * hosts), NOT by reading prose — companies rarely state partnerships in text.
   */
  detectedVia: string | null;
  domain: string | null;
};

export type LocationEntry = {
  label: string | null;
  address: string | null;
};

/* ------------------------------------------------------------------ *
 * Think-bigger extension sub-shapes
 * ------------------------------------------------------------------ */

/**
 * Deterministic. Sourced ONLY from `<html lang>` and `<link rel="alternate"
 * hreflang>`. We deliberately do not keyword-detect language names in prose:
 * "French doors" and "Chinese market" are not language-support signals.
 */
export type SiteLanguage = {
  main: string | null;
  alternates: string[];
};

/** Structured counterpart to the prose Ideal Customer Persona field. */
export type DemographicDetail = {
  ageRange: string | null;
  incomeBracket: string | null;
  householdType: string | null;
};

/* ------------------------------------------------------------------ *
 * Scan status
 * ------------------------------------------------------------------ */

/**
 * `partial` means the crawl timed out mid-flight and we kept what we had.
 * This is tracked separately from completeness on purpose: completeness scoring
 * treats every absent field identically regardless of cause (§8), and the
 * *reason* lives here instead of distorting the score.
 */
export type ScanStatus = "complete" | "partial" | "failed";

export type ScanMeta = {
  status: ScanStatus;
  startedAt: string;
  finishedAt: string;
  requestedUrl: string;
  resolvedUrl: string;
  pagesFetched: { url: string; pageType: PageType }[];
  /** Pages we discovered and intended to fetch but never completed. Fuels retry. */
  pagesFailed: { url: string; pageType: PageType; reason: string }[];
  durationMs: number;
};

/* ------------------------------------------------------------------ *
 * DRAFT — the natural output of the pure transform layer
 * ------------------------------------------------------------------ */

export type DraftCompanyFoundation = {
  /** Category 2, REQUIRED. */
  overview: Category2Field;
  companyName: string | null;
  website: string | null;
  industry: string | null;
  businessModel: string | null;
  companyRole: string | null;
  yearFounded: number | null;
  legalEntityType: string | null;
  employeeCount: string | null;
  mainAddress: string | null;
  otherLocations: LocationEntry[];
  serviceLocations: string[];
  alternativeCompanyNames: string[];
};

export type DraftPositioning = {
  /** Category 2, REQUIRED. */
  pitch: Category2Field;
  foundingStory: Category2Field;
};

export type DraftMarketAndCustomers = {
  targetBuyers: Category2Field;
  customerNeeds: Category2Field;
  idealCustomerPersona: Category2Field;
  industryGroupings: string[];
  industryOutlook: Category2Field;
  /**
   * How the business reaches market, as categories: "Online (website forms)",
   * "Phone", "In person". Plain strings because a channel is a category, not a
   * destination — there is nothing to link to.
   */
  channels: string[];
  /**
   * Named conversion mechanisms: "Newsletter signup", "Appointment scheduler",
   * "Content marketing (blog)".
   *
   * Also plain strings, and deliberately so. Unlike a CTA, a funnel has no single
   * href — "newsletter signup" is a Mailchimp embed, a footer field and a form
   * all at once — so there is no destination to carry. It is an aggregate over
   * the whole site, like serviceLocations and industryGroupings.
   */
  funnels: string[];
  /**
   * Individual calls to action. This one IS a destination, so it keeps the full
   * CtaEntry shape: label, href, kind and the page it was found on.
   */
  ctas: CtaEntry[];
  suppliersPartners: PartnerEntry[];
};

export type DraftBrandingAndStyle = {
  writingStyle: Category2Field;
  /** Images, not snippets — see `Category2VisualField`. */
  artStyle: Category2VisualField;
  fonts: string[];
  brandColors: string[];
  logos: LogoEntry[];
};

export type DraftOnlinePresence = {
  socialMediaLinks: SocialLinkEntry[];
};

export type ContentThemeEntry = {
  /** The recurring subject itself, e.g. "drought-tolerant planting". */
  theme: string | null;
  /** How many distinct places on the site it surfaced. Evidence of recurrence. */
  mentions: number;
  /** Where it appeared, so a reviewer can judge whether it is a real theme. */
  examples: string[];
};

export type LegalLanguageEntry = {
  /** "privacy" | "terms" | "disclaimer" | "accessibility" | "guarantee" | … */
  kind: string | null;
  /** The literal clause found. Never paraphrased — legal wording is the fact. */
  text: string | null;
  sourceUrl: string | null;
};

export type DraftExtensions = {
  siteLanguage: SiteLanguage;
  demographicDetail: DemographicDetail;
  valuesAndSocialPositioning: Category2Field;
  testimonials: TestimonialEntry[];
  faq: FaqEntry[];
  differentiators: Category2Field;
  certifications: CertificationEntry[];
  /**
   * Recurring subjects the business writes about. Frequency-ranked from headings,
   * nav labels and offering names — evidence of what they talk about, which is
   * what a blog or social generator needs before it can pick a topic.
   */
  contentThemes: ContentThemeEntry[];
  /**
   * Privacy, terms, disclaimer and guarantee language. Stored verbatim: a
   * downstream generator needs to know the constraints it must not contradict,
   * and a paraphrased disclaimer is worse than none.
   */
  legalAndCompliance: LegalLanguageEntry[];
  /**
   * A snapshot of promotional language present at scrape time. A single scrape
   * cannot observe a pattern over time, so nothing here claims seasonality.
   */
  currentPromotions: Category2Field;
};

/**
 * A freeform note written by the reviewer.
 *
 * Deliberately outside the Category 1/2/3 taxonomy, because that taxonomy
 * describes *how something was extracted* — and nothing here is extracted. The
 * scraper never writes to this array, it has no found/absent status, no source
 * snippets, no placeholder and no reviewed flag: content authored from scratch
 * has nothing to be reviewed against.
 *
 * Being outside the taxonomy also means it is outside the field registry, which
 * is what keeps it out of completeness scoring and required-field validation for
 * free, rather than by special-casing it in either.
 *
 * Plain title + text on purpose. Structured custom fields are a much larger
 * feature — user-defined types, validation, migration of existing records — and
 * would be a separate design, not an extension of this.
 */
export type CustomSection = {
  id: string;
  title: string;
  content: string;
  /** Set when the reviewer adds the note, not when the scan ran. */
  createdAt: string;
};

/**
 * Every field is present in some form — populated, snippet-bundled, or explicitly
 * absent. A key is never simply missing.
 */
export type KnowledgeBaseDraft = {
  schemaVersion: 1;
  scan: ScanMeta;
  companyFoundation: DraftCompanyFoundation;
  positioning: DraftPositioning;
  marketAndCustomers: DraftMarketAndCustomers;
  brandingAndStyle: DraftBrandingAndStyle;
  onlinePresence: DraftOnlinePresence;
  keyPeople: PersonEntry[];
  offerings: OfferingEntry[];
  extensions: DraftExtensions;
  /** User-authored. Always starts empty — the scraper never writes here. */
  customSections: CustomSection[];
};

/* ------------------------------------------------------------------ *
 * FINAL — the saved shape produced by draftToFinal()
 * ------------------------------------------------------------------ */

export type FinalCompanyFoundation = Omit<DraftCompanyFoundation, "overview"> & {
  /** Required: validation guarantees a non-empty, reviewed string. */
  overview: string;
};

export type FinalPositioning = {
  /** Required. */
  pitch: string;
  foundingStory: string | null;
};

export type FinalMarketAndCustomers = Omit<
  DraftMarketAndCustomers,
  "targetBuyers" | "customerNeeds" | "idealCustomerPersona" | "industryOutlook"
> & {
  targetBuyers: string | null;
  customerNeeds: string | null;
  idealCustomerPersona: string | null;
  industryOutlook: string | null;
};

export type FinalBrandingAndStyle = Omit<
  DraftBrandingAndStyle,
  "writingStyle" | "artStyle"
> & {
  writingStyle: string | null;
  artStyle: string | null;
};

export type FinalExtensions = Omit<
  DraftExtensions,
  "valuesAndSocialPositioning" | "differentiators" | "currentPromotions"
> & {
  valuesAndSocialPositioning: string | null;
  differentiators: string | null;
  currentPromotions: string | null;
};

export type KnowledgeBase = {
  schemaVersion: 1;
  id: string;
  companyId: string;
  savedAt: string;
  scan: ScanMeta;
  companyFoundation: FinalCompanyFoundation;
  positioning: FinalPositioning;
  marketAndCustomers: FinalMarketAndCustomers;
  brandingAndStyle: FinalBrandingAndStyle;
  onlinePresence: DraftOnlinePresence;
  keyPeople: PersonEntry[];
  /** Required: at least one entry. */
  offerings: OfferingEntry[];
  extensions: FinalExtensions;
  customSections: CustomSection[];
};

/* ------------------------------------------------------------------ *
 * Category group identifiers, shared by the review UI and the detail view
 * ------------------------------------------------------------------ */

export const CATEGORY_GROUP_IDS = [
  "foundation",
  "positioning",
  "market",
  "branding",
  "presence",
  "people",
  "offerings",
  "extensions",
] as const;

export type CategoryGroupId = (typeof CATEGORY_GROUP_IDS)[number];

export const CATEGORY_GROUP_LABELS: Record<CategoryGroupId, string> = {
  foundation: "Company Foundation",
  positioning: "Positioning",
  market: "Market & Customers",
  branding: "Branding & Style",
  presence: "Online Presence",
  people: "Key People",
  offerings: "Offerings",
  extensions: "Extended Signals",
};
