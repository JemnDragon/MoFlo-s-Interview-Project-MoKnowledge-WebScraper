/**
 * Crawl orchestrator: the only place fetch, discovery and parse meet.
 *
 * Responsibilities kept deliberately narrow — it sequences the stages, enforces
 * the global time budget, reports real progress, and classifies which of the
 * three failure modes (§9) occurred. It performs no extraction itself.
 *
 * Timeout semantics: when the global deadline fires mid-crawl we keep every page
 * already fetched and mark the scan `partial`. Partial progress is never
 * discarded, and the pages that never completed are recorded so the retry action
 * can re-attempt only those.
 */

import "server-only";
import type {
  DiscoveryResult,
  FailedPage,
  PageCandidate,
  ParsedPage,
  RawScrape,
  ScanErrorKind,
  ScanProgressEvent,
} from "@/types/scrape";
import type { PageType } from "@/types/knowledge";
import { canonicalizeUrl, validateUrl } from "@/lib/utils/url";
import { MAX_ADDITIONAL_PAGES, discoverPages } from "@/lib/discovery/discoverPages";
import { parseSitemapUrls } from "@/lib/discovery/sitemap";
import {
  PROBED_PAGE_TYPES,
  looksLikeSoftFourOhFour,
  probeUrlsFor,
} from "@/lib/discovery/probePaths";
import { parsePage } from "@/lib/parse/parsePage";
import { stylesheetUrls } from "@/lib/parse/branding";
import { DEFAULT_PAGE_TIMEOUT_MS, fetchPage, fetchSitemap } from "./fetchPage";
import * as cheerio from "cheerio";

export const DEFAULT_TOTAL_BUDGET_MS = 45_000;
const MAX_STYLESHEETS = 3;
const STYLESHEET_TIMEOUT_MS = 5_000;
/** Probes are speculative, so they get a shorter leash than a confirmed page. */
const PROBE_TIMEOUT_MS = 6_000;

export type CrawlOptions = {
  requestedUrl: string;
  onProgress?: (event: ScanProgressEvent) => void;
  totalBudgetMs?: number;
  /**
   * Resume mode. Supplies the pages already parsed by an earlier scan plus the
   * URLs that failed, so a retry re-attempts only what did not complete.
   */
  resume?: {
    pages: ParsedPage[];
    failedPages: FailedPage[];
  };
};

export type CrawlResult =
  | { ok: true; raw: RawScrape }
  | { ok: false; kind: ScanErrorKind; message: string };

function emit(options: CrawlOptions, event: ScanProgressEvent): void {
  options.onProgress?.(event);
}

/** Fetches a bounded number of stylesheets so brand colours are more than inline styles. */
async function fetchStylesheets(
  html: string,
  baseUrl: string,
  signal: AbortSignal,
): Promise<string> {
  const $ = cheerio.load(html);
  const urls = stylesheetUrls($, baseUrl).slice(0, MAX_STYLESHEETS);
  const results = await Promise.all(
    urls.map(async (url) => {
      const result = await fetchPage(url, [], { timeoutMs: STYLESHEET_TIMEOUT_MS, signal });
      return result.ok ? result.page.html : "";
    }),
  );
  return results.join("\n");
}

type ProbeHit = { candidate: PageCandidate; html: string };

/**
 * Discovery tier 3. Runs only for required-field categories that produced no
 * candidate from nav links or sitemap — see lib/discovery/probePaths.ts for why
 * this tier exists (JS-rendered navigation the HTML fetch never sees) and why it
 * is kept this narrow.
 *
 * Probes for one category run in parallel and the first usable hit wins; the
 * rest are discarded rather than queued, so a category costs at most one page of
 * the crawl budget however many guesses it took.
 */
async function probeMissingCategories(input: {
  discovery: DiscoveryResult;
  siteUrl: string;
  homepageHtml: string;
  options: CrawlOptions;
  signal: AbortSignal;
  alreadyQueued: number;
}): Promise<ProbeHit[]> {
  const { discovery, siteUrl, homepageHtml, options, signal, alreadyQueued } = input;

  const missing = PROBED_PAGE_TYPES.filter((pageType) =>
    discovery.unmatchedPageTypes.includes(pageType),
  );
  if (missing.length === 0) return [];

  let budgetLeft = Math.max(0, MAX_ADDITIONAL_PAGES - alreadyQueued);
  if (budgetLeft === 0) return [];

  emit(options, {
    type: "stage",
    stage: "discovering",
    message: `No ${missing.join(" or ")} page was linked — trying conventional paths in case the navigation is rendered by JavaScript`,
  });

  const hits: ProbeHit[] = [];

  for (const pageType of missing) {
    if (budgetLeft === 0 || signal.aborted) break;

    const urls = probeUrlsFor(pageType, siteUrl);
    const results = await Promise.all(
      urls.map(async (url) => {
        const result = await fetchPage(url, [pageType], {
          timeoutMs: PROBE_TIMEOUT_MS,
          signal,
        });
        return result.ok ? result.page : null;
      }),
    );

    const usable = results.find(
      (page) =>
        page !== null &&
        !looksLikeSoftFourOhFour(page.html, homepageHtml) &&
        canonicalizeUrl(page.finalUrl) !== canonicalizeUrl(siteUrl) &&
        !hits.some((hit) => hit.candidate.url === canonicalizeUrl(page.finalUrl)),
    );

    if (!usable) continue;

    hits.push({
      candidate: {
        url: canonicalizeUrl(usable.finalUrl),
        pageTypes: [pageType],
        discoveredVia: "path-probe",
        linkText: null,
      },
      html: usable.html,
    });
    budgetLeft -= 1;
  }

  return hits;
}

export async function crawlSite(options: CrawlOptions): Promise<CrawlResult> {
  const startedAt = new Date();
  const budgetMs = options.totalBudgetMs ?? DEFAULT_TOTAL_BUDGET_MS;

  /* -- Failure mode 1: malformed URL. Caught before any network call. -- */
  emit(options, { type: "stage", stage: "validating", message: "Checking the web address" });
  const validation = validateUrl(options.requestedUrl);
  if (!validation.ok) {
    return { ok: false, kind: "malformed-url", message: validation.reason };
  }
  const homepageUrl = validation.url;

  const deadline = new AbortController();
  const deadlineTimer = setTimeout(() => deadline.abort(), budgetMs);
  const timedOut = () => deadline.signal.aborted;

  try {
    /* -- Resume path: skip discovery, re-attempt only what failed. -- */
    if (options.resume) {
      return await resumeCrawl(options, options.resume, homepageUrl, startedAt, deadline.signal);
    }

    /* -- Failure mode 2: unreachable/blocked. Nothing partial exists. -- */
    emit(options, { type: "stage", stage: "discovering", message: "Loading the homepage" });
    const homepageResult = await fetchPage(homepageUrl, ["homepage"], {
      timeoutMs: Math.min(DEFAULT_PAGE_TIMEOUT_MS, budgetMs),
      signal: deadline.signal,
    });

    if (!homepageResult.ok) {
      const { reason, message } = homepageResult.failure;
      return {
        ok: false,
        kind: reason === "timeout" ? "timeout-no-data" : "unreachable",
        message,
      };
    }

    const homepageHtml = homepageResult.page.html;
    const resolvedUrl = homepageResult.page.finalUrl;

    emit(options, {
      type: "stage",
      stage: "discovering",
      message: "Reading navigation links to find About, Services, Team and Contact pages",
    });

    const sitemapBodies = await fetchSitemap(resolvedUrl, { signal: deadline.signal });
    const sitemapUrls = sitemapBodies.flatMap(parseSitemapUrls);

    const discovery = discoverPages({
      homepageUrl: resolvedUrl,
      homepageHtml,
      sitemapUrls,
    });

    /* -- Tier 3: probe conventional paths for still-missing required categories. -- */
    const probed = await probeMissingCategories({
      discovery,
      siteUrl: resolvedUrl,
      homepageHtml,
      options,
      signal: deadline.signal,
      alreadyQueued: discovery.candidates.length - 1,
    });

    if (probed.length > 0) {
      discovery.candidates.push(...probed.map((hit) => hit.candidate));
      discovery.unmatchedPageTypes = discovery.unmatchedPageTypes.filter(
        (pageType) => !probed.some((hit) => hit.candidate.pageTypes.includes(pageType)),
      );
    }

    /* -- Fetch stage, reporting real page counts. -- */
    // Probed pages were already retrieved during discovery; don't fetch them twice.
    const probedUrls = new Set(probed.map((hit) => hit.candidate.url));
    const toFetch = discovery.candidates.filter(
      (candidate) =>
        candidate.url !== discovery.homepageUrl && !probedUrls.has(candidate.url),
    );
    const total = toFetch.length + 1 + probed.length;

    emit(options, {
      type: "page-progress",
      stage: "fetching",
      completed: 1,
      total,
      currentUrl: resolvedUrl,
      pageTypes: ["homepage"],
    });

    const externalCss = await fetchStylesheets(homepageHtml, resolvedUrl, deadline.signal);

    const rawPages: { url: string; html: string; pageTypes: PageType[] }[] = [
      { url: resolvedUrl, html: homepageHtml, pageTypes: ["homepage"] },
      ...probed.map((hit) => ({
        url: hit.candidate.url,
        html: hit.html,
        pageTypes: hit.candidate.pageTypes,
      })),
    ];
    const failedPages: FailedPage[] = [];
    let completed = 1 + probed.length;

    for (const candidate of toFetch) {
      if (timedOut()) {
        // Everything not yet attempted is recorded as incomplete so the retry
        // action knows exactly what to pick up.
        failedPages.push({
          url: candidate.url,
          pageTypes: candidate.pageTypes,
          reason: "timeout",
          message: "The scan ran out of time before this page was fetched.",
        });
        continue;
      }

      const result = await fetchPage(candidate.url, candidate.pageTypes, {
        signal: deadline.signal,
      });
      completed += 1;

      if (result.ok) {
        rawPages.push({
          url: result.page.finalUrl,
          html: result.page.html,
          pageTypes: candidate.pageTypes,
        });
        emit(options, {
          type: "page-progress",
          stage: "fetching",
          completed,
          total,
          currentUrl: candidate.url,
          pageTypes: candidate.pageTypes,
        });
      } else {
        failedPages.push(result.failure);
        emit(options, {
          type: "page-failed",
          url: candidate.url,
          reason: result.failure.reason,
          message: result.failure.message,
        });
      }
    }

    /* -- Parse stage. -- */
    emit(options, {
      type: "stage",
      stage: "extracting",
      message: `Extracting structured data from ${rawPages.length} page${rawPages.length === 1 ? "" : "s"}`,
    });

    const pages: ParsedPage[] = rawPages.map((page) =>
      parsePage({
        url: page.url,
        pageTypes: page.pageTypes,
        html: page.html,
        // Stylesheets are only fetched for the homepage; the same CSS bundle
        // almost always governs the whole site, and refetching per page is a
        // poor use of the time budget.
        externalCss: page.url === resolvedUrl ? externalCss : "",
      }),
    );

    const finishedAt = new Date();
    const status = failedPages.some((page) => page.reason === "timeout") ? "partial" : "complete";

    return {
      ok: true,
      raw: {
        requestedUrl: options.requestedUrl,
        resolvedUrl,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        status,
        discovery,
        pages,
        failedPages,
      },
    };
  } catch (error) {
    return {
      ok: false,
      kind: "internal",
      message: error instanceof Error ? error.message : "The scan failed unexpectedly.",
    };
  } finally {
    clearTimeout(deadlineTimer);
  }
}

/** Re-attempts only the pages that did not complete, merging into prior results. */
async function resumeCrawl(
  options: CrawlOptions,
  resume: NonNullable<CrawlOptions["resume"]>,
  homepageUrl: string,
  startedAt: Date,
  signal: AbortSignal,
): Promise<CrawlResult> {
  const total = resume.failedPages.length;
  emit(options, {
    type: "stage",
    stage: "fetching",
    message: `Re-attempting ${total} page${total === 1 ? "" : "s"} that didn't complete`,
  });

  const pages = [...resume.pages];
  const stillFailed: FailedPage[] = [];
  let completed = 0;

  for (const failed of resume.failedPages) {
    const result = await fetchPage(failed.url, failed.pageTypes, { signal });
    completed += 1;

    if (result.ok) {
      pages.push(
        parsePage({
          url: result.page.finalUrl,
          pageTypes: failed.pageTypes,
          html: result.page.html,
          externalCss: "",
        }),
      );
      emit(options, {
        type: "page-progress",
        stage: "fetching",
        completed,
        total,
        currentUrl: failed.url,
        pageTypes: failed.pageTypes,
      });
    } else {
      stillFailed.push(result.failure);
      emit(options, {
        type: "page-failed",
        url: failed.url,
        reason: result.failure.reason,
        message: result.failure.message,
      });
    }
  }

  emit(options, {
    type: "stage",
    stage: "extracting",
    message: `Extracting structured data from ${pages.length} pages`,
  });

  const finishedAt = new Date();
  return {
    ok: true,
    raw: {
      requestedUrl: options.requestedUrl,
      resolvedUrl: homepageUrl,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      status: stillFailed.length > 0 ? "partial" : "complete",
      discovery: {
        homepageUrl,
        candidates: [],
        sitemapFallbackUsed: [],
        unmatchedPageTypes: [],
        navLinksUnusable: false,
      },
      pages,
      failedPages: stillFailed,
    },
  };
}
