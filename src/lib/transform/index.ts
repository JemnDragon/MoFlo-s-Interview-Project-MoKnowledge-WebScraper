/**
 * The transform layer: raw scrape in, KnowledgeBaseDraft out.
 *
 * Pure and synchronous. No fetching, no timers, no randomness, no clock reads
 * beyond what the scrape already recorded. Given the same RawScrape it produces
 * byte-identical output, which is what makes the whole extraction story testable
 * from a saved HTML fixture without touching the network.
 *
 * This file is only an orchestrator; each group's logic lives in its own module.
 */

import type { KnowledgeBaseDraft, ScanMeta } from "@/types/knowledge";
import type { RawScrape } from "@/types/scrape";
import { primaryPageType } from "@/lib/discovery/classify";
import { pruneEmptyEntries } from "@/lib/validate/emptyEntries";
import { dedupeBy } from "@/lib/utils/text";
import { buildContext } from "./context";
import { transformFoundation } from "./foundation";
import { transformPositioning } from "./positioning";
import { transformMarket } from "./market";
import { transformBranding } from "./branding";
import { transformKeyPeople, transformOfferings } from "./entities";
import { transformExtensions } from "./extensions";

function scanMetaFrom(raw: RawScrape): ScanMeta {
  return {
    status: raw.status,
    startedAt: raw.startedAt,
    finishedAt: raw.finishedAt,
    requestedUrl: raw.requestedUrl,
    resolvedUrl: raw.resolvedUrl,
    pagesFetched: raw.pages.map((page) => ({
      url: page.url,
      pageType: primaryPageType(page.pageTypes),
    })),
    pagesFailed: raw.failedPages.map((page) => ({
      url: page.url,
      pageType: primaryPageType(page.pageTypes),
      reason: page.message,
    })),
    durationMs: raw.durationMs,
  };
}

export function rawToDraft(raw: RawScrape): KnowledgeBaseDraft {
  const context = buildContext(raw);

  // Resolved once and shared: Industry falls back to rolling these categories up
  // when the site has no schema.org Organization node, which is most of the web.
  const offerings = transformOfferings(context);

  // Every list is swept once here rather than each extractor guarding itself.
  // Most already do — `industryGroupings()` filters on length, the offering and
  // testimonial parsers require a name and a quote — but "most" is exactly the
  // gap that let a nameless entry through `dedupeBy`, which collapses all of
  // them onto the key `""` and keeps the first. Pure, so this does not touch the
  // purity guarantee above.
  return pruneEmptyEntries<KnowledgeBaseDraft>({
    schemaVersion: 1,
    scan: scanMetaFrom(raw),
    companyFoundation: transformFoundation(context, offerings),
    positioning: transformPositioning(context),
    marketAndCustomers: transformMarket(context),
    brandingAndStyle: transformBranding(context),
    onlinePresence: {
      socialMediaLinks: dedupeBy(
        context.pages.flatMap((page) => page.socialLinks),
        (link) => link.url,
      ).slice(0, 20),
    },
    keyPeople: transformKeyPeople(context),
    offerings,
    extensions: transformExtensions(context),
    // Always empty. This array is user-authored only; the scraper has nothing to
    // put in it, and populating it here would also break the purity of this
    // function, since every entry carries a creation timestamp.
    customSections: [],
  });
}

export { buildContext } from "./context";
export { industryGroupingCandidates } from "./market";
export {
  yearFoundedCandidates,
  yearFoundedConflict,
  type YearFoundedCandidate,
} from "./foundation";
