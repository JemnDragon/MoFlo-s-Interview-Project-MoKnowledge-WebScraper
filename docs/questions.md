# Required Questions

---

## 1. What approach did you take to scraping and structuring the knowledge base data?

**Scraping: a bounded, classification-first crawl in three tiers.**

The homepage is fetched, then its nav and footer links are classified against a
static keyword file into eight page types (about, services, team, contact,
testimonials, pricing, faq, blog). Link text is the primary signal because the
site owner wrote it to tell a human what a page is for — "Meet the team"
classifies correctly even when the URL is `/p/8821`. If not one nav link
*classifies* (not merely: if none are found — themes reliably emit cart and
policy links), discovery widens to every in-site link.

`sitemap.xml` is tier 2, consulted only for the categories tier 1 produced
nothing for, because a sitemap has URLs and no anchor text and so classifies
strictly worse. Sitemap **indexes** are followed one level: Shopify,
Yoast/WordPress and Squarespace all serve an index whose entries are further
`.xml` files, and treating an index as a page list makes the whole tier silently
useless on a large share of real SMB sites.

Tier 3 probes a few conventional paths (`/about`, `/services`) for
required-field categories only. It exists for one narrow reason: this crawler
fetches HTML without executing JavaScript, so a site whose nav is rendered
client-side returns markup with no nav links in it, and the first two tiers
conclude the pages don't exist when they were simply never visible. Guessing
*where to look* carries no fabrication risk — a wrong guess 404s — but it is
capped at three guesses per category and guarded against soft-404s, so a site
that answers unknown paths with its homepage can't get that copy filed as About
content.

The crawl is capped at homepage + 8 pages, filled in category-priority order so
a site with thirty classifiable pages spends the budget on About before Blog.

**Parsing: two libraries, two jobs.** `cheerio` does all structural selection —
links, headings, meta, script sources, list items. `@mozilla/readability` over
`jsdom` extracts main-article text for narrative fields, because `$('body').text()`
pollutes every one of them with nav labels, cookie banners and "© 2024 All rights
reserved". JSON-LD and Open Graph are parsed directly and are the
highest-confidence source for deterministic fields.

**Structuring: three type families, split by how fields behave.**

- **Category 1** — deterministic facts. Plain nullable values. Found, or `null`.
- **Category 2** — narrative/synthesis. Snippet bundles, each snippet tagged with
  the page type and URL it came from.
- **Category 3** — structured lists whose sub-fields are each independently
  nullable; an empty array is a valid final state.

`KnowledgeBaseDraft` is deliberately **not** `Partial<KnowledgeBase>`. The two
diverge at the field-*shape* level — a narrative field is a snippet bundle in the
draft and a plain string in the final object — and `Partial<>` can only make keys
optional, not change their type.

**The pipeline is Discovery → Fetch → Parse → Transform → Draft → Validate →
Save, with a hard purity boundary at Transform.** Everything upstream does I/O;
`rawToDraft()` has no network, no timers and no clock reads, so identical input
always produces identical output and the entire extraction path is testable from
a saved HTML fixture. `npm run smoke` exercises it without a network.

---

## 2. What information beyond our current baseline did you choose to include, and why?

Every addition answers one question asked of the baseline: **can a
content-generation app actually act on this?** Where the answer was no, the gap
became a field.

| Addition | The gap it fills |
|---|---|
| **Languages** | Nothing in the baseline tells MoMail what language to write in. Sourced *only* from `<html lang>` and `hreflang` — see below. |
| **Content Themes** | Nothing tells MoBlogs what to write *about*. Offerings says what they sell, Writing Style says how they write; neither says what they keep talking about. Frequency-ranked from headings, offering names and list items, and a subject must appear in ≥2 distinct places — one mention is a sentence, not a theme. |
| **Demographic Detail** | Ideal Persona is prose, so nothing downstream can segment on it. Structured counterpart; the prose field stays prose. |
| **Testimonials / Social Proof** | The only first-party evidence of who the customers *actually* are, versus who the company *says* they are. Interesting enough that it became prompt 3. |
| **Legal & Compliance Language** | The constraint layer. Generated copy must not contradict a commitment the business has already published. Stored **verbatim** — a paraphrased disclaimer is not a disclaimer. |
| **Certifications / Awards** | Trust signals that go straight into copy. Split org-level vs. person-level: a CPA licence belongs to the accountant, not the firm. |
| **Values / Social Positioning** | A distinct voice input Writing Style misses — a company can write plainly and still lead with sustainability. |
| **Current Promotions** | Time-sensitive language is exactly what a social post should catch, and is invisible in every other field. Snapshot only. |

**Two baseline prompts were reframed rather than dropped,** because as written
they asked for something a company's own website structurally cannot provide:

- *Customer complaints / FAQ* → **FAQ & Common Objections.** No business
  publishes its complaints. It does publish the objections it has decided to
  pre-empt, which carries much of the same signal and is honestly sourced.
- *Competitor information* → **Differentiators / USPs.** A target's own site is
  not a source on its competitors. It is an excellent source on the claims it
  makes against them. Real competitor data needs an independent directory, which
  is written up in the enrichment ideas.

**One was kept but re-scoped:** *seasonal or time-sensitive messaging patterns*
became Current Promotions, a **snapshot**. A single scrape cannot observe a
pattern over time, so the field records what was on the site at scrape time and
nothing in the UI or docs claims seasonality.

**One was deliberately left as an enrichment idea rather than a field:** *media
mentions and press coverage*. Coverage of a business lives on other people's
websites by definition, so a scraper pointed at the target's own domain can only
find the subset it chose to link from an "As seen in" strip — which is curated,
partial, and indistinguishable from a logo wall. A Media Mentions field fed by a
news API is genuinely valuable and is written up in
[`knowledge-enrichment-ideas.md`](./knowledge-enrichment-ideas.md); a Media
Mentions field fed by this scraper would mostly be empty and occasionally wrong.

**And Suppliers/Partners changed extraction method entirely** — third-party
script and embed detection rather than prose reading. SMBs almost never write
"we use Stripe for payments", but their tracking pixels and booking widgets say
so unambiguously.

The one I'd defend hardest is **Languages**, because it is the clearest case of
the project's governing rule paying off. The obvious implementation is to scan
prose for language names, and it would demo well. It is also wrong often enough
to be dangerous: *French doors*, *Chinese market*, *Spanish tile*, *Greek
yoghurt*, *Dutch oven*. A false Languages value routes a MoMail campaign into
the wrong language. Declarations only.

---

## 3. How would your knowledge base design improve the outputs of MoSocial, MoMail, and MoBlogs specifically?

### MoSocial

- **Content Themes** answers "what should this post be about?" — ranked by what
  the business demonstrably talks about, not by what a model guesses a landscaper
  posts about.
- **Current Promotions** is the single most postable thing on any SMB site, and
  it is the one field that decays fastest. Capturing it at scrape time with an
  explicit snapshot caveat lets MoSocial use it *and* know not to trust it in
  three months.
- **Writing Style bundles snippets from several page types on purpose**, and the
  prompt instructs the model to name the *dominant* pattern rather than average
  sources that disagree. That matters most in short form: an averaged voice
  produces captions that sound like nobody.
- **Social Media Links tell MoSocial which platforms actually exist.** Generating
  TikTok content for a business with no TikTok is wasted output, and no baseline
  field prevents it.
- **Key People carry pronouns resolved only from their own bios** — so a "meet
  the team" post cannot misgender someone. Gender is `null` when the bio doesn't
  say, which is the correct input for a generator that would otherwise guess from
  a first name.
- **Brand colours, fonts and logos** feed image generation directly, and are
  parsed straight from CSS and markup.
- **Art Style** is the one field this scraper structurally cannot produce.
  Describing composition, colour and typography means looking at a picture, and
  nothing in a `cheerio`/Readability pipeline opens one. So extraction stops at
  what it can do honestly — locating the candidate images — and the field carries
  those images as evidence for a vision model
  (`prompts/04-art-style-vision.md`) or a reviewer to describe. `null` when no
  image was found at all. An earlier version bundled alt text instead, which
  produced descriptions of captions dressed up as descriptions of brands.

### MoMail

- **Languages** decides what language to send in. This is the field with the most
  direct, least recoverable failure mode in the whole schema, which is why it is
  declaration-only.
- **Demographic Detail is structured** precisely so MoMail can segment on it.
  Prose personas can be read by a model but not filtered by a list tool.
- **FAQ & Common Objections is a nurture sequence in raw form.** Each objection
  the business already answers is an email; the ordering is the funnel.
- **Channels, Funnels and CTAs are three separate fields**, because MoMail uses
  them at three different moments. **Channels** ("Phone", "Online booking") decide
  whether an email should drive to a form or a phone number at all. **Funnels**
  ("Newsletter signup", "Free inspection or assessment") name the mechanism a
  sequence should feed. **CTAs** supply the business's own conversion language —
  "Request a free design consult", not a generic "Learn more" — including phone
  numbers and emails printed as plain text, which on a one-page site is
  frequently the *only* conversion path there is.
- **Pricing is stored as the literal string found** — `"from $850"`, hedges
  intact. An email that says "$850" when the site says "from $850" is a
  mispriced quote the business has to honour or retract.
- **Legal & Compliance is the guardrail.** A campaign promising next-day delivery
  when the terms say 3–5 business days is a liability, not an off-brand sentence.
- **The persona-fit insight** tells the operator when the people writing
  testimonials are not the people the business says it serves — which is a
  targeting problem MoMail is otherwise about to scale up.

### MoBlogs

- **Content Themes** is the topic backlog.
- **Founding Story** is the origin article, and it is `absent` rather than
  invented when the site never tells one.
- **Industry Outlook** supplies the thought-leadership angle where the site
  actually discusses its market.
- **Differentiators** grounds comparison pieces in claims the business itself
  makes, rather than in competitor claims it never made.
- **Key People bios and credentials** give articles a credible author and expert
  quotes — the E-E-A-T signals long-form ranking depends on.
- **Service Locations** carries the local-SEO angle in the business's own
  phrasing.
- **Testimonials** are case-study seeds with attribution already attached.

### What matters most is cross-cutting

Four properties of the design do more for output quality than any individual
field:

1. **Absence is machine-readable, and it is an instruction.** A Category 2 field
   is `{ status: "absent" }`, not an empty string. That distinction is the
   difference between a generator knowing *"this business has never stated a
   founding story — do not write one"* and a generator seeing a blank and filling
   it. Most knowledge bases cannot express the difference, and it is exactly
   where hallucination enters a content pipeline.
2. **Every snippet carries `source` and `sourceUrl`.** Generated copy can be
   traced back to the page it came from, so a claim in an email is checkable
   rather than merely plausible.
3. **The `reviewed` flag travels with the data.** Downstream apps can refuse to
   auto-publish from unreviewed fields, or degrade to a safer template. Quality
   gating belongs with the data, not in each app.
4. **`completeness_score` is a routing signal.** Below a threshold, a profile
   should go to a human rather than into an automated campaign. It's denormalised
   onto the row precisely so that decision is cheap.

The through-line: **this design's contribution is not that it extracts more, it
is that it is honest about what it doesn't have** — in a form the three apps can
act on programmatically.

---

## 4. What would you improve or change about MoKnowledge if you had more time?

**First, the things genuinely missing rather than merely unpolished:**

1. **A fixture-based test suite.** The transform layer is pure specifically so it
   can be tested from saved HTML, and that affordance is only partly used — the
   smoke suite covers the pure logic but there are no real-site fixtures.
   Snapshotting a dozen real SMB sites, including the ugly ones, is the
   highest-value next commit by a distance.
2. **Headless rendering for JS-built sites.** Path probing hedges against
   client-rendered navigation; it does not fix it. A Playwright-backed fetch
   behind a feature flag, used only when the static fetch comes back thin, would
   close the one blind spot where "not found" can be wrong rather than merely
   empty.
3. **Live LLM integration.** The three prompts are written and the placeholder
   boundary is clean. Out of scope per the brief, but it's a contained piece of
   work.
4. **Supabase with real RLS.** The repository interface exists so this is one new
   class; the policy design is written up in `docs/database-schema.md`.

**Then the known weak spots:**

5. **Category 3 extraction against page builders.** People, offerings and
   testimonials rely on markup-shape heuristics that Wix and Squarespace defeat.
   Layout clustering, or a vision pass, would beat adding more CSS selectors.
6. **Cross-page conflict surfacing.** Two pages stating different addresses
   currently resolves by page-type priority. It should surface as a conflict for
   the reviewer rather than silently picking one.
7. **Non-English signal lists.** The content-signal phrases are English-only,
   which is an awkward limitation in a system that treats Languages as a
   first-class field.
8. **Re-scan diffing.** Version history is already stored, so showing what changed
   between snapshots is nearly free — and "they added three services and dropped
   their pricing page" is a real business signal.

**And explicitly out of scope by decision, not omission:** multi-scrape seasonal
detection, and naming competitors from the target's own site.

---

## 5. What was the most challenging part of this assignment?

Deciding what **not** to extract, and then holding that line when it made the
output look worse.

Every honest decision in this system costs visible coverage. Resolving gender only
from pronouns in a person's own bio means it's `null` for anyone whose bio is
written in the third person without them. Refusing to detect language from prose
means a bilingual site that never sets `hreflang` shows no languages at all. In
each case there's an implementation that fills the field, demos better, and is
wrong often enough to damage the customer it's supposed to serve — and the
wrongness is invisible, because a fabricated value looks exactly like a found one.

The harder lesson was that this principle has a failure mode of its own.
Industry was originally schema.org-only, which felt rigorous and meant the field
returned `null` on essentially every Shopify and Wix site. But refusing to guess
is not the same as refusing to look: rolling up the categories the business
already assigned to its own offerings is a *stated fact*, not an inference, and I
had skipped it. The fix was to exhaust the honest sources properly — schema.org,
then the offering-category rollup, then declared metadata — while keeping `null`
as the answer when all of them are silent. Being unhelpful is not the same as
being careful, and it took a real site returning an empty profile to see the
difference.

That tension got concrete during the build. Scanning a real Las Vegas bakery
returned mostly "not found", and my first instinct was that the scraper was
broken. Investigating showed it was **both**: the site genuinely is a one-page
Shopify placeholder with no About page and no structured data, *and* I had three
real bugs — sitemap indexes weren't followed, extracted phone numbers and emails
were being thrown away unread, and the nav fallback only triggered on zero links
found rather than zero links classified.

The useful lesson was that the fix had to be split cleanly in two, because
conflating them would have been the wrong move in both directions. The bugs
needed fixing. The genuine emptiness needed *communicating* — so a scan that
reads only the homepage now says so explicitly, in the UI, rather than leaving a
near-empty form to read as a broken tool. Being right about the data isn't
enough if the interface lets someone conclude the opposite.

The runner-up was a narrower design problem: deciding where review state lives.
Putting the reviewer's edits and the `reviewed` flag inside `KnowledgeBaseDraft`
would have been the obvious move, and it would have destroyed the property that
makes the transform layer testable — the same scrape would produce different
drafts depending on what someone had typed. Keeping them in a parallel
`ReviewState` that `draftToFinal()` consumes alongside the draft preserved
purity, and it's why the extraction pipeline can be exercised from a fixture with
no browser and no network at all.
