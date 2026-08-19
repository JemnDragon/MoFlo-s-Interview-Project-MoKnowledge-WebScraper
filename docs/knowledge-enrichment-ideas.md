# Knowledge Enrichment Ideas

A company's own website is a good first source and a limited one. It is
self-reported, static, and silent about anything the company would rather not
publish. These are the external sources worth adding, ordered roughly by
value-per-unit-of-integration-pain, each tied to a specific gap this build
actually leaves.

None of these are implemented. They are documented as direction, per scope.

---

## 1. Google Business Profile + domain WHOIS

**Fills:** Main Address, Other Locations, Industry, Year Founded, Employee Count,
Business Model, opening hours (not currently in schema, arguably should be).

These are the fields that come back `null` most often from a website scan, and
they are precisely the fields a business directory already holds in structured
form. Google Business Profile gives verified address, category, hours and a
review count. WHOIS gives a domain registration date, which is a weak but real
lower bound on "how long has this business existed online" for companies that
never state a founding year.

**Cost:** low. GBP has an official API; WHOIS is trivial. The main work is
reconciliation — deciding what happens when GBP says one address and the site
says another. That should surface as a conflict for a human, not be silently
resolved by preferring one source, since a stale GBP listing is as common as a
stale website footer.

**Caveat:** GBP category is a fixed taxonomy that often does not match how the
business describes itself. Store it alongside the site-derived Industry rather
than overwriting.

---

## 2. Review platforms (Google, Yelp, Trustpilot, industry-specific)

**Fills:** Testimonials with *independent* provenance, plus a genuine sentiment
signal, plus a much better basis for the actual-vs-stated-customer comparison.

This is the single highest-value addition, because it fixes a structural weakness
rather than a coverage gap. Testimonials scraped from a company's own site are
**curated by definition** — the company chose them. Prompt 3 already has to hedge
its confidence for that reason. Independent reviews are not curated, so they can
support conclusions the current data cannot: what actually goes wrong, which
offerings customers mention unprompted, whether the stated persona matches
reality.

It is also the only realistic route to the "complaints" signal that the baseline
brief asked for and that a company's own site structurally cannot provide. The
FAQ / Common Objections field is the honest website-only substitute; review
platforms are the real thing.

**Cost:** medium to high, and mostly legal rather than technical. Google Places
exposes a limited number of reviews via API. Yelp's API terms restrict storage
and display. Trustpilot requires a business relationship. Scraping any of them
violates their terms. Realistically this is per-platform API integration with
per-platform storage rules, and the schema needs a `source` and a
`sourceIsIndependent` flag so curated and independent proof are never mixed.

---

## 3. LinkedIn (company + people)

**Fills:** Key People — keeps them current — plus Employee Count as a verified
number rather than a phrase lifted from an About page, plus Company Role and
Industry from LinkedIn's taxonomy.

Website team pages go stale faster than almost anything else on a site. Someone
who left eighteen months ago is still smiling on the Our Team page of a great
many small businesses. Generating a MoMail campaign that names them is a
concrete, embarrassing failure this would prevent.

**Cost:** high. LinkedIn's official API does not expose this data to third
parties at this tier, and scraping it is both against their terms and actively
defended. The realistic version is a paid data provider (Clearbit-style,
People Data Labs, Apollo) rather than LinkedIn directly. Worth pricing before
committing — for a single-location SMB the marginal value over the website team
page may not justify the per-record cost.

---

## 4. News and press aggregation → a Media Mentions field

**Fills:** a new field the schema does not have. Third-party coverage: local
press, industry trade publications, award announcements, expansion news.

This is genuinely additive rather than gap-filling, and it is the best available
source of *timely* content hooks — MoSocial and MoBlogs both benefit far more
from "they were written up in the county business journal last month" than from
any static profile field. It also independently corroborates the Certifications
and Awards the site claims about itself.

**Cost:** low to medium. News APIs are cheap and well-documented. The hard part
is disambiguation: "Cascade Green" matches a lot of things, and a Media Mentions
field polluted with the wrong company's news is worse than an empty one. Needs a
confidence threshold and a human confirmation step, at minimum matching on
company name plus locality plus domain mention.

---

## 5. Partner social media APIs

**Fills:** post cadence, engagement rates, which content performs, and a much
better-grounded Writing Style — actual published voice at volume rather than six
snippets of website copy.

The Online Presence field currently records that a Facebook page exists. That is
a link, not knowledge. What the content apps actually need is how often this
business posts, what it posts about, and what its audience responds to.

**Cost: high, and it should be scoped as opt-in per connected account rather than
as blanket enrichment.** Each platform is a separate app-review and approval
process; Meta's in particular is slow and periodically revokes permissions.
Several are paid or aggressively rate-limited. Most importantly, reading a
business's own page analytics requires *that business* to grant access — it is
not something MoFlo can do on their behalf from a URL. So the correct product
shape is a connector the SMB opts into, not a step in the scan pipeline, and the
schema should represent it as such: a `connectedAccounts` structure with explicit
grant state, not more fields that silently stay null for everyone who has not
connected anything.

---

## 6. Industry and competitor content monitoring

**Fills:** Industry Outlook with something real, and sharpens Differentiators /
USPs by giving them something to be different *from*.

Right now Differentiators records the claims a company makes about itself, and
Industry Outlook is usually null because most SMB sites never discuss their
market. Monitoring trade publications and the public content of comparable
businesses in the same category and region would let both fields say something a
content app could actually use: not "we offer same-day service" in isolation, but
"same-day service, which two of the five comparable local firms also advertise."

**Deliberately not attempting to name competitors from the target's own site.**
The temptation is to look for comparison language and extract names from it. That
would be unreliable in the obvious way — companies rarely name competitors, and
when they do it is in marketing framing — and it would attribute a competitor
list to a source that never provided one. Competitor identification should come
from an independent categorised business directory (category + geography), never
from the target's own copy.

**Cost:** high, and the fuzziest of the six. "Comparable business" is a judgment
call and getting it wrong produces confidently wrong benchmarks. Worth prototyping
against one vertical before generalising.

---

## Sequencing

If this were built in order: **1 and 4 first** — cheap, low-risk, and they fill
the emptiest fields. **2 next**, because it is the highest-value source and the
only one that fixes a structural blind spot, with the legal work started early
since it is the long pole. **3, 5, 6 later**, each contingent on evidence that
the marginal content quality justifies a materially higher integration and
maintenance cost.

Whatever gets added, the same rule applies as to the scraper: every enriched
field carries its source, enrichment never silently overwrites a site-derived
value, and a conflict between two sources surfaces to a human rather than being
resolved by precedence order.
