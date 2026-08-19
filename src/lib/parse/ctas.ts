/**
 * Channels / funnels / CTAs.
 *
 * A CTA is identified structurally — a button, a submit control, a tel:/mailto:
 * link, a link into a known booking host — rather than by "does this text sound
 * persuasive". Structure is checkable; tone is not.
 */

import * as cheerio from "cheerio";
import type { CtaEntry } from "@/types/knowledge";
import { absolutize, hostnameOf } from "@/lib/utils/url";
import { dedupeBy, visibleText } from "@/lib/utils/text";
import { isUiNoise } from "./uiNoise";

const BOOKING_HOSTS = [
  "calendly.com",
  "acuityscheduling.com",
  "squareup.com",
  "square.site",
  "mindbodyonline.com",
  "opentable.com",
  "resy.com",
  "booksy.com",
  "vagaro.com",
  "setmore.com",
  "youcanbook.me",
];

function kindFor(href: string): string {
  if (href.startsWith("tel:")) return "tel";
  if (href.startsWith("mailto:")) return "mailto";
  const host = hostnameOf(href)?.replace(/^www\./, "");
  if (host && BOOKING_HOSTS.some((booking) => host === booking || host.endsWith(`.${booking}`))) {
    return "booking";
  }
  return "link";
}

export function extractCtas($: cheerio.CheerioAPI, baseUrl: string, sourceUrl: string): CtaEntry[] {
  const ctas: CtaEntry[] = [];

  // Anchors and buttons that look like calls to action structurally.
  const selectors = [
    'a[class*="btn" i][href]',
    'a[class*="button" i][href]',
    'a[role="button"][href]',
    'a[href^="tel:"]',
    'a[href^="mailto:"]',
    "button",
    'input[type="submit"]',
  ];

  $(selectors.join(", ")).each((_, el) => {
    const element = $(el);
    const rawHref = element.attr("href");
    const label =
      visibleText(element.text()) ||
      visibleText(element.attr("value") ?? "") ||
      visibleText(element.attr("aria-label") ?? "");

    if (!label) return;

    // Primary signal, and the only one that rejects on its own: this label is a
    // control for operating the website, not something the business is asking a
    // customer to do. Applied here as well as in `parsePage` because a CTA label
    // comes off an attribute rather than out of a text stream.
    if (isUiNoise(label)) return;

    const href = rawHref
      ? rawHref.startsWith("tel:") || rawHref.startsWith("mailto:")
        ? rawHref
        : absolutize(rawHref, baseUrl)
      : null;

    // Secondary signal. A missing or unresolvable href does NOT reject a
    // candidate by itself — a newsletter submit button is a real conversion path
    // and has no href at all. What it does is remove the strongest evidence that
    // this control goes anywhere, so the remaining evidence has to be better.
    //
    // Concretely: a control that submits a form is kept regardless, because
    // submitting is a destination even without a URL. A bare `<button>` outside
    // any form has neither a target nor a submit behaviour, so the only thing
    // left is its label — and a single-word label at that point is far more
    // likely to be a theme control the curated list has not caught yet
    // ("Toggle", "Expand", "Options") than a business asking for anything.
    //
    // Generic UI controls disproportionately lack real targets, so raising the
    // bar for the hrefless is where that correlation is worth spending. Two
    // words is a deliberately low bar: it drops the single-word stragglers
    // without touching "Notify Me", "Get Started" or "Book Now".
    if (!href) {
      const isFormControl =
        el.tagName === "input" ||
        (element.attr("type") ?? "").toLowerCase() === "submit" ||
        element.closest("form").length > 0;
      const wordCount = label.split(/\s+/).filter(Boolean).length;
      if (!isFormControl && wordCount < 2) return;
    }

    ctas.push({
      label,
      href,
      kind: href ? kindFor(href) : "form",
      sourceUrl,
    });
  });

  // Forms are funnels in their own right, even without a styled button.
  $("form").each((_, el) => {
    const form = $(el);
    const named =
      visibleText(form.attr("aria-label") ?? "") ||
      visibleText(form.attr("name") ?? "") ||
      visibleText(form.find("legend, h1, h2, h3").first().text());

    // A form the site itself named "search" is the search box, not a conversion
    // path. Only a *stated* name is tested: the "Form" fallback below must
    // survive, because `deriveChannels` reads a `kind: "form"` CTA as the
    // evidence for the "Online (website forms)" channel, and an unlabelled
    // contact form is exactly that evidence.
    if (named && isUiNoise(named)) return;

    const label = named || "Form";
    const action = form.attr("action");
    ctas.push({
      label,
      href: action ? absolutize(action, baseUrl) : null,
      kind: "form",
      sourceUrl,
    });
  });

  return dedupeBy(ctas, (cta) => `${cta.kind}::${cta.label?.toLowerCase()}`).slice(0, 25);
}
