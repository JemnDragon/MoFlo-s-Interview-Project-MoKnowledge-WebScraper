/**
 * Testimonials / social proof.
 *
 * Beyond being a schema field in its own right, this is the evidence base for
 * the actual-vs-stated-customer comparison (prompt 3): who actually writes in
 * versus who the company says it serves.
 *
 * Attribution is only recorded when the markup separates it from the quote
 * (a <cite>, a footer, an author class). We do not slice the last line off a
 * quote and call it a name.
 */

import * as cheerio from "cheerio";
import type { RawTestimonialCandidate } from "@/types/scrape";
import { collapseWhitespace, dedupeBy } from "@/lib/utils/text";

const ATTRIBUTION_SELECTOR = [
  "cite",
  "footer",
  '[class*="author" i]',
  '[class*="attribution" i]',
  '[class*="client-name" i]',
  '[class*="reviewer" i]',
].join(", ");

function cleanQuote(value: string): string {
  return collapseWhitespace(value).replace(/^["“”'']+|["“”'']+$/g, "");
}

function fromJsonLd(jsonLd: Record<string, unknown>[]): RawTestimonialCandidate[] {
  const testimonials: RawTestimonialCandidate[] = [];

  const consider = (node: unknown) => {
    if (typeof node !== "object" || node === null) return;
    const record = node as Record<string, unknown>;
    const type = record["@type"];
    const types = (Array.isArray(type) ? type : [type]).filter(
      (value): value is string => typeof value === "string",
    );
    if (!types.some((value) => value.toLowerCase() === "review")) return;

    const body = record["reviewBody"] ?? record["description"];
    const author = record["author"];
    const authorName =
      typeof author === "string"
        ? author
        : typeof author === "object" && author !== null
          ? ((author as Record<string, unknown>)["name"] as string | undefined)
          : undefined;

    if (typeof body !== "string" || body.trim().length === 0) return;
    testimonials.push({
      quote: cleanQuote(body),
      attributedTo: typeof authorName === "string" ? collapseWhitespace(authorName) : null,
    });
  };

  for (const node of jsonLd) {
    consider(node);
    const reviews = node["review"];
    if (Array.isArray(reviews)) reviews.forEach(consider);
    else consider(reviews);
  }

  return testimonials;
}

function fromMarkup($: cheerio.CheerioAPI): RawTestimonialCandidate[] {
  const testimonials: RawTestimonialCandidate[] = [];
  const selector = [
    "blockquote",
    '[class*="testimonial" i]',
    '[class*="review" i]:not([class*="reviewer" i])',
    '[class*="quote" i]',
  ].join(", ");

  $(selector).each((_, el) => {
    const block = $(el);
    const attributionEl = block.find(ATTRIBUTION_SELECTOR).first();
    const attributedTo = attributionEl.length > 0 ? collapseWhitespace(attributionEl.text()) : null;

    const clone = block.clone();
    clone.find(ATTRIBUTION_SELECTOR).remove();
    const quote = cleanQuote(clone.text());

    if (quote.length < 20 || quote.length > 1200) return;
    testimonials.push({
      quote,
      attributedTo: attributedTo && attributedTo.length < 90 ? attributedTo.replace(/^[—–-]\s*/, "") : null,
    });
  });

  return testimonials;
}

export function extractTestimonials(
  $: cheerio.CheerioAPI,
  jsonLd: Record<string, unknown>[],
): RawTestimonialCandidate[] {
  const all = [...fromJsonLd(jsonLd), ...fromMarkup($)];
  return dedupeBy(all, (item) => (item.quote ?? "").slice(0, 120).toLowerCase()).slice(0, 25);
}
