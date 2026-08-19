-- =====================================================================
-- MoKnowledge — Postgres schema
--
-- This is the target schema. The build ships a local JSON-file store
-- (src/lib/db/jsonStore.ts) that implements exactly these semantics behind a
-- repository interface, so the app runs with no credentials while the shape,
-- the retention policy and the query patterns stay honest to this document.
--
-- Two tables for identity vs. content-snapshot, so versioning and identity stay
-- cleanly split: a company is one thing that persists, its knowledge base is a
-- series of snapshots of what we knew about it at a point in time.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()

-- ---------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------
CREATE TABLE companies (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT        NOT NULL,
  canonical_website  TEXT        NOT NULL UNIQUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN companies.canonical_website IS
  'Normalised origin (scheme + host, no trailing slash). Unique: re-scanning the
   same site produces a new knowledge_bases row, never a second company.';

-- ---------------------------------------------------------------------
-- Content snapshots
-- ---------------------------------------------------------------------
CREATE TABLE knowledge_bases (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID        NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  -- Full nested KnowledgeBase content. Document-store approach on purpose:
  -- essentially every access pattern in this product loads or saves the whole
  -- object at once (review page, detail view, JSON export, feeding a MoFlo
  -- content app), so normalising forty fields across a dozen child tables would
  -- add join cost and migration burden to buy a flexibility nothing asks for.
  data               JSONB       NOT NULL,

  -- Promoted columns: duplicated out of `data` ONLY where a list/filter/sort
  -- would otherwise have to deserialise every row.
  company_name       TEXT        NOT NULL,
  website            TEXT        NOT NULL,
  industry           TEXT,
  site_language      TEXT[]      NOT NULL DEFAULT '{}',   -- ties to the Languages filter
  completeness_score SMALLINT    NOT NULL DEFAULT 0,      -- computed + denormalised
  logo_url           TEXT,                                -- card view, no JSONB read
  brand_color        TEXT,                                -- card view initial-circle fallback

  status             TEXT        NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'soft_deleted')),
  is_current         BOOLEAN     NOT NULL DEFAULT TRUE,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN knowledge_bases.completeness_score IS
  'Recalculated on every save/edit. Denormalised so the card and table views can
   sort and render without deserialising the JSONB.';

COMMENT ON COLUMN knowledge_bases.is_current IS
  'Exactly one current row per company. Older rows are retained as history up to
   the retention cap (see below).';

-- Only one current snapshot per company.
CREATE UNIQUE INDEX knowledge_bases_one_current
  ON knowledge_bases (company_id)
  WHERE is_current;

CREATE INDEX knowledge_bases_company_idx   ON knowledge_bases (company_id, created_at DESC);
CREATE INDEX knowledge_bases_industry_idx  ON knowledge_bases (industry) WHERE is_current;
CREATE INDEX knowledge_bases_language_idx  ON knowledge_bases USING GIN (site_language);
CREATE INDEX knowledge_bases_status_idx    ON knowledge_bases (status) WHERE is_current;

-- Text search across company name, overview, and Key People names.
--
-- Key People names are deliberately NOT promoted to a column or a join table.
-- They stay nested in `data` and are searched with a JSONB path query backed by
-- this GIN index. Promoting them would mean maintaining a second copy of list
-- data the snapshot already holds, and keeping the two in sync on every edit —
-- real cost, for a search target this product hits rarely and at small scale.
-- If it ever becomes a bottleneck, a lightweight join table is the natural next
-- step; that is explicitly deferred, not overlooked.
CREATE INDEX knowledge_bases_data_gin ON knowledge_bases USING GIN (data jsonb_path_ops);

-- Example of the Key People search this index supports:
--   SELECT id, company_name
--   FROM   knowledge_bases
--   WHERE  is_current
--     AND  jsonb_path_exists(
--            data,
--            '$.keyPeople[*].name ? (@ like_regex "morgan" flag "i")'
--          );

-- ---------------------------------------------------------------------
-- Section visibility (operational UI state)
-- ---------------------------------------------------------------------
-- Kept out of `data` deliberately. "The user hid the Key People block" is not
-- scraped content: it is operational state about how this record is displayed.
-- Versioning it alongside scraped content would mean a re-scan silently
-- resurrecting sections someone hid, or a hide action creating a content
-- version. Separate table, separate lifecycle.
CREATE TABLE knowledge_base_section_status (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_base_id  UUID        NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
  section_name       TEXT        NOT NULL,
  hidden             BOOLEAN     NOT NULL DEFAULT FALSE,
  hidden_at          TIMESTAMPTZ,

  UNIQUE (knowledge_base_id, section_name)
);

COMMENT ON TABLE knowledge_base_section_status IS
  'Section-level hide/restore. Soft-only by design — there is no hard delete at
   section granularity. If the parent profile is soft-deleted, these rows remain
   stored but are moot until the profile is restored.';

-- ---------------------------------------------------------------------
-- Version retention: a fixed cap of 5 snapshots per company
-- ---------------------------------------------------------------------
-- Counted regardless of the parent company's soft-deleted status: retention is
-- about storage, and a soft-deleted company still occupies it.
--
-- This HARD-deletes the oldest row, which is a deliberate exception to the
-- soft-delete-first philosophy used everywhere else in the product. The
-- justification: automatic retention pruning is a system policy operating on a
-- schedule the user did not choose, not a destructive action the user took.
-- Soft delete exists so a user can undo their own mistake; there is no user
-- mistake here to undo, and a soft-deleted-then-never-purged history would grow
-- without bound, which is exactly what the cap exists to prevent.
CREATE OR REPLACE FUNCTION prune_knowledge_base_versions()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM knowledge_bases
  WHERE id IN (
    SELECT id
    FROM   knowledge_bases
    WHERE  company_id = NEW.company_id
    ORDER  BY created_at DESC
    OFFSET 5
  );
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER knowledge_bases_prune
  AFTER INSERT ON knowledge_bases
  FOR EACH ROW EXECUTE FUNCTION prune_knowledge_base_versions();

-- ---------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER knowledge_bases_touch
  BEFORE UPDATE ON knowledge_bases
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
