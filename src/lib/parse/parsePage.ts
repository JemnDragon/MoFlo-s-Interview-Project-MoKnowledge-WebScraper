/**
 * Per-page parse orchestrator.
 *
 * A thin composer: it loads the document once with cheerio, runs Readability for
 * narrative text, and delegates every extraction concern to its own small
 * module. Adding a new extractor means adding one import and one line here.
 *
 * Synchronous by design. Every network call (page HTML, stylesheets) happened
 * upstream in the crawler, which is what keeps this testable from a fixture.
 */

import "server-only";
import * as cheerio from "cheerio";
import type { ParsedPage } from "@/types/scrape";
import type { PageType } from "@/types/knowledge";
import { collapseWhitespace, dedupe, visibleText } from "@/lib/utils/text";
import { isUiNoise, withoutUiNoise } from "./uiNoise";
import { extractMainContent } from "./readability";
import { parseStructuredData } from "./structuredData";
import { parseBrandSignals } from "./branding";
import { extractSocialLinks } from "./socialLinks";
import { parseLanguageSignals } from "./language";
import { extractCtas } from "./ctas";
import { extractPartners } from "./partners";
import { extractContact } from "./contact";
import { extractPeople } from "./people";
import { extractOfferings } from "./offerings";
import { extractTestimonials } from "./testimonials";
import { extractFaq } from "./faq";
import { extractCertifications } from "./certifications";
import { extractLegalLanguage } from "./legal";

export type ParsePageInput = {
  url: string;
  pageTypes: PageType[];
  html: string;
  /** Concatenated text of the page's linked stylesheets, fetched by the crawler. */
  externalCss: string;
};

export function parsePage(input: ParsePageInput): ParsedPage {
  const { url, pageTypes, html, externalCss } = input;
  const $ = cheerio.load(html);

  // Remove non-content nodes before reading any text so script bodies and CSS
  // never leak into snippets. Structured data was already captured above them.
  const structuredData = parseStructuredData($);
  const brand = parseBrandSignals($, url, externalCss);
  const socialLinks = extractSocialLinks($, url);
  const ctas = extractCtas($, url, url);
  const partners = extractPartners($);
  const language = parseLanguageSignals($);
  const certifications = extractCertifications($);
  const legal = extractLegalLanguage($, url);
  // Offerings first: their names are handed to the people extractor so a product
  // card can never also be read as a person.
  const offerings = extractOfferings($, structuredData.jsonLd);
  const offeringNames = new Set(
    offerings
      .map((offering) => offering.name?.trim().toLowerCase())
      .filter((name): name is string => Boolean(name)),
  );
  const people = extractPeople($, structuredData.jsonLd, offeringNames);
  const testimonials = extractTestimonials($, structuredData.jsonLd);
  const faq = extractFaq($, structuredData.jsonLd);

  $("script, style, noscript, svg").remove();
  const pageText = collapseWhitespace($("body").text());

  // Headings, list items and paragraphs are the three candidate text streams
  // every downstream field reads from, so the UI-chrome exclusion is applied
  // here, once, rather than inside each extractor. `visibleText` rather than
  // `collapseWhitespace`: a heading of three zero-width spaces is not
  // whitespace to JavaScript and would otherwise survive as a blank entry all
  // the way to the review UI.
  const headings: { level: number; text: string }[] = [];
  $("h1, h2, h3, h4").each((_, el) => {
    const tag = (el as { tagName?: string }).tagName ?? "h4";
    const text = visibleText($(el).text());
    if (text && !isUiNoise(text)) headings.push({ level: Number(tag.slice(1)) || 4, text });
  });

  const listItems = dedupe(
    withoutUiNoise(
      $("li")
        .map((_, el) => visibleText($(el).text()))
        .get(),
    ).filter((text) => text.length > 0 && text.length < 200),
  ).slice(0, 120);

  const main = extractMainContent(html, url);
  // Readability usually strips chrome, but an empty-cart notice or a cookie
  // banner rendered inside the main content region survives it — and a snippet
  // reading "Your cart is empty" landing in Pitch is the exact leak this guards.
  const paragraphs = withoutUiNoise(main.paragraphs.map((text) => visibleText(text))).filter(
    (text) => text.length > 0,
  );

  return {
    url,
    pageTypes,
    title: main.title ?? collapseWhitespace($("title").first().text()) ?? null,
    mainContent: main.text,
    paragraphs,
    headings: headings.slice(0, 60),
    listItems,
    structuredData,
    brand,
    language,
    socialLinks,
    ctas,
    partners,
    legal,
    candidates: { people, offerings, testimonials, faq, certifications },
    contact: extractContact($, structuredData.jsonLd, pageText),
  };
}
