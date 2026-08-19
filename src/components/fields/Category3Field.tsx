"use client";

import type { LogoEntry, OfferingEntry, PersonEntry } from "@/types/knowledge";
import type { FieldSpec, SubFieldSpec } from "@/lib/schema/fields";
import { MissingState, type MissingCause } from "@/components/shared/MissingState";
import { LogoEntryView, OfferingEntryView, PersonEntryView } from "./EntryPresentation";
import { LogoThumbnail } from "./ImageCandidateCard";

/**
 * Category 3: lists of objects with individually-nullable sub-fields.
 *
 * An empty list is a valid final state, not an error — a business with no
 * testimonials on its site simply has none. The empty state says that plainly and
 * still offers "add one manually", because the reviewer may know of entries the
 * scraper could not see.
 */

type Entry = Record<string, unknown>;

type Props = {
  spec: FieldSpec;
  value: unknown;
  mode: "edit" | "read";
  missingCause: MissingCause;
  onChange?: (next: Entry[]) => void;
};

function blankEntry(subFields: SubFieldSpec[]): Entry {
  return Object.fromEntries(
    subFields.map((sub) => [sub.key, sub.kind === "stringList" ? [] : null]),
  );
}

export function Category3Field({ spec, value, mode, missingCause, onChange }: Props) {
  const entries = Array.isArray(value) ? (value as Entry[]) : [];
  const subFields = spec.subFields ?? [];

  const update = (index: number, key: string, next: unknown) => {
    const copy = entries.map((entry, i) => (i === index ? { ...entry, [key]: next } : entry));
    onChange?.(copy);
  };

  if (entries.length === 0) {
    return (
      <div className="space-y-2">
        <MissingState
          cause={missingCause}
          compact={mode === "read"}
          action={
            mode === "edit" ? (
              <button
                type="button"
                className="rounded border border-ink-200 bg-surface px-2 py-1 text-xs font-medium text-accent-600 hover:border-accent-500"
                onClick={() => onChange?.([blankEntry(subFields)])}
              >
                + Add {spec.label.replace(/s$/, "")} manually
              </button>
            ) : undefined
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {entries.map((entry, index) => (
          <li key={index} className="rounded-lg border border-ink-200 bg-surface p-3">
            {/* Read mode uses the reference document's house format for the two
                entry types it formats distinctively; editing always uses the
                labelled grid, which is the right shape for a form. */}
            {mode === "read" && spec.entryFormat === "person" ? (
              <PersonEntryView person={entry as unknown as PersonEntry} />
            ) : mode === "read" && spec.entryFormat === "offering" ? (
              <OfferingEntryView offering={entry as unknown as OfferingEntry} />
            ) : mode === "read" && spec.entryFormat === "logo" ? (
              <LogoEntryView logo={entry as unknown as LogoEntry} />
            ) : (
              // Logos keep the labelled inputs — a URL and its alt text are
              // editable facts — but gain a thumbnail beside them, because the
              // one thing a reviewer needs to judge a logo entry is whether the
              // URL actually resolves to that company's logo, and no amount of
              // reading the string tells them that.
              <div className={spec.entryFormat === "logo" ? "flex items-start gap-3" : undefined}>
                {spec.entryFormat === "logo" && (
                  <LogoThumbnail
                    url={typeof entry["url"] === "string" ? entry["url"] : ""}
                    alt={typeof entry["alt"] === "string" ? entry["alt"] : null}
                  />
                )}
                <div className="grid flex-1 gap-2 sm:grid-cols-2">
                  {subFields.map((sub) => (
                    <SubField
                      key={sub.key}
                      sub={sub}
                      value={entry[sub.key]}
                      mode={mode}
                      onChange={(next) => update(index, sub.key, next)}
                    />
                  ))}
                </div>
              </div>
            )}
            {mode === "edit" && (
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  className="rounded border border-ink-200 px-2 py-1 text-xs text-ink-500 hover:border-danger-600 hover:text-danger-600"
                  onClick={() => onChange?.(entries.filter((_, i) => i !== index))}
                >
                  Remove entry
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {mode === "edit" && (
        <button
          type="button"
          className="rounded border border-ink-200 bg-surface px-2 py-1 text-xs font-medium text-accent-600 hover:border-accent-500"
          onClick={() => onChange?.([...entries, blankEntry(subFields)])}
        >
          + Add {spec.label.replace(/s$/, "")}
        </button>
      )}
    </div>
  );
}

function SubField({
  sub,
  value,
  mode,
  onChange,
}: {
  sub: SubFieldSpec;
  value: unknown;
  mode: "edit" | "read";
  onChange: (next: unknown) => void;
}) {
  const isList = sub.kind === "stringList";
  const listValue = Array.isArray(value) ? (value as string[]) : [];
  const empty = isList
    ? listValue.length === 0
    : value === null || value === undefined || String(value).trim().length === 0;

  const wrapperClass = sub.kind === "longText" ? "sm:col-span-2" : undefined;

  if (mode === "read") {
    return (
      <div className={wrapperClass}>
        <span className="hint">{sub.label}</span>
        {empty ? (
          <p className="text-sm text-ink-400">Not found</p>
        ) : isList ? (
          <ul className="flex flex-wrap gap-1">
            {listValue.map((item, index) => (
              <li
                key={`${item}-${index}`}
                className="rounded bg-ink-100 px-1.5 py-0.5 text-xs text-ink-700"
              >
                {item}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm leading-relaxed text-ink-900">{String(value)}</p>
        )}
      </div>
    );
  }

  return (
    <label className={`block ${wrapperClass ?? ""}`}>
      <span className="hint">{sub.label}</span>
      {isList ? (
        <input
          type="text"
          value={listValue.join(", ")}
          placeholder="Comma-separated, or leave blank"
          onChange={(event) =>
            onChange(
              event.target.value
                .split(",")
                .map((part) => part.trim())
                .filter((part) => part.length > 0),
            )
          }
        />
      ) : sub.kind === "longText" ? (
        <textarea
          value={empty ? "" : String(value)}
          placeholder="Not found"
          onChange={(event) => onChange(event.target.value.trim() === "" ? null : event.target.value)}
        />
      ) : (
        <input
          type={sub.kind === "number" ? "number" : sub.kind === "url" ? "url" : "text"}
          value={empty ? "" : String(value)}
          placeholder="Not found"
          onChange={(event) => {
            const raw = event.target.value;
            if (sub.kind === "number") onChange(raw.trim() === "" ? null : Number(raw));
            else onChange(raw.trim() === "" ? null : raw);
          }}
        />
      )}
    </label>
  );
}
