# MoKnowledge

Turns a small business's website into a structured knowledge base that MoFlo
Cloud's content apps (MoSocial, MoMail, MoBlogs) can generate from — **without
inventing anything the site never said.**

Scan a URL, get a draft you review field by field, save it, browse and compare
saved profiles three ways.

---

## The one rule

**Never fabricate data.** If a field cannot be found or confidently determined, it
is absent — never filled with a plausible-sounding default.

This is not a caveat at the bottom of the README; it is the constraint that
shapes the type system, the fallback rules, the validator, the mock output and
the empty states. The reasoning is worked through in
[`docs/data-quality.md`](docs/data-quality.md), but the short version is an
asymmetry:

> An absent field is **visible** — flagged in the UI, counted against
> completeness, prompted for. A fabricated field is **invisible** — it looks
> exactly like a found one, so nobody reviews it.

The output becomes email and social copy published under the business's own name.
A gap someone can see is recoverable. A confident lie nobody catches is not.

---

## Setup

Requires Node 20.9+. Works the same on macOS, Linux and Windows — there are no
shell commands in the npm scripts and no dependencies that need native
compilation, so Windows needs no build tools.

```bash
npm install
npm run dev
```

Then open **http://localhost:3000/knowledge**.

<details>
<summary><strong>Windows notes</strong></summary>

Run the commands above in PowerShell or Command Prompt from the project folder;
they are identical. Two small things:

- Piping the CLI's JSON with `>` in Windows PowerShell 5.1 writes UTF-16, which
  breaks the file. Use the built-in flag instead:
  `npm run scrape -- https://example.com --out scan.json`
- The local store lives in `.data\` inside the project. Deleting that folder
  resets all saved knowledge bases; it is gitignored and safe to remove.

</details>

No API keys, no database, no `.env` file. Persistence is a local JSON store under
`.data/` that implements the documented Postgres schema behind a repository
interface — see [Database](#database).

```bash
npm run build      # production build
npm run typecheck  # tsc --noEmit
npm run lint
npm run smoke      # dependency-free unit checks over the pure logic
npm run flows      # end-to-end checks over the review + persistence journeys
npm run markup     # cheerio-level checks — needs `npm install`, unlike the other two

# headless scrape, no UI — useful for testing extraction
npm run scrape -- https://some-small-business.com
npm run scrape -- https://some-small-business.com --out ./scan.json --raw
```

`npm run smoke` unit-tests the pure logic: URL validation and the malformed-URL
failure mode, page-type classification, sitemap-index detection, path-probe
derivation, the soft-404 guard, language declaration parsing, snippet bundling
and absent-vs-found semantics, the reviewed-state transition table, pricing
extraction, `draftToFinal()` — including that mock text cannot save even when the
reviewed flag is set — completeness with hidden sections, and field-registry
invariants.

`npm run flows` exercises whole journeys against the real persistence and
validation layers, using drafts modelled on the reference profiles — including
the sparse ones, because that is where the interesting behaviour lives. It covers
the review journey end to end, the one-page-site case, the technoblade.com
product-in-Key-People regression, the Industry fallback chain, save/list/filter,
search by a Key Person's name nested in the JSONB, soft delete and restore,
section hide and restore, the 5-version retention cap, and hard delete.

Neither touches the network or a browser, which is the payoff for keeping the
transform layer pure and the repository behind an interface.

That independence has a cost, and `npm run markup` is the answer to it: the two
worst extraction bugs found so far — a struck-through sale price read as the
current one, and a country/currency picker extracted as a product — are both
invisible without parsing real HTML, so neither suite could see them. It runs the
cheerio extractors against fixtures hand-reduced from real Shopify Dawn markup.
It is the one suite that needs dependencies installed.

> **No LLM calls are made anywhere in this build.** Every narrative field is
> pre-filled with a labelled placeholder. The real prompts are in
> [`/prompts`](prompts/).

---

## Pipeline

```
Discovery → Fetch → Parse → Transform → Draft (editable) → Validate → Save
└──────── server-side, I/O ─────────┘ └─── pure ───┘  └── client ──┘ └─ repo ─┘
```

There is a hard boundary at **Transform**. Everything before it does I/O;
`rawToDraft()` is pure and synchronous — no network, no timers, no clock reads —
so identical input always produces byte-identical output and the whole extraction
path is testable from a saved HTML fixture.

Discovery, fetch and parse are server-only (`src/lib/**` + Route Handlers).
Scraping from the browser would be blocked by CORS and would expose the crawl to
whatever the visitor's network can reach rather than ours.

---

## Scraping and extraction approach

### Discovery — bounded and classification-first, in three tiers

Homepage plus **up to 8** additional pages. Never an exhaustive crawl.

**Tier 1 — nav and footer links.** Link text is the strongest classification
signal available on any website, because the site owner wrote it to tell a human
what the page is for. "Meet the team" classifies as `team` even when the URL is
`/p/8821`. If not one nav link *classifies* (not merely: if none are found —
themes reliably emit cart and policy links), discovery widens to every in-site
link before concluding anything.

**Tier 2 — `sitemap.xml`, per missing category only.** Consulted for the
categories tier 1 produced nothing for, never as a bulk source, because a sitemap
has URLs and no anchor text and so classifies strictly worse. **Sitemap indexes
are followed one level deep**: Shopify, Yoast/WordPress and Squarespace all serve
an index at `/sitemap.xml` whose entries are further `.xml` files, so treating an
index as a page list makes this whole tier silently contribute nothing on a large
share of real SMB sites.

**Tier 3 — direct path probing.** Last resort, for required-field categories
only. This exists for one specific reason: **this crawler fetches HTML and does
not execute JavaScript**, so a site that renders its navigation client-side
returns markup containing no nav links at all. Tiers 1 and 2 then conclude the
pages do not exist when in fact they were never visible. Probing a few
conventional paths (`/about`, `/services`, `/products`…) hedges against that
blind spot. It is *not* a general "try harder" measure, and it is kept narrow:

- only for categories feeding **Overview, Pitch and Offerings**, mirroring how the
  transform layer also reserves its homepage fallback for required fields;
- at most **3 guesses per category**, first usable hit wins;
- **paths derived from the same keyword file** as classification, so there is no
  second list to drift out of sync;
- guarded against **soft-404s** — a site that answers unknown paths with HTTP 200
  and the homepage would otherwise get its marketing copy filed as About-page
  content, which is exactly the quiet fabrication this project exists to avoid.

Guessing *where to look* carries no fabrication risk — a wrong guess 404s and
contributes nothing. Guessing what a page *says* would be a different matter, and
nothing here does that.

Supporting rules:

- **Static keyword file**, not inline arrays and not an external word-bank API:
  [`src/data/page-type-keywords.json`](src/data/page-type-keywords.json). It is
  classification *data*, editable without touching code.
- **Multiple matches are allowed.** One link may match several categories; one
  page may serve as both About and Team. Neither is treated as a conflict.
- **No candidate means absent.** Optional categories are never chased.

Budget is filled in category-priority order, so a site with thirty classifiable
pages spends it on About before Blog.

### Parsing — two libraries, two jobs

| Concern | Tool | Why |
|---|---|---|
| Structural selection | `cheerio` | Links, headings, meta, script srcs, list items |
| Narrative text | `@mozilla/readability` + `jsdom` | `$('body').text()` pollutes every narrative field with nav labels, cookie banners and "© 2024 All rights reserved" |
| JSON-LD / Open Graph | `JSON.parse` | Already machine-readable; highest-confidence source for Category 1 |
| Colours & fonts | regex over inline styles, `<style>` blocks and fetched stylesheets | No design API involved |
| Social links | filter every `<a href>` against a static domain list | Zero false positives; a link to `supplier.com/instagram-tips` is not a profile |
| Languages | `<html lang>` + `<link rel="alternate" hreflang>` **only** | See below |
| Suppliers/partners | third-party script and embed detection | SMBs never write "we use Stripe"; their pixels say so unambiguously |

**On Languages.** This is the field most tempting to keyword-detect and the one
where keyword detection fails hardest: *French doors*, *Chinese market*, *Spanish
tile*, *Greek yoghurt*, *Dutch oven*. None of those means the business serves
customers in that language, and a false value would route a MoMail campaign into
the wrong language. Declarations only.

---

## Schema design

### Three type families, not one with optional keys

```ts
type Snippet = { source: PageType; sourceUrl: string; text: string };

type Category2Field =
  | { status: "found"; snippets: Snippet[] }
  | { status: "absent" };
```

- **Category 1** — deterministic structural facts. Plain nullable values, no
  wrapper. Found, or `null`.
- **Category 2** — narrative/synthesis. Always array-shaped snippet bundles.
  Extractive fields carry one snippet; synthesis fields carry several, drawn from
  different page types on purpose so one page's tone does not become the answer.
- **Category 3** — structured lists with individually-nullable sub-fields. An
  empty array is a **valid final state**, not an error.

`KnowledgeBaseDraft` is **not** `Partial<KnowledgeBase>`. The two diverge at the
field-*shape* level — a narrative field is a snippet bundle in the draft and a
plain string in the final object — and `Partial<>` can only make keys optional,
not change their type.

Only **Overview, Pitch and one Offering** are required (present in 100% of the
reference profiles). Everything else is legitimately allowed to be absent. A
validator that demands more than the data supports teaches reviewers to type
something plausible into whatever box is blocking them.

### Baseline categories

Company Foundation · Positioning · Market & Customers · Branding & Style · Online
Presence · Key People · Offerings.

One structural note: the brief lists *"Channels, funnels, CTAs"* as a single
bullet, and the reference profiles split it into three. It is stored as three
fields here, matching the reference, because they answer different questions and
want different shapes:

| Field | Shape | Why |
|---|---|---|
| **Channels** | `string[]` | A route to market is a category — "Phone", "Online booking". There is nothing to link to. Derived from evidence: a `tel:` link, a booking embed, a published address. |
| **Funnels** | `string[]` | A mechanism has no single destination — "newsletter signup" is a Mailchimp embed, a footer field and a form at once. It is an aggregate over the site, like `serviceLocations`. |
| **CTAs** | `CtaEntry[]` | A call to action *is* a destination, so it keeps `label`, `href`, `kind` and `sourceUrl`. |

Both derived lists are evidence-driven: a blog page that discovery actually found
yields "Content marketing (blog)"; the *word* "blog" in a sentence does not.

### Extensions, each tied to a specific gap

Every addition answers one question asked of the baseline: *can a content app
actually act on this?*

| Extension | The gap it fills |
|---|---|
| **Languages** | Nothing in the baseline tells MoMail what language to write in. |
| **Demographic Detail** | Ideal Persona is prose, so nothing downstream can filter or segment on it. Structured counterpart; the prose field stays prose. |
| **Values / Social Positioning** | A distinct voice input Writing Style misses — a company can write plainly and still lead with sustainability. |
| **Content Themes** | Nothing in the baseline tells MoBlogs what to write *about*. Offerings says what they sell, Writing Style says how they write; neither says what they keep talking about. Frequency-ranked, and a subject must appear in ≥2 distinct places — one mention is a sentence, not a theme. |
| **Legal & Compliance Language** | The constraint layer. Generated copy must not contradict a commitment the business already published. Stored **verbatim** — a paraphrased disclaimer is not a disclaimer. |
| **Testimonials / Social Proof** | The only first-party evidence of who the customers *actually* are, versus who the company *says* they are. Also the evidence base for prompt 3. |
| **FAQ / Common Objections** | **Reframed from "complaints."** No business publishes its complaints. It does publish the objections it pre-empts. |
| **Differentiators / USPs** | **Reframed from "competitor signals."** A target's own site is not a source on its competitors — it is an excellent source on the claims it makes against them. |
| **Certifications / Awards** | Trust signals that go straight into copy. Split org-level vs. person-level: a CPA licence belongs to the accountant, not the firm. |
| **Current Promotions** | Time-sensitive language is exactly what a social post should catch, and is invisible in every other field. **Snapshot only** — one scrape cannot observe a seasonal pattern, and nothing in the UI or docs claims it can. |

Suppliers/Partners stayed in the baseline but changed extraction method entirely
to script/embed detection, for the reason in the parsing table above.

---

## `/knowledge` — build and review

**Real staged progress, not a spinner.** The Route Handler streams NDJSON
progress events reporting actual stages: discovery → fetching *(n of m pages, by
URL)* → extracting → finalising, with failed pages surfaced as they happen. The
pipeline already knows all of this; hiding it behind a generic spinner would
discard information the person waiting actively wants.

**Review UI**, grouped by the schema's own categories (the same grouping the
Detailed view reuses):

- **Category 1** — the found value, or an explicit *"not found — add manually"*
  affordance rather than a blank input.
- **Category 2** — the labelled placeholder in the editor, source-tagged snippets
  beside it. Extractive fields show their snippet expanded; synthesis fields
  collapse, with a "found on: About, Homepage" provenance line.
- **Category 3** — every entry individually editable and removable, plus manual
  add for entries the scraper missed.
- **Live completeness**, consistent with the indicator on `/knowledge/view`.
- **Save names the exact blockers** — "Pitch still contains the mock placeholder"
  — never "please complete the form."

**Your notes.** Below every scraped category sits one block the scan had no part
in: freeform title + text notes the reviewer writes themselves. They live outside
the Category 1/2/3 taxonomy — that taxonomy describes *how a value was
extracted*, and nothing here is — which is also what keeps them out of
completeness scoring and required-field validation without either needing an
exception. No snippets, no placeholder, no reviewed flag: text authored from
scratch has nothing to be reviewed against. Stored as one more key in the JSONB
document, so no migration and no promoted column. Deliberately plain
title-and-text; structured custom fields would be a separate, much larger
feature.

**Field descriptions.** Fields a reviewer could plausibly confuse carry a one-line
muted description under the label — Overview vs Pitch, Ideal Persona vs
Demographic Detail, Differentiators vs Values, and think-bigger fields whose scope
isn't obvious (Current Promotions is a scan-time snapshot). Review UI only: on the
read-only Detailed view they would be clutter, since nobody browsing a saved
profile is deciding what belongs in a field. Fields whose label already says
everything deliberately have none.

**Reviewed vs. unreviewed.** A Category 2 field flips to *reviewed* at blur, the
moment its content differs from the placeholder it started with. No confirm
button: a reviewer who rewrote the text has reviewed it, and a second click to
attest to that is a step people learn to click without reading. **An unreviewed
field does not satisfy validation even though it contains text** — and
`draftToFinal()` re-checks for the mock prefix as well as the flag, so
placeholder content cannot reach storage.

### Three scan failure modes, three treatments

| Mode | Caught | Draft? |
|---|---|---|
| **Malformed URL** | Before any request, same validator client and server | No — nothing to keep |
| **Unreachable / blocked** | At fetch, on the homepage | No — no partial data exists |
| **Timeout mid-crawl** | Global budget expires | **Yes** — everything fetched is kept, `scanStatus: "partial"`, banner + retry |

The retry re-attempts **only the incomplete pages**. That is real, not relabelled:
successfully parsed pages are held in a server-side scan cache keyed by scan id,
so a site that timed out on one slow Team page does not pay for a second full
crawl.

---

## `/knowledge/view` — browse saved profiles

**Card** — fixed-height cards (required for virtualisation), logo or a
brand-coloured initial circle, name, industry, a languages badge capped at 3 with
`+N` overflow and kept visually secondary, completeness bar, last-updated,
dimmed + badged when soft-deleted. Logos shrink to fit and are never stretched;
the *absence* of a logo is noted explicitly in the Detailed view.

**Table** — dense comparison columns. **Removed as an option below the mobile
breakpoint**, not hidden with CSS: a ten-column comparison table has no honest
phone layout, since horizontal scrolling hides the columns that make it a
comparison and stacking it turns each row into a card, which is the card view. If
Table is active when the viewport shrinks, the selector switches to Card.

**Detailed** — the full knowledge base, read-only, **rendered by the same
components as the review UI** (driven off a field registry, so the two cannot
drift). Side-by-side on desktop, stacked on mobile — pure CSS, no JS.

**Filtering** — Industry and Languages as structured filters; text search across
company name, overview and Key People names.

**Two delete surfaces:**

- **Profile-level** — prominent, offers an explicit soft/hard choice at delete
  time, hard delete requires typing `DELETE`.
- **Section-level** — small and contextual inside each category block,
  **soft-only**, always paired with a visible restore.
- A soft-deleted profile **supersedes** all section-level hidden states.
- The completeness indicator distinguishes *hidden* required fields from
  *never-found* ones, because those read completely differently to a human.

**Responsive strategy.** `matchMedia` is used for exactly two things — card-grid
column count and table availability — because virtualisation must know the layout
shape *before* rendering, which CSS cannot tell it. Everything else is a plain CSS
breakpoint.

Plus: JSON export (the save format), raw-JSON inspector, last-updated and
completeness on every view.

---

## Prompts

Three prompts in [`/prompts`](prompts/), all on one shared six-part template:
role framing → labelled source-tagged input blocks → one narrow task → explicit
grounding constraint with `null` as the escape hatch → worked micro-example
*(always including a `null` case)* → strict JSON matching the TypeScript type.

1. [**Writing Style synthesis**](prompts/01-writing-style.md) — one cohesive
   paragraph, not a checklist; must name the *dominant* pattern rather than
   average sources that disagree.
2. [**Overview + Pitch**](prompts/02-overview-pitch.md) — both from the same
   material, explicitly forbidden from reusing phrasing, each independently
   returnable as `null`.
3. [**Testimonials vs. stated persona**](prompts/03-testimonials-persona.md) —
   comparative observations, not two summaries. Returns
   `alignment: "insufficient_data"` when there are no testimonials. **Not a schema
   field** — a standalone insight — and it has a genuine ordering dependency: it
   reads the *resolved* Ideal Persona, so it runs after that field is reviewed.

**Mock implementation.** All three are stubbed with an unmistakable placeholder,
never a confident fake. A convincing synthesis would be indistinguishable from
real output, so a reviewer would skim it, accept it, and ship copy grounded in
nothing.

---

## Database

Full DDL: [`src/lib/db/schema.sql`](src/lib/db/schema.sql). Reasoning, plus the
**bonus challenge** — multi-tenancy and Row Level Security policy design:
[`docs/database-schema.md`](docs/database-schema.md).

```
companies                      identity, unique canonical_website
knowledge_bases                data JSONB + promoted columns, is_current, status
knowledge_base_section_status  operational UI state, kept out of the versioned document
```

What runs here is a local JSON store implementing exactly these semantics behind
`KnowledgeRepository`. Swapping in Supabase is one new class.

---

## Assumptions and limitations

**Assumptions**

- Single scan, single point in time.
- HTML is fetched, not executed — a fully client-rendered site scans thin, which
  shows up as a low completeness score rather than an error.
- SMB-sized sites; the 8-page cap would be wrong for an enterprise site.
- One reviewer per draft; review state is client-side, not collaborative.
- Signal-phrase lists are English-only — a real limitation given that Languages
  is a schema field.

**Three limitations worth calling out explicitly**

1. **Current Promotions is a snapshot.** A single scrape cannot observe a pattern
   over time. The field captures promotional language present at scrape time and
   claims nothing about seasonality, in the UI copy or here.
2. **Version retention hard-deletes.** Five snapshots per company, counted
   regardless of soft-deleted status; the oldest is *hard*-deleted on overflow.
   This is a deliberate exception to soft-delete-first: soft delete exists so a
   user can undo their own mistake, and automatic pruning is a system policy with
   no user mistake to undo. Reversibility is owed to destructive user actions, not
   to a garbage collector.
3. **Key People names are not promoted to a column.** They are a supported search
   target but stay in the JSONB, searched via a GIN-backed `jsonb_path_exists`
   query. Promoting them means maintaining a redundant copy of list data on every
   edit — real correctness surface, for a search this product hits rarely at this
   scale. A lightweight join table is the natural next step and is deferred, not
   overlooked.

**What the system cannot tell you** — anything requiring multiple scrapes over
time, anything the company does not publish (complaints, churn, real pricing),
anything about competitors, and anything visual. That last one is a structural
limit rather than a coverage gap: Art Style is a vision task, so the scraper
locates the brand's candidate images (reusing the Logos detection) and carries
them as evidence, but describing them needs a vision-capable model or a human.
See §9 of `docs/data-quality.md`.

## If I had more time

Out of scope by decision, in rough priority order: a fixture-based test suite for
the transform layer *(the purity was built for this and is currently unused —
highest-value next commit)*; live LLM integration; Supabase with RLS and
multi-tenancy; better Category 3 extraction for page-builder sites;
cross-page conflict surfacing; non-English signal lists; re-scan diffing against
stored version history.

---

## Layout

```
src/
  app/                      routes + Route Handlers (streamed scan, CRUD, insight)
  components/
    fields/                 registry-driven renderers, shared by review + detail
    review/                 scan progress, review panel, save bar, persona insight
    view/                   card grid, table, detailed, filters, delete controls
    shared/                 completeness bar, honest empty states
  data/                     static keyword + signature JSON (classification data)
  hooks/                    matchMedia breakpoint detection
  lib/
    discovery/              link classification, page discovery
    fetch/                  single-page fetch, crawl orchestration, failure modes
    parse/                  one module per extraction concern
    transform/              pure raw → draft, one module per schema group
    validate/               draftToFinal, completeness
    db/                     repository interface, JSON store, schema.sql
    mock/                   labelled placeholder generation
    schema/                 the field registry
  types/                    knowledge, scrape, review
prompts/                    the three LLM prompts
docs/                       data quality, enrichment ideas, questions, DB schema
examples/                   a complete KnowledgeBase JSON
screenshots/                app screenshots
scripts/                    headless scrape CLI
```
