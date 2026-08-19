/**
 * Row shapes and the repository contract.
 *
 * The interface is written against the Postgres schema in `schema.sql`, not
 * against the JSON file that currently implements it. Swapping in Supabase means
 * writing one more class against this interface; nothing above the repository
 * knows which one it is talking to.
 */

import type { CategoryGroupId, KnowledgeBase } from "@/types/knowledge";

export type CompanyRow = {
  id: string;
  name: string;
  canonicalWebsite: string;
  createdAt: string;
};

export type KnowledgeBaseStatus = "active" | "soft_deleted";

export type KnowledgeBaseRow = {
  id: string;
  companyId: string;
  /** The full nested KnowledgeBase document — the JSONB column. */
  data: KnowledgeBase;

  /* Promoted columns. Duplicated from `data` for filtering and card rendering. */
  companyName: string;
  website: string;
  industry: string | null;
  siteLanguage: string[];
  completenessScore: number;
  logoUrl: string | null;
  brandColor: string | null;

  status: KnowledgeBaseStatus;
  isCurrent: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SectionStatusRow = {
  id: string;
  knowledgeBaseId: string;
  sectionName: CategoryGroupId;
  hidden: boolean;
  hiddenAt: string | null;
};

/** What the list views need, without deserialising the JSONB document. */
export type KnowledgeBaseSummary = {
  id: string;
  companyId: string;
  companyName: string;
  website: string;
  industry: string | null;
  siteLanguage: string[];
  completenessScore: number;
  logoUrl: string | null;
  brandColor: string | null;
  status: KnowledgeBaseStatus;
  updatedAt: string;
  offeringsCount: number;
  keyPeopleCount: number;
  yearFounded: number | null;
};

export type ListFilters = {
  industry?: string | null;
  language?: string | null;
  /** Matches company name, overview text, and Key People names. */
  search?: string | null;
  includeDeleted?: boolean;
};

export const VERSION_RETENTION_CAP = 5;

export interface KnowledgeRepository {
  /** Upserts the company by canonical website, then inserts a new current version. */
  save(input: {
    knowledgeBase: Omit<KnowledgeBase, "id" | "companyId" | "savedAt">;
    completenessScore: number;
  }): Promise<KnowledgeBaseRow>;

  list(filters?: ListFilters): Promise<KnowledgeBaseSummary[]>;
  get(id: string): Promise<KnowledgeBaseRow | null>;
  /** Prior snapshots for a company, newest first, excluding the current one. */
  versions(companyId: string): Promise<KnowledgeBaseRow[]>;

  softDelete(id: string): Promise<void>;
  restore(id: string): Promise<void>;
  hardDelete(id: string): Promise<void>;

  sectionStatus(knowledgeBaseId: string): Promise<SectionStatusRow[]>;
  setSectionHidden(
    knowledgeBaseId: string,
    sectionName: CategoryGroupId,
    hidden: boolean,
  ): Promise<SectionStatusRow>;

  /** Distinct values for the structured filters on /knowledge/view. */
  facets(): Promise<{ industries: string[]; languages: string[] }>;
}
