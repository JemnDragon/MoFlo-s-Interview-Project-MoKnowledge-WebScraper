/**
 * POST /api/scan/retry — re-attempt only the pages that didn't complete.
 *
 * Not a rescan. The cached RawScrape holds the pages that already parsed
 * successfully, so this re-fetches strictly the failed URLs and merges them into
 * the existing result before re-running the transform. A site that timed out on
 * one slow Team page does not pay for a second full crawl.
 */

import { NextRequest } from "next/server";
import { crawlSite } from "@/lib/fetch/crawl";
import { rawToDraft } from "@/lib/transform";
import { getScan, replaceScan } from "@/lib/db/scanCache";
import type { ScanProgressEvent } from "@/types/scrape";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  let scanId: string;
  try {
    const body = (await request.json()) as { scanId?: unknown };
    scanId = typeof body.scanId === "string" ? body.scanId : "";
  } catch {
    return Response.json({ error: "Expected a JSON body with a scanId field." }, { status: 400 });
  }

  const previous = await getScan(scanId);
  if (!previous) {
    return Response.json(
      {
        error:
          "That scan is no longer cached, so only the incomplete pages can't be identified. Run a fresh scan instead.",
      },
      { status: 404 },
    );
  }

  if (previous.failedPages.length === 0) {
    return Response.json({ error: "That scan has no incomplete pages to retry." }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ScanProgressEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        const result = await crawlSite({
          requestedUrl: previous.resolvedUrl,
          onProgress: send,
          resume: { pages: previous.pages, failedPages: previous.failedPages },
        });

        if (!result.ok) {
          send({ type: "error", kind: result.kind, message: result.message });
          controller.close();
          return;
        }

        // Preserve the original discovery record — the resumed crawl doesn't
        // redo discovery, so its own discovery field is empty by construction.
        const merged = { ...result.raw, discovery: previous.discovery };
        await replaceScan(scanId, merged);

        send({ type: "stage", stage: "finalizing", message: "Rebuilding the draft" });

        const warnings =
          merged.failedPages.length > 0
            ? [
                `${merged.failedPages.length} page(s) still didn't complete. Everything else has been merged into the draft.`,
              ]
            : [];

        send({ type: "done", draft: { ...rawToDraft(merged), scanId }, warnings });
      } catch (error) {
        send({
          type: "error",
          kind: "internal",
          message: error instanceof Error ? error.message : "The retry failed unexpectedly.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
    },
  });
}
