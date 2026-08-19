"use client";

import { useState } from "react";
import type { Snippet } from "@/types/knowledge";
import type { SnippetDisplay } from "@/lib/schema/fields";

/**
 * Source-tagged snippet display.
 *
 * Extractive fields show their single snippet expanded — there is one passage and
 * the reviewer needs to see it. Synthesis fields collapse, because six passages
 * from six pages would bury the editor they are meant to support. The `source`
 * tag on every snippet is what powers the "found on: About, Homepage" line.
 */
export function SnippetList({
  snippets,
  display,
}: {
  snippets: Snippet[];
  display: SnippetDisplay;
}) {
  const [expanded, setExpanded] = useState(display === "expanded");

  if (snippets.length === 0) return null;

  const sources = Array.from(new Set(snippets.map((snippet) => snippet.source)));

  return (
    <div className="rounded-lg border border-ink-200 bg-ink-50">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
          {snippets.length} source snippet{snippets.length === 1 ? "" : "s"} · found on:{" "}
          {sources.join(", ")}
        </span>
        <span aria-hidden className="text-xs text-ink-400">
          {expanded ? "Hide" : "Show"}
        </span>
      </button>

      {expanded && (
        <ul className="space-y-2 border-t border-ink-200 px-3 py-2">
          {snippets.map((snippet, index) => (
            <li key={`${snippet.sourceUrl}-${index}`} className="text-xs">
              <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
                <span className="rounded bg-accent-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-600">
                  {snippet.source}
                </span>
                <a
                  href={snippet.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="truncate text-[10px] text-ink-400 underline decoration-dotted"
                >
                  {snippet.sourceUrl}
                </a>
              </div>
              <p className="leading-relaxed text-ink-700">{snippet.text}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
