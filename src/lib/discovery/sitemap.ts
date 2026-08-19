/**
 * sitemap.xml handling.
 *
 * Split out from discoverPages so it carries no cheerio dependency: sitemaps are
 * a trivially simple XML shape, and keeping this module dependency-free means it
 * can be unit-tested without a DOM (see scripts/smoke.ts).
 */

/** Extracts every <loc> value, tolerating CDATA and attributes on the tag. */
export function parseSitemapUrls(xml: string): string[] {
  const urls: string[] = [];
  const pattern = /<loc\b[^>]*>([\s\S]*?)<\/loc>/gi;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    const raw = (match[1] ?? "")
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .trim();
    if (raw) urls.push(raw);
  }

  return urls;
}

/**
 * True when this is a sitemap *index* — its <loc> entries point at further
 * sitemap files rather than at pages.
 *
 * This matters much more than it looks. Shopify, Yoast/WordPress and Squarespace
 * all serve an index at /sitemap.xml, so treating an index as a page list yields
 * a handful of `.xml` URLs that classify as no page type at all, and the entire
 * sitemap fallback tier silently contributes nothing on a large share of real
 * small-business sites — while appearing to work.
 */
export function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml);
}

/**
 * Which child sitemaps are worth following, best first.
 *
 * Pages and collections hold the About/Services content discovery is looking
 * for. Product, image and media sitemaps are usually enormous and contribute
 * nothing to the page-type categories, so they sort last and fall outside the
 * cap. Only one level of index is ever followed — this is a fallback, not a
 * site mirror.
 */
export function rankChildSitemaps(urls: string[], limit: number): string[] {
  const score = (url: string): number => {
    const lower = url.toLowerCase();
    if (lower.includes("page")) return 0;
    if (lower.includes("collection") || lower.includes("categor")) return 1;
    if (lower.includes("post") || lower.includes("blog")) return 2;
    if (lower.includes("product") || lower.includes("image") || lower.includes("media")) return 4;
    return 3;
  };

  return [...urls]
    .filter((url) => /\.xml(\?|$)/i.test(url))
    .sort((a, b) => score(a) - score(b))
    .slice(0, limit);
}
