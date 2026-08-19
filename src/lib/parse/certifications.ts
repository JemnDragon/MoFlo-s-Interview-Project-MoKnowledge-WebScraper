/**
 * Certifications, awards and credentials at the organisation level.
 *
 * Individual credentials (a CPA licence, a state contractor number tied to one
 * named person) are captured on that person's Key People entry instead — they
 * belong to the human, not the company, and conflating the two produces claims
 * the business itself would not make.
 *
 * Only the matched phrase is kept. The issuer and year are recorded when they
 * appear inside the same phrase and left null otherwise.
 */

import * as cheerio from "cheerio";
import type { RawCertificationCandidate } from "@/types/scrape";
import { collapseWhitespace, dedupeBy } from "@/lib/utils/text";

const CREDENTIAL_PHRASE =
  /\b(?:[A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,4}\s+)?(?:certified|licensed|accredited|award(?:-winning|ed)?|recognized|member of|affiliated with|BBB[- ]accredited|A\+ rated|ISO\s?\d{4,5})\b[^.!?\n]{0,80}/g;

const YEAR = /\b(19|20)\d{2}\b/;

const ISSUER_HINTS =
  /\b(?:by|from|through|with)\s+(the\s+)?([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,4})/;

/** Filters out marketing prose that happens to contain a trigger word. */
function isPlausibleCredential(phrase: string): boolean {
  const value = collapseWhitespace(phrase);
  if (value.length < 10 || value.length > 120) return false;
  // "award winning service you can trust" is copy, not a credential.
  if (/\b(you|your|we promise|guarantee[ds]?)\b/i.test(value)) return false;
  return true;
}

export function extractCertifications($: cheerio.CheerioAPI): RawCertificationCandidate[] {
  const scopes = [
    '[class*="cert" i]',
    '[class*="award" i]',
    '[class*="accredit" i]',
    '[class*="badge" i]',
    '[class*="credential" i]',
    "footer",
  ].join(", ");

  const texts: string[] = [];
  $(scopes).each((_, el) => {
    texts.push(collapseWhitespace($(el).text()));
  });
  // Alt text on trust badges is often the cleanest statement of a credential.
  $("img[alt]").each((_, el) => {
    const alt = collapseWhitespace($(el).attr("alt") ?? "");
    if (/certif|licens|accredit|award|member|iso\s?\d/i.test(alt)) texts.push(alt);
  });

  const candidates: RawCertificationCandidate[] = [];

  for (const text of texts) {
    CREDENTIAL_PHRASE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CREDENTIAL_PHRASE.exec(text)) !== null) {
      const phrase = collapseWhitespace(match[0]);
      if (!isPlausibleCredential(phrase)) continue;

      const yearMatch = YEAR.exec(phrase);
      const issuerMatch = ISSUER_HINTS.exec(phrase);

      candidates.push({
        name: phrase,
        issuer: issuerMatch?.[2] ? collapseWhitespace(issuerMatch[2]) : null,
        year: yearMatch ? Number(yearMatch[0]) : null,
      });
    }
  }

  return dedupeBy(candidates, (item) => (item.name ?? "").toLowerCase()).slice(0, 20);
}
