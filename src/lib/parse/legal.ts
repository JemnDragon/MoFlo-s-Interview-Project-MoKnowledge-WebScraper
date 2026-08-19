/**
 * Legal and compliance language: privacy, terms, disclaimers, guarantees.
 *
 * Why a content-generation system should care: this is the set of claims the
 * business has already committed to in writing, and the set it is constrained
 * by. A MoMail campaign that promises next-day delivery when the site's terms
 * say 3–5 business days, or that omits a disclaimer the business is legally
 * required to carry, is a real liability rather than an off-brand sentence.
 *
 * Clauses are stored verbatim. Legal wording IS the fact — a paraphrased
 * disclaimer is not a disclaimer, and summarising one would be the single worst
 * place in this schema to lose fidelity.
 */

import * as cheerio from "cheerio";
import type { LegalLanguageEntry } from "@/types/knowledge";
import { collapseWhitespace, dedupeBy } from "@/lib/utils/text";

/** Ordered: the first pattern to match a clause wins its `kind`. */
const CLAUSE_KINDS: { kind: string; pattern: RegExp }[] = [
  { kind: "privacy", pattern: /\b(privacy policy|we (?:do not|don't|never) (?:sell|share) your|personal (?:data|information)|GDPR|CCPA|cookies?)\b/i },
  { kind: "terms", pattern: /\b(terms (?:of|and) (?:service|use|sale)|conditions of (?:sale|use))\b/i },
  { kind: "disclaimer", pattern: /\b(disclaimer|not (?:medical|legal|financial|tax) advice|results (?:may|will) vary|for informational purposes only|no guarantee of)\b/i },
  { kind: "guarantee", pattern: /\b(money[- ]back guarantee|satisfaction guaranteed?|warranty|guaranteed for|refund policy|返品)\b/i },
  { kind: "accessibility", pattern: /\b(accessibility statement|WCAG|ADA compliant)\b/i },
  { kind: "licensing", pattern: /\b(licen[cs]e (?:no|number|#)|insured and bonded|bonded and insured|registration (?:no|number))\b/i },
];

const MIN_CLAUSE = 25;
const MAX_CLAUSE = 400;

function kindOf(text: string): string | null {
  for (const { kind, pattern } of CLAUSE_KINDS) {
    if (pattern.test(text)) return kind;
  }
  return null;
}

export function extractLegalLanguage(
  $: cheerio.CheerioAPI,
  sourceUrl: string,
): LegalLanguageEntry[] {
  const entries: LegalLanguageEntry[] = [];

  // Legal text overwhelmingly lives in the footer, in fine-print classes, or on
  // a dedicated policy page. Scanning the whole body would pull in marketing
  // copy that merely contains the word "guarantee".
  const scopes = [
    "footer",
    '[class*="legal" i]',
    '[class*="disclaimer" i]',
    '[class*="fine-print" i]',
    '[class*="policy" i]',
    '[class*="terms" i]',
    "small",
  ].join(", ");

  const consider = (raw: string) => {
    const text = collapseWhitespace(raw);
    if (text.length < MIN_CLAUSE || text.length > MAX_CLAUSE) return;
    const kind = kindOf(text);
    if (!kind) return;
    entries.push({ kind, text, sourceUrl });
  };

  $(scopes).each((_, el) => {
    const block = $(el);
    // Sentence-level, so one footer doesn't become a single 4,000-character blob.
    for (const sentence of collapseWhitespace(block.text()).split(/(?<=[.!?])\s+/)) {
      consider(sentence);
    }
  });

  // A dedicated policy page: take its paragraphs directly.
  if (/privacy|terms|legal|disclaimer|accessibility|refund/i.test(sourceUrl)) {
    $("p, li").each((_, el) => consider($(el).text()));
  }

  return dedupeBy(entries, (entry) => (entry.text ?? "").slice(0, 120).toLowerCase()).slice(0, 20);
}
