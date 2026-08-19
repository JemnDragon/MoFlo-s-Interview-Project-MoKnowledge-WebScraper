"use client";

import type { ScanProgressEvent } from "@/types/scrape";

/**
 * Real staged progress, not a spinner.
 *
 * The pipeline already knows which stage it is in and how many of how many pages
 * have been fetched, so reporting anything vaguer would be discarding
 * information the person waiting actively wants. Failed pages are surfaced as
 * they happen rather than saved up for the end.
 */

export type ProgressState = {
  stage: string;
  message: string;
  completed: number;
  total: number;
  failures: { url: string; message: string }[];
};

export const INITIAL_PROGRESS: ProgressState = {
  stage: "validating",
  message: "Checking the web address",
  completed: 0,
  total: 0,
  failures: [],
};

export function reduceProgress(state: ProgressState, event: ScanProgressEvent): ProgressState {
  switch (event.type) {
    case "stage":
      return { ...state, stage: event.stage, message: event.message };
    case "page-progress":
      return {
        ...state,
        stage: "fetching",
        message: `Fetching pages (${event.completed} of ${event.total})`,
        completed: event.completed,
        total: event.total,
      };
    case "page-failed":
      return {
        ...state,
        failures: [...state.failures, { url: event.url, message: event.message }],
      };
    default:
      return state;
  }
}

const STAGES: { id: string; label: string }[] = [
  { id: "validating", label: "Checking address" },
  { id: "discovering", label: "Discovering pages" },
  { id: "fetching", label: "Fetching pages" },
  { id: "extracting", label: "Extracting data" },
  { id: "finalizing", label: "Finalising draft" },
];

export function ScanProgress({ state }: { state: ProgressState }) {
  const activeIndex = Math.max(
    0,
    STAGES.findIndex((stage) => stage.id === state.stage),
  );

  return (
    <div className="card p-5">
      <h2 className="text-sm font-bold text-ink-900">Scanning</h2>
      <p className="hint mt-0.5">{state.message}</p>

      <ol className="mt-4 space-y-2">
        {STAGES.map((stage, index) => {
          const done = index < activeIndex;
          const active = index === activeIndex;
          return (
            <li key={stage.id} className="flex items-center gap-2.5">
              <span
                aria-hidden
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  done
                    ? "bg-good-100 text-good-600"
                    : active
                      ? "bg-accent-500 text-white"
                      : "bg-ink-100 text-ink-400"
                }`}
              >
                {done ? "✓" : index + 1}
              </span>
              <span
                className={`text-sm ${active ? "font-semibold text-ink-900" : done ? "text-ink-500" : "text-ink-400"}`}
              >
                {stage.label}
                {stage.id === "fetching" && state.total > 0 && (
                  <span className="ml-1.5 text-xs text-ink-500">
                    {state.completed} / {state.total}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>

      {state.total > 0 && (
        <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
          <div
            className="h-full rounded-full bg-accent-500 transition-all"
            style={{ width: `${Math.round((state.completed / state.total) * 100)}%` }}
          />
        </div>
      )}

      {state.failures.length > 0 && (
        <div className="mt-4 rounded-lg border border-mock-500/30 bg-mock-100 p-3">
          <p className="text-xs font-semibold text-mock-600">
            {state.failures.length} page{state.failures.length === 1 ? "" : "s"} couldn&apos;t be
            fetched
          </p>
          <ul className="mt-1 space-y-0.5">
            {state.failures.map((failure) => (
              <li key={failure.url} className="text-[11px] leading-relaxed text-mock-600">
                <span className="font-mono">{failure.url}</span> — {failure.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
