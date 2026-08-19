/**
 * Branding & Style.
 *
 * Fonts, colours and logos are Category 1 — parsed straight out of the site's own
 * CSS and markup. Writing Style and Art Style are Category 2 synthesis fields.
 *
 * Writing Style in particular is why `spreadAcrossSources` exists: a bundle taken
 * entirely from the About page would describe the About page's voice. Sampling
 * across homepage, services, blog and team gives the LLM (and the reviewer) the
 * evidence needed to name a *dominant* pattern rather than average one page.
 */

import type {
  Category2VisualField,
  DraftBrandingAndStyle,
  ImageEvidence,
  LogoEntry,
  Snippet,
} from "@/types/knowledge";
import { collapseWhitespace, dedupe, dedupeBy, isNonEmpty, visibleText } from "@/lib/utils/text";
import { primaryPageType } from "@/lib/discovery/classify";
import { bundle, MAX_SYNTHESIS_SNIPPETS, spreadAcrossSources } from "./helpers";
import { allSnippets, declaredDescription, type TransformContext } from "./context";

/**
 * Where a brand keeps its voice when it has no prose.
 *
 * Writing Style used to read paragraphs and nothing else, on the assumption that
 * voice lives in sentences. That assumption holds for a service business with an
 * About page and breaks completely on a storefront. A real scan of a Shopify
 * shop found no narrative paragraphs at all, so the field fell back to whatever
 * short text survived — while the brand's actual voice was sitting in plain
 * sight in its section headers: "MEET THE", "PICNIC PALS", "TRAVERSE THE",
 * "WETLANDS", "DIVE INTO THE", "OCEAN".
 *
 * Note the split. Those are separate `h1` elements, because the theme breaks the
 * line for layout. "MEET THE" is eight characters, and that is why the paragraph
 * substance floor cannot be applied to headings — it would discard the strongest
 * voice signal on the page for being short, which is the specific failure this
 * tier exists to correct.
 *
 * Four tiers, interleaved rather than concatenated so no single kind of text can
 * fill the bundle:
 *
 *   1. **Prose paragraphs** — still first when they exist. Nothing about a site
 *      with real copy changes.
 *   2. **The declared description** — promoted from an Overview/Pitch fallback to
 *      a first-class voice source. It is usually the one full sentence the
 *      business deliberately wrote about itself. Included even when
 *      `looksTruncated` flags it: a cut-off sentence is useless as a *fact* and
 *      perfectly good as evidence of *tone*, which is a different question.
 *   3. **Headings** — see `voiceHeadings`.
 *   4. **Naming and microcopy** — only when the site has no prose at all. See
 *      `namingSnippets`.
 */
function writingStyleSnippets(context: TransformContext): Snippet[] {
  const everything = allSnippets(context);
  const substantial = everything.filter((snippet) => snippet.text.length >= 40);
  const prose = spreadAcrossSources(
    substantial.length > 0 ? substantial : everything,
    MAX_SYNTHESIS_SNIPPETS,
  );

  const declared = declaredDescription(context);
  const tiers: Snippet[][] = [
    prose,
    declared ? [declared.snippet] : [],
    voiceHeadings(context),
  ];

  // Naming convention is a real style signal on a product-driven site — "Sweet
  // Snail Slime Plush", "Radalotl Slime Plush" say something about voice. It is
  // last and conditional because on a site with actual copy it is noise
  // competing with sentences, and because a catalogue of twenty products named
  // to one formula tells you the formula once and then repeats itself.
  if (prose.length === 0) tiers.push(namingSnippets(context));

  return interleave(tiers, MAX_SYNTHESIS_SNIPPETS);
}

/**
 * Round-robin across tiers, so a site with forty headings and one paragraph does
 * not produce a bundle of forty headings.
 *
 * `spreadAcrossSources` already does this across *page types*; this does it
 * across *kinds of text*, which is a second axis that only became necessary once
 * Writing Style had more than one kind.
 */
function interleave(tiers: Snippet[][], limit: number): Snippet[] {
  const out: Snippet[] = [];
  for (let round = 0; out.length < limit; round += 1) {
    let added = false;
    for (const tier of tiers) {
      const snippet = tier[round];
      if (!snippet) continue;
      out.push(snippet);
      added = true;
      if (out.length >= limit) break;
    }
    if (!added) break;
  }
  return dedupeBy(out, (snippet) => snippet.text.trim().toLowerCase());
}

/** Homepage and collection/services pages — where a storefront does its talking. */
const VOICE_PAGE_TYPES = ["homepage", "services"] as const;

/** Enough to establish a pattern; more is the same pattern again. */
const MAX_VOICE_HEADINGS = 4;

/**
 * Section headers as voice evidence.
 *
 * Two rules, and the reasoning for each is the point:
 *
 * **No character floor, but two words minimum.** Short is the normal shape of a
 * heading and cannot disqualify one. But a single word is a label — "Shop",
 * "Ocean", "Forest" — and a label carries no voice. Two words is where a phrase
 * starts: "PICNIC PALS", "DIVE INTO THE", "Mushroom Mayhem". Chrome was already
 * removed upstream in `parsePage`, so this is filtering for signal, not safety.
 *
 * **Shallower headings first.** `h1` and `h2` are section headers a human wrote;
 * `h3` on a storefront is frequently product spec text — the same real scan had
 * `12" tall`, `11.5" long`, `14.5" wide` sitting in `h3`. Ranking by level
 * pushes those below the four taken, without needing a rule about what a
 * measurement looks like.
 */
function voiceHeadings(context: TransformContext): Snippet[] {
  const pages = context.pages.filter((page) =>
    VOICE_PAGE_TYPES.some((pageType) => page.pageTypes.includes(pageType)),
  );

  const candidates = pages.flatMap((page) => {
    const source = primaryPageType(page.pageTypes);
    return page.headings
      .filter((heading) => heading.level <= 3)
      .filter((heading) => visibleText(heading.text).split(/\s+/).filter(Boolean).length >= 2)
      .map((heading) => ({
        level: heading.level,
        snippet: { source, sourceUrl: page.url, text: visibleText(heading.text) },
      }));
  });

  candidates.sort((a, b) => a.level - b.level);
  return dedupeBy(
    candidates.map((candidate) => candidate.snippet),
    (snippet) => snippet.text.toLowerCase(),
  ).slice(0, MAX_VOICE_HEADINGS);
}

/** Two is a convention; six is a catalogue listing pretending to be evidence. */
const MAX_NAMING_SNIPPETS = 2;

/**
 * Product names and call-to-action microcopy, for a site with no prose at all.
 *
 * Both are already extracted and already chrome-filtered, so this adds no new
 * extraction risk. CTA labels are included alongside offering names because on
 * the scan that prompted this the most voice-bearing string on the whole page
 * was a button reading "Notify Me!" — the newsletter blurb next to it
 * ("Be the first to know about new drops…") sits in the footer, which
 * Readability strips, so the button is what survives.
 *
 * That is a real limitation worth stating rather than papering over: footer
 * marketing copy is not reachable from this pipeline's text streams, and
 * recovering it would mean re-admitting the footer, which is where the cookie
 * banners and link farms live.
 */
function namingSnippets(context: TransformContext): Snippet[] {
  const snippets: Snippet[] = [];

  for (const page of context.pages) {
    const source = primaryPageType(page.pageTypes);
    for (const offering of page.candidates.offerings) {
      if (isNonEmpty(offering.name)) {
        snippets.push({ source, sourceUrl: page.url, text: offering.name });
      }
    }
    for (const cta of page.ctas) {
      if (isNonEmpty(cta.label)) {
        snippets.push({ source, sourceUrl: page.url, text: cta.label });
      }
    }
  }

  return dedupeBy(snippets, (snippet) => snippet.text.toLowerCase()).slice(0, MAX_NAMING_SNIPPETS);
}

/**
 * How representative an image is of the brand's visual identity.
 *
 * `og:image` is the picture the company deliberately chose to represent itself
 * when its link is shared, which makes it the single best candidate. A favicon
 * is a 32-pixel square and tells a vision model almost nothing, so it goes last
 * — kept rather than dropped, because on a site with no other imagery it is the
 * only thing there is.
 */
const IMAGE_RANK: Record<string, number> = {
  "og:image": 0,
  "img[logo]": 1,
  "header img": 2,
  "link[apple-touch-icon]": 3,
  "link[rel=icon]": 4,
};

/** Enough to characterise a brand; more is just a longer scroll in the review UI. */
const MAX_ART_STYLE_IMAGES = 4;

/**
 * Every logo-ish image found, tagged with the page it came from.
 *
 * The single source both the Logos field and Art Style read. Art Style needs
 * exactly the candidate set Logos already detects — og:image, header and
 * class/alt/src-matched `img` tags, touch icons and favicons — so it reuses that
 * detection rather than re-implementing a parallel one that could drift.
 * `LogoEntry` has no page reference, so the page URL is carried alongside.
 */
function logoCandidates(context: TransformContext): { logo: LogoEntry; sourceUrl: string }[] {
  return dedupeBy(
    context.pages.flatMap((page) =>
      page.brand.logos.map((logo) => ({ logo, sourceUrl: page.url })),
    ),
    (candidate) => candidate.logo.url ?? "",
  );
}

/**
 * Art Style: the located images themselves, not a description of them.
 *
 * This field deliberately does NOT bundle text snippets the way every other
 * Category 2 field does. It used to — alt text and `og:image:alt`, reworded as
 * "Image described as: …" — and that was the wrong shape for the problem. Alt
 * text is a caption written for screen readers; it says "Company logo" far more
 * often than it says anything about composition or palette, and presenting it as
 * art-style evidence implied the pipeline had looked at pictures it never
 * opened.
 *
 * The honest split is: locating the image is deterministic and this scraper does
 * it well; describing the image is a vision task and this scraper cannot do it
 * at all. So the field carries the URLs, the review UI renders them, and the
 * description is written by someone — or something — that can see.
 *
 * Alt text still travels, as each image's own caption. That is what it is.
 */
function artStyleImages(context: TransformContext): ImageEvidence[] {
  const ogImageAlt = new Map<string, string>();
  for (const page of context.pages) {
    const alt = page.structuredData.openGraph["og:image:alt"];
    const url = page.structuredData.openGraph["og:image"];
    if (isNonEmpty(alt) && isNonEmpty(url)) ogImageAlt.set(url, collapseWhitespace(alt));
  }

  const candidates = logoCandidates(context)
    .filter((candidate): candidate is { logo: LogoEntry & { url: string }; sourceUrl: string } =>
      isNonEmpty(candidate.logo.url),
    )
    .map<ImageEvidence>(({ logo, sourceUrl }) => ({
      url: logo.url,
      // `og:image:alt` describes the social preview specifically and is usually
      // richer than a logo's alt, so it wins where both exist for one URL.
      alt: ogImageAlt.get(logo.url) ?? (isNonEmpty(logo.alt) ? logo.alt : null),
      detectedVia: logo.detectedVia,
      sourceUrl,
    }));

  candidates.sort(
    (a, b) =>
      (IMAGE_RANK[a.detectedVia ?? ""] ?? 99) - (IMAGE_RANK[b.detectedVia ?? ""] ?? 99),
  );
  return candidates.slice(0, MAX_ART_STYLE_IMAGES);
}

/**
 * Same honesty rule as every other field, with "no image found" standing in for
 * "no text found". A site with no detectable imagery has no art style evidence,
 * and saying so beats describing a colour palette from CSS variables.
 */
function artStyleBundle(images: ImageEvidence[]): Category2VisualField {
  return images.length > 0 ? { status: "found", images } : { status: "absent" };
}

export function transformBranding(context: TransformContext): DraftBrandingAndStyle {
  const candidates = logoCandidates(context);

  return {
    writingStyle: bundle(writingStyleSnippets(context), MAX_SYNTHESIS_SNIPPETS),
    artStyle: artStyleBundle(artStyleImages(context)),
    fonts: dedupe(context.pages.flatMap((page) => page.brand.fonts)).slice(0, 6),
    brandColors: dedupe(context.pages.flatMap((page) => page.brand.colors)).slice(0, 8),
    logos: candidates.map((candidate) => candidate.logo).slice(0, 6),
  };
}
