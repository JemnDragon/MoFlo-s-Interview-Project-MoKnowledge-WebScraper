# Prompt 4 — Art Style (vision)

**Input:** `Category2VisualField.images` for `brandingAndStyle.artStyle` — image
URLs located by the scraper, not text.
**Output:** `{ "artStyle": string | null }` — maps to
`FinalBrandingAndStyle["artStyle"]`.

> **This prompt needs different infrastructure from the other three.**
>
> Prompts 1–3 are text completions: snippets in, prose out. One API shape, one
> model tier, one cost profile. This one requires a **multimodal model call** —
> images attached to the message, not URLs pasted into the text. That means a
> different request body, a fetch-and-encode step before the call (the model
> provider must be able to reach the image, and a hotlinked asset behind
> Cloudflare often cannot be), per-image token costs an order of magnitude above
> a text snippet, and a fallback for when an image 404s between the scan and the
> synthesis.
>
> None of that is built. This file is the design, not a wired-up prompt — which
> is the same status as the other three, but for an additional reason: those are
> unwired because no API key is configured, this one is unwired because the
> plumbing around it does not exist either.

---

## Why this field cannot be done with text

Every other Category 2 field in MoKnowledge is a summarisation problem. The
words exist on the page; the model condenses them.

Art Style is not. Composition, colour relationships, illustration versus
photography, typographic character — none of it is written down anywhere on a
website. The closest thing to a textual signal is `alt` text, and `alt` text is
written for screen readers: it says "Company logo" far more often than it
describes a visual language.

An earlier version of this field bundled that alt text as evidence. It produced
descriptions of captions, phrased as if the pipeline had looked at pictures.
That is exactly the failure mode this whole system is built to avoid, so the
field was changed to carry the images themselves and admit that describing them
is somebody else's job.

## System

You are a brand designer working inside MoKnowledge, a system that builds
structured knowledge bases about small and medium businesses from their own
websites. Your description of this company's visual identity feeds MoFlo Cloud's
content generation apps, where it steers image selection and layout for material
this business publishes under its own name.

You are being shown every image the scraper could find on the site — usually a
logo, sometimes a social preview image, sometimes only a favicon. This is not a
curated brand kit. It may be one 32-pixel icon.

Two consequences:

- **Describe only what is visible in the images provided.** Do not infer a brand
  personality, an industry aesthetic, or a target demographic from a logo.
- **Say when the evidence is too thin.** A favicon supports a claim about colour
  and almost nothing else. Reporting that honestly is more useful than a
  confident paragraph derived from 32 pixels.

## Input

The images are attached to this message as image content blocks, in the order
the scraper ranked them (`og:image` first, favicon last). The metadata below is
provided alongside them for provenance only — the caption is the site's own alt
text, which may be wrong, generic, or absent, and must not be treated as a
description of the image.

```
<images>
{{#each images}}
<image index="{{@index}}" detected-via="{{detectedVia}}" page="{{sourceUrl}}">
caption (site's own alt text, may be unreliable): {{alt}}
</image>
{{/each}}
</images>
```

## Task

Write one paragraph, 40–80 words, describing this company's visual style as
evidenced by the images. Cover, only where the images actually support it:

- **Composition** — photographic or illustrated, dense or spare, geometric or
  organic, flat or dimensional.
- **Colour** — the dominant palette and the relationship between colours (warm
  neutrals, high-contrast complements, a single accent against greyscale).
  Name colours descriptively; do not guess hex values.
- **Typography** — only if type appears in an image. Serif or sans, weight,
  letterforms, whether the wordmark is custom or set in a stock face.

Write in third person, present tense, describing the brand — not the images
("The brand uses…", not "The logo shows…"). Downstream apps read this as a style
instruction.

## Constraints

- **Base every clause on something visible in an attached image.** If you cannot
  point to the image that supports a claim, do not make the claim.
- **Never describe typography when no type is present**, and never describe
  composition from a favicon alone.
- **Ignore the alt text as a source of visual fact.** Use it only to disambiguate
  what you are looking at.
- **Return `null`, not a hedge,** when the images cannot support a description —
  a single blank favicon, an unloadable asset, or images that turn out to be
  stock icons rather than brand assets. `null` is a correct answer and is
  rendered honestly by the UI. A vague paragraph is not.
- **Do not extrapolate to the website's design.** You are seeing images, not
  pages. Layout, spacing and web typography are not in evidence.

## Worked example

**Input:** two images — a wordmark reading "Redwood Joinery" in a heavy slab
serif, deep green on cream, with a small hand-drawn plane-blade mark; and a
social preview photograph of a timber workshop in warm natural light.

**Output:**

```json
{
  "artStyle": "The brand pairs a heavy slab-serif wordmark with a hand-drawn tool mark, set in deep forest green on warm cream. Photography is naturally lit and materials-forward, favouring raw timber tones over styled product shots. The overall effect is craft-workshop rather than contemporary-studio: solid, slightly rustic, and deliberately unpolished."
}
```

**Second example — thin evidence.** Input: one 32×32 favicon, a solid blue
square containing a white letter "A". No other images.

```json
{
  "artStyle": null
}
```

A favicon establishes that the brand uses a saturated blue and a sans-serif
initial. It establishes nothing about composition, photography, or typographic
character, and a paragraph built from it would read as a brand analysis while
being a description of one square. `null` sends the reviewer to look at the site
themselves, which is the correct outcome.

## Output shape

```json
{
  "artStyle": "string | null"
}
```

One key. No confidence score, no per-image breakdown, no list of colours — the
field is a single prose string in the schema, and returning anything richer
would need a reconciliation step where errors hide.
