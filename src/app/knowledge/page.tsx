"use client";

import { useState } from "react";
import type { KnowledgeBaseDraft } from "@/types/knowledge";
import type { ScanErrorKind } from "@/types/scrape";
import { validateUrl } from "@/lib/utils/url";
import { retryScan, runScan } from "@/lib/client/scanClient";
import {
  INITIAL_PROGRESS,
  ScanProgress,
  reduceProgress,
  type ProgressState,
} from "@/components/review/ScanProgress";
import { ReviewPanel } from "@/components/review/ReviewPanel";

/**
 * /knowledge — the build page.
 *
 * Three distinct failure modes, three distinct treatments:
 *   malformed URL   → caught here before any request; no draft, inline message.
 *   unreachable     → fails at fetch; no partial data exists, so no draft.
 *   timeout mid-crawl → partial draft IS created and shown, with a banner and a
 *                       retry that re-attempts only the incomplete pages.
 */
export default function KnowledgePage() {
  const [url, setUrl] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [progress, setProgress] = useState<ProgressState>(INITIAL_PROGRESS);
  const [draft, setDraft] = useState<KnowledgeBaseDraft | null>(null);
  const [scanId, setScanId] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [failure, setFailure] = useState<{ kind: ScanErrorKind; message: string } | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    // Malformed-URL check runs client-side for instant feedback. The Route
    // Handler runs the same check — the server does not trust this one.
    const validation = validateUrl(url);
    if (!validation.ok) {
      setInputError(validation.reason);
      return;
    }

    setInputError(null);
    setFailure(null);
    setDraft(null);
    setProgress(INITIAL_PROGRESS);
    setScanning(true);

    const outcome = await runScan(validation.url, (event) =>
      setProgress((current) => reduceProgress(current, event)),
    );

    setScanning(false);
    if (outcome.ok) {
      setDraft(outcome.draft);
      setScanId(outcome.scanId);
      setWarnings(outcome.warnings);
    } else {
      setFailure({ kind: outcome.kind, message: outcome.message });
    }
  };

  const handleRetry = async () => {
    if (!scanId) return;
    setRetrying(true);
    setProgress(INITIAL_PROGRESS);

    const outcome = await retryScan(scanId, (event) =>
      setProgress((current) => reduceProgress(current, event)),
    );

    setRetrying(false);
    if (outcome.ok) {
      setDraft(outcome.draft);
      setWarnings(outcome.warnings);
    } else {
      setFailure({ kind: outcome.kind, message: outcome.message });
    }
  };

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <h1 className="text-lg font-bold tracking-tight text-ink-900">
          Build a knowledge base from a website
        </h1>
        <p className="hint mt-1 max-w-2xl">
          MoKnowledge reads a company&apos;s homepage plus up to eight pages it can classify from
          the site&apos;s own navigation, and turns what it finds into a structured profile. It
          never fills a field it could not find — an absent field stays absent, and says why.
        </p>

        <form onSubmit={submit} className="mt-4 flex flex-wrap items-start gap-2">
          <div className="min-w-[260px] flex-1">
            <label htmlFor="site-url" className="field-label">
              Company website
            </label>
            <input
              id="site-url"
              type="text"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                if (inputError) setInputError(null);
              }}
              placeholder="example.com"
              aria-invalid={inputError ? true : undefined}
              aria-describedby={inputError ? "url-error" : undefined}
              className="mt-1"
            />
            {inputError && (
              <p id="url-error" className="mt-1 text-xs font-medium text-danger-600">
                {inputError}
              </p>
            )}
          </div>
          <button
            type="submit"
            disabled={scanning}
            className="mt-6 rounded-full bg-accent-500 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-ink-100 disabled:text-ink-400"
          >
            {scanning ? "Scanning…" : "Scan site"}
          </button>
        </form>
      </section>

      {(scanning || retrying) && <ScanProgress state={progress} />}

      {failure && !scanning && (
        <section className="rounded-lg border border-danger-600/25 bg-danger-100 p-5">
          <h2 className="text-sm font-bold text-danger-600">
            {failure.kind === "malformed-url"
              ? "That web address isn't valid"
              : failure.kind === "unreachable"
                ? "That site couldn't be reached"
                : failure.kind === "timeout-no-data"
                  ? "The site didn't respond in time"
                  : "The scan failed"}
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-danger-600">{failure.message}</p>
          <p className="mt-2 text-xs leading-relaxed text-danger-600/80">
            No draft was created — the scan failed before any page content was retrieved, so there
            is nothing partial to keep. Check the address and try again.
          </p>
        </section>
      )}

      {draft && !scanning && (
        <ReviewPanel
          key={draft.scan.finishedAt}
          draft={draft}
          scanId={scanId}
          warnings={warnings}
          onRetry={handleRetry}
          retrying={retrying}
        />
      )}
    </div>
  );
}
