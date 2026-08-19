/**
 * Local JSON-file implementation of `KnowledgeRepository`.
 *
 * A dev-time stand-in for Postgres, written to mirror `schema.sql` semantics
 * exactly — same two-table split, same promoted columns, same one-current-row
 * invariant, same 5-version retention cap with a hard delete of the oldest, same
 * separate section-status collection. Everything above this file is written
 * against the interface, so replacing it with Supabase is a single new class.
 *
 * What it does NOT try to reproduce: real concurrency. Writes are serialised
 * through an in-process promise chain, which is correct for a single Next.js
 * server and would obviously be wrong for more than one.
 */

import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CategoryGroupId, KnowledgeBase } from "@/types/knowledge";
import {
  VERSION_RETENTION_CAP,
  type CompanyRow,
  type KnowledgeBaseRow,
  type KnowledgeBaseSummary,
  type KnowledgeRepository,
  type ListFilters,
  type SectionStatusRow,
} from "./types";

type Database = {
  companies: CompanyRow[];
  knowledgeBases: KnowledgeBaseRow[];
  sectionStatus: SectionStatusRow[];
};

const DATA_DIR = path.join(process.cwd(), ".data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const EMPTY: Database = { companies: [], knowledgeBases: [], sectionStatus: [] };

/** Serialises all mutations; see the note above about single-process scope. */
let writeChain: Promise<unknown> = Promise.resolve();

async function readDatabase(): Promise<Database> {
  try {
    const contents = await readFile(DB_PATH, "utf8");
    const parsed = JSON.parse(contents) as Partial<Database>;
    return {
      companies: parsed.companies ?? [],
      knowledgeBases: parsed.knowledgeBases ?? [],
      sectionStatus: parsed.sectionStatus ?? [],
    };
  } catch {
    return { ...EMPTY };
  }
}

/**
 * Write to a temp file then rename, so a crash mid-write can't truncate the store.
 *
 * The retry is for Windows. `rename` over an existing file is atomic on POSIX and
 * normally works on Windows too (libuv passes MOVEFILE_REPLACE_EXISTING), but a
 * real-time virus scanner briefly holding the destination open makes it fail with
 * a transient EPERM. Losing a save to an antivirus race would be a poor way to
 * discover this, so it backs off briefly and tries again.
 */
async function writeDatabase(database: Database): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const temporary = `${DB_PATH}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(database, null, 2), "utf8");

  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rename(temporary, DB_PATH);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY") throw error;
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }

  // Last resort: overwrite in place. Not atomic, but a non-atomic save beats a
  // lost one, and the temp file is cleaned up either way.
  try {
    await writeFile(DB_PATH, JSON.stringify(database, null, 2), "utf8");
  } catch {
    throw lastError;
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

function transact<T>(mutator: (database: Database) => Promise<T> | T): Promise<T> {
  const next = writeChain.then(async () => {
    const database = await readDatabase();
    const result = await mutator(database);
    await writeDatabase(database);
    return result;
  });
  // Keep the chain alive even if one mutation rejects.
  writeChain = next.catch(() => undefined);
  return next;
}

/** Scheme + host, no trailing slash — the uniqueness key for a company. */
export function canonicalWebsiteOf(website: string): string {
  try {
    const url = new URL(website);
    return `${url.protocol}//${url.hostname.replace(/^www\./, "")}`.toLowerCase();
  } catch {
    return website.trim().toLowerCase();
  }
}

function summaryOf(row: KnowledgeBaseRow): KnowledgeBaseSummary {
  return {
    id: row.id,
    companyId: row.companyId,
    companyName: row.companyName,
    website: row.website,
    industry: row.industry,
    siteLanguage: row.siteLanguage,
    completenessScore: row.completenessScore,
    logoUrl: row.logoUrl,
    brandColor: row.brandColor,
    status: row.status,
    updatedAt: row.updatedAt,
    offeringsCount: row.data.offerings.length,
    keyPeopleCount: row.data.keyPeople.length,
    yearFounded: row.data.companyFoundation.yearFounded,
  };
}

/**
 * The JSONB-query equivalent: search company name, overview, and Key People
 * names. Key People names are read out of the nested document rather than from a
 * promoted column, exactly as the Postgres implementation would with
 * `jsonb_path_exists`.
 */
function matchesSearch(row: KnowledgeBaseRow, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (needle.length === 0) return true;

  if (row.companyName.toLowerCase().includes(needle)) return true;
  if (row.data.companyFoundation.overview.toLowerCase().includes(needle)) return true;
  return row.data.keyPeople.some((person) =>
    (person.name ?? "").toLowerCase().includes(needle),
  );
}

export class JsonKnowledgeRepository implements KnowledgeRepository {
  async save(input: {
    knowledgeBase: Omit<KnowledgeBase, "id" | "companyId" | "savedAt">;
    completenessScore: number;
  }): Promise<KnowledgeBaseRow> {
    const { knowledgeBase, completenessScore } = input;
    const website = knowledgeBase.companyFoundation.website ?? knowledgeBase.scan.resolvedUrl;
    const canonical = canonicalWebsiteOf(website);
    const name = knowledgeBase.companyFoundation.companyName ?? canonical;

    return transact((database) => {
      const now = new Date().toISOString();

      let company = database.companies.find((row) => row.canonicalWebsite === canonical);
      if (!company) {
        company = { id: randomUUID(), name, canonicalWebsite: canonical, createdAt: now };
        database.companies.push(company);
      } else if (company.name !== name) {
        company.name = name;
      }

      // Exactly one current row per company.
      for (const row of database.knowledgeBases) {
        if (row.companyId === company.id) row.isCurrent = false;
      }

      const id = randomUUID();
      const languages = [
        knowledgeBase.extensions.siteLanguage.main,
        ...knowledgeBase.extensions.siteLanguage.alternates,
      ].filter((value): value is string => typeof value === "string");

      const row: KnowledgeBaseRow = {
        id,
        companyId: company.id,
        data: { ...knowledgeBase, id, companyId: company.id, savedAt: now },
        companyName: name,
        website,
        industry: knowledgeBase.companyFoundation.industry,
        siteLanguage: Array.from(new Set(languages)),
        completenessScore,
        logoUrl: knowledgeBase.brandingAndStyle.logos[0]?.url ?? null,
        brandColor: knowledgeBase.brandingAndStyle.brandColors[0] ?? null,
        status: "active",
        isCurrent: true,
        createdAt: now,
        updatedAt: now,
      };
      database.knowledgeBases.push(row);

      // Retention: hard-delete the oldest beyond the cap. Counted regardless of
      // soft-deleted status — see the rationale comment in schema.sql.
      const forCompany = database.knowledgeBases
        .filter((candidate) => candidate.companyId === company.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      const overflow = forCompany.slice(VERSION_RETENTION_CAP);
      for (const stale of overflow) {
        database.knowledgeBases = database.knowledgeBases.filter(
          (candidate) => candidate.id !== stale.id,
        );
        database.sectionStatus = database.sectionStatus.filter(
          (status) => status.knowledgeBaseId !== stale.id,
        );
      }

      return row;
    });
  }

  async list(filters: ListFilters = {}): Promise<KnowledgeBaseSummary[]> {
    const database = await readDatabase();
    return database.knowledgeBases
      .filter((row) => row.isCurrent)
      .filter((row) => (filters.includeDeleted ? true : row.status === "active"))
      .filter((row) => (filters.industry ? row.industry === filters.industry : true))
      .filter((row) =>
        filters.language ? row.siteLanguage.includes(filters.language) : true,
      )
      .filter((row) => (filters.search ? matchesSearch(row, filters.search) : true))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(summaryOf);
  }

  async get(id: string): Promise<KnowledgeBaseRow | null> {
    const database = await readDatabase();
    return database.knowledgeBases.find((row) => row.id === id) ?? null;
  }

  async versions(companyId: string): Promise<KnowledgeBaseRow[]> {
    const database = await readDatabase();
    return database.knowledgeBases
      .filter((row) => row.companyId === companyId && !row.isCurrent)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async softDelete(id: string): Promise<void> {
    await transact((database) => {
      const row = database.knowledgeBases.find((candidate) => candidate.id === id);
      if (!row) return;
      row.status = "soft_deleted";
      row.updatedAt = new Date().toISOString();
    });
  }

  async restore(id: string): Promise<void> {
    await transact((database) => {
      const row = database.knowledgeBases.find((candidate) => candidate.id === id);
      if (!row) return;
      row.status = "active";
      row.updatedAt = new Date().toISOString();
    });
  }

  async hardDelete(id: string): Promise<void> {
    await transact((database) => {
      const row = database.knowledgeBases.find((candidate) => candidate.id === id);
      database.knowledgeBases = database.knowledgeBases.filter(
        (candidate) => candidate.id !== id,
      );
      database.sectionStatus = database.sectionStatus.filter(
        (status) => status.knowledgeBaseId !== id,
      );
      // Remove the company too if this was its last snapshot (ON DELETE CASCADE
      // runs the other way in Postgres; this keeps the JSON store from
      // accumulating orphan identity rows).
      if (row) {
        const remaining = database.knowledgeBases.some(
          (candidate) => candidate.companyId === row.companyId,
        );
        if (!remaining) {
          database.companies = database.companies.filter(
            (company) => company.id !== row.companyId,
          );
        }
      }
    });
  }

  async sectionStatus(knowledgeBaseId: string): Promise<SectionStatusRow[]> {
    const database = await readDatabase();
    return database.sectionStatus.filter((row) => row.knowledgeBaseId === knowledgeBaseId);
  }

  async setSectionHidden(
    knowledgeBaseId: string,
    sectionName: CategoryGroupId,
    hidden: boolean,
  ): Promise<SectionStatusRow> {
    return transact((database) => {
      const existing = database.sectionStatus.find(
        (row) => row.knowledgeBaseId === knowledgeBaseId && row.sectionName === sectionName,
      );
      if (existing) {
        existing.hidden = hidden;
        existing.hiddenAt = hidden ? new Date().toISOString() : null;
        return existing;
      }
      const row: SectionStatusRow = {
        id: randomUUID(),
        knowledgeBaseId,
        sectionName,
        hidden,
        hiddenAt: hidden ? new Date().toISOString() : null,
      };
      database.sectionStatus.push(row);
      return row;
    });
  }

  async facets(): Promise<{ industries: string[]; languages: string[] }> {
    const database = await readDatabase();
    const current = database.knowledgeBases.filter((row) => row.isCurrent);
    return {
      industries: Array.from(
        new Set(
          current
            .map((row) => row.industry)
            .filter((value): value is string => typeof value === "string" && value.length > 0),
        ),
      ).sort(),
      languages: Array.from(new Set(current.flatMap((row) => row.siteLanguage))).sort(),
    };
  }
}
