# Data Quality Thinking

The governing rule for this system is one sentence: **never fabricate data.** If
a field cannot be found or confidently determined, it is absent — not filled with
a plausible default.

That rule is easy to state and easy to violate accidentally, because almost every
convenience in a scraping pipeline is a small invitation to guess. This document
records where those invitations were declined and why.

---

## 1. Why absence is the safe answer here

MoKnowledge output feeds MoSocial, MoMail and MoBlogs. A wrong value does not
sit inertly in a database — it becomes an email that tells a customer something
untrue about the business, published under that business's name.

The asymmetry matters:

- An **absent** field is visible. The review UI flags it, the completeness score
  drops, a human is prompted to fill it.
- A **fabricated** field is invisible. It looks exactly like a found one. Nobody
  reviews it because nothing signals that it needs review.

So the cost of a false negative is a gap someone can see and close. The cost of a
false positive is a confident lie nobody catches. Every ambiguous decision in
this codebase resolves toward the first.

---

## 2. The three field categories and their fallback rules

### Category 1 — deterministic structural fields

Plain nullable values. **Found, or `null`.** No partial state, no inference.

Concretely, this is why:

- **Industry** resolves through a three-tier chain, and never from page copy.
  Guessing "Plumber" from the word "pipes" is right often enough to feel fine and
  wrong often enough to mis-target every downstream campaign. But an earlier
  version accepted *only* schema.org markup, which meant it returned `null` on
  essentially every Shopify, Wix and Squarespace site — being unhelpful is not the
  same as being careful. The chain now runs:

  1. **schema.org** — `industry`, `knowsAbout`, `additionalType`, or a specific
     `@type` subtype.
  2. **The offerings' own categories**, rolled up. Written by the business about
     its own catalogue, so still a stated fact rather than an inference. Guarded
     twice: generic categories ("Service", "Product") are discarded because they
     tell a downstream app nothing, and the winner must recur unless it is the
     only category present, so one stray "Financial Service" among ten
     pest-control offerings cannot become the industry. Stored exactly as
     written — no pluralising, no title-casing.
  3. **Declared metadata** — a *short, curated* `meta[name=keywords]` list, or
     the first breadcrumb below the root. Weakest tier and ordered last: stuffed
     keyword lists are ignored entirely, and breadcrumbs on a store describe a
     product collection rather than an industry.

  Silent at all three tiers and it stays `null`. Better-exhausted fallbacks, same
  absent-not-fabricated rule.
- **Year founded** requires an explicit phrase — "founded in 1994", "since 1994",
  a JSON-LD `foundingDate`. A stray 1994 in a blog post is not a founding date,
  and the corpus is scoped to About and homepage copy so it cannot become one.
  Three rules make this field behave:

  1. **Scoped like Key People.** Only About and homepage text is read. A real
     scan returned 2011 for an accountancy whose About page says "since 2003",
     with the 2011 sitting on a services page and in platform-generated markup.
  2. **Ranked, not first-match.** Candidates are collected from every source and
     ranked once — explicit founding phrases above bare "since YYYY", About above
     homepage. Previously the explicit-phrase pattern was swept across the whole
     corpus before "since" was tried at all, so a weak match on a distant page
     beat a strong one on the About page.
  3. **Prose outranks `foundingDate`** — the opposite of how Industry resolves,
     and deliberately so. Hosted site platforms frequently auto-populate
     `foundingDate` with the *account* creation date, and it arrives as a bare
     value with no context. A full sentence on the About page is the business
     making a claim about itself. When the two disagree the reviewer is told
     which won and what was rejected, rather than the conflict being resolved
     silently.
- **Languages** comes only from `<html lang>` and `<link rel="alternate"
  hreflang>`. This is the one that most tempts a keyword approach, and it is the
  one where a keyword approach fails hardest: *French doors*, *Chinese market*,
  *Spanish tile*, *Greek yoghurt*, *Dutch oven*. None of those means the business
  serves customers in that language. A false Languages value would route a MoMail
  campaign into the wrong language.
- **Key People** is read only from pages classified `team` or `about`. The
  person heuristic — a heading that looks like a name, a short line, a paragraph —
  is *precisely* the shape of a product card, so on a merch store `h3` titles like
  "Techno Sword Earrings" pass a name test and "Regular price $30.00" becomes the
  bio. The fix is page-type scoping rather than a cleverer name test, because
  where a field is read from is a structural fact while whether a phrase sounds
  like a person is a guess. A second check rejects any candidate whose name
  matches an extracted offering or that sits inside a commerce block, for the
  small business whose About page also lists products. The trade-off is real: a
  founder introduced only on the homepage is now missed, which is the right
  direction to fail — an empty list is visible and one click to fix, a list of
  hoodies presented as staff is not.
- **Gender** on a Key Person is resolved only from pronouns present in that
  person's own bio, and only when they are unambiguous. Never from a first name,
  never from a photo. A bio containing both "he" and "they" resolves to `null`
  rather than picking the more frequent.
- **Addresses** need three independent signals (street number, street-type word,
  and a postcode or comma-separated city) before free-text matching accepts one.
  Structured sources — JSON-LD `PostalAddress`, an `<address>` element — are
  trusted outright, and text matching is skipped entirely when they exist.

#### The single-source blind spot, and the audit that closed it

Three Category 1 fields turned out to share one failure: they read from
schema.org markup and nothing else, so they returned `null` on any site without
an Organization node — which is most of Shopify, Wix and Squarespace. Being
unwilling to guess had quietly become being unwilling to *look*.

After the second instance, the remaining fields were audited rather than fixed
one at a time as each was noticed. Every Category 1 resolver, and where it reads
from today:

| Field | Sources | Was it single-source? |
|---|---|---|
| Company Name | JSON-LD → `og:site_name` → `<title>` | No |
| Website | resolved crawl URL | n/a — always known |
| **Industry** | JSON-LD → offering-category rollup → declared metadata | **Yes — fixed** |
| **Company Role** | JSON-LD → stated self-description → commerce platform | **Yes — fixed** |
| **Year Founded** | JSON-LD → founding-phrase patterns | No, but the patterns missed 4 of 6 real reference sentences — **widened** |
| **Legal Entity Type** | company name → alternative names → legal name in prose | Narrower variant: read only the *trading* name — **fixed** |
| Employee Count | JSON-LD `numberOfEmployees` → "team of N" patterns | No |
| Main Address | JSON-LD `PostalAddress` → `<address>` → bounded text match | No |
| Business Model | stated phrases | No — never used JSON-LD |
| Fonts / Brand Colors | CSS parsing | No |
| Languages | `lang` / `hreflang` | Single-source **by design** — see above |
| Demographic Detail | stated phrases | No |

Two things worth keeping from this. First, **the fix is always another honest
source, never a looser one**: an offering-category rollup and a self-description
are both things the business wrote about itself, so exhausting them costs nothing
in accuracy. Second, **Languages is single-source on purpose** and stays that
way — the audit's question is "are there more stated sources we are ignoring?",
not "can we be less strict?".

Year Founded also gained a specific exclusion. A `YYYY – present` pattern was
removed rather than guarded, because its legitimate use (a history timeline) is
rare while its common appearance is a copyright range in a footer. A copyright
marker within 25 characters before a year now disqualifies it — a short window on
purpose, so "Serving Texas since 1941 · © 2024" still yields 1941.

### Category 2 — narrative and synthesis fields

Snippet bundles. The scraper's job is to **collect candidate passages, not to
judge them.**

There is no word-count floor, no readability score, no "this looks like filler"
filter. The only gate is `isNonEmpty` — is there any text at all — because an
empty string genuinely carries no information and everything else is a judgment
call the scraper is not qualified to make.

This applies uniformly, including to Writing Style and Ideal Customer Persona,
the two fields where the temptation to pre-filter is strongest because they draw
from many sources. Quality judgment is deferred to the human reviewer, or in
production to the LLM, both of which can see context the regex cannot.

**Therefore `absent` means one specific thing: no candidate content was found.**
It never means "what we found looked short" or "what we found looked weak". That
consistency is what makes the review UI's empty states trustworthy.

Synthesis fields additionally spread their snippets across page types before
taking a second passage from any one page (`spreadAcrossSources`). A Writing Style
bundle drawn entirely from the About page would describe the About page's voice,
not the site's — which is a subtler form of the same error.

### Category 3 — structured lists

Arrays of objects with individually-nullable sub-fields. **An empty array is a
valid final state, not an error.**

A business with no named staff on its website genuinely has no Key People. A
business with no testimonials has none. Recording that honestly is more useful
than manufacturing an entry, and it is information in its own right — "this
company publishes no social proof" is a real finding about a company.

Sub-fields resolve independently. A team card with a job title and no name is
kept as `{ name: null, title: "Office Manager", … }` rather than dropped or
completed. Dropping it loses a real fact; completing it invents one.

#### The empty-entry blind spot, and the sweep that closed it

The rule above has a floor. An entry where *every* content sub-field is null
holds no fact to preserve, so keeping it is not honesty — it renders as a blank
card and inflates the completeness score with nothing.

This surfaced as blank chips in **Industry Groupings**, but that field was not
the cause. `industryGroupings()` already filters on `length > 2`; the scraper
cannot emit a blank one. The blanks came from the **write** path. Both "+ Add"
buttons in the review UI deliberately append an empty row — `""` for a string
list, an all-null `blankEntry()` for an object list — because a reviewer needs
somewhere to type. Nothing between that row and the JSONB column removed it
again if they never typed.

That makes it a property of every list field, not of one of them. The fix is
therefore one registry-driven sweep, `pruneEmptyEntries()`, applied at both
boundaries a list can cross:

| Boundary | Catches |
| --- | --- |
| End of `rawToDraft()` | Anything an extractor let slip. Pure, so transform purity holds. |
| Top of `draftToFinal()` | Rows the reviewer added and abandoned. |

It runs at save, never while editing — a row that vanishes the moment it loses
focus is unusable. `computeCompleteness()` uses the same predicate, so a draft
mid-review scores honestly before either prune has run.

**Why the field registry decides what "empty" means.** The obvious test — "every
sub-field is null" — never fires, because provenance is always populated:
`sourceUrl` is set on every entry the transform produces, and
`transformTestimonials` hardcodes `source: "Company website"`. An entry carrying
nothing but provenance would pass a naive check and still render blank. So
emptiness is judged against `spec.subFields`, which lists exactly the
content-bearing keys and deliberately omits `sourceUrl` — the same list the
editor renders inputs for. If a reviewer sees no fields to fill, there is nothing
worth keeping.

Two things this sweep is careful *not* to do:

- **`0` is not content, but a real number is.** The only numeric sub-fields are
  `contentThemes.mentions` and `certifications.year`, and neither "seen zero
  times" nor "year zero" is a fact — they are what an untouched numeric input
  collapses to. A certification known only by its year is thin, but it is
  evidence the scan found, so it stays.
- **Pruning is not the required-field check.** `draftToFinal` previously used one
  filter for both, which silently deleted an offering that had a description and
  a price but no heading the parser could read as a name. Those are now kept;
  the "at least one Offering" bar still counts named offerings only, because a
  content app cannot write a post about an offering with no name.

`customSections` sits outside the field registry by design, so the sweep cannot
see it and the same rule is applied to it explicitly in `draftToFinal`.

##### "Empty" had to be redefined once

The first version of this rule tested `.trim().length > 0`, and blank rows kept
appearing anyway. The reason is a genuine JavaScript trap: **`String.trim()` and
the regex class `\s` share one definition of whitespace, and it excludes
zero-width characters.** A heading whose text is three zero-width spaces has
`.trim().length === 3`. It passed the length filter in `industryGroupings()`, it
passed the prune, and it rendered as a completely blank chip.

That is not a contrived input. Site builders emit `&zwnj;` and `&#8203;` as
layout spacers, and CMS editors leave soft hyphens behind after a paste. So the
condition is now "does this render as anything", not "is this longer than
nothing":

| Test | Means | Used for |
| --- | --- | --- |
| `hasVisibleText` | anything left after stripping zero-width and bidi controls | the shared prune, every field |
| `hasAlphanumeric` | contains a letter or a digit | headings and category names only |

The second is deliberately *not* the shared rule. `"———"` and `"•••"` are
visible — they render as a row of dashes a theme dropped into an `h2` — so they
are junk in a heading and junk as an industry grouping, but a brand colour of
`#fff` is punctuation-led and perfectly real. Whether punctuation carries meaning
depends on what the field holds, so that judgment stays where the field is
known.

Survivors are normalised too, not just filtered: `"Roofing<ZWSP>"` is stored as
`"Roofing"` so it dedupes against a clean copy of itself instead of sitting
beside it as a second, identical-looking chip.

`scripts/scrape-cli.ts` prints every Industry Groupings candidate with its raw
value `JSON.stringify`-ed and the reason it was dropped — `not visible`, `no
letters or digits`, `too short`, `too long`, `duplicate`. Stringifying is the
point: a zero-width character prints as `"\u200b"` rather than as an empty pair
of quotes, which is the difference between diagnosing this and staring at it.

Two structural guards in `scripts/smoke.ts` keep the rule from silently
decaying: every `objectList` spec must declare `subFields` (an empty list would
make its entries unjudgeable), and a constant assigned to a key that *is* a
content sub-field would make that list unprunable forever — `source` on
testimonials is the live example, safe only because the parser requires a real
quote first, which is now pinned by a test.

---

## 3. Required fields and the homepage fallback

Only three things are required to save: **Overview, Pitch, and at least one
Offering.** These are required because they appear in 100% of the reference
profiles.

Required fields get one extra chance: if no dedicated page was discovered for
them, they fall back to homepage content before being marked absent. Overview
falls back from About to the homepage's `og:description` and narrative; Pitch
falls back from the homepage to About.

**Optional fields get no such fallback.** Widening the net for a field nobody
requires is padding — it produces a Founding Story assembled from homepage
marketing copy for a company that never told one.

Everything else in the schema is legitimately allowed to be absent, and the
validator treats it that way. A validator that demands more than the data
supports does not improve data quality; it teaches reviewers to type something
plausible into the box that is blocking them.

---

## 4. Scan failure handling — three modes, three treatments

These are genuinely different situations and collapsing them would lose real
information.

### Malformed URL

Caught before any network call, by the same `validateUrl` on both client and
server (the client copy is for instant feedback; the server does not trust it).

**No draft is created.** The user gets a specific message — "that domain does not
look like a real domain name", not "scan failed".

### Unreachable or blocked site

DNS failure, connection refused, 403, expired certificate. Fails at the fetch
stage, on the homepage, before anything has been read.

**No draft is created, because no partial data exists.** The error distinguishes
causes where it can: a 403 says the site may be blocking automated visitors,
which is actionable in a way "failed to fetch" is not. The UI states explicitly
that there is nothing partial to keep, so the absence of a draft does not look
like a bug.

### Timeout mid-crawl

The homepage loaded, some pages were read, the global budget expired.

**Everything already fetched is kept.** The draft is created with
`scanStatus: "partial"`, the pages that never completed are recorded on
`scan.pagesFailed`, and the review UI shows a banner explaining what happened and
listing them.

Discarding a partial crawl would be the single most user-hostile choice available
here: the work is done, the data is real, and the only thing wrong with it is that
there is less of it than hoped.

**Retry re-attempts only the incomplete pages.** This is real, not relabelled: the
parsed pages from the first attempt are held in a server-side scan cache keyed by
scan id, so the retry fetches strictly the failed URLs and merges them in. A site
that timed out on one slow Team page does not pay for a second full crawl.

---

## 5. Completeness scoring

**The score treats every absent field identically, regardless of cause.**

Never found, page timed out, category had no candidate page — all count the same.
From the point of view of "how usable is this knowledge base", they *are* the
same: the field is empty either way.

The reason is tracked separately, in `scanStatus` and in the per-field breakdown,
so the UI can explain it without the number lying. Weighting a timeout-caused
absence differently would produce a score that is not comparable between two
profiles, which defeats the purpose of having one.

**Lists are counted by content, not by length.** A list holding nothing but an
abandoned "+ Add" row would otherwise score identically to a list of real
entries, which is the number telling a small lie about how usable the knowledge
base is. `isPopulated` uses the same emptiness predicate as the save-path sweep
(§2, Category 3), so a draft mid-review — where nothing has been pruned yet —
still scores honestly.

**One exception: user-hidden sections are excluded from the denominator rather
than counted as missing.** Hiding a section is a deliberate choice, and
penalising a user for a choice they made is scoring the user, not the data. The
breakdown reports hidden fields separately, and the Detailed view calls out
hidden *required* fields specifically — "Overview is hidden, not missing" reads
very differently from "Overview was never found", and a reviewer needs to be able
to tell which they are looking at.

---

## 6. The absent / hidden / unreviewed distinction in the UI

Four causes, four visual treatments, four different messages. There is no generic
"No data" state anywhere in this application.

| State | Colour | Says | Means |
|---|---|---|---|
| **Not found** | neutral grey | "The pages that were scanned didn't state this." | The scan completed and the site is silent on this. |
| **No source page** | neutral grey | "This site appears to have no page of the type this field is read from." | Different from above: there was nowhere to look. |
| **Scan didn't finish** | blue | "The page this would come from never loaded before the scan ran out of time." | Retry may fill it. Paired with the retry action. |
| **Hidden by you** | slate | "This section is hidden on this profile. The underlying data is still stored." | A human decision, reversible, excluded from the score. |
| **Awaiting review** | amber | "This still holds the mock placeholder." | There is text, but no human has looked at it. |

The last one is the subtle one. A Category 2 field pre-filled with a placeholder
*contains text*, so a naive "is it empty" check passes it. It is tracked
separately as `reviewed`, and an unreviewed field does not satisfy validation even
though it is non-empty. `draftToFinal()` checks the flag and also re-checks the
text for the mock prefix, so placeholder content cannot reach storage even if the
flag were somehow set.

The flip from unreviewed to reviewed happens at blur, the moment the content
differs from the placeholder it started with. There is no separate confirm
button: a reviewer who has rewritten the text has reviewed it by any reasonable
definition, and a second click to attest to that is a step people learn to click
without reading.

The full rule, because one row of it is easy to get wrong:

| started with | now contains | reviewed |
|---|---|---|
| mock placeholder | mock placeholder | no |
| mock placeholder | edited mock text | no |
| mock placeholder | real prose | yes |
| mock placeholder | **nothing** | **yes** |
| nothing (absent field) | nothing | no |
| nothing (absent field) | real prose | yes |

**Row four is the important one.** Clearing the placeholder and leaving the field
blank is a real review decision — *"I read the snippets and there is nothing
honest to say here"* — and it has to stay distinguishable from never having
opened the field. An earlier version of this required non-empty content to count
as reviewed, which silently demoted that judgment back to unreviewed and asked
the reviewer to make it a second time. The test is about *change*, not content.

Row five is why the test is "untouched" rather than "changed from mock": a field
that began empty and is still empty genuinely carries no evidence anyone looked
at it.

#### The badge is shown less often than the flag is computed

Row five had a rendering consequence. An absent field with an empty editor drew
*three* indicators saying the same thing at once — an "Unreviewed" badge, the
`MissingState` "Not found" badge under the textarea, and the empty-evidence hint
in the right-hand panel.

The badge is the one to drop, and not merely because three is too many: it is
the only one of the three that is **wrong** rather than redundant. "Unreviewed"
implies there is something here a reviewer has not got to yet. There is nothing
here at all, which is what `MissingState` says correctly.

`shouldShowReviewBadge` decides this, and it is display-only — the `reviewed`
flag is still computed identically for every field, and `draftToFinal` still
reads it. Critically, the guard keys on **status**, not on emptiness:

| status | editor | badge |
|---|---|---|
| `absent` | empty or untouched | hidden — `MissingState` covers it |
| `absent` | reviewer typed something | shown |
| `found` | anything, including deliberately blanked | **always shown** |

That last row is the whole reason for the shape. A blanked-out field and an
absent one look identical from the editor's side — value `""`, no content — and
the blanked-out one is precisely the review decision row four exists to protect.
Gating on emptiness would have swallowed it. Gating on status cannot, because a
placeholder only exists when the scan found something. `scripts/flows.ts`
asserts both directions, and mutation-testing the `status === "found"` early
return fails exactly those two checks.

**How this is kept from regressing.** The bug lived in an inline `onBlur`
handler, where no test could reach it, so extracting the predicate was not enough
on its own — the tests would then cover `isReviewed` while the component stayed
free to wrap a length guard back around it. The whole transition now lives in
`blurEditorState()`, the handler is a single delegating call, and
`scripts/flows.ts` asserts three things: the transition's behaviour including the
blank-out, that the handler still delegates, and that the component never
computes `reviewed` itself. Both guards were mutation-tested — re-inlining the
original expression fails three checks, and breaking `isReviewed` fails five
across the two suites.

Blanking a **required** field is a separate matter. It still counts as reviewed —
the reviewer did look — but the save stays blocked, with a message saying the
field is required and currently empty. Reviewed and satisfied are different
things, and the UI says which one is missing.

---

## 7. Mock output is deliberately unconvincing

No live LLM call is made anywhere in this build. Every Category 2 field is
pre-filled with:

> `[Mock placeholder — in production an LLM would synthesise Writing Style from
> the 6 source snippets below (found on: homepage, about, services). No AI has
> run on this text.]`

This is a product decision, not a shortcut. A convincing fake — "Warm,
approachable prose with short declarative sentences and frequent direct address"
— would be indistinguishable from real output. A reviewer would skim it, accept
it, and ship copy grounded in nothing at all. The placeholder is written to be
unmistakably a placeholder for exactly the same reason absent fields say why they
are absent: **the system's actual state should be legible to the person relying
on it.**

The same discipline applies to the persona-fit insight. Its one real branch is
the honest one: with no testimonials it returns `insufficient_data` with
`isMock: false`, because "there is nothing to compare" is a genuine finding
rather than a stand-in for one. Everything else it returns is labelled mock,
including the alignment value, which the UI states should not be read as a
finding.

---

## 8. What this system still cannot tell you

Stated plainly, because a knowledge base that overstates its own coverage is the
failure mode this whole document exists to prevent:

- **Anything requiring more than one scrape over time.** Current Promotions is a
  snapshot. It cannot establish that an offer is seasonal, recurring, or new.
- **Anything the company does not publish.** Complaints, churn, real pricing
  behind a quote, actual customer demographics beyond who wrote a testimonial.
- **Anything about competitors.** A company's own site is not a source on its
  competitors. Differentiators captures the claims it makes; it does not verify
  them.
- **Anything visual.** Nothing in this pipeline opens an image. This one is
  different enough from the rest to have its own section below.
- **Content behind JavaScript.** The crawler fetches HTML; it does not execute a
  page. A site that renders its entire body client-side will scan thin, and that
  will show up as a low completeness score rather than as an error.

  This is the one blind spot where "not found" can be *wrong* rather than merely
  empty — the page may exist and simply never have been visible. Two things
  mitigate it. Discovery falls back to every in-site link when no nav link
  classifies, then probes a few conventional paths for the required-field
  categories (see §2 of the README). And when a scan reads only the homepage, the
  review UI says so explicitly rather than leaving the reviewer to infer that a
  near-empty form means the tool is broken:

  > *Only the homepage could be read — no other page on this site was
  > discoverable. Most fields draw on dedicated About, Services, Team or Contact
  > pages, so a largely empty profile here is an accurate reflection of what this
  > site publishes, not a scan failure.*

  Neither mitigation makes the crawler see a JS-rendered page. Headless rendering
  is the real fix, and it is out of scope here; what is in scope is not silently
  reporting invisibility as absence.

---

## 9. Art Style — the one field this scraper cannot produce

Every other gap in this document is a coverage problem: the scraper looked in
too few places, or the site never published the fact. Industry was JSON-LD-only
and needed a fallback chain. Year Founded was reading the wrong year off a
copyright footer. Both were fixable by looking harder in the right places.

**Art Style is not that kind of gap.** Describing a brand's composition, colour
story and typographic character requires looking at a picture. `cheerio` selects
DOM nodes and Readability extracts prose; neither opens an image file, and no
amount of additional text extraction changes that. This is a structural
limitation of a text-only pipeline, not a missing source.

### What the scraper does, and where it stops

| Step | Who does it | Status |
|---|---|---|
| Locate candidate images | This scraper | Deterministic, reliable, done |
| Describe what they look like | Vision model or human | **Out of scope for this build** |

Extraction is deliberately scoped to the first row. It reuses the same detection
the Logos field already had — `og:image`, header images, class/alt/src-matched
`img` tags, touch icons and favicons — because Art Style needs exactly that
candidate set and a second parallel implementation would drift from it. Both
fields read one `logoCandidates()` call.

Candidates are ranked by how much they can support: `og:image` first (the
picture the company chose to represent itself when its link is shared), favicon
last (32 pixels, kept only because on a sparse site it may be the only image
there is). Four are carried.

### What changed, and why the old version was worse

Art Style used to be an ordinary Category 2 snippet field. Its evidence was alt
text and `og:image:alt`, reworded into snippets reading *"Image described as:
…"*.

That was wrong in a way worth naming, because it is subtler than an empty field.
Alt text is written for screen readers — it says "Company logo" far more often
than it describes a visual language. Presenting those strings as art-style
evidence produced *descriptions of captions*, framed as though the pipeline had
examined images it never opened. The field looked populated and was not. An
honestly empty field is recoverable; a confidently mislabelled one is the exact
failure this document exists to prevent.

So the field's evidence type changed. `Category2VisualField` carries
`ImageEvidence[]` — URL, the site's own alt text as a caption, how it was
detected, and the page it came from — and the review UI renders the actual
images beside the editor. Alt text still travels, labelled as what it is.

The saved value is still a plain string, exactly like every other Category 2
field. Only the *evidence* differs, which is why `draftToFinal` and completeness
scoring need no special case: both read `status`, never the evidence itself.

### The placeholder says something different on purpose

Every other Category 2 placeholder reads *"in production an LLM would synthesise
this from the N snippets below"*. For Art Style that sentence would be false
twice over: there are no snippets, and the call required is not a text
completion.

A reviewer reading the generic wording would reasonably conclude Art Style is
blocked on the same missing API key as the others. It is blocked on different
infrastructure — a multimodal request with images attached, a fetch-and-encode
step before the call, per-image token costs, and a fallback for assets that 404
between the scan and the synthesis. None of that is built. The placeholder says
so, and points at
[`prompts/04-art-style-vision.md`](../prompts/04-art-style-vision.md), which is
the design for it.

### Absence works exactly as it does everywhere else

No candidate image found → `{ status: "absent" }` → the field is `null`, and the
UI says *"No candidate image — no logo, header image or og:image was found on
the scanned pages. There is nothing to look at, so there is nothing to
describe."*

Same rule as every other field, with "no image found" in place of "no text
found". Nothing is inferred from CSS custom properties or the brand colour
palette: those are Category 1 facts about declared styles, not evidence of a
visual identity, and rolling them into a prose description would be inventing
the field from adjacent data.

---

## 10. Page chrome is not business content

A scan of a Shopify store returned "Skip to content", "Close", "Menu" and
"Cart 0" as calls to action, and pushed "Your cart is empty" into the Pitch
snippets.

### Why the fix is not in the CTA parser

The obvious place to filter is `extractCtas`, and it would have been wrong in
exactly the way the Industry Groupings fix was nearly wrong. **The noise is not a
property of CTAs. It is a property of page text.** The same strings reach Pitch
as snippets, and can reach headings, list items, offering names and FAQ
questions by the same route. Filtering one consumer leaves the rest, and the next
report is the same bug wearing a different field's name.

So the exclusion runs in `parsePage`, at the point where the three candidate
text streams — headings, list items, Readability paragraphs — are gathered, above
every extractor. `extractCtas` calls it too, because a CTA label can come off an
`aria-label` or `value` attribute rather than out of a text stream. One list, and
a field added later inherits it.

### Why a curated list rather than a heuristic

The tempting rule is "short generic-sounding labels are chrome". That is a
judgment about tone, and this codebase decides things structurally wherever it
can. On the same page that produced the noise, "Shop All", "Learn More" and
"Notify Me!" are short and generic-sounding and are all real calls to action.

`src/data/ui-noise.json` follows the `page-type-keywords.json` pattern: static,
hand-curated, editable without a redeploy, and auditable — you can read it and
see exactly what is being discarded. Two lists, with different risk profiles:

| List | Match | Why the split |
| --- | --- | --- |
| `exact` (~100) | whole normalised string | Complete labels, never sentence fragments. Safe. |
| `contains` (~17) | substring | Banner and empty-state sentences only. Capped small — a substring rule can eat real copy, and that failure is silent. |

Normalisation lowercases, strips punctuation and drops a trailing counter, so
"Cart 0", "Cart (0)" and "Cart · 2" all resolve to one entry rather than three.
A smoke check asserts every list entry is already in normalised form, so a lookup
can never silently miss because someone typed "Back to Top".

The cost, stated plainly: this list is finite and English-only. It will miss
chrome on a differently-worded theme. That failure shows up as noise in the
review UI, which a reviewer deletes in one click — the opposite error, silently
eating a real CTA, is invisible. Anything genuinely ambiguous is left off.

### A missing `href` is a secondary signal, not a verdict

Generic UI controls disproportionately lack real link targets, which makes
hreflessness tempting to reject on. It is the wrong sole test: a newsletter
submit button is a real conversion path and has no `href` at all, and
`deriveChannels` reads a `kind: "form"` CTA as the evidence for the "Online
(website forms)" channel.

So the two signals combine rather than either deciding alone:

1. **A chrome label rejects on its own.** This is the primary test.
2. **A missing `href` raises the bar the label has to clear.** A control that
   submits a form is kept regardless — submitting is a destination even without a
   URL. A bare `<button>` outside any form has neither a target nor a submit
   behaviour, so the only remaining evidence is its label, and a *single-word*
   label at that point is far more likely to be a theme control the list has not
   caught yet ("Toggle", "Options") than a business asking for anything. Two
   words is a deliberately low bar: it drops the stragglers without touching
   "Notify Me", "Get Started" or "Book Now".

A form is only excluded when the site *itself* named it something on the list
("search"). The unnamed-`Form` fallback survives, because deleting it would take
the "Online (website forms)" channel with it.

### Testing honesty

The chrome strings in `scripts/flows.ts` are verbatim from a real fetch of the
site that produced the report. What those checks prove is that the rule is
correct and is called on both candidate streams — **not** that a live crawl of
that URL is clean, because `parsePage` needs cheerio and the crawler needs the
network. Confirming end to end takes `npm run scrape -- https://slimestory.com`
with dependencies installed, and the CLI now prints the CTA labels it kept so
that check is one line of output rather than a click through the review UI.

---

## 11. Three bugs from one shape, and the shared paths that fix them

A scan of a Shopify store surfaced three symptoms that looked unrelated:
Overview ending `"…and ful..."`, a snippet reading in full `"Shop"`, an offering
priced `$40.00` when the page said `$28.00`, and an offering named
`"Country/region"` whose features were two hundred country names.

They are three problems, and each one is instructive about a different thing.

### 11.1 The truncation is not ours

The `"…and ful..."` was reported as a truncation bug, reasonably — it looks
exactly like one. It is not. **Nothing in this pipeline truncates snippet text,
and nothing ever did.** That string is slimestory.com's own meta description,
which its CMS cut at 155 characters mid-word, reproduced faithfully.

Which rules out the obvious fix. "Truncate on a word boundary" cannot apply
where we are not truncating, and restoring the missing characters would mean
inventing them.

What *can* be fixed is the ranking. Overview and Pitch both fall back to
`og:description`, and a self-truncated one was leading both fields — the first
thing a reviewer read and the passage most likely to be condensed into the final
value. `looksTruncated()` detects the shape (trailing ellipsis, or ~155
characters ending on a bare word with no terminal punctuation) and
`describedSnippets()` demotes it below real prose. It is still kept, because on
a thin site it may be the only self-description there is. Same shape as the Year
Founded ranking: collect everything, rank once, keep the loser visible.

### 11.2 One gathering point, or the fix only lands on one field

The report's diagnosis — *"the earlier fix was applied inside Pitch's own
extraction path rather than in the shared logic both fields consume"* — was the
right instinct about the wrong fix. There was no earlier fix. But the hazard it
describes was real and present:

| Field | How it reached page text | Status |
| --- | --- | --- |
| Overview, Pitch, Founding Story | `pageSnippets()` | shared |
| Writing Style, Values, Differentiators, Promotions, Persona, Target Buyers | `allSnippets()` — a fold over `pageSnippets` | shared |
| **Industry Outlook** | **mapped `page.paragraphs` itself** | **fixed** |

One field out of eleven had its own copy. It would have missed every rule added
to the shared one, silently, and been reported later as its own bug. It now goes
through `pageSnippets` like the rest, and a smoke check asserts that no transform
module reads `.paragraphs` directly — comments stripped first, so the comment
explaining the fix does not trip the guard on itself.

**The substance floor** lives in `pageSnippets`, once. Readability pulls `p`,
`li` and `blockquote` as paragraphs, so a themed nav rendered as a list handed
Overview a snippet reading `"Shop"`. The rule is two words and twelve visible
characters, and it is worth being precise that this does not contradict §8's
"the scraper does not judge quality": a Category 2 snippet is a *passage* an LLM
can condense, and one word is not one, whatever its quality. "Free shipping"
passes. "MEET THE PICNIC PALS" passes. Nothing above the floor is scored,
ranked or filtered for readability.

### 11.3 A confidently wrong number is worse than no number

A discounted product renders both prices, and `element.text()` concatenates them
into `"$40.00$28.00"`. The first regex match wins, so the *old* price was stored
as the current one.

This is the worst failure mode in the whole system — not because the number is
wrong, but because a wrong price is indistinguishable from a right one. An
absent price is visible in the review UI and prompts someone. `$40.00` prompts
nobody.

Fixed by reading price out of the *element* rather than a flat string, so the
markup that distinguishes the two numbers is still available:

1. An explicitly-marked sale price wins outright — the theme is stating a fact.
   (Shopify Dawn names these `price-item--sale` and `price-item--regular`, which
   will catch out anyone matching on the word "regular".)
2. Otherwise, remove the struck-through nodes from a **clone** and take what is
   left. A clone because `$` is shared with every other extractor on the page.
3. A lone struck price with no replacement is reported as the price and **not**
   as a discount — "was $40" with no "now" is not a sale.

**The discount then feeds Current Promotions.** Having identified the pair for
the pricing fix, discarding it would waste the most time-sensitive signal on the
site — and that field exists to be a scan-time snapshot. The snippet reads
`"Sweet Snail Slime Plush: was $40.00, now $28.00."` Both numbers and the name
are observed values reproduced verbatim; only the connective words are ours, and
they state what the markup meant. Nothing is claimed about why the price
dropped, how long it lasts, or whether it recurs — that would be the
fabrication, and a test asserts the text contains no such language.

### 11.4 Dropdown content is never an offering

`"Country/region"` with two hundred features is Shopify's localisation picker:
an `h2` followed by a disclosure `ul` of `li` links — structurally identical to
"service heading followed by feature list" unless you look at what the list is
*for*.

Excluded by **ancestry**, because ancestry is a structural fact: any candidate
inside `select`, `option`, `[role=listbox]`, `localization-form`, a
`*-selector` class, a disclosure, a `nav`, a `header` or a `footer` is labelling
a control. The content-shaped guard (`looksLikeOptionList`) is the second line,
not the rule: 25+ entries, or four-plus entries matching `"(XXX"` currency-code
shape at half the list or more. Checked against the *uncapped* feature list —
the twelve-item slice would otherwise hide the very signal being tested for.

Offering names now also run through the shared `ui-noise.json` list (§10), which
already contained `"country region"`. That is the systemic version of the ask:
the same list guards CTAs, headings, list items, paragraphs, offering names and
offering features, so the next field to be reported is one that was already
covered.

### 11.5 How this was verified, exactly

`npm run markup` is a third harness for the extractors that need a real DOM —
`smoke` and `flows` are deliberately dependency-free, which is what made them
blind to both markup bugs above. Its fixtures are hand-reduced from the real
Dawn markup.

**It has not been executed here**, because the npm registry is unreachable in
this environment and cheerio cannot be installed. What *was* done instead: the
selector strings were extracted from the source and evaluated against Chromium —
the reference CSS engine cheerio's `css-select` targets — on the same fixture
markup. That confirms `STRUCK_PRICE_SELECTOR` matches the `<s>` and not the sale
span, that `SALE_PRICE_SELECTOR` matches `$28.00` alone, that clone-and-remove
leaves `"Sweet Snail Slime Plush $28.00"` with the live document intact, and
that `SELECTOR_CONTEXT.closest()` is true for the picker's `h2` and `li` and
false for a real services `h2` and `li`.

That is evidence the selectors are right. It is not evidence the extractors run
correctly end to end. `npm run markup` is one command away for anyone with
dependencies installed, and `npm run scrape -- https://slimestory.com` is the
full confirmation.


---

## 12. Voice does not only live in sentences

Writing Style read paragraphs and nothing else, on the assumption that voice
lives in prose. That holds for a service business with an About page and breaks
completely on a storefront.

A scan of slimestory.com found **no narrative paragraphs at all** — it is a
Shopify shop with no About-page copy — so the field fell back to whatever short
text survived. Meanwhile the brand's actual voice was sitting in plain sight:

> MEET THE · PICNIC PALS · TRAVERSE THE · WETLANDS · DIVE INTO THE · OCEAN

Note the split. Those are separate `h1` elements, because the theme breaks the
line for layout. **"MEET THE" is eight characters**, which is precisely why the
paragraph substance floor (§11.2) cannot be applied to headings — it would
discard the strongest voice signal on the page for being short.

### Four tiers, interleaved

| Tier | Source | When |
| --- | --- | --- |
| 1 | Prose paragraphs | Always first when they exist. A site with real copy is unchanged. |
| 2 | The declared description | Promoted from an Overview/Pitch fallback to a first-class voice source. |
| 3 | `h1`–`h3` on homepage and collection pages | Always. |
| 4 | Product names and CTA microcopy | **Only when there is no prose at all.** |

They are interleaved round-robin rather than concatenated. `spreadAcrossSources`
already prevents one *page type* dominating a bundle; this prevents one *kind of
text* dominating it, which only became a risk once the field had more than one
kind. A site with forty headings and one paragraph would otherwise produce a
bundle of forty headings.

Two rules govern the heading tier, and the reasoning matters more than the
thresholds:

- **No character floor, but two words minimum.** Short is the normal shape of a
  heading. A single word is a *label* — "Shop", "Ocean", "Forest" — and a label
  carries no voice. Two words is where a phrase begins.
- **Shallower headings first.** `h1`/`h2` are section headers a human wrote;
  `h3` on a storefront is frequently spec text — the same scan had `12" tall`,
  `11.5" long`, `14.5" wide` in `h3`. Ranking by level pushes those out without
  needing a rule about what a measurement looks like.

The truncated declared description (§11.1) is included here even though Overview
and Pitch demote it. That is not an inconsistency: a sentence cut off mid-word is
useless as a *fact* and perfectly good as evidence of *tone*. Different fields,
different question.

Naming is fourth and conditional because a catalogue of twenty products built to
one formula tells you the formula once and then repeats itself. Two entries, and
only when prose is absent.

### What this still cannot reach

The newsletter blurb — *"Be the first to know about new drops, restocked items,
and special deals!"* — is genuinely voice-bearing and is **not** captured. It
sits in the footer, which Readability strips, and re-admitting the footer is
where the cookie banners and link farms live. What survives from that corner of
the page is the button next to it, "Notify Me!", which the naming tier does pick
up. Stated here rather than papered over.

### The prompt had to move with it

`prompts/01-writing-style.md` returned `null` on "fewer than roughly two or three
sentences of connected writing" — which would have thrown away everything above.
The rule is now about whether *phrasing choices* are visible, not sentence count:
bare labels and boilerplate still return `null`; a storefront's imperatives do
not.

The same prompt was tightened separately: a hard 60–90 word, four-sentence cap;
2–3 dimensions rather than all four, so an axis with weak evidence is left
unaddressed instead of half-invented; and an anchoring rule requiring every claim
to point at a specific word, phrase or construction, with generic descriptors
("professional", "friendly") permitted only when immediately backed by an
example. Both worked examples were rewritten to meet that bar, and
`scripts/smoke.ts` measures them — a few-shot example that breaks the constraint
it illustrates teaches that the constraint is optional.


---

## 13. Overview and Pitch draw from one pool

These two fields used to build separate pools, and each had a blind spot the
other did not:

| Field | Old behaviour | Blind spot |
| --- | --- | --- |
| Overview | `if (fromAbout.length > 0) return fromAbout;` | On **any** site with an About page it never saw the homepage or the declared description. A two-line About page starved a required field while a rich homepage sat unread. |
| Pitch | homepage first, About only when the homepage yielded literally nothing | The mirror image. |

The split also contradicted the prompt these fields feed.
[`prompts/02-overview-pitch.md`](../prompts/02-overview-pitch.md) takes a
**single** `snippets` array and writes both fields from it, *"specifically so
they can be written to be different from each other"*. Two divergent bundles
cannot be passed to a prompt that accepts one.

### Shared pool, per-field ordering

`positioningPool()` gathers every candidate once, tagged by **kind** — which is
not the same as page type, because a homepage `h1` and a homepage paragraph are
the same page and very different evidence:

`about` · `hero` · `homepage-prose` · `declared`

Each field then orders that pool by a priority list:

```
OVERVIEW_PRIORITY = about → declared → homepage-prose → hero
PITCH_PRIORITY    = hero  → declared → homepage-prose → about
```

Third-person and factual leads with About prose and ranks the hero slogan last.
Second-person and persuasive inverts it. The two orderings are **data, not
branches**, so the difference between the fields is one line and cannot drift
back into two divergent implementations.

Both fields now take the same number of snippets (`MAX_POSITIONING_SNIPPETS`).
They previously took two and three, which was harmless with separate pools and
is not with one: a smaller cap means one field systematically sees less of the
same evidence, and the field seeing less would have been the required, factual
one.

### The §8 fallbacks became structural

There is no longer an "if no About page, try the homepage" branch, or its
opposite. Homepage passages are always in the pool; they simply rank below About
prose for Overview and surface on their own when there is little or none. Same
for About prose in Pitch. A fallback expressed as ranking cannot fail to fire the
way a branch guarded on total emptiness could.

The truncated-description rule (§11.1) still applies and is now the one
exception to the priority lists: a declared description the site cut mid-word
goes last for both fields regardless of kind priority. It is still kept — on a
thin site it is the only self-description there is, and a test asserts it
survives there — but where real prose exists it is ranked below all of it.

---

## 14. Logos are shown, not spelled out

The Logos field rendered as three labelled strings, one of which was a bare URL.
For an image that is close to useless: a reviewer checking a written Art Style
description against the brand's actual imagery cannot do it from a URL.

Both surfaces now render the image itself, from one component:

| Surface | What renders |
| --- | --- |
| `/knowledge` review UI | Thumbnail beside the labelled inputs — URL and alt text stay editable |
| `/knowledge/view` Detailed | Thumbnail, alt, provenance and a per-image save link |
| Art Style evidence panel | The same card, with the source page URL as well |
| Card grid | Unchanged — it already had this rule |

**One container rule, shared with the card grid.** Real logos in the reference
corpus run from a 32×32 favicon to a 2500×785 wordmark. Any rule other than
"contain inside a fixed box" makes one of those two look broken, so the box is a
fixed square and the image is `object-contain` with `max-h`/`max-w` matched to
it. Every logo in the list renders, not just the first — co-branded sites
legitimately have several.

**A broken URL is a finding, not a layout failure.** An unreachable image falls
back to a small "Could not load" placeholder *and* prints the URL as text,
because at that point the URL is the only thing left that is true. A
broken-image icon reads as "this app is broken" rather than "this site's asset is
gone".

### The save link, and what it honestly does

Each image gets a plain per-image link at its existing URL — no re-hosting, no
re-encoding, no new storage, no zip. It carries `download` with a filename hint
taken from the URL path.

Stated plainly because the alternative is a control that quietly does something
other than its label: **`download` is ignored cross-origin**, and every candidate
here is cross-origin by definition. On most hosts the link opens the image, from
where the browser's own save is one click away. The filename hint is set anyway
— it costs nothing and is correct the day someone points this at a
locally-served fixture.

**Nothing is added to the JSON export.** The export stays URLs and text. It
already carried `brandingAndStyle.logos` as `{ url, alt, detectedVia }`; this is
a rendering change on data that was always there, and a smoke check asserts the
exported example contains no `data:image` or base64 payload.

### Why the Detailed view can show these at all

Worth recording, because it is not obvious. `Category2VisualField` is a
draft-only shape — the saved `KnowledgeBase` stores Art Style as a plain resolved
string, so the image evidence is gone by the time the Detailed view renders.

The URLs survive because `logos` **is** persisted, and because Art Style and
Logos are both derived from one `logoCandidates()` call in the transform (§9).
Same set, different field. Had those two been extracted separately, the Detailed
view would have had nothing to show.
