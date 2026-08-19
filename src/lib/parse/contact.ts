/**
 * Contact details: emails, phone numbers, postal addresses.
 *
 * Structured sources (mailto:/tel: hrefs, schema.org PostalAddress) are trusted
 * outright. Free-text address matching is deliberately conservative — a
 * street-address regex that is too eager turns "Suite 200 available" into an
 * address, and a wrong address is materially worse than a missing one.
 */

import * as cheerio from "cheerio";
import { findJsonLdByType } from "./structuredData";
import { collapseWhitespace, dedupe } from "@/lib/utils/text";

const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/** US/CA-style numbers plus common international prefixes. */
const PHONE_PATTERN =
  /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g;

/**
 * Requires a street number, a street word, AND either a state/postcode or a
 * comma-separated city — three independent signals, so ordinary marketing copy
 * does not qualify.
 */
const ADDRESS_PATTERN =
  /\d{1,6}\s+[A-Za-z0-9.'\- ]{2,40}\s(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct|Place|Pl|Parkway|Pkwy|Highway|Hwy|Suite|Ste|Unit)\b[A-Za-z0-9.,'#\- ]{0,60}(?:,\s*[A-Za-z .'-]{2,30})?(?:,?\s*[A-Z]{2})?\s*\d{5}(?:-\d{4})?/g;

export type ContactSignals = {
  emails: string[];
  phones: string[];
  addresses: string[];
};

function addressFromJsonLd(jsonLd: Record<string, unknown>[]): string[] {
  const node = findJsonLdByType(jsonLd, [
    "LocalBusiness",
    "Organization",
    "Corporation",
    "ProfessionalService",
    "Store",
    "Restaurant",
    "MedicalBusiness",
    "HomeAndConstructionBusiness",
  ]);
  const address = node?.["address"];
  if (typeof address === "string") return [collapseWhitespace(address)];
  if (typeof address !== "object" || address === null) return [];

  const record = address as Record<string, unknown>;
  const parts = [
    "streetAddress",
    "addressLocality",
    "addressRegion",
    "postalCode",
    "addressCountry",
  ]
    .map((key) => record[key])
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  return parts.length > 0 ? [collapseWhitespace(parts.join(", "))] : [];
}

export function extractContact(
  $: cheerio.CheerioAPI,
  jsonLd: Record<string, unknown>[],
  pageText: string,
): ContactSignals {
  const emails: string[] = [];
  const phones: string[] = [];

  $('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const value = href.replace(/^mailto:/i, "").split("?")[0];
    if (value) emails.push(value.trim().toLowerCase());
  });

  $('a[href^="tel:"]').each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const value = href.replace(/^tel:/i, "").trim();
    if (value) phones.push(value);
  });

  // Fall back to page text only when the structured hrefs found nothing.
  if (emails.length === 0) {
    emails.push(...(pageText.match(EMAIL_PATTERN) ?? []).map((value) => value.toLowerCase()));
  }
  if (phones.length === 0) {
    phones.push(...(pageText.match(PHONE_PATTERN) ?? []).map(collapseWhitespace));
  }

  const structuredAddresses = addressFromJsonLd(jsonLd);
  const textAddresses =
    structuredAddresses.length > 0
      ? []
      : (pageText.match(ADDRESS_PATTERN) ?? []).map(collapseWhitespace);

  // Microdata / <address> elements are an explicit declaration, so trust them.
  const markedUpAddresses: string[] = [];
  $('address, [itemprop="address"]').each((_, el) => {
    const value = collapseWhitespace($(el).text());
    if (value.length > 8 && value.length < 200) markedUpAddresses.push(value);
  });

  return {
    emails: dedupe(emails).slice(0, 5),
    phones: dedupe(phones).slice(0, 5),
    addresses: dedupe([...structuredAddresses, ...markedUpAddresses, ...textAddresses]).slice(0, 6),
  };
}
