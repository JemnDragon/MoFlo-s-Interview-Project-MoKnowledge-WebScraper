/**
 * draftToFinal(): the one gate between an editable draft and a saved record.
 *
 * Only three things are required (§5): Overview, Pitch, and at least one
 * Offering. Those three are required because they are present in 100% of the
 * reference profiles — every other field is legitimately allowed to be absent,
 * and treating any of them as an error would push a reviewer toward inventing
 * content to get past a validator.
 *
 * A field that still holds its untouched mock placeholder does NOT satisfy
 * validation even though it contains text. That is the whole point of tracking
 * `reviewed` separately from "is non-empty".
 */

import type {
  Category2Field,
  Category2VisualField,
  KnowledgeBase,
  KnowledgeBaseDraft,
} from "@/types/knowledge";
import type { ReviewState } from "@/types/review";
import { getFieldSpec, requiredFields } from "@/lib/schema/fields";
import { isMockText } from "@/lib/mock/placeholders";
import { pruneEmptyEntries } from "@/lib/validate/emptyEntries";

export type ValidationProblem = {
  fieldPath: string;
  label: string;
  /** Why this specific field blocks the save. Never a generic message. */
  reason:
    | "absent-and-empty"
    | "unreviewed-placeholder"
    | "empty"
    | "no-entries";
  message: string;
};

export type DraftToFinalResult =
  | { ok: true; knowledgeBase: Omit<KnowledgeBase, "id" | "companyId" | "savedAt"> }
  | { ok: false; problems: ValidationProblem[] };

/**
 * Resolves a Category 2 field to the reviewer's text, or null.
 *
 * Reads only `status`, never the evidence itself, which is why Art Style's
 * image-bundle variant needs no special case here: whatever the field was
 * assembled from, what gets saved is the string a human left in the editor.
 */
function resolveCat2(
  path: string,
  field: Category2Field | Category2VisualField,
  review: ReviewState,
): { text: string | null; problem: ValidationProblem["reason"] | null } {
  const editor = review.cat2[path];
  const value = editor?.value?.trim() ?? "";

  if (value.length === 0) {
    return { text: null, problem: field.status === "absent" ? "absent-and-empty" : "empty" };
  }
  if (editor && !editor.reviewed) {
    return { text: null, problem: "unreviewed-placeholder" };
  }
  if (isMockText(value)) {
    // Belt and braces: even if `reviewed` somehow got set, mock text never saves.
    return { text: null, problem: "unreviewed-placeholder" };
  }
  return { text: value, problem: null };
}

function messageFor(label: string, reason: ValidationProblem["reason"]): string {
  switch (reason) {
    case "absent-and-empty":
      return `${label} is required, and the scan found no source content for it. Write it yourself before saving.`;
    case "unreviewed-placeholder":
      return `${label} still contains the mock placeholder. Replace it with real content — placeholder text is never saved.`;
    case "empty":
      return `${label} is required and is currently empty.`;
    case "no-entries":
      return `At least one ${label.replace(/s$/, "")} is required. Add one manually if the scan found none.`;
  }
}

export function draftToFinal(
  incoming: KnowledgeBaseDraft,
  review: ReviewState,
): DraftToFinalResult {
  const problems: ValidationProblem[] = [];

  // The review UI's "+ Add" buttons deliberately append an empty row — a blank
  // string for a string list, an all-null `blankEntry()` for an object list —
  // because a reviewer needs somewhere to type. Rows they never filled in are
  // not data, and this is the last point before storage where that can be said
  // once for every list rather than field by field. Deliberately NOT done while
  // editing: a row that vanishes the moment it loses focus is unusable.
  const draft = pruneEmptyEntries(incoming);

  const overview = resolveCat2("companyFoundation.overview", draft.companyFoundation.overview, review);
  const pitch = resolveCat2("positioning.pitch", draft.positioning.pitch, review);

  for (const [path, resolved] of [
    ["companyFoundation.overview", overview],
    ["positioning.pitch", pitch],
  ] as const) {
    if (resolved.problem) {
      const label = getFieldSpec(path)?.label ?? path;
      problems.push({
        fieldPath: path,
        label,
        reason: resolved.problem,
        message: messageFor(label, resolved.problem),
      });
    }
  }

  // Two different questions, previously answered by one filter.
  //
  // "Is the required-field bar met?" is stricter than "does this entry hold
  // anything": MoSocial and MoMail write *about* an offering, and an offering
  // with no name is not something you can write a post about. So the requirement
  // still counts named offerings only.
  //
  // "What gets saved?" is the general rule. The old code used the named list for
  // both, which silently deleted an offering that had a description and a price
  // but no heading the parser could read as a name — discarding evidence the
  // scan really did find, which is the one thing this system must not do. Those
  // are now kept; only entries holding nothing at all are dropped, by
  // `pruneEmptyEntries` above.
  const namedOfferings = draft.offerings.filter(
    (offering) => (offering.name ?? "").trim().length > 0,
  );
  if (namedOfferings.length === 0) {
    problems.push({
      fieldPath: "offerings",
      label: "Offerings",
      reason: "no-entries",
      message: messageFor("Offerings", "no-entries"),
    });
  }

  if (problems.length > 0) return { ok: false, problems };

  // Optional Category 2 fields resolve to whatever the reviewer left, or null.
  // An unreviewed optional field saves as null rather than as placeholder text.
  const optional = (path: string, field: Category2Field | Category2VisualField): string | null =>
    resolveCat2(path, field, review).text;

  return {
    ok: true,
    knowledgeBase: {
      schemaVersion: 1,
      scan: draft.scan,
      companyFoundation: {
        ...draft.companyFoundation,
        overview: overview.text as string,
      },
      positioning: {
        pitch: pitch.text as string,
        foundingStory: optional("positioning.foundingStory", draft.positioning.foundingStory),
      },
      marketAndCustomers: {
        ...draft.marketAndCustomers,
        targetBuyers: optional(
          "marketAndCustomers.targetBuyers",
          draft.marketAndCustomers.targetBuyers,
        ),
        customerNeeds: optional(
          "marketAndCustomers.customerNeeds",
          draft.marketAndCustomers.customerNeeds,
        ),
        idealCustomerPersona: optional(
          "marketAndCustomers.idealCustomerPersona",
          draft.marketAndCustomers.idealCustomerPersona,
        ),
        industryOutlook: optional(
          "marketAndCustomers.industryOutlook",
          draft.marketAndCustomers.industryOutlook,
        ),
      },
      brandingAndStyle: {
        ...draft.brandingAndStyle,
        writingStyle: optional("brandingAndStyle.writingStyle", draft.brandingAndStyle.writingStyle),
        artStyle: optional("brandingAndStyle.artStyle", draft.brandingAndStyle.artStyle),
      },
      onlinePresence: draft.onlinePresence,
      keyPeople: draft.keyPeople,
      offerings: draft.offerings,
      // Custom notes are supplementary: not required, not scored, and there is
      // nothing to validate about freeform text the reviewer wrote themselves.
      //
      // The one thing they do share with every other list is that "+ Add a note"
      // creates an empty row. They sit outside the field registry by design, so
      // `pruneEmptyEntries` cannot see them and the same rule is applied here
      // explicitly — the Detailed view already hid these; now they never reach
      // storage. A note with a title and no body is real and is kept.
      customSections: draft.customSections.filter(
        (section) => section.title.trim().length > 0 || section.content.trim().length > 0,
      ),
      extensions: {
        ...draft.extensions,
        valuesAndSocialPositioning: optional(
          "extensions.valuesAndSocialPositioning",
          draft.extensions.valuesAndSocialPositioning,
        ),
        differentiators: optional("extensions.differentiators", draft.extensions.differentiators),
        currentPromotions: optional(
          "extensions.currentPromotions",
          draft.extensions.currentPromotions,
        ),
      },
    },
  };
}

/** Which required fields are currently unsatisfied — drives the live save button. */
export function unsatisfiedRequiredFields(
  draft: KnowledgeBaseDraft,
  review: ReviewState,
): ValidationProblem[] {
  const result = draftToFinal(draft, review);
  return result.ok ? [] : result.problems;
}

export function requiredFieldPaths(): string[] {
  return requiredFields().map((spec) => spec.path);
}
