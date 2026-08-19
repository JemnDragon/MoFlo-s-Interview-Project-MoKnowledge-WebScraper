/**
 * Suppliers & partners via third-party script/embed detection.
 *
 * Reading prose for partnerships does not work on SMB sites: businesses very
 * rarely write "we use Stripe for payments and Mailchimp for our newsletter".
 * But their <script src>, <iframe src> and <link href> hostnames say it plainly,
 * and those are unambiguous facts about the site rather than interpretations of
 * it. Matched against `src/data/third-party-signatures.json`.
 */

import * as cheerio from "cheerio";
import signatureFile from "@/data/third-party-signatures.json";
import type { PartnerEntry } from "@/types/knowledge";
import { dedupeBy } from "@/lib/utils/text";

type Signature = { name: string; domains: string[]; kind: string };

const SIGNATURES: Signature[] = (signatureFile as { signatures: Signature[] }).signatures;

export function extractPartners($: cheerio.CheerioAPI): PartnerEntry[] {
  const references: string[] = [];

  $("script[src]").each((_, el) => {
    const src = $(el).attr("src");
    if (src) references.push(src);
  });
  $("iframe[src]").each((_, el) => {
    const src = $(el).attr("src");
    if (src) references.push(src);
  });
  $("link[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (href) references.push(href);
  });
  // Inline scripts often carry the vendor's endpoint in a string literal.
  $("script:not([src])").each((_, el) => {
    references.push($(el).contents().text().slice(0, 4000));
  });

  const haystack = references.join("\n").toLowerCase();
  const partners: PartnerEntry[] = [];

  for (const signature of SIGNATURES) {
    const matched = signature.domains.find((domain) => haystack.includes(domain.toLowerCase()));
    if (!matched) continue;
    partners.push({
      name: signature.name,
      domain: matched,
      detectedVia: `${signature.kind} script/embed`,
    });
  }

  return dedupeBy(partners, (partner) => partner.name ?? "");
}
