/**
 * Types describing the raw material that flows *into* the transform layer.
 *
 * Everything here is produced server-side (discovery → fetch → parse). The
 * transform layer consumes `RawScrape` and nothing else; it performs no I/O,
 * which is what makes it a pure synchronous function and trivially testable.
 */

import type {
  CtaEntry,
  LegalLanguageEntry,
  LogoEntry,
  PageType,
  PartnerEntry,
  ScanStatus,
  SocialLinkEntry,
} from "./knowledge";

/* ------------------------------------------------------------------ *
 * Discovery
 * ------------------------------------------------------------------ */

/**
 * How a candidate page was discovered, in descending order of signal quality.
 * `path-probe` is the last-resort tier that hedges against JS-rendered navigation
 * the HTML fetch never sees — see lib/discovery/probePaths.ts.
 */
export type DiscoverySource =
  | "homepage"
  | "nav-link"
  | "footer-link"
  | "sitemap"
  | "path-probe";

export type PageCandidate = {
  url: string;
  /**
   * A single link may legitimately match several categories (e.g. an
   * "About our team" link). We allow that rather than forcing exclusivity.
   */
  pageTypes: PageType[];
  discoveredVia: DiscoverySource;
  /** The anchor text that triggered classification. Useful for debugging. */
  linkText: string | null;
};

export type DiscoveryResult = {
  homepageUrl: string;
  candidates: PageCandidate[];
  /** Categories that produced no candidate from nav/footer and fell back to sitemap. */
  sitemapFallbackUsed: PageType[];
  /** Categories with no candidate anywhere. Accepted, not force-crawled. */
  unmatchedPageTypes: PageType[];
  /**
   * True when no nav/footer link classified at all and discovery widened to every
   * in-site link. Usually means the navigation is rendered client-side.
   */
  navLinksUnusable: boolean;
};

/* ------------------------------------------------------------------ *
 * Fetch
 * ------------------------------------------------------------------ */

export type FetchFailureReason =
  | "dns"
  | "connection-refused"
  | "blocked"
  | "http-error"
  | "timeout"
  | "not-html"
  | "unknown";

export type FetchedPage = {
  url: string;
  finalUrl: string;
  pageTypes: PageType[];
  status: number;
  html: string;
  fetchedAt: string;
};

export type FailedPage = {
  url: string;
  pageTypes: PageType[];
  reason: FetchFailureReason;
  message: string;
};

/* ------------------------------------------------------------------ *
 * Parse
 * ------------------------------------------------------------------ */

/** Free-text block lifted from a page, already tagged with its provenance. */
export type TextBlock = {
  source: PageType;
  sourceUrl: string;
  text: string;
};

export type StructuredData = {
  /** Parsed <script type="application/ld+json"> objects, flattened from @graph. */
  jsonLd: Record<string, unknown>[];
  /** og:* and twitter:* meta tags, keyed without the prefix colon. */
  openGraph: Record<string, string>;
  /** Plain <meta name=...> tags of interest (description, author, generator). */
  meta: Record<string, string>;
};

export type BrandSignals = {
  /** Hex/rgb values harvested from inline styles, <style> blocks and stylesheets. */
  colors: string[];
  /** Font family names from @font-face, font-family declarations and Google Fonts links. */
  fonts: string[];
  logos: LogoEntry[];
};

export type LanguageSignals = {
  /** From <html lang>. */
  htmlLang: string | null;
  /** From <link rel="alternate" hreflang="..">, excluding x-default. */
  hreflang: string[];
};

/** Everything one page yields after parsing. */
export type ParsedPage = {
  url: string;
  pageTypes: PageType[];
  title: string | null;
  /** Readability's main-article text, boilerplate stripped. */
  mainContent: string | null;
  /** Paragraph-level blocks of the main content, for snippet bundling. */
  paragraphs: string[];
  headings: { level: number; text: string }[];
  listItems: string[];
  structuredData: StructuredData;
  brand: BrandSignals;
  language: LanguageSignals;
  socialLinks: SocialLinkEntry[];
  ctas: CtaEntry[];
  partners: PartnerEntry[];
  /** Privacy, terms, disclaimer and guarantee clauses, stored verbatim. */
  legal: LegalLanguageEntry[];
  /** Raw candidate blocks for Category 3 extraction, kept unresolved. */
  candidates: {
    people: RawPersonCandidate[];
    offerings: RawOfferingCandidate[];
    testimonials: RawTestimonialCandidate[];
    faq: RawFaqCandidate[];
    certifications: RawCertificationCandidate[];
  };
  contact: {
    emails: string[];
    phones: string[];
    addresses: string[];
  };
};

export type RawPersonCandidate = {
  name: string | null;
  title: string | null;
  bio: string | null;
  /** Pronouns literally present in the bio text; never inferred from a name. */
  pronounsFound: string[];
  credentials: string[];
};

export type RawOfferingCandidate = {
  name: string | null;
  description: string | null;
  features: string[];
  /** What a customer pays today. On a discounted product, the sale price. */
  priceText: string | null;
  /**
   * The struck-through price, when the page showed one alongside a lower
   * current price. Null when there is no discount — "was $40" with no "now" is
   * not a sale, it is just a price.
   *
   * Raw-layer only, deliberately: it does not reach `OfferingEntry`, because a
   * discount is a time-sensitive fact about *right now* and the offering record
   * is meant to outlive it. It feeds Current Promotions instead, which is the
   * field designed to be a scan-time snapshot.
   */
  originalPriceText: string | null;
  category: string | null;
};

export type RawTestimonialCandidate = {
  quote: string | null;
  attributedTo: string | null;
};

export type RawFaqCandidate = {
  question: string | null;
  answer: string | null;
};

export type RawCertificationCandidate = {
  name: string | null;
  issuer: string | null;
  year: number | null;
};

/* ------------------------------------------------------------------ *
 * The single object handed to the transform layer
 * ------------------------------------------------------------------ */

export type RawScrape = {
  requestedUrl: string;
  resolvedUrl: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: ScanStatus;
  discovery: DiscoveryResult;
  pages: ParsedPage[];
  failedPages: FailedPage[];
};

/* ------------------------------------------------------------------ *
 * Streamed pipeline progress (consumed by the /knowledge loading state)
 * ------------------------------------------------------------------ */

export type ScanStage =
  | "validating"
  | "discovering"
  | "fetching"
  | "extracting"
  | "finalizing"
  | "done"
  | "error";

export type ScanProgressEvent =
  | { type: "stage"; stage: ScanStage; message: string }
  | {
      type: "page-progress";
      stage: "fetching";
      completed: number;
      total: number;
      currentUrl: string;
      pageTypes: PageType[];
    }
  | { type: "page-failed"; url: string; reason: FetchFailureReason; message: string }
  | { type: "done"; draft: unknown; warnings: string[] }
  | { type: "error"; kind: ScanErrorKind; message: string };

/**
 * The three failure modes are distinct because the product handles them
 * differently: only `timeout-mid-crawl` produces a usable partial draft.
 */
export type ScanErrorKind =
  | "malformed-url"
  | "unreachable"
  | "timeout-no-data"
  | "internal";
