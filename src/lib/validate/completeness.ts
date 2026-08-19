/**
 * Completeness scoring.
 *
 * Deliberate design decision (§8): the score treats every absent field
 * identically, whatever the cause. A field that was never found, a field whose
 * page timed out, and a field the scraper skipped all count the same — because
 * from the point of view of "how usable is this knowledge base", they are the
 * same. The *reason* is tracked separately (in `scanStatus` and in the per-field
 * breakdown below) so the UI can explain it without the number lying.
 *
 * The one distinction the breakdown does draw is user-hidden sections. Those are
 * missing because someone chose to hide them, which reads differently to a human
 * than "the site never said". Hidden fields are excluded from the denominator
 * rather than counted as failures — penalising a deliberate choice would be
 * scoring the user, not the data.
 */

import type { CategoryGroupId, KnowledgeBase, KnowledgeBaseDraft } from "@/types/knowledge";
import { FIELD_SPECS, type FieldSpec } from "@/lib/schema/fields";
import { getAtPath } from "@/lib/utils/paths";
import { isEmptyEntry, subFieldHasContent } from "@/lib/validate/emptyEntries";

export type MissingReason = "not-found" | "hidden";

export type MissingField = {
  fieldPath: string;
  label: string;
  group: CategoryGroupId;
  reason: MissingReason;
  required: boolean;
};

export type Completeness = {
  /** 0–100, rounded. Hidden fields are outside the denominator. */
  score: number;
  populated: number;
  /** Fields counted, i.e. total minus hidden. */
  counted: number;
  missing: MissingField[];
  hiddenCount: number;
};

function isPopulated(spec: FieldSpec, value: unknown): boolean {
  if (value === null || value === undefined) return false;

  // Category 2 in draft form.
  if (
    typeof value === "object" &&
    value !== null &&
    "status" in (value as Record<string, unknown>)
  ) {
    return (value as { status: string }).status === "found";
  }

  switch (spec.kind) {
    // Counted by content, not by length. A list holding nothing but the blank
    // row a reviewer added and never filled in would otherwise score the same as
    // a list of real entries, which is the score telling a small lie about how
    // usable the knowledge base is. Both save paths prune these before storage;
    // this makes the number honest for a draft mid-review too, where nothing has
    // been pruned yet.
    case "stringList":
      return Array.isArray(value) && value.some((item) => subFieldHasContent(item));
    case "objectList":
      return (
        Array.isArray(value) &&
        value.some((entry) => !isEmptyEntry(entry, spec.subFields ?? []))
      );
    case "language": {
      const language = value as { main: string | null; alternates: string[] };
      return Boolean(language.main) || language.alternates.length > 0;
    }
    case "structured": {
      const record = value as Record<string, unknown>;
      return Object.values(record).some(
        (sub) => sub !== null && sub !== undefined && String(sub).trim().length > 0,
      );
    }
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    default:
      return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
  }
}

export function computeCompleteness(
  record: KnowledgeBaseDraft | KnowledgeBase,
  options: { hiddenSections?: CategoryGroupId[] } = {},
): Completeness {
  const hidden = new Set(options.hiddenSections ?? []);
  const missing: MissingField[] = [];
  let populated = 0;
  let counted = 0;
  let hiddenCount = 0;

  for (const spec of FIELD_SPECS) {
    if (hidden.has(spec.group)) {
      hiddenCount += 1;
      missing.push({
        fieldPath: spec.path,
        label: spec.label,
        group: spec.group,
        reason: "hidden",
        required: spec.required === true,
      });
      continue;
    }

    counted += 1;
    if (isPopulated(spec, getAtPath(record, spec.path))) {
      populated += 1;
    } else {
      missing.push({
        fieldPath: spec.path,
        label: spec.label,
        group: spec.group,
        reason: "not-found",
        required: spec.required === true,
      });
    }
  }

  return {
    score: counted === 0 ? 0 : Math.round((populated / counted) * 100),
    populated,
    counted,
    missing,
    hiddenCount,
  };
}

/** Required fields that are missing because a section is hidden, not because they were never found. */
export function hiddenRequiredFields(completeness: Completeness): MissingField[] {
  return completeness.missing.filter((field) => field.reason === "hidden" && field.required);
}
