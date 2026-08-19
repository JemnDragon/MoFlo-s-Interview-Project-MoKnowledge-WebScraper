/**
 * Structural brand signals: colours, fonts and logos.
 *
 * All of it comes from parsing what the site already ships — inline styles,
 * <style> blocks, linked stylesheet text (fetched upstream and passed in), and
 * image/meta tags. There is no design or branding API involved, and no attempt
 * to "decide" what the brand colour *should* be: we surface what was found, in
 * frequency order, and let the reviewer pick.
 */

import * as cheerio from "cheerio";
import type { BrandSignals } from "@/types/scrape";
import type { LogoEntry } from "@/types/knowledge";
import { absolutize } from "@/lib/utils/url";
import { collapseWhitespace, dedupe, dedupeBy } from "@/lib/utils/text";

const HEX_COLOR = /#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})\b/gi;
const RGB_COLOR = /rgba?\(\s*\d{1,3}\s*[, ]\s*\d{1,3}\s*[, ]\s*\d{1,3}(?:\s*[,/]\s*[\d.]+%?)?\s*\)/gi;
const FONT_FAMILY = /font-family\s*:\s*([^;}"']+)/gi;
const FONT_FACE_FAMILY = /@font-face[^}]*font-family\s*:\s*["']?([^;"'}]+)/gi;

/** Colours that carry no brand information whatsoever. */
const IGNORED_COLORS = new Set([
  "#fff",
  "#ffffff",
  "#000",
  "#000000",
  "#transparent",
  "rgba(0,0,0,0)",
  "rgb(255,255,255)",
  "rgb(0,0,0)",
]);

const GENERIC_FONTS = new Set([
  "inherit",
  "initial",
  "unset",
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "ui-rounded",
  "-apple-system",
  "blinkmacsystemfont",
  "segoe ui",
  "roboto",
  "helvetica",
  "helvetica neue",
  "arial",
  "sans",
  "emoji",
  "math",
  "fangsong",
]);

function normalizeColor(raw: string): string {
  const value = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (/^#[0-9a-f]{3}$/.test(value)) {
    const [, r, g, b] = value;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return value;
}

/** Ranks by how often each colour appears — the brand colour is usually the busiest. */
function rankByFrequency(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([value]) => value);
}

export function extractColors(cssText: string): string[] {
  const found = [
    ...(cssText.match(HEX_COLOR) ?? []),
    ...(cssText.match(RGB_COLOR) ?? []),
  ]
    .map(normalizeColor)
    .filter((color) => !IGNORED_COLORS.has(color))
    // Near-white and near-black are page chrome, not brand identity.
    .filter((color) => !/^#(f{6}|0{6}|e{6}|1{6})$/.test(color));

  return rankByFrequency(found).slice(0, 8);
}

export function extractFonts(cssText: string, $: cheerio.CheerioAPI): string[] {
  const families: string[] = [];

  for (const pattern of [FONT_FAMILY, FONT_FACE_FAMILY]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(cssText)) !== null) {
      const list = match[1];
      if (!list) continue;
      for (const family of list.split(",")) {
        const cleaned = family.replace(/["']/g, "").trim().toLowerCase();
        if (!cleaned || GENERIC_FONTS.has(cleaned) || cleaned.startsWith("var(")) continue;
        families.push(cleaned);
      }
    }
  }

  // Web-font <link> tags name the family directly in the query string.
  $('link[href*="fonts.googleapis.com"], link[href*="use.typekit.net"]').each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const familyParam = /[?&]family=([^&]+)/.exec(href);
    if (!familyParam?.[1]) return;
    for (const chunk of decodeURIComponent(familyParam[1]).split("|")) {
      const name = chunk.split(":")[0]?.replace(/\+/g, " ").trim().toLowerCase();
      if (name && !GENERIC_FONTS.has(name)) families.push(name);
    }
  });

  return rankByFrequency(families)
    .slice(0, 6)
    .map((name) => name.replace(/\b\w/g, (char) => char.toUpperCase()));
}

/** Collects every stylesheet URL on the page so the crawler can fetch them. */
export function stylesheetUrls($: cheerio.CheerioAPI, baseUrl: string): string[] {
  const urls: string[] = [];
  $('link[rel~="stylesheet"][href]').each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    const absolute = absolutize(href, baseUrl);
    if (absolute) urls.push(absolute);
  });
  return dedupe(urls);
}

/** Inline <style> blocks plus every style="" attribute, concatenated. */
export function inlineCss($: cheerio.CheerioAPI): string {
  const blocks: string[] = [];
  $("style").each((_, el) => {
    blocks.push($(el).contents().text());
  });
  $("[style]").each((_, el) => {
    const style = $(el).attr("style");
    if (style) blocks.push(style);
  });
  return blocks.join("\n");
}

export function extractLogos($: cheerio.CheerioAPI, baseUrl: string): LogoEntry[] {
  const logos: LogoEntry[] = [];

  const push = (src: string | undefined, alt: string | undefined, via: string) => {
    if (!src) return;
    const absolute = absolutize(src, baseUrl);
    if (!absolute) return;
    logos.push({
      url: absolute,
      alt: alt ? collapseWhitespace(alt) : null,
      detectedVia: via,
    });
  };

  // Ordered by how reliably each signal indicates an actual logo.
  $('img[class*="logo" i], img[id*="logo" i], img[alt*="logo" i], img[src*="logo" i]').each(
    (_, el) => push($(el).attr("src"), $(el).attr("alt"), "img[logo]"),
  );
  $('header img, [class*="brand" i] img').slice(0, 2).each((_, el) => {
    push($(el).attr("src"), $(el).attr("alt"), "header img");
  });
  push($('meta[property="og:image"]').attr("content"), undefined, "og:image");
  push($('link[rel="apple-touch-icon"]').attr("href"), undefined, "link[apple-touch-icon]");
  push($('link[rel~="icon"]').attr("href"), undefined, "link[rel=icon]");

  return dedupeBy(logos, (logo) => logo.url ?? "").slice(0, 5);
}

export function parseBrandSignals(
  $: cheerio.CheerioAPI,
  baseUrl: string,
  externalCss: string,
): BrandSignals {
  const cssText = `${inlineCss($)}\n${externalCss}`;
  return {
    colors: extractColors(cssText),
    fonts: extractFonts(cssText, $),
    logos: extractLogos($, baseUrl),
  };
}
