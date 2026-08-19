/**
 * Offering candidates: services, products, packages, menu items.
 *
 * Sources in descending confidence: schema.org Product/Service/Offer nodes,
 * service-card markup, then heading+description pairs on a services page.
 * Pricing is captured as the literal string found ("from $89", "£25/hr") rather
 * than parsed into a number — the units, qualifiers and "starting at" hedges are
 * part of the fact, and normalising them away would misrepresent it.
 */

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import signalFile from "@/data/content-signals.json";
import type { RawOfferingCandidate } from "@/types/scrape";
import { collapseWhitespace, dedupeBy } from "@/lib/utils/text";
import { isUiNoise } from "./uiNoise";

const PRICE_PATTERN =
  /(?:from|starting at|starts at|as low as)?\s?[$£€¥]\s?\d{1,3}(?:[,.]\d{3})*(?:\.\d{2})?(?:\s?(?:\/|per\s)\s?[a-z]{2,12})?/i;

/**
 * Pricing is stated as a *model* far more often than as a number on SMB sites —
 * "Per Project", "By Quote/Estimate", "Included with monitoring service". A
 * currency-only regex returns null for almost every real offering, so these are
 * matched too, from the shared signal file.
 *
 * Currency wins when both are present: "$850 per project" is more informative
 * than "per project". Either way the literal matched text is stored, never
 * normalised — "Free Inspection" and "$0" are not the same claim, and the hedge
 * in "from $850" is part of the fact.
 */
const PRICING_MODELS: string[] = signalFile.pricingModels;

const NON_OFFERING_HEADINGS =
  /^(about|about us|contact|contact us|our team|team|home|blog|news|testimonials|reviews|faq|frequently asked questions|hours|location|locations|follow us|newsletter|sitemap|privacy|terms)$/i;

/**
 * Markup that means "this price is not the price you would pay".
 *
 * A discounted product renders both numbers, and `element.text()` concatenates
 * them into "$40.00$28.00". The first regex match wins, so the *old* price was
 * being extracted and presented as the current one — a confidently wrong number,
 * which is worse than returning nothing, because nothing is visible in the
 * review UI and a wrong price is not.
 *
 * `<s>`, `<del>` and `<strike>` are the semantic forms. The class names are the
 * ones real themes actually ship — Shopify's Dawn uses `price-item--regular` for
 * the compare-at price and `price-item--sale` for the live one, which is a
 * naming choice that will catch out anyone matching on the word "regular".
 */
const STRUCK_PRICE_SELECTOR = [
  "s",
  "del",
  "strike",
  '[class*="compare-at" i]',
  '[class*="compare_at" i]',
  '[class*="was-price" i]',
  '[class*="was_price" i]',
  '[class*="original-price" i]',
  '[class*="original_price" i]',
  '[class*="old-price" i]',
  '[class*="price--old" i]',
  '[class*="price-item--regular" i]',
  '[class*="regular-price" i]',
  ".visually-hidden",
].join(", ");

/** The live price, when a theme marks it explicitly. Preferred over inference. */
const SALE_PRICE_SELECTOR = [
  "ins",
  '[class*="sale-price" i]',
  '[class*="sale_price" i]',
  '[class*="price--sale" i]',
  '[class*="price-item--sale" i]',
  '[class*="current-price" i]',
  '[class*="now-price" i]',
].join(", ");

export type PriceReading = {
  /** What a customer would pay today. */
  price: string | null;
  /** The struck-through price, when the page showed a discount. */
  original: string | null;
};

/**
 * Reads price out of an element rather than out of a flat string, so the markup
 * that distinguishes the two numbers is still available.
 *
 * Order matters: an explicitly-marked sale price is a fact the theme is stating,
 * so it wins outright. Only when nothing is marked do we fall back to "strip the
 * struck-through parts and take what is left", which is inference and can be
 * wrong on a theme that names things unusually.
 */
export function priceFromElement(element: cheerio.Cheerio<AnyNode>): PriceReading {
  const original = priceIn(collapseWhitespace(element.find(STRUCK_PRICE_SELECTOR).text()));

  const marked = priceIn(collapseWhitespace(element.find(SALE_PRICE_SELECTOR).text()));
  if (marked) return { price: marked, original: original === marked ? null : original };

  // Nothing marked as the sale price. Remove the struck-through nodes from a
  // clone — a clone because `$` is shared with every other extractor on this
  // page and mutating it would silently change what they see.
  const clone = element.clone();
  clone.find(STRUCK_PRICE_SELECTOR).remove();
  const remaining = priceIn(collapseWhitespace(clone.text()));

  if (remaining) return { price: remaining, original: original === remaining ? null : original };
  // Only the struck price exists. That is still the only number on the page, so
  // it is reported — as the price, with no discount claimed, because "was $40"
  // with no "now" is not evidence of a sale.
  return { price: original, original: null };
}

/**
 * Content that is a control for choosing something, not content about the
 * business.
 *
 * A real scan extracted an offering named "Country/region" whose features were
 * two hundred country names and currency codes. That is Shopify's localisation
 * picker: an `h2` followed by a disclosure `ul` of `li` links, which is
 * structurally indistinguishable from "service heading followed by feature
 * list" unless you look at what the list is *for*.
 *
 * Excluded by ancestry rather than by content, because ancestry is a structural
 * fact. The content-shaped guard exists too, further down, as a second line —
 * but it is the fallback, not the rule.
 */
const SELECTOR_CONTEXT = [
  "select",
  "option",
  "optgroup",
  "datalist",
  '[role="listbox"]',
  '[role="combobox"]',
  '[role="menu"]',
  '[role="menubar"]',
  "localization-form",
  '[class*="localization" i]',
  '[class*="country-selector" i]',
  '[class*="currency-selector" i]',
  '[class*="language-selector" i]',
  '[class*="locale-selector" i]',
  '[class*="disclosure" i]',
  "nav",
  "header",
  "footer",
].join(", ");

function insideSelector($: cheerio.CheerioAPI, el: AnyNode): boolean {
  return $(el).closest(SELECTOR_CONTEXT).length > 0;
}

/** Currency codes in parentheses — "Afghanistan (AFN ؋)", "Albania (ALL L)". */
const CURRENCY_CODE_ENTRY = /\(\s*[A-Z]{3}\b/;

/**
 * Second line of defence for the same problem, on content rather than ancestry.
 *
 * Two independent tells, either of which is enough:
 *
 *  - **Anomalous length.** No small business lists forty features under one
 *    service. Checked against the *raw* list, before the twelve-item cap, or the
 *    cap would hide the very signal being tested for.
 *  - **Currency-code shape.** Half or more of the entries matching
 *    "(XXX" is a region picker, not a feature list. Requires several matches so
 *    a genuine "Pricing (USD)" bullet cannot trip it.
 */
export function looksLikeOptionList(entries: string[]): boolean {
  if (entries.length >= 25) return true;
  if (entries.length < 4) return false;
  const codeLike = entries.filter((entry) => CURRENCY_CODE_ENTRY.test(entry)).length;
  return codeLike >= 4 && codeLike / entries.length >= 0.5;
}

export function priceIn(text: string): string | null {
  const currency = PRICE_PATTERN.exec(text);
  if (currency) return collapseWhitespace(currency[0]);

  const haystack = text.toLowerCase();
  for (const model of PRICING_MODELS) {
    const index = haystack.indexOf(model);
    if (index === -1) continue;
    // Return the phrase as the page wrote it, with its original casing, plus
    // whatever qualifier immediately follows ("included with monitoring service").
    const slice = collapseWhitespace(text.slice(index, index + model.length + 30));
    const clipped = slice.split(/[.;|•\n]/)[0] ?? slice;
    return collapseWhitespace(clipped);
  }
  return null;
}

function fromJsonLd(jsonLd: Record<string, unknown>[]): RawOfferingCandidate[] {
  const offerings: RawOfferingCandidate[] = [];

  const consider = (node: unknown) => {
    if (typeof node !== "object" || node === null) return;
    const record = node as Record<string, unknown>;
    const type = record["@type"];
    const types = (Array.isArray(type) ? type : [type]).filter(
      (value): value is string => typeof value === "string",
    );
    const isOffering = types.some((value) =>
      ["product", "service", "offer", "menuitem", "course", "event"].includes(value.toLowerCase()),
    );
    if (!isOffering) return;

    const name = typeof record["name"] === "string" ? collapseWhitespace(record["name"]) : null;
    const description =
      typeof record["description"] === "string"
        ? collapseWhitespace(record["description"])
        : null;
    const category =
      typeof record["category"] === "string" ? collapseWhitespace(record["category"]) : null;

    let priceText: string | null = null;
    const offers = record["offers"];
    if (typeof offers === "object" && offers !== null) {
      const offerRecord = (Array.isArray(offers) ? offers[0] : offers) as Record<string, unknown>;
      const price = offerRecord?.["price"];
      const currency = offerRecord?.["priceCurrency"];
      if (price !== undefined && price !== null) {
        priceText = collapseWhitespace(
          `${typeof currency === "string" ? `${currency} ` : ""}${String(price)}`,
        );
      }
    }

    if (!name) return;
    offerings.push({ name, description, features: [], priceText, originalPriceText: null, category });
  };

  for (const node of jsonLd) {
    consider(node);
    for (const key of ["hasOfferCatalog", "makesOffer", "itemListElement", "hasMenuItem"]) {
      const value = node[key];
      if (Array.isArray(value)) value.forEach(consider);
      else consider(value);
    }
  }

  return offerings;
}

function fromCards($: cheerio.CheerioAPI): RawOfferingCandidate[] {
  const offerings: RawOfferingCandidate[] = [];
  const selector = [
    '[class*="service-card" i]',
    '[class*="service-item" i]',
    '[class*="product-card" i]',
    '[class*="pricing-card" i]',
    '[class*="package" i]',
    '[class*="menu-item" i]',
    '[itemtype*="Product" i]',
    '[itemtype*="Service" i]',
  ].join(", ");

  $(selector).each((_, el) => {
    if (insideSelector($, el)) return;
    const card = $(el);
    const name = collapseWhitespace(card.find("h1,h2,h3,h4,h5,strong").first().text()) || null;
    if (!name || NON_OFFERING_HEADINGS.test(name) || isUiNoise(name)) return;

    const description = collapseWhitespace(card.find("p").first().text()) || null;
    const rawFeatures = card
      .find("li")
      .map((_i, li) => (insideSelector($, li) ? "" : collapseWhitespace($(li).text())))
      .get()
      .filter((value) => value.length > 0 && !isUiNoise(value));
    if (looksLikeOptionList(rawFeatures)) return;

    const reading = priceFromElement(card);
    offerings.push({
      name,
      description,
      features: rawFeatures.slice(0, 12),
      priceText: reading.price,
      originalPriceText: reading.original,
      category: null,
    });
  });

  return offerings;
}

function fromHeadings($: cheerio.CheerioAPI): RawOfferingCandidate[] {
  const offerings: RawOfferingCandidate[] = [];

  $("h2, h3").each((_, el) => {
    // A heading inside a picker, a nav or a footer is labelling a control, not
    // announcing a service. This is what let "Country/region" become an offering.
    if (insideSelector($, el)) return;
    const name = collapseWhitespace($(el).text());
    if (!name || name.length > 90 || NON_OFFERING_HEADINGS.test(name)) return;
    if (isUiNoise(name)) return;
    if (name.endsWith("?")) return; // that's an FAQ heading, not an offering

    let description: string | null = null;
    const features: string[] = [];
    let node: AnyNode | null = $(el).next().get(0) ?? null;
    let hops = 0;

    while (node && hops < 3) {
      const element = $(node);
      const tag = (node as { tagName?: string }).tagName?.toLowerCase();
      if (tag && /^h[1-3]$/.test(tag)) break;
      if (tag === "p" && !description) {
        description = collapseWhitespace(element.text()) || null;
      }
      if (tag === "ul" || tag === "ol") {
        element.find("li").each((_i, li) => {
          if (insideSelector($, li)) return;
          const value = collapseWhitespace($(li).text());
          if (value && !isUiNoise(value)) features.push(value);
        });
      }
      node = element.next().get(0) ?? null;
      hops += 1;
    }

    if (!description && features.length === 0) return;
    // Tested on the uncapped list: the twelve-item slice below would hide the
    // two-hundred-entry shape that is the whole signal.
    if (looksLikeOptionList(features)) return;
    // Deliberately NOT the markup-aware reading. This path fires on a bare
    // heading in prose, whose nearest container is often a whole page section —
    // a price found there could belong to a different offering entirely.
    // Discounted product grids come through `fromCards`, which has a bounded
    // element to read.
    offerings.push({
      name,
      description,
      features: features.slice(0, 12),
      priceText: priceIn(`${name} ${description ?? ""}`),
      originalPriceText: null,
      category: null,
    });
  });

  return offerings;
}

export function extractOfferings(
  $: cheerio.CheerioAPI,
  jsonLd: Record<string, unknown>[],
): RawOfferingCandidate[] {
  const all = [...fromJsonLd(jsonLd), ...fromCards($), ...fromHeadings($)];
  return dedupeBy(all, (offering) => (offering.name ?? "").toLowerCase().trim()).slice(0, 40);
}
