"use client";

import { useMemo, useState } from "react";
import {
  CATEGORY_GROUP_IDS,
  CATEGORY_GROUP_LABELS,
  type CategoryGroupId,
} from "@/types/knowledge";
import type { KnowledgeBaseRow, SectionStatusRow } from "@/lib/db/types";
import { computeCompleteness, hiddenRequiredFields } from "@/lib/validate/completeness";
import { CategoryGroupBlock } from "@/components/fields/CategoryGroupBlock";
import { CustomSectionsView } from "@/components/fields/CustomSections";
import { CompletenessBar } from "@/components/shared/CompletenessBar";
import { PersonaFitCard } from "@/components/review/PersonaFitCard";
import { DeleteControls } from "./DeleteControls";

/**
 * Full knowledge base, read-only, reusing the same category components the review
 * UI is built from.
 *
 * Layout is side-by-side on desktop and single-column on mobile via one CSS grid
 * breakpoint — no JavaScript. Unlike the card grid, nothing here needs to know
 * the layout shape in advance.
 */
export function DetailedView({
  row,
  sections,
  onToggleSection,
  onDelete,
  onRestore,
}: {
  row: KnowledgeBaseRow;
  sections: SectionStatusRow[];
  onToggleSection: (group: CategoryGroupId, hidden: boolean) => void;
  onDelete: (mode: "soft" | "hard") => void;
  onRestore: () => void;
}) {
  const [showJson, setShowJson] = useState(false);

  const hiddenGroups = useMemo(
    () =>
      sections
        .filter((section) => section.hidden)
        .map((section) => section.sectionName as CategoryGroupId),
    [sections],
  );

  const profileDeleted = row.status === "soft_deleted";
  const completeness = useMemo(
    () => computeCompleteness(row.data, { hiddenSections: hiddenGroups }),
    [row.data, hiddenGroups],
  );
  const hiddenRequired = hiddenRequiredFields(completeness);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(row.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${row.companyName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-knowledge-base.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <header className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-[240px]">
            <h2 className="text-lg font-bold tracking-tight text-ink-900">{row.companyName}</h2>
            <p className="hint mt-0.5">
              <a
                href={row.website}
                target="_blank"
                rel="noreferrer noopener"
                className="text-accent-600 underline decoration-dotted"
              >
                {row.website}
              </a>
              {" · "}
              {row.industry ?? "Industry not found"}
              {" · "}last updated {new Date(row.updatedAt).toLocaleString()}
            </p>
            {row.data.brandingAndStyle.logos.length === 0 && (
              <p className="hint mt-1 text-ink-400">
                No logo was found on this site — the card view shows an initial circle instead.
              </p>
            )}
          </div>

          <div className="min-w-[220px] flex-1 md:max-w-xs">
            <CompletenessBar completeness={completeness} />
          </div>
        </div>

        {profileDeleted && (
          <div className="mt-3 rounded-lg border border-hidden-600/25 bg-hidden-100 p-3">
            <p className="text-xs font-semibold text-hidden-600">
              This profile is soft-deleted
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-hidden-600">
              Profile-level deletion supersedes every section-level hidden state — those are still
              stored, but they are moot until the profile is restored.
            </p>
            <button
              type="button"
              onClick={onRestore}
              className="mt-2 rounded border border-hidden-600/40 bg-surface px-2.5 py-1 text-xs font-semibold text-hidden-600"
            >
              Restore profile
            </button>
          </div>
        )}

        {hiddenRequired.length > 0 && (
          <div className="mt-3 rounded-lg border border-hidden-600/25 bg-hidden-100 p-3">
            <p className="text-xs font-semibold text-hidden-600">
              {hiddenRequired.length} required field
              {hiddenRequired.length === 1 ? " is" : "s are"} hidden, not missing
            </p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-hidden-600">
              {hiddenRequired.map((field) => field.label).join(", ")} — hidden by a section-level
              delete rather than never found. Restore the section to see them again.
            </p>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={exportJson}
            className="rounded border border-ink-200 px-2.5 py-1 text-xs font-semibold text-ink-700 hover:border-accent-500 hover:text-accent-600"
          >
            Export JSON
          </button>
          <button
            type="button"
            onClick={() => setShowJson((value) => !value)}
            className="rounded border border-ink-200 px-2.5 py-1 text-xs font-semibold text-ink-700 hover:border-accent-500 hover:text-accent-600"
          >
            {showJson ? "Hide raw JSON" : "View raw JSON"}
          </button>
          <div className="ml-auto">
            <DeleteControls deleted={profileDeleted} onDelete={onDelete} onRestore={onRestore} />
          </div>
        </div>

        {showJson && (
          <pre className="mt-3 max-h-96 overflow-auto rounded-lg border border-ink-200 bg-ink-100 p-3 text-[11px] leading-relaxed text-ink-700">
            {JSON.stringify(row.data, null, 2)}
          </pre>
        )}
      </header>

      {/* Side-by-side on desktop, stacked on mobile — pure CSS, no JS. */}
      <div className="grid gap-4 lg:grid-cols-2">
        {CATEGORY_GROUP_IDS.map((group) => (
          <CategoryGroupBlock
            key={group}
            group={group}
            record={row.data}
            mode="read"
            scanIncomplete={row.data.scan.status === "partial"}
            hidden={hiddenGroups.includes(group)}
            onToggleHidden={onToggleSection}
          />
        ))}
      </div>

      {/* Renders nothing when there are no notes — see CustomSectionsView. */}
      <CustomSectionsView sections={row.data.customSections ?? []} />

      <PersonaFitCard
        personaText={row.data.marketAndCustomers.idealCustomerPersona}
        testimonialCount={row.data.extensions.testimonials.length}
      />

      <section className="card p-4">
        <h3 className="text-sm font-bold text-ink-900">Scan record</h3>
        <dl className="mt-2 grid gap-2 text-xs sm:grid-cols-2">
          <div>
            <dt className="hint">Status</dt>
            <dd className="font-semibold text-ink-900">{row.data.scan.status}</dd>
          </div>
          <div>
            <dt className="hint">Duration</dt>
            <dd className="text-ink-900">{(row.data.scan.durationMs / 1000).toFixed(1)}s</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="hint">Pages read ({row.data.scan.pagesFetched.length})</dt>
            <dd className="mt-0.5 flex flex-wrap gap-1">
              {row.data.scan.pagesFetched.map((page) => (
                <span
                  key={page.url}
                  className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] text-ink-700"
                  title={page.url}
                >
                  {page.pageType}
                </span>
              ))}
            </dd>
          </div>
          {row.data.scan.pagesFailed.length > 0 && (
            <div className="sm:col-span-2">
              <dt className="hint">Pages that never completed</dt>
              <dd className="mt-0.5 space-y-0.5">
                {row.data.scan.pagesFailed.map((page) => (
                  <p key={page.url} className="text-[11px] text-partial-600">
                    <span className="font-mono">{page.url}</span> — {page.reason}
                  </p>
                ))}
              </dd>
            </div>
          )}
        </dl>
        <p className="hint mt-2">
          Section visibility is stored separately from this snapshot, so hiding{" "}
          {CATEGORY_GROUP_LABELS.people} does not create a new content version and a re-scan does
          not silently un-hide it.
        </p>
      </section>
    </div>
  );
}
