# Database schema

The DDL lives in [`src/lib/db/schema.sql`](../src/lib/db/schema.sql). This
document is the reasoning behind it.

## What actually runs in this build

A local JSON-file store (`src/lib/db/jsonStore.ts`) sitting behind a repository
interface (`src/lib/db/types.ts`), so the app runs with no credentials. It
implements the Postgres semantics exactly — the same two-table split, the same
promoted columns, the same one-current-row invariant, the same 5-version cap with
a hard delete of the oldest, the same separate section-status collection.

Nothing above `repository()` knows which implementation it is talking to.
Swapping in Supabase is one new class against the same interface.

What the JSON store does *not* reproduce is real concurrency: writes are
serialised through an in-process promise chain, which is correct for one Next.js
server and obviously wrong for more than one.

---

## Three tables

```
companies                      identity — one row per business, forever
knowledge_bases                content snapshots — up to 5 per company
knowledge_base_section_status  operational UI state — which sections are hidden
```

### Why identity is split from content

A company is one thing that persists. Its knowledge base is a *series of
snapshots* of what we knew about it at particular moments. Putting both in one
table means either losing history on every re-scan, or duplicating identity
across every version and then having to decide which copy is authoritative.

`canonical_website` is unique (scheme + host, `www.` stripped). Re-scanning the
same site produces a new `knowledge_bases` row, never a second company.

### Why `data` is a JSONB document

Essentially every access pattern in this product loads or saves the whole object:
the review page saves it entire, the Detailed view reads it entire, JSON export
serialises it entire, and a MoFlo content app consumes it entire.

Normalising forty fields across a dozen child tables would add join cost and
migration burden to buy a flexibility that nothing in the product asks for. The
document-store approach also means a schema addition — a new extension field — is
a TypeScript change rather than a migration.

### Custom notes need no schema change

Reviewer-written notes (`customSections`) are just another key inside the `data`
JSONB document. No migration, no new table, and deliberately no promoted column:
they are not a filter, sort or search target, so promoting them would add a
synchronisation burden for nothing. Existing rows without the key read back as
absent and the UI renders nothing — which is the correct behaviour for a note
nobody wrote.

### Promoted columns, and only these

```
company_name, website, industry, site_language[], completeness_score,
logo_url, brand_color, status, is_current
```

The rule for promotion is narrow: **a column is promoted only where a filter,
sort or list render would otherwise have to deserialise every row.**

- `industry` and `site_language[]` back the two structured filters.
- `completeness_score` is computed and denormalised on every save so the card and
  table views can sort on it directly.
- `logo_url` and `brand_color` exist purely so the card grid can render a
  hundred cards without parsing a hundred JSONB documents.

Every promoted column is a duplicate that must be kept in sync on write, so the
list is kept as short as the query patterns allow.

---

## Key People search — the deliberate non-promotion

Text search covers company name, overview, **and Key People names**. The first
two read from promoted columns. The third does not.

Key People names stay nested in the `data` JSONB and are searched with a Postgres
JSONB path query backed by a GIN index:

```sql
SELECT id, company_name
FROM   knowledge_bases
WHERE  is_current
  AND  jsonb_path_exists(
         data,
         '$.keyPeople[*].name ? (@ like_regex "morgan" flag "i")'
       );
```

**Why not promote them?** Key People is a *list*, so promoting it means either a
`text[]` column or a join table. Either way it is a second copy of data the
snapshot already holds, and it has to be rebuilt on every edit that touches the
people list — including edits made in the review UI before a save. That is real
ongoing correctness surface, bought for a search target this product hits rarely,
at a scale (hundreds to low thousands of profiles) where a GIN-indexed path query
is comfortably fast.

If it ever does become a bottleneck, a lightweight `knowledge_base_people` join
table is the natural next step. That is **deferred as out of scope for this
project's scale**, not overlooked.

---

## Section status is a separate table

"The user hid the Key People block" is not scraped content. It is operational
state about how one record is displayed.

Keeping it inside `data` would mean:

- a hide action creates a new content version, which is wrong — nothing about the
  company changed;
- a re-scan silently resurrects sections someone deliberately hid, which is worse.

Separate table, separate lifecycle, keyed by `(knowledge_base_id, section_name)`.

It is **soft-only by design** — there is no hard delete at section granularity. A
section is a slice of a scraped snapshot rather than a user-authored object, so
"permanently destroy the Key People data but keep the record" has no honest
meaning; the next scan would just bring it back.

If the whole profile is soft-deleted, that status **supersedes** every
section-level hidden state. Those rows remain stored but are moot until the
profile is restored.

---

## Version retention: 5 snapshots, hard-deleted

A fixed cap of five `knowledge_bases` rows per company, counted **regardless of
the parent company's soft-deleted status** — retention is about storage, and a
soft-deleted company still occupies it. On the insert that pushes the count past
five, the oldest row is hard-deleted (an `AFTER INSERT` trigger in Postgres; the
same logic inline in the JSON store).

This is a **deliberate exception** to the soft-delete-first philosophy used
everywhere else, and it is worth being explicit about why:

> Soft delete exists so a user can undo their own mistake. Automatic retention
> pruning is a system policy operating on a schedule the user did not choose —
> there is no user mistake to undo. And a soft-deleted-but-never-purged history
> grows without bound, which is precisely what the cap exists to prevent.

Reversibility is a guarantee owed to user-initiated destructive actions. It is not
owed to a garbage collector.

---

## Indexes

| Index | Serves |
|---|---|
| `knowledge_bases_one_current` (unique, partial) | Enforces exactly one current snapshot per company |
| `knowledge_bases_company_idx` | Version history lookups, newest first |
| `knowledge_bases_industry_idx` (partial on `is_current`) | Industry filter |
| `knowledge_bases_language_idx` (GIN on `text[]`) | Languages filter |
| `knowledge_bases_status_idx` (partial) | "Show deleted" toggle |
| `knowledge_bases_data_gin` (`jsonb_path_ops`) | Key People name search, and any future JSONB predicate |

---

## Multi-tenancy and Row Level Security

Not implemented in code — the local JSON store has no concept of a caller — but
designed, because the shape of the answer constrains the schema above.

### The question that has to be settled first

**Is a company tenant-scoped or global?** Two MoFlo customers could plausibly
both want a knowledge base for the same supplier. There are two defensible
answers and they produce different schemas:

- **Tenant-scoped (recommended).** Each account owns its own companies and
  snapshots. A knowledge base is partly *editorial* — a human reviewed those
  narrative fields and made judgment calls — so two accounts scanning the same
  site should get their own copy rather than fight over one. Costs some duplicate
  crawling.
- **Globally shared with per-tenant overlays.** One canonical company row,
  per-tenant edits layered on top. Saves crawl cost and would let scans amortise
  across customers, but it means one customer's review work silently shapes
  another's output, and `canonical_website UNIQUE` becomes a cross-tenant
  coupling rather than a local invariant.

Everything below assumes **tenant-scoped**, which is why `companies` carries a
global-looking unique constraint today: under tenancy that constraint becomes
`UNIQUE (account_id, canonical_website)`.

### Schema changes

```sql
-- Supabase provides auth.users. Accounts group users into a tenant.
CREATE TABLE accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE account_members (
  account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'member'
                CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  PRIMARY KEY (account_id, user_id)
);

ALTER TABLE companies       ADD COLUMN account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE;
ALTER TABLE knowledge_bases ADD COLUMN account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE;

ALTER TABLE companies DROP CONSTRAINT companies_canonical_website_key;
ALTER TABLE companies ADD  CONSTRAINT companies_account_website_key
  UNIQUE (account_id, canonical_website);
```

`account_id` is **denormalised onto `knowledge_bases`** rather than reached
through `company_id`. That is deliberate: an RLS policy runs on every row of
every query, so a policy that has to join to `companies` to find the tenant turns
each list query into a join per row. Carrying the tenant key on the row keeps
every policy a single indexed equality check. It is the one denormalisation in
this schema justified by security rather than by read patterns.

### Policies

```sql
ALTER TABLE companies                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_bases               ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_base_section_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_members               ENABLE ROW LEVEL SECURITY;

-- Which accounts does the caller belong to? SECURITY DEFINER + STABLE so the
-- planner caches it per statement instead of re-running it per row.
CREATE OR REPLACE FUNCTION current_account_ids()
RETURNS SETOF UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT account_id FROM account_members WHERE user_id = auth.uid();
$$;

CREATE POLICY kb_select ON knowledge_bases
  FOR SELECT USING (account_id IN (SELECT current_account_ids()));

CREATE POLICY kb_insert ON knowledge_bases
  FOR INSERT WITH CHECK (account_id IN (SELECT current_account_ids()));

-- USING gates which rows you may target; WITH CHECK gates what you may leave
-- behind. Both are required, or a member could re-assign a row to another tenant.
CREATE POLICY kb_update ON knowledge_bases
  FOR UPDATE
  USING      (account_id IN (SELECT current_account_ids()))
  WITH CHECK (account_id IN (SELECT current_account_ids()));

-- Hard delete is owner/admin only. Soft delete is an UPDATE and stays open to
-- members, which mirrors the product's soft-delete-first stance: the reversible
-- action is broadly available, the irreversible one is not.
CREATE POLICY kb_delete ON knowledge_bases
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM account_members m
      WHERE m.user_id = auth.uid()
        AND m.account_id = knowledge_bases.account_id
        AND m.role IN ('owner', 'admin')
    )
  );

-- Section status inherits its parent's tenant rather than carrying its own,
-- because it is never queried independently of a knowledge base.
CREATE POLICY section_status_all ON knowledge_base_section_status
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM knowledge_bases kb
      WHERE kb.id = knowledge_base_section_status.knowledge_base_id
        AND kb.account_id IN (SELECT current_account_ids())
    )
  );
```

### Considerations worth stating

- **Index every policy predicate.** `CREATE INDEX ON knowledge_bases (account_id)`
  is not optional; without it RLS turns list queries into sequential scans.
- **The retention trigger runs as the table owner and bypasses RLS.** That's
  correct — pruning is a system policy, not a user action — but it means the
  `DELETE` inside `prune_knowledge_base_versions()` must be scoped by
  `company_id` and nothing else, or it could reach across tenants. The current
  function already is.
- **The service role bypasses RLS entirely.** The scan pipeline runs server-side
  under it, so the Route Handler must derive `account_id` from the session and
  set it explicitly — RLS is not protecting that path.
- **`viewer` needs a separate write restriction.** The policies above let any
  member update. A real deployment would add `role <> 'viewer'` to the update
  policy's `WITH CHECK`.
- **RLS does not cover the JSONB interior.** If a future field held something a
  `viewer` shouldn't see, hiding it means splitting the column, not writing a
  cleverer policy.

### Versioning under tenancy

Unchanged: the 5-snapshot cap is per `company_id`, and `company_id` is already
tenant-scoped once `companies.account_id` exists, so retention stays a
within-tenant concern. The `is_current` partial unique index likewise remains
correct — one current snapshot per company, and companies no longer collide
across tenants.

## Not implemented

The above is a design, not code. The local JSON store has no caller identity, so
none of it is enforced at runtime. Building it means adding a Supabase
implementation of `KnowledgeRepository` plus session plumbing in the Route
Handlers — a contained piece of work the interface was shaped to accommodate.
