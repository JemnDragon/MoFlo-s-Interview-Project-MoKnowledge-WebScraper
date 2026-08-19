/**
 * Channels and Funnels — derived from structural evidence, never from prose.
 *
 * These two fields sit next to CTAs but answer different questions:
 *
 *   Channels — how does this business reach market?   ("Phone", "Online store")
 *   Funnels  — what mechanisms convert interest?      ("Newsletter signup")
 *   CTAs     — what specific actions does it ask for? ("Get a free estimate")
 *
 * Every entry below is grounded in something observed: a `tel:` link, a form with
 * an email field and subscribe wording, a booking host in a script tag, a blog
 * page that discovery actually found. Nothing here reads marketing copy and
 * decides a business "probably" does content marketing — if the evidence is not
 * on the site, the entry is not in the list.
 *
 * That grounding is why both are plain `string[]`. Each label is a conclusion
 * drawn from several signals across several pages, so there is no single URL to
 * attach to it, and inventing a `sourceUrl` for an aggregate would be the kind of
 * false precision this schema avoids elsewhere.
 */

import type { CtaEntry } from "@/types/knowledge";
import { dedupe } from "@/lib/utils/text";
import type { TransformContext } from "./context";
import { pagesOfType } from "./context";

/* ------------------------------------------------------------------ *
 * Channels
 * ------------------------------------------------------------------ */

const COMMERCE_VENDORS = ["Shopify", "Square", "Toast", "DoorDash", "PayPal", "Stripe"];
const BOOKING_VENDORS = ["Calendly", "Acuity Scheduling", "Mindbody", "OpenTable", "Resy"];

export function deriveChannels(context: TransformContext): string[] {
  const channels: string[] = [];
  const ctas = context.pages.flatMap((page) => page.ctas);
  const partners = context.pages.flatMap((page) => page.partners);
  const hasPartner = (names: string[]) =>
    partners.some((partner) => names.includes(partner.name ?? ""));

  if (ctas.some((cta) => cta.kind === "form")) channels.push("Online (website forms)");
  if (
    ctas.some((cta) => cta.kind === "tel") ||
    context.pages.some((page) => page.contact.phones.length > 0)
  ) {
    channels.push("Phone");
  }
  if (
    ctas.some((cta) => cta.kind === "mailto") ||
    context.pages.some((page) => page.contact.emails.length > 0)
  ) {
    channels.push("Email");
  }
  if (ctas.some((cta) => cta.kind === "booking") || hasPartner(BOOKING_VENDORS)) {
    channels.push("Online booking");
  }
  if (hasPartner(COMMERCE_VENDORS)) channels.push("Online ordering / e-commerce");
  if (context.pages.some((page) => page.socialLinks.length > 0)) channels.push("Social media");
  // A published street address is a standing invitation to turn up.
  if (context.pages.some((page) => page.contact.addresses.length > 0)) {
    channels.push("In person (physical location)");
  }

  return dedupe(channels);
}

/* ------------------------------------------------------------------ *
 * Funnels
 * ------------------------------------------------------------------ */

/** Each rule names a mechanism and the evidence that must exist for it. */
type FunnelRule = {
  label: string;
  detect: (context: TransformContext, ctas: CtaEntry[]) => boolean;
};

const labelMatches = (ctas: CtaEntry[], pattern: RegExp) =>
  ctas.some((cta) => pattern.test(cta.label ?? ""));

const anyPageText = (context: TransformContext, pattern: RegExp) =>
  context.pages.some((page) => pattern.test(page.mainContent ?? ""));

const hasVendor = (context: TransformContext, names: string[]) =>
  context.pages.some((page) =>
    page.partners.some((partner) => names.includes(partner.name ?? "")),
  );

const FUNNEL_RULES: FunnelRule[] = [
  {
    label: "Newsletter signup",
    detect: (context, ctas) =>
      labelMatches(ctas, /\b(subscribe|newsletter|sign ?up for|join our list|stay updated)\b/i) ||
      hasVendor(context, ["Mailchimp", "Klaviyo"]),
  },
  {
    label: "Contact form",
    detect: (_context, ctas) =>
      ctas.some((cta) => cta.kind === "form" && /contact|message|enquir|inquir|get in touch/i.test(cta.label ?? "")) ||
      labelMatches(ctas, /\b(contact us|send (us )?a message|get in touch)\b/i),
  },
  {
    label: "Quote / estimate request",
    detect: (_context, ctas) =>
      labelMatches(ctas, /\b(quote|estimate|pricing request|get a price)\b/i),
  },
  {
    label: "Appointment scheduler",
    detect: (context, ctas) =>
      labelMatches(ctas, /\b(book|schedule|appointment|consultation|reserve)\b/i) ||
      hasVendor(context, BOOKING_VENDORS),
  },
  {
    label: "Demo request",
    detect: (_context, ctas) => labelMatches(ctas, /\b(demo|trial|walkthrough|see it in action)\b/i),
  },
  {
    label: "Content marketing (blog)",
    // Only when discovery actually found a blog page — not when the word appears.
    detect: (context) => pagesOfType(context, "blog").length > 0,
  },
  {
    label: "Educational content (FAQs)",
    detect: (context) =>
      pagesOfType(context, "faq").length > 0 ||
      context.pages.some((page) => page.candidates.faq.length >= 3),
  },
  {
    label: "Testimonials and social proof",
    detect: (context) => context.pages.some((page) => page.candidates.testimonials.length > 0),
  },
  {
    label: "Financing options",
    detect: (context) =>
      anyPageText(context, /\b(financing available|payment plans?|finance your|0% APR|monthly payments)\b/i),
  },
  {
    label: "Partnership / reseller program",
    detect: (context) =>
      anyPageText(context, /\b(partner (with us|program)|reseller|become a dealer|affiliate program)\b/i),
  },
  {
    label: "Free inspection or assessment",
    detect: (context, ctas) =>
      labelMatches(ctas, /\bfree (inspection|assessment|audit|analysis|evaluation)\b/i) ||
      anyPageText(context, /\bfree (inspection|assessment|audit|evaluation)\b/i),
  },
  {
    label: "Live chat",
    detect: (context) => hasVendor(context, ["Intercom", "Zendesk", "Tawk.to", "Podium"]),
  },
];

export function deriveFunnels(context: TransformContext): string[] {
  const ctas = context.pages.flatMap((page) => page.ctas);
  return FUNNEL_RULES.filter((rule) => rule.detect(context, ctas)).map((rule) => rule.label);
}
