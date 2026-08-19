"use client";

/**
 * Empty states that say WHY something is empty.
 *
 * Four different causes, four different messages. Collapsing them into one
 * "No data" is the fastest way to make a reviewer distrust the whole record —
 * they cannot tell whether the scraper failed, the site is silent, or they hid
 * it themselves five minutes ago.
 */

export type MissingCause =
  | "not-found"
  | "no-page-found"
  | "scan-incomplete"
  | "hidden"
  | "unreviewed";

const COPY: Record<MissingCause, { label: string; detail: string; tone: string }> = {
  "not-found": {
    label: "Not found",
    detail: "The pages that were scanned didn't state this. Add it manually if you know it.",
    tone: "border-ink-200 bg-ink-50 text-ink-500",
  },
  "no-page-found": {
    label: "No source page",
    detail:
      "This site appears to have no page of the type this field is read from, so there was nothing to read.",
    tone: "border-ink-200 bg-ink-50 text-ink-500",
  },
  "scan-incomplete": {
    label: "Scan didn't finish",
    detail:
      "The page this would come from never loaded before the scan ran out of time. Retrying the incomplete pages may fill it in.",
    tone: "border-partial-600/30 bg-partial-100 text-partial-600",
  },
  hidden: {
    label: "Hidden by you",
    detail: "This section is hidden on this profile. The underlying data is still stored.",
    tone: "border-hidden-600/25 bg-hidden-100 text-hidden-600",
  },
  unreviewed: {
    label: "Awaiting review",
    detail:
      "This still holds the mock placeholder. Placeholder text is never saved — replace it with real content.",
    tone: "border-mock-500/35 bg-mock-100 text-mock-600",
  },
};

export function MissingState({
  cause,
  action,
  compact = false,
}: {
  cause: MissingCause;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  const copy = COPY[cause];
  return (
    <div className={`rounded-lg border border-dashed px-3 py-2 ${copy.tone}`}>
      <p className="text-xs font-semibold">{copy.label}</p>
      {!compact && <p className="mt-0.5 text-xs leading-relaxed opacity-90">{copy.detail}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function MissingBadge({ cause }: { cause: MissingCause }) {
  const copy = COPY[cause];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${copy.tone}`}
      title={copy.detail}
    >
      {copy.label}
    </span>
  );
}
