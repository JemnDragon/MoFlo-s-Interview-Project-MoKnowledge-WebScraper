/**
 * Content Themes — the recurring subjects a business writes about.
 *
 * This is the field that most directly serves MoBlogs and MoSocial. Both have to
 * answer "what should this post be about?", and nothing else in the baseline
 * schema answers it: Offerings lists what the company sells, Writing Style
 * describes how it writes, but neither says what it keeps *talking about*. A
 * landscaper who sells patios but writes constantly about water conservation has
 * a content programme the offering list cannot see.
 *
 * Honesty constraint: a theme must RECUR. A subject mentioned once is a
 * sentence, not a theme, so anything appearing in fewer than two distinct places
 * is dropped rather than reported with `mentions: 1`. Every theme carries its
 * example strings so a reviewer can check the claim rather than trust the count.
 */

import signalFile from "@/data/content-signals.json";
import type { ContentThemeEntry } from "@/types/knowledge";
import { collapseWhitespace, dedupe } from "@/lib/utils/text";
import type { TransformContext } from "./context";

const STOPWORDS = new Set(signalFile.themeStopwords);

/** Below this, a repeated word is coincidence rather than a subject. */
const MIN_MENTIONS = 2;
const MAX_THEMES = 12;
const MIN_TERM_LENGTH = 4;

/**
 * Headings, offering names and list items — the places a site names a subject
 * deliberately. Body prose is excluded on purpose: it inflates common words
 * without indicating that the business considers them topics.
 */
function themeSources(context: TransformContext): string[] {
  const sources: string[] = [];

  for (const page of context.pages) {
    for (const heading of page.headings) {
      if (heading.level <= 3) sources.push(heading.text);
    }
    for (const offering of page.candidates.offerings) {
      if (offering.name) sources.push(offering.name);
    }
    // List items are where service menus and topic lists live.
    sources.push(...page.listItems.filter((item) => item.length < 80));
  }

  return dedupe(
    sources.map(collapseWhitespace).filter((text) => text.length >= MIN_TERM_LENGTH),
  );
}

function significantTerms(text: string): string[] {
  return collapseWhitespace(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= MIN_TERM_LENGTH && !STOPWORDS.has(word));
}

export function transformContentThemes(context: TransformContext): ContentThemeEntry[] {
  const sources = themeSources(context);

  // term → the distinct source strings it appeared in.
  const occurrences = new Map<string, Set<string>>();

  for (const source of sources) {
    for (const term of dedupe(significantTerms(source))) {
      const seen = occurrences.get(term) ?? new Set<string>();
      seen.add(source);
      occurrences.set(term, seen);
    }
  }

  const themes: ContentThemeEntry[] = [];

  for (const [term, examples] of occurrences) {
    if (examples.size < MIN_MENTIONS) continue;
    themes.push({
      theme: term,
      mentions: examples.size,
      // Three is enough for a reviewer to judge whether the term is a real
      // subject or an artefact of repeated navigation furniture.
      examples: Array.from(examples).slice(0, 3),
    });
  }

  return themes
    .sort((a, b) => b.mentions - a.mentions || (a.theme ?? "").localeCompare(b.theme ?? ""))
    .slice(0, MAX_THEMES);
}
