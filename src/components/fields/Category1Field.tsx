"use client";

import type { FieldSpec } from "@/lib/schema/fields";
import type { DemographicDetail, SiteLanguage } from "@/types/knowledge";
import { MissingState, type MissingCause } from "@/components/shared/MissingState";

/**
 * Category 1: deterministic values. Found, or null. No wrapper, no partial state.
 *
 * The empty state is an explicit "not found — add manually" affordance rather
 * than a blank input, so the reviewer can tell the difference between "the
 * scanner found nothing" and "this input just happens to be empty right now".
 */

type Props = {
  spec: FieldSpec;
  value: unknown;
  mode: "edit" | "read";
  missingCause: MissingCause;
  onChange?: (next: unknown) => void;
};

export function Category1Field({ spec, value, mode, missingCause, onChange }: Props) {
  if (spec.kind === "language") return <LanguageField value={value} />;
  if (spec.kind === "structured") {
    return <StructuredField spec={spec} value={value} mode={mode} onChange={onChange} missingCause={missingCause} />;
  }
  if (spec.kind === "stringList") {
    return <StringListField value={value} mode={mode} onChange={onChange} missingCause={missingCause} isColor={spec.path.includes("Colors")} />;
  }

  const isEmpty = value === null || value === undefined || String(value).trim().length === 0;

  if (mode === "read") {
    if (isEmpty) return <MissingState cause={missingCause} compact />;
    if (spec.kind === "url") {
      return (
        <a
          href={String(value)}
          target="_blank"
          rel="noreferrer noopener"
          className="text-sm text-accent-600 underline decoration-dotted break-all"
        >
          {String(value)}
        </a>
      );
    }
    return <p className="text-sm leading-relaxed text-ink-900">{String(value)}</p>;
  }

  return (
    <div className="space-y-1.5">
      <input
        type={spec.kind === "number" ? "number" : spec.kind === "url" ? "url" : "text"}
        value={value === null || value === undefined ? "" : String(value)}
        placeholder={isEmpty ? "Not found — add manually" : undefined}
        onChange={(event) => {
          const raw = event.target.value;
          if (spec.kind === "number") {
            onChange?.(raw.trim() === "" ? null : Number(raw));
          } else {
            onChange?.(raw.trim() === "" ? null : raw);
          }
        }}
      />
      {isEmpty && <MissingState cause={missingCause} compact />}
    </div>
  );
}

/** Languages: deterministic, from lang/hreflang only. Read-only even in edit mode. */
function LanguageField({ value }: { value: unknown }) {
  const language = (value ?? { main: null, alternates: [] }) as SiteLanguage;
  const codes = [language.main, ...language.alternates].filter(
    (tag): tag is string => typeof tag === "string",
  );

  if (codes.length === 0) {
    return (
      <MissingState
        cause="not-found"
        compact
        action={
          <p className="text-[11px] leading-relaxed">
            This site declares no <code>lang</code> or <code>hreflang</code>. Language is never
            guessed from page copy, so it stays empty.
          </p>
        }
      />
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {codes.map((code, index) => (
        <span
          key={code}
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            index === 0 ? "bg-accent-100 text-accent-600" : "bg-ink-100 text-ink-700"
          }`}
          title={index === 0 ? "Main language (html lang)" : "Alternate (hreflang)"}
        >
          {code}
        </span>
      ))}
    </div>
  );
}

function StructuredField({
  spec,
  value,
  mode,
  onChange,
  missingCause,
}: Props) {
  const record = (value ?? {}) as Partial<DemographicDetail> & Record<string, unknown>;
  const subFields = spec.subFields ?? [];
  const allEmpty = subFields.every((sub) => {
    const current = record[sub.key];
    return current === null || current === undefined || String(current).trim().length === 0;
  });

  if (mode === "read" && allEmpty) return <MissingState cause={missingCause} compact />;

  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {subFields.map((sub) => {
        const current = record[sub.key];
        const empty = current === null || current === undefined || String(current).trim() === "";
        return (
          <label key={sub.key} className="block">
            <span className="hint">{sub.label}</span>
            {mode === "read" ? (
              <p className="text-sm text-ink-900">
                {empty ? <span className="text-ink-400">Not found</span> : String(current)}
              </p>
            ) : (
              <input
                type="text"
                value={empty ? "" : String(current)}
                placeholder="Not found"
                onChange={(event) =>
                  onChange?.({
                    ...record,
                    [sub.key]: event.target.value.trim() === "" ? null : event.target.value,
                  })
                }
              />
            )}
          </label>
        );
      })}
    </div>
  );
}

function StringListField({
  value,
  mode,
  onChange,
  missingCause,
  isColor,
}: {
  value: unknown;
  mode: "edit" | "read";
  onChange?: (next: unknown) => void;
  missingCause: MissingCause;
  isColor: boolean;
}) {
  const items = Array.isArray(value) ? (value as string[]) : [];

  if (items.length === 0 && mode === "read") return <MissingState cause={missingCause} compact />;

  if (mode === "read") {
    return (
      <ul className="flex flex-wrap gap-1.5">
        {items.map((item, index) => (
          <li
            // Not keyed on the value: two identical (or two blank) items are
            // possible mid-review, before the save-path prune runs.
            key={`${item}-${index}`}
            className="flex items-center gap-1.5 rounded-full bg-ink-100 px-2 py-0.5 text-xs text-ink-700"
          >
            {isColor && (
              <span
                aria-hidden
                className="h-3 w-3 rounded-full border border-ink-200"
                style={{ background: item }}
              />
            )}
            {item}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="space-y-1.5">
      {items.length === 0 && <MissingState cause={missingCause} compact />}
      <ul className="space-y-1.5">
        {items.map((item, index) => (
          <li key={`${item}-${index}`} className="flex items-center gap-2">
            {isColor && (
              <span
                aria-hidden
                className="h-6 w-6 shrink-0 rounded border border-ink-200"
                style={{ background: item }}
              />
            )}
            <input
              type="text"
              value={item}
              onChange={(event) => {
                const next = [...items];
                next[index] = event.target.value;
                onChange?.(next);
              }}
            />
            <button
              type="button"
              className="shrink-0 rounded border border-ink-200 px-2 py-1 text-xs text-ink-500 hover:border-danger-600 hover:text-danger-600"
              onClick={() => onChange?.(items.filter((_, i) => i !== index))}
              aria-label={`Remove ${item}`}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="rounded border border-ink-200 px-2 py-1 text-xs font-medium text-accent-600 hover:border-accent-500"
        onClick={() => onChange?.([...items, ""])}
      >
        + Add
      </button>
    </div>
  );
}
