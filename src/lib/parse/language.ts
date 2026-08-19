/**
 * Language detection — deterministic, declaration-only.
 *
 * The ONLY sources are `<html lang>` and `<link rel="alternate" hreflang>`.
 *
 * We deliberately do not scan prose for language names. The false-positive rate
 * is unacceptable: "French doors", "Chinese market", "Spanish tile", "Greek
 * yoghurt" and "Dutch oven" all appear on ordinary SMB sites and none of them
 * means the business serves customers in that language. A wrong Languages value
 * is worse than an absent one, because a downstream MoMail campaign would act
 * on it.
 */

import * as cheerio from "cheerio";
import type { LanguageSignals } from "@/types/scrape";
import type { SiteLanguage } from "@/types/knowledge";
import { dedupe } from "@/lib/utils/text";

/** Normalises "en-US" / "EN_us" to a consistent "en-US" form. */
export function normalizeLangTag(raw: string): string | null {
  const cleaned = raw.trim().replace(/_/g, "-");
  if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(cleaned)) return null;
  const [language, ...rest] = cleaned.split("-");
  if (!language) return null;
  const region = rest
    .map((part) => (part.length === 2 ? part.toUpperCase() : part.toLowerCase()))
    .join("-");
  return region ? `${language.toLowerCase()}-${region}` : language.toLowerCase();
}

export function parseLanguageSignals($: cheerio.CheerioAPI): LanguageSignals {
  const htmlLangRaw = $("html").attr("lang");
  const htmlLang = htmlLangRaw ? normalizeLangTag(htmlLangRaw) : null;

  const hreflang: string[] = [];
  $("link[rel='alternate'][hreflang]").each((_, el) => {
    const value = $(el).attr("hreflang");
    if (!value) return;
    // x-default is a routing hint, not a supported language.
    if (value.toLowerCase() === "x-default") return;
    const normalized = normalizeLangTag(value);
    if (normalized) hreflang.push(normalized);
  });

  return { htmlLang, hreflang: dedupe(hreflang) };
}

/** Merges per-page signals into one site-level value. */
export function mergeLanguageSignals(signals: LanguageSignals[]): SiteLanguage {
  const main = signals.find((signal) => signal.htmlLang !== null)?.htmlLang ?? null;
  const alternates = dedupe(signals.flatMap((signal) => signal.hreflang)).filter(
    (tag) => tag !== main,
  );
  return { main, alternates };
}

/** Short display codes for the card view badge, e.g. ["EN", "ES"]. */
export function languageCodes(language: SiteLanguage): string[] {
  const all = [language.main, ...language.alternates].filter(
    (tag): tag is string => typeof tag === "string",
  );
  return dedupe(all.map((tag) => (tag.split("-")[0] ?? tag).toUpperCase()));
}
