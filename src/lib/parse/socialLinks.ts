/**
 * Social profile detection: every <a href> on the page filtered against a static
 * list of known social domains (`src/data/social-domains.json`).
 *
 * Filtering against a fixed list rather than pattern-guessing keeps false
 * positives at zero: a link to `oursupplier.com/instagram-tips` is not a social
 * profile, and no heuristic that looks for the word "instagram" can tell.
 */

import * as cheerio from "cheerio";
import socialFile from "@/data/social-domains.json";
import type { SocialLinkEntry } from "@/types/knowledge";
import { absolutize, hostnameOf } from "@/lib/utils/url";
import { dedupeBy } from "@/lib/utils/text";

type SocialDomain = { platform: string; match: string[] };

const SOCIAL_DOMAINS: SocialDomain[] = (socialFile as { domains: SocialDomain[] }).domains;

export function platformForUrl(url: string): string | null {
  const host = hostnameOf(url);
  if (!host) return null;
  const bare = host.replace(/^www\./, "");
  for (const entry of SOCIAL_DOMAINS) {
    if (entry.match.some((domain) => bare === domain || bare.endsWith(`.${domain}`))) {
      return entry.platform;
    }
  }
  return null;
}

export function extractSocialLinks($: cheerio.CheerioAPI, baseUrl: string): SocialLinkEntry[] {
  const links: SocialLinkEntry[] = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const absolute = absolutize(href, baseUrl);
    if (!absolute) return;
    const platform = platformForUrl(absolute);
    if (!platform) return;
    links.push({ platform, url: absolute });
  });

  return dedupeBy(links, (link) => `${link.platform}::${link.url}`).slice(0, 20);
}
