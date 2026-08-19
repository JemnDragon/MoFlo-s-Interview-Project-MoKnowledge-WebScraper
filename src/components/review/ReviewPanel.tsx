"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CATEGORY_GROUP_IDS, type KnowledgeBaseDraft } from "@/types/knowledge";
import type { Cat2EditorState, ReviewState } from "@/types/review";
import { setAtPath } from "@/lib/utils/paths";
import { computeCompleteness } from "@/lib/validate/completeness";
import { unsatisfiedRequiredFields } from "@/lib/validate/draftToFinal";
import { initialReviewState, reviewedCount } from "@/lib/review/initialize";
import { CategoryGroupBlock } from "@/components/fields/CategoryGroupBlock";
import { CustomSectionsEditor } from "@/components/fields/CustomSections";
import { SaveBar } from "./SaveBar";
import { PersonaFitCard } from "./PersonaFitCard";

/**
 * The review surface.
 *
 * State split mirrors the type split: Category 1 and 3 edits mutate a local copy
 * of the draft (they are plain values), while Category 2 edits live in a separate
 * review state that carries the placeholder and the reviewed flag. `draftToFinal`
 * takes both.
 */
export function ReviewPanel({
  draft: initialDraft,
  scanId,
  warnings,
  onRetry,
  retrying,
}: {
  draft: KnowledgeBaseDraft;
  scanId: string | null;
  warnings: string[];
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<KnowledgeBaseDraft>(initialDraft);
  const [review, setReview] = useState<ReviewState>(() => initialReviewState(initialDraft));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const completeness = useMemo(() => computeCompleteness(draft), [draft]);
  const problems = useMemo(() => unsatisfiedRequiredFields(draft, review), [draft, review]);
  const { reviewed, total } = reviewedCount(review);

  const scanIncomplete = draft.scan.status === "partial";
  const personaEditor = review.cat2["marketAndCustomers.idealCustomerPersona"];
  const personaResolved = personaEditor?.reviewed ? personaEditor.value : null;

  const handleValueChange = (path: string, next: unknown) => {
    setDraft((current) => setAtPath(current, path, next));
  };

  const handleCat2Change = (path: string, next: Cat2EditorState) => {
    setReview((current) => ({ ...current, cat2: { ...current.cat2, [path]: next } }));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft, review }),
      });
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        setSaveError(body.error ?? "The knowledge base could not be saved.");
        return;
      }
      const body = (await response.json()) as { id: string };
      router.push(`/knowledge/view?focus=${body.id}`);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "The knowledge base could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {scanIncomplete && (
        <div className="rounded-lg border border-partial-600/30 bg-partial-100 p-4">
          <p className="text-sm font-semibold text-partial-600">This scan didn&apos;t finish</p>
          <p className="mt-0.5 text-xs leading-relaxed text-partial-600">
            {draft.scan.pagesFailed.length} page
            {draft.scan.pagesFailed.length === 1 ? "" : "s"} never completed before the time budget
            ran out. Everything already fetched has been kept — nothing below was discarded. Fields
            that would have come from the missing pages are marked &ldquo;scan didn&apos;t
            finish&rdquo; rather than &ldquo;not found&rdquo;.
          </p>
          {draft.scan.pagesFailed.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {draft.scan.pagesFailed.map((page) => (
                <li key={page.url} className="text-[11px] text-partial-600">
                  <span className="font-mono">{page.url}</span> — {page.reason}
                </li>
              ))}
            </ul>
          )}
          {onRetry && scanId && (
            <button
              type="button"
              onClick={onRetry}
              disabled={retrying}
              className="mt-2 rounded border border-partial-600/40 bg-surface px-2.5 py-1 text-xs font-semibold text-partial-600 disabled:opacity-60"
            >
              {retrying ? "Retrying…" : "Retry the incomplete pages"}
            </button>
          )}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="rounded-lg border border-ink-200 bg-surface p-4">
          <p className="text-xs font-semibold text-ink-700">What the scan found and didn&apos;t</p>
          <ul className="mt-1 space-y-0.5">
            {warnings.map((warning, index) => (
              <li key={index} className="hint">
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-lg border border-mock-500/30 bg-mock-100 p-4">
        <p className="text-sm font-semibold text-mock-600">No AI has run on this draft</p>
        <p className="mt-0.5 text-xs leading-relaxed text-mock-600">
          Every narrative field below is pre-filled with a labelled placeholder, not with generated
          prose. The real prompts that would produce these values live in <code>/prompts</code>. A
          field still holding its placeholder counts as unreviewed and will not save.
        </p>
      </div>

      {CATEGORY_GROUP_IDS.map((group) => (
        <CategoryGroupBlock
          key={group}
          group={group}
          record={draft}
          mode="edit"
          review={review}
          scanIncomplete={scanIncomplete}
          onValueChange={handleValueChange}
          onCat2Change={handleCat2Change}
        />
      ))}

      {/* After every scraped category: the one block the scan had no part in. */}
      <CustomSectionsEditor
        sections={draft.customSections}
        onChange={(next) => setDraft((current) => ({ ...current, customSections: next }))}
      />

      <PersonaFitCard
        personaText={personaResolved}
        testimonialCount={draft.extensions.testimonials.length}
      />

      {saveError && (
        <div className="rounded-lg border border-danger-600/25 bg-danger-100 p-3 text-xs text-danger-600">
          {saveError}
        </div>
      )}

      <SaveBar
        completeness={completeness}
        problems={problems}
        reviewed={reviewed}
        totalCat2={total}
        saving={saving}
        onSave={handleSave}
      />
    </div>
  );
}
