/**
 * Single-page fetch. Server-only.
 *
 * Fetching never happens in the browser: cross-origin requests to arbitrary SMB
 * sites would be blocked by CORS, and doing it client-side would expose the
 * crawl to whatever the visitor's network can reach rather than ours.
 *
 * Failure classification matters downstream — §9 treats an unreachable host
 * (nothing to show) differently from a timeout mid-crawl (keep what we have).
 */

import "server-only";
import type { FailedPage, FetchFailureReason, FetchedPage } from "@/types/scrape";
import type { PageType } from "@/types/knowledge";
import {
  isSitemapIndex,
  parseSitemapUrls,
  rankChildSitemaps,
} from "@/lib/discovery/sitemap";

export const DEFAULT_PAGE_TIMEOUT_MS = 12_000;
const MAX_BYTES = 3_000_000;

const USER_AGENT =
  "Mozilla/5.0 (compatible; MoKnowledgeBot/1.0; +https://moflo.cloud/moknowledge)";

export type FetchPageResult =
  | { ok: true; page: FetchedPage }
  | { ok: false; failure: FailedPage };

function classifyError(error: unknown): { reason: FetchFailureReason; message: string } {
  if (error instanceof DOMException && error.name === "AbortError") {
    return { reason: "timeout", message: "The page took too long to respond." };
  }
  const cause = (error as { cause?: { code?: string } } | undefined)?.cause;
  const code = cause?.code;
  switch (code) {
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return { reason: "dns", message: "That domain could not be found." };
    case "ECONNREFUSED":
      return { reason: "connection-refused", message: "The server refused the connection." };
    case "ECONNRESET":
      return { reason: "connection-refused", message: "The connection was reset by the server." };
    case "CERT_HAS_EXPIRED":
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
      return { reason: "blocked", message: "The site's security certificate could not be verified." };
    case "UND_ERR_HEADERS_TIMEOUT":
    case "UND_ERR_CONNECT_TIMEOUT":
      return { reason: "timeout", message: "The page took too long to respond." };
    default:
      return {
        reason: "unknown",
        message: error instanceof Error ? error.message : "The page could not be fetched.",
      };
  }
}

export async function fetchPage(
  url: string,
  pageTypes: PageType[],
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<FetchPageResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PAGE_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Abort this page early if the whole crawl's deadline fires.
  const onOuterAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onOuterAbort, { once: true });

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (!response.ok) {
      const blocked = response.status === 403 || response.status === 401 || response.status === 429;
      return {
        ok: false,
        failure: {
          url,
          pageTypes,
          reason: blocked ? "blocked" : "http-error",
          message: blocked
            ? `The site refused the request (HTTP ${response.status}). It may be blocking automated visitors.`
            : `The server returned HTTP ${response.status}.`,
        },
      };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/text\/html|application\/xhtml|text\/xml|application\/xml/i.test(contentType)) {
      return {
        ok: false,
        failure: {
          url,
          pageTypes,
          reason: "not-html",
          message: `That address returned ${contentType.split(";")[0]}, not a web page.`,
        },
      };
    }

    const html = (await response.text()).slice(0, MAX_BYTES);

    return {
      ok: true,
      page: {
        url,
        finalUrl: response.url || url,
        pageTypes,
        status: response.status,
        html,
        fetchedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    const { reason, message } = classifyError(error);
    return { ok: false, failure: { url, pageTypes, reason, message } };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onOuterAbort);
  }
}

/** How many child sitemaps to follow when /sitemap.xml turns out to be an index. */
const MAX_CHILD_SITEMAPS = 3;

/**
 * Best-effort sitemap fetch, following one level of sitemap index.
 *
 * A missing sitemap is normal and never an error. An *index* is also normal —
 * Shopify, Yoast/WordPress and Squarespace all serve one — and following it is
 * the difference between the sitemap tier working and silently doing nothing on
 * a large share of real sites. Only one level is followed, and only a few
 * children, because this is a fallback and not a site mirror.
 */
export async function fetchSitemap(
  homepageUrl: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<string[]> {
  let sitemapUrl: string;
  try {
    sitemapUrl = new URL("/sitemap.xml", homepageUrl).toString();
  } catch {
    return [];
  }

  const timeoutMs = options.timeoutMs ?? 6_000;
  const root = await fetchPage(sitemapUrl, [], { timeoutMs, signal: options.signal });
  if (!root.ok) return [];

  const rootXml = root.page.html;
  if (!isSitemapIndex(rootXml)) return [rootXml];

  const children = rankChildSitemaps(parseSitemapUrls(rootXml), MAX_CHILD_SITEMAPS);
  const bodies = await Promise.all(
    children.map(async (url) => {
      const child = await fetchPage(url, [], { timeoutMs, signal: options.signal });
      return child.ok ? child.page.html : null;
    }),
  );

  return bodies.filter((body): body is string => body !== null);
}
