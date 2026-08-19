/**
 * One rule, applied to every list in the schema: an entry with no content in it
 * is not an entry.
 *
 * ## Why this is one shared function and not a filter per field
 *
 * The bug that prompted this was reported against Industry Groupings, but
 * Industry Groupings is not where it lives. The scraper cannot emit a blank
 * grouping — `industryGroupings()` already filters on `length > 2`. The blanks
 * come from the *write* path: `StringListField`'s "+ Add" button appends `""`
 * and `Category3Field`'s "+ Add" appends an all-null `blankEntry()`, both by
 * design, because a reviewer needs an empty row to type into. Nothing between
 * that row and the JSONB column ever removed it again if they didn't.
 *
 * That makes it a property of *every* list field, not of one of them, so the fix
 * belongs at the one place all lists pass through rather than in twelve
 * extraction functions. `draftToFinal()` already did exactly this for Offerings
 * — `usableOfferings` — as a side effect of the required-field check. This
 * generalises that single case to the whole registry.
 *
 * ## Why the field registry decides what "empty" means
 *
 * The obvious test — "every sub-field is null" — never fires, because it isn't
 * only content sub-fields that get populated:
 *
 *   - `sourceUrl` is set on every Category 3 entry the transform produces.
 *   - `transformTestimonials` hardcodes `source: "Company website"`.
 *
 * An entry carrying nothing but provenance would pass a naive check and render
 * as a blank card anyway. So emptiness is judged against `spec.subFields`, which
 * lists exactly the content-bearing keys and deliberately omits `sourceUrl` —
 * the same list the editor renders inputs for. If a reviewer sees no fields to
 * fill, there is nothing in the entry worth keeping.
 *
 * The one hazard that leaves: a *constant* written into a key that IS in
 * subFields would silently make its list unprunable. `source` on testimonials is
 * the live example, harmless today only because the parse layer requires a
 * non-empty quote before it emits anything. `scripts/smoke.ts` guards this.
 *
 * Pure — no I/O, no clock. Safe to call from inside `rawToDraft()`.
 */

import { FIELD_SPECS, type SubFieldSpec } from "@/lib/schema/fields";
import { getAtPath, setAtPath } from "@/lib/utils/paths";
import { hasVisibleText, visibleText } from "@/lib/utils/text";

/**
 * Does one sub-field value carry information?
 *
 * `0` counts as empty on purpose. The only numeric sub-fields are
 * `contentThemes.mentions` and `certifications.year`, and neither "seen zero
 * times" nor "year zero" is a fact about anything — they are what an untouched
 * numeric input collapses to. A non-zero number is kept even with every sibling
 * null: a certification known only by its year is thin, but it is evidence the
 * scan actually found, and discarding found evidence is the one thing this
 * system is not allowed to do.
 */
export function subFieldHasContent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some((item) => subFieldHasContent(item));
  if (typeof value === "number") return Number.isFinite(value) && value !== 0;
  if (typeof value === "boolean") return value;
  // `hasVisibleText`, not `.trim()`. The first version of this rule used trim,
  // which is the wrong condition: zero-width characters are not whitespace to
  // JavaScript, so a value of three zero-width spaces measured as three
  // characters of content and rendered as a blank row. See `ZERO_WIDTH`.
  return hasVisibleText(String(value));
}

/**
 * True when none of the entry's content sub-fields carry anything.
 *
 * An entry is judged only against the keys in `subFields`. An empty `subFields`
 * returns `false` — nothing is known about what this entry is supposed to hold,
 * so keeping a possibly-junk entry beats silently deleting a whole list.
 */
export function isEmptyEntry(entry: unknown, subFields: SubFieldSpec[]): boolean {
  if (subFields.length === 0) return false;
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return true;
  const record = entry as Record<string, unknown>;
  return !subFields.some((sub) => subFieldHasContent(record[sub.key]));
}

/**
 * Blank strings dropped; survivors normalised.
 *
 * "Blank" means *renders as nothing*, not `.trim().length === 0`. Survivors have
 * their zero-width characters stripped too, so a grouping that reads
 * "Roofing<ZWSP>" is stored as "Roofing" and dedupes against a clean copy of
 * itself rather than sitting beside it as a second, identical-looking chip.
 */
export function pruneStringList(items: unknown[]): string[] {
  return items
    .filter((item): item is string => typeof item === "string")
    .map((item) => visibleText(item))
    .filter((item) => item.length > 0);
}

export type PruneReport = { path: string; removed: number }[];

/**
 * Walks every `objectList` and `stringList` field in the registry and drops the
 * entries that hold nothing. Returns a new record; the input is untouched.
 *
 * Registry-driven rather than hand-listed so that a list field added later
 * inherits the behaviour without anyone remembering to wire it up — which is the
 * specific failure mode that produced this bug, given Offerings already had the
 * fix and nothing else did.
 */
export function pruneEmptyEntries<T>(record: T, report?: PruneReport): T {
  let next = record;

  for (const spec of FIELD_SPECS) {
    const value = getAtPath(next, spec.path);
    if (!Array.isArray(value)) continue;

    let kept: unknown[];
    if (spec.kind === "objectList") {
      const subFields = spec.subFields ?? [];
      kept = value.filter((entry) => !isEmptyEntry(entry, subFields));
    } else if (spec.kind === "stringList") {
      kept = pruneStringList(value);
    } else {
      continue;
    }

    // Length alone is not enough: `pruneStringList` also trims survivors, which
    // changes contents without changing count.
    const changed =
      kept.length !== value.length || kept.some((item, index) => item !== value[index]);
    if (changed) {
      report?.push({ path: spec.path, removed: value.length - kept.length });
      next = setAtPath(next, spec.path, kept);
    }
  }

  return next;
}
