/**
 * Discovery: decide which handful of pages are worth fetching.
 *
 * Strategy (§2):
 *   1. Nav and footer links first. They carry human-written link text, which is
 *      the best classification signal available anywhere on a site.
 *   2. sitemap.xml only as a *per-category* fallback — consulted for the
 *      categories that nav/footer produced nothing for, not as a bulk source.
 *   3. Bounded budget. Homepage plus up to MAX_ADDITIONAL_PAGES others. A
 *      category with no candidate is simply accepted as absent; we never widen
 *      the crawl to go hunting for it.
 */

import * as cheerio from "cheerio";
import type { PageType } from "@/types/knowledge";
import type { DiscoveryResult, PageCandidate, DiscoverySource } from "@/types/scrape";
import { absolutize, canonicalizeUrl, sameRegistrableSite } from "@/lib/utils/url";
import { collapseWhitespace, dedupeBy } from "@/lib/utils/text";
import { CLASSIFIABLE_PAGE_TYPES, classifyLink, classifyUrlOnly } from "./classify";

export const MAX_ADDITIONAL_PAGES = 8;
/** Per category, so a site with nine "services" links doesn't eat the budget. */
const MAX_CANDIDATES_PER_TYPE = 2;

type RawLink = { href: string; text: string; via: DiscoverySource };

/** Pulls links out of nav/header/footer regions, falling back to the whole page. */
export function extractNavigationLinks(html: string, baseUrl: string): RawLink[] {
  const $ = cheerio.load(html);
  const links: RawLink[] = [];

  const regions: { selector: string; via: DiscoverySource }[] = [
    { selector: "nav a[href]", via: "nav-link" },
    { selector: "header a[href]", via: "nav-link" },
    { selector: '[role="navigation"] a[href]', via: "nav-link" },
    { selector: '[class*="nav" i] a[href]', via: "nav-link" },
    { selector: '[id*="menu" i] a[href]', via: "nav-link" },
    { selector: "footer a[href]", via: "footer-link" },
    { selector: '[class*="footer" i] a[href]', via: "footer-link" },
  ];

  for (const region of regions) {
    $(region.selector).each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      const absolute = absolutize(href, baseUrl);
      if (!absolute) return;
      links.push({
        href: absolute,
        text: collapseWhitespace($(el).text()),
        via: region.via,
      });
    });
  }

  return links.filter((link) => sameRegistrableSite(link.href, baseUrl));
}

/** Every in-site link on the page, used when the nav regions yield nothing usable. */
export function extractAllLinks(html: string, baseUrl: string): RawLink[] {
  const $ = cheerio.load(html);
  const links: RawLink[] = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const absolute = absolutize(href, baseUrl);
    if (!absolute) return;
    links.push({ href: absolute, text: collapseWhitespace($(el).text()), via: "nav-link" });
  });

  return links.filter((link) => sameRegistrableSite(link.href, baseUrl));
}

function isSameAsHomepage(url: string, homepageUrl: string): boolean {
  return canonicalizeUrl(url) === canonicalizeUrl(homepageUrl);
}

/** Groups classified links by page type, capped per type, order preserved. */
function candidatesByType(
  links: RawLink[],
  homepageUrl: string,
): Map<PageType, PageCandidate[]> {
  const byType = new Map<PageType, PageCandidate[]>();

  for (const link of links) {
    if (isSameAsHomepage(link.href, homepageUrl)) continue;
    const pageTypes = classifyLink(link.text, link.href);
    if (pageTypes.length === 0) continue;

    const candidate: PageCandidate = {
      url: canonicalizeUrl(link.href),
      pageTypes,
      discoveredVia: link.via,
      linkText: link.text || null,
    };

    for (const pageType of pageTypes) {
      const existing = byType.get(pageType) ?? [];
      if (existing.some((c) => c.url === candidate.url)) continue;
      if (existing.length >= MAX_CANDIDATES_PER_TYPE) continue;
      existing.push(candidate);
      byType.set(pageType, existing);
    }
  }

  return byType;
}

export type DiscoveryInput = {
  homepageUrl: string;
  homepageHtml: string;
  /** Already-fetched sitemap URL list, or empty if unavailable. Fetching is upstream. */
  sitemapUrls: string[];
};

/**
 * Pure given its inputs: all fetching (homepage, sitemap.xml) happens upstream in
 * the crawl orchestrator, which keeps this function directly unit-testable.
 */
export function discoverPages(input: DiscoveryInput): DiscoveryResult {
  const { homepageUrl, homepageHtml, sitemapUrls } = input;

  // Tier 1: nav and footer links.
  const navLinks = extractNavigationLinks(homepageHtml, homepageUrl);
  let byType = candidatesByType(navLinks, homepageUrl);

  // If not one nav link classified, the nav is either absent or rendered
  // client-side and never reached this HTML. Widen to every in-site link before
  // concluding the site has no About page. Checking *classified* rather than
  // *found* matters: themes reliably emit cart and policy links, so a
  // links-length test would see three unclassifiable links and stop here.
  const navLinksUnusable = byType.size === 0;
  if (navLinksUnusable) {
    byType = candidatesByType(extractAllLinks(homepageHtml, homepageUrl), homepageUrl);
  }

  const sitemapFallbackUsed: PageType[] = [];
  const unmatchedPageTypes: PageType[] = [];

  for (const pageType of CLASSIFIABLE_PAGE_TYPES) {
    if ((byType.get(pageType) ?? []).length > 0) continue;

    const fromSitemap = sitemapUrls
      .filter((url) => sameRegistrableSite(url, homepageUrl))
      .filter((url) => !isSameAsHomepage(url, homepageUrl))
      .filter((url) => classifyUrlOnly(url).includes(pageType))
      .slice(0, MAX_CANDIDATES_PER_TYPE)
      .map<PageCandidate>((url) => ({
        url: canonicalizeUrl(url),
        pageTypes: classifyUrlOnly(url),
        discoveredVia: "sitemap",
        linkText: null,
      }));

    if (fromSitemap.length > 0) {
      byType.set(pageType, fromSitemap);
      sitemapFallbackUsed.push(pageType);
    } else {
      // Accepted, not chased. Absence of an FAQ page is information, not failure.
      unmatchedPageTypes.push(pageType);
    }
  }

  // Fill the budget in crawl-priority order so that if a site has ten
  // classifiable pages, we spend the budget on About before Blog.
  const ordered: PageCandidate[] = [];
  for (const pageType of CLASSIFIABLE_PAGE_TYPES) {
    for (const candidate of byType.get(pageType) ?? []) {
      ordered.push(candidate);
    }
  }

  const unique = dedupeBy(ordered, (candidate) => candidate.url).map((candidate) => ({
    ...candidate,
    // Merge every page type any link assigned to this URL: one page is allowed
    // to serve as both About and Team.
    pageTypes: Array.from(
      new Set(
        ordered
          .filter((other) => other.url === candidate.url)
          .flatMap((other) => other.pageTypes),
      ),
    ),
  }));

  const homepageCandidate: PageCandidate = {
    url: canonicalizeUrl(homepageUrl),
    pageTypes: ["homepage"],
    discoveredVia: "homepage",
    linkText: null,
  };

  return {
    homepageUrl: canonicalizeUrl(homepageUrl),
    candidates: [homepageCandidate, ...unique.slice(0, MAX_ADDITIONAL_PAGES)],
    sitemapFallbackUsed,
    unmatchedPageTypes,
    navLinksUnusable,
  };
}
