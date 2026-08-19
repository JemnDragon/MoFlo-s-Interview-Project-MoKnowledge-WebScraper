/**
 * FAQ / common objections.
 *
 * Reframed from "customer complaints" in the baseline brief, because a company's
 * own website is structurally incapable of being a source for its complaints.
 * What it *does* publish is the set of objections it has decided are worth
 * pre-empting — which is the same underlying signal, honestly sourced.
 */

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { RawFaqCandidate } from "@/types/scrape";
import { collapseWhitespace, dedupeBy } from "@/lib/utils/text";

function looksLikeQuestion(text: string): boolean {
  const value = collapseWhitespace(text);
  if (value.length < 8 || value.length > 220) return false;
  return (
    value.endsWith("?") ||
    /^(how|what|when|where|why|who|can|do|does|is|are|will|should|which)\b/i.test(value)
  );
}

function fromJsonLd(jsonLd: Record<string, unknown>[]): RawFaqCandidate[] {
  const entries: RawFaqCandidate[] = [];

  const consider = (node: unknown) => {
    if (typeof node !== "object" || node === null) return;
    const record = node as Record<string, unknown>;
    const type = record["@type"];
    const types = (Array.isArray(type) ? type : [type]).filter(
      (value): value is string => typeof value === "string",
    );
    if (!types.some((value) => value.toLowerCase() === "question")) return;

    const question = typeof record["name"] === "string" ? collapseWhitespace(record["name"]) : null;
    const accepted = record["acceptedAnswer"];
    const answerText =
      typeof accepted === "object" && accepted !== null
        ? (accepted as Record<string, unknown>)["text"]
        : undefined;

    entries.push({
      question,
      answer: typeof answerText === "string" ? collapseWhitespace(stripTags(answerText)) : null,
    });
  };

  for (const node of jsonLd) {
    consider(node);
    const mainEntity = node["mainEntity"];
    if (Array.isArray(mainEntity)) mainEntity.forEach(consider);
    else consider(mainEntity);
  }

  return entries;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ");
}

function fromDetails($: cheerio.CheerioAPI): RawFaqCandidate[] {
  const entries: RawFaqCandidate[] = [];
  $("details").each((_, el) => {
    const details = $(el);
    const question = collapseWhitespace(details.find("summary").first().text());
    const clone = details.clone();
    clone.find("summary").remove();
    const answer = collapseWhitespace(clone.text());
    if (!question) return;
    entries.push({ question, answer: answer || null });
  });
  return entries;
}

function fromAccordions($: cheerio.CheerioAPI): RawFaqCandidate[] {
  const entries: RawFaqCandidate[] = [];
  const selector = [
    '[class*="accordion" i]',
    '[class*="faq" i]',
    '[itemtype*="Question" i]',
  ].join(", ");

  $(selector).each((_, el) => {
    const block = $(el);
    const question = collapseWhitespace(
      block.find('h2,h3,h4,h5,summary,[class*="question" i],[itemprop="name"]').first().text(),
    );
    if (!question || !looksLikeQuestion(question)) return;
    const answer = collapseWhitespace(
      block.find('p,[class*="answer" i],[itemprop="text"]').first().text(),
    );
    entries.push({ question, answer: answer || null });
  });

  return entries;
}

function fromHeadings($: cheerio.CheerioAPI): RawFaqCandidate[] {
  const entries: RawFaqCandidate[] = [];
  $("h2, h3, h4, strong").each((_, el) => {
    const question = collapseWhitespace($(el).text());
    if (!question.endsWith("?") || !looksLikeQuestion(question)) return;

    let answer: string | null = null;
    let node: AnyNode | null = $(el).next().get(0) ?? null;
    let hops = 0;
    while (node && hops < 3 && !answer) {
      const element = $(node);
      const tag = (node as { tagName?: string }).tagName?.toLowerCase();
      if (tag && /^h[1-4]$/.test(tag)) break;
      const text = collapseWhitespace(element.text());
      if (text.length > 15) answer = text;
      node = element.next().get(0) ?? null;
      hops += 1;
    }
    entries.push({ question, answer });
  });
  return entries;
}

export function extractFaq(
  $: cheerio.CheerioAPI,
  jsonLd: Record<string, unknown>[],
): RawFaqCandidate[] {
  const all = [...fromJsonLd(jsonLd), ...fromDetails($), ...fromAccordions($), ...fromHeadings($)];
  return dedupeBy(all, (entry) => (entry.question ?? "").toLowerCase().trim()).slice(0, 30);
}
