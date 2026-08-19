"use client";

import { useState } from "react";
import type { CustomSection } from "@/types/knowledge";

/**
 * Freeform reviewer notes.
 *
 * Sits outside the field registry that drives every other block on this page,
 * because it sits outside the Category 1/2/3 taxonomy — that taxonomy describes
 * how a value was *extracted*, and nothing here is extracted. The practical
 * consequence is the useful one: being outside the registry keeps these notes
 * out of completeness scoring and required-field validation automatically,
 * rather than by adding an exception to both.
 *
 * So there is no source-snippet panel, no mock placeholder, and no
 * reviewed/unreviewed pill. Text written from scratch has nothing to be reviewed
 * against, and showing an "Unreviewed" badge on something the reviewer just
 * typed would be nonsense.
 *
 * Scope is title + text, deliberately. Anything resembling a form builder —
 * user-defined field types, structured sub-fields, per-field validation — is a
 * much larger feature with migration consequences for every stored record, and
 * would be designed separately rather than grown out of this.
 */

function newSection(): CustomSection {
  return {
    // Timestamped when the reviewer adds it, not when the scan ran.
    id: globalThis.crypto?.randomUUID?.() ?? `note-${Date.now()}`,
    title: "",
    content: "",
    createdAt: new Date().toISOString(),
  };
}

export function CustomSectionsEditor({
  sections,
  onChange,
}: {
  sections: CustomSection[];
  onChange: (next: CustomSection[]) => void;
}) {
  const [adding, setAdding] = useState(false);

  const update = (id: string, patch: Partial<CustomSection>) => {
    onChange(sections.map((section) => (section.id === id ? { ...section, ...patch } : section)));
  };

  const add = () => {
    onChange([...sections, newSection()]);
    setAdding(true);
  };

  return (
    <section className="card p-4" aria-labelledby="custom-sections">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 id="custom-sections" className="text-sm font-bold tracking-tight text-ink-900">
          Your notes
        </h3>
        <span className="rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-500">
          Not scored
        </span>
      </div>
      <p className="hint mb-3">
        Anything the scan could not know — context from a phone call, a caveat about the business,
        a reminder for whoever picks this up next. Saved with the knowledge base, and deliberately
        excluded from the completeness score.
      </p>

      {sections.length === 0 && !adding && (
        <p className="hint mb-3 rounded-lg border border-dashed border-ink-200 bg-ink-50 px-3 py-2">
          No notes yet.
        </p>
      )}

      {sections.length > 0 && (
        <ul className="mb-3 space-y-2">
          {sections.map((section) => (
            <li key={section.id} className="rounded-lg border border-ink-200 bg-surface p-3">
              <label className="block">
                <span className="hint">Title</span>
                <input
                  type="text"
                  value={section.title}
                  placeholder="What is this note about?"
                  onChange={(event) => update(section.id, { title: event.target.value })}
                />
              </label>
              <label className="mt-2 block">
                <span className="hint">Note</span>
                <textarea
                  value={section.content}
                  placeholder="Write anything useful here."
                  onChange={(event) => update(section.id, { content: event.target.value })}
                />
              </label>
              <div className="mt-2 flex items-center justify-between gap-2">
                <time className="text-[10px] text-ink-400" dateTime={section.createdAt}>
                  Added {new Date(section.createdAt).toLocaleString()}
                </time>
                <button
                  type="button"
                  className="rounded border border-ink-200 px-2 py-1 text-xs text-ink-500 hover:border-danger-600 hover:text-danger-600"
                  onClick={() => onChange(sections.filter((other) => other.id !== section.id))}
                >
                  Remove note
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={add}
        className="rounded-full border border-ink-200 bg-surface px-3 py-1.5 text-xs font-semibold text-accent-600 hover:border-accent-500"
      >
        + Add a note
      </button>
    </section>
  );
}

/**
 * Read-only rendering for the Detailed view. Renders nothing at all when there
 * are no notes — an empty "Your notes" heading would be noise, and unlike a
 * scraped field there is no meaningful "absent" state to report: the reviewer
 * simply did not write one.
 */
export function CustomSectionsView({ sections }: { sections: CustomSection[] }) {
  const usable = sections.filter(
    (section) => section.title.trim().length > 0 || section.content.trim().length > 0,
  );
  if (usable.length === 0) return null;

  return (
    <section className="card p-4" aria-labelledby="custom-sections-view">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 id="custom-sections-view" className="text-sm font-bold tracking-tight text-ink-900">
          Your notes
        </h3>
        <span className="rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-500">
          Written by a reviewer · not scraped, not scored
        </span>
      </div>

      <ul className="space-y-3">
        {usable.map((section) => (
          <li key={section.id} className="border-t border-ink-100 pt-3 first:border-t-0 first:pt-0">
            <p className="text-sm font-bold text-ink-900">
              {section.title.trim() || <span className="text-ink-400">Untitled note</span>}
            </p>
            {section.content.trim() && (
              <p className="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-ink-700">
                {section.content}
              </p>
            )}
            <time className="mt-1 block text-[10px] text-ink-400" dateTime={section.createdAt}>
              Added {new Date(section.createdAt).toLocaleString()}
            </time>
          </li>
        ))}
      </ul>
    </section>
  );
}
