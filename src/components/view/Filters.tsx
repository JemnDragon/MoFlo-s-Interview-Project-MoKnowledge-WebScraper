"use client";

/**
 * Structured filters (Industry, Languages) plus free-text search.
 *
 * Search covers company name, overview, and Key People names. The Key People part
 * is a JSONB query against the nested document rather than a promoted column —
 * see the note in schema.sql for why that trade-off was made deliberately.
 */
export function Filters({
  industries,
  languages,
  industry,
  language,
  search,
  includeDeleted,
  onChange,
  resultCount,
}: {
  industries: string[];
  languages: string[];
  industry: string;
  language: string;
  search: string;
  includeDeleted: boolean;
  onChange: (next: {
    industry?: string;
    language?: string;
    search?: string;
    includeDeleted?: boolean;
  }) => void;
  resultCount: number;
}) {
  return (
    <div className="card p-4">
      <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <label className="block">
          <span className="field-label">Search</span>
          <input
            type="search"
            value={search}
            placeholder="Company name, overview text, or a person's name"
            onChange={(event) => onChange({ search: event.target.value })}
            className="mt-1"
          />
        </label>

        <label className="block">
          <span className="field-label">Industry</span>
          <select
            value={industry}
            onChange={(event) => onChange({ industry: event.target.value })}
            className="mt-1"
          >
            <option value="">All industries</option>
            {industries.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="field-label">Language</span>
          <select
            value={language}
            onChange={(event) => onChange({ language: event.target.value })}
            className="mt-1"
          >
            <option value="">All languages</option>
            {languages.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs text-ink-700">
          <input
            type="checkbox"
            checked={includeDeleted}
            onChange={(event) => onChange({ includeDeleted: event.target.checked })}
            className="h-3.5 !w-3.5"
          />
          Show soft-deleted profiles
        </label>
        <span className="hint">
          {resultCount} profile{resultCount === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}
