"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { CategoryGroupId } from "@/types/knowledge";
import type { KnowledgeBaseRow, KnowledgeBaseSummary, SectionStatusRow } from "@/lib/db/types";
import { ViewModeSelector, type ViewMode } from "./ViewModeSelector";
import { Filters } from "./Filters";
import { CardGrid } from "./CardGrid";
import { TableView } from "./TableView";
import { DetailedView } from "./DetailedView";

type ListResponse = {
  items: KnowledgeBaseSummary[];
  facets: { industries: string[]; languages: string[] };
};

type DetailResponse = {
  row: KnowledgeBaseRow;
  sections: SectionStatusRow[];
  versionCount: number;
};

export function KnowledgeExplorer() {
  const searchParams = useSearchParams();
  const focusId = searchParams.get("focus");

  const [mode, setMode] = useState<ViewMode>("card");
  const [items, setItems] = useState<KnowledgeBaseSummary[]>([]);
  const [facets, setFacets] = useState<ListResponse["facets"]>({ industries: [], languages: [] });
  const [filters, setFilters] = useState({
    industry: "",
    language: "",
    search: "",
    includeDeleted: false,
  });
  const [selectedId, setSelectedId] = useState<string | null>(focusId);
  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const loadList = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filters.industry) params.set("industry", filters.industry);
    if (filters.language) params.set("language", filters.language);
    if (filters.search) params.set("search", filters.search);
    if (filters.includeDeleted) params.set("includeDeleted", "true");

    const response = await fetch(`/api/knowledge?${params.toString()}`);
    const body = (await response.json()) as ListResponse;
    setItems(body.items);
    setFacets(body.facets);
    setLoading(false);
  }, [filters]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const loadDetail = useCallback(async (id: string) => {
    const response = await fetch(`/api/knowledge/${id}`);
    if (!response.ok) {
      setDetail(null);
      return;
    }
    setDetail((await response.json()) as DetailResponse);
  }, []);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  // Opening a profile from Card or Table switches to Detailed — that is what
  // "open" means, and a selection that changed nothing visible would be a bug.
  const open = (id: string) => {
    setSelectedId(id);
    setMode("detailed");
  };

  const toggleSection = async (group: CategoryGroupId, hidden: boolean) => {
    if (!detail) return;
    await fetch(`/api/knowledge/${detail.row.id}/sections`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ section: group, hidden }),
    });
    await loadDetail(detail.row.id);
  };

  const deleteProfile = async (deleteMode: "soft" | "hard") => {
    if (!detail) return;
    await fetch(`/api/knowledge/${detail.row.id}?mode=${deleteMode}`, { method: "DELETE" });
    if (deleteMode === "hard") {
      setSelectedId(null);
      setMode("card");
    } else {
      await loadDetail(detail.row.id);
    }
    await loadList();
  };

  const restoreProfile = async () => {
    if (!detail) return;
    await fetch(`/api/knowledge/${detail.row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "restore" }),
    });
    await loadDetail(detail.row.id);
    await loadList();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-ink-900">Saved knowledge bases</h1>
          <p className="hint">
            Every profile keeps up to 5 versions. Older snapshots beyond that are pruned
            automatically.
          </p>
        </div>
        <ViewModeSelector mode={mode} onChange={setMode} />
      </div>

      {mode !== "detailed" && (
        <Filters
          industries={facets.industries}
          languages={facets.languages}
          industry={filters.industry}
          language={filters.language}
          search={filters.search}
          includeDeleted={filters.includeDeleted}
          resultCount={items.length}
          onChange={(next) => setFilters((current) => ({ ...current, ...next }))}
        />
      )}

      {loading && mode !== "detailed" && (
        <div className="card p-6 text-center">
          <p className="hint">Loading…</p>
        </div>
      )}

      {!loading && mode === "card" && <CardGrid items={items} onOpen={open} />}
      {!loading && mode === "table" && <TableView items={items} onOpen={open} />}

      {mode === "detailed" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="field-label" htmlFor="detail-select">
              Profile
            </label>
            <select
              id="detail-select"
              value={selectedId ?? ""}
              onChange={(event) => setSelectedId(event.target.value || null)}
              className="max-w-xs"
            >
              <option value="">Select a knowledge base…</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.companyName}
                  {item.status === "soft_deleted" ? " (deleted)" : ""}
                </option>
              ))}
            </select>
          </div>

          {detail ? (
            <DetailedView
              row={detail.row}
              sections={detail.sections}
              onToggleSection={toggleSection}
              onDelete={deleteProfile}
              onRestore={restoreProfile}
            />
          ) : (
            <div className="card p-8 text-center">
              <p className="text-sm font-semibold text-ink-700">No profile selected</p>
              <p className="hint mt-1">
                Pick one above, or open a card from the Card or Table view.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
