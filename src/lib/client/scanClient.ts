"use client";

/**
 * Client-side reader for the NDJSON progress stream.
 *
 * Kept separate from the components so the loading UI is a pure function of the
 * events it receives, and so the same reader serves both /api/scan and
 * /api/scan/retry.
 */

import type { KnowledgeBaseDraft } from "@/types/knowledge";
import type { ScanErrorKind, ScanProgressEvent } from "@/types/scrape";

export type ScanOutcome =
  | { ok: true; draft: KnowledgeBaseDraft; scanId: string | null; warnings: string[] }
  | { ok: false; kind: ScanErrorKind; message: string };

async function readStream(
  response: Response,
  onEvent: (event: ScanProgressEvent) => void,
): Promise<ScanOutcome> {
  if (!response.ok && response.headers.get("content-type")?.includes("application/json")) {
    const body = (await response.json()) as { error?: string; kind?: ScanErrorKind };
    return {
      ok: false,
      kind: body.kind ?? "internal",
      message: body.error ?? "The scan could not be started.",
    };
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return { ok: false, kind: "internal", message: "The server returned no response body." };
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let outcome: ScanOutcome | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim().length === 0) continue;
      let event: ScanProgressEvent;
      try {
        event = JSON.parse(line) as ScanProgressEvent;
      } catch {
        continue;
      }
      onEvent(event);

      if (event.type === "done") {
        const payload = event.draft as KnowledgeBaseDraft & { scanId?: string };
        outcome = {
          ok: true,
          draft: payload,
          scanId: payload.scanId ?? null,
          warnings: event.warnings,
        };
      } else if (event.type === "error") {
        outcome = { ok: false, kind: event.kind, message: event.message };
      }
    }
  }

  return outcome ?? { ok: false, kind: "internal", message: "The scan ended without a result." };
}

export async function runScan(
  url: string,
  onEvent: (event: ScanProgressEvent) => void,
): Promise<ScanOutcome> {
  const response = await fetch("/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  return readStream(response, onEvent);
}

export async function retryScan(
  scanId: string,
  onEvent: (event: ScanProgressEvent) => void,
): Promise<ScanOutcome> {
  const response = await fetch("/api/scan/retry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scanId }),
  });
  return readStream(response, onEvent);
}
