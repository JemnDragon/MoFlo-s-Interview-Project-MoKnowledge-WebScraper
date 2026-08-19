/**
 * POST /api/scan — run a scan and stream real pipeline progress.
 *
 * The loading state on /knowledge reports actual stages (discovery → fetching
 * [n of m] → extracting → finalizing) rather than a generic spinner, because the
 * pipeline already knows all of that and hiding it behind a fake spinner would be
 * throwing away information the user wants.
 *
 * Transport is newline-delimited JSON over a streamed response: one event per
 * line, so the client can render each as it lands without waiting for the whole
 * body. Server-Sent Events would work equally well; NDJSON avoids needing an
 * EventSource for what is a one-shot POST.
 */

import { NextRequest } from "next/server";
import { crawlSite } from "@/lib/fetch/crawl";
import {
  buildContext,
  rawToDraft,
  yearFoundedCandidates,
  yearFoundedConflict,
} from "@/lib/transform";
import { putScan } from "@/lib/db/scanCache";
import { validateUrl } from "@/lib/utils/url";
import type { ScanProgressEvent } from "@/types/scrape";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  let url: string;
  try {
    const body = (await request.json()) as { url?: unknown };
    url = typeof body.url === "string" ? body.url : "";
  } catch {
    return Response.json({ error: "Expected a JSON body with a url field." }, { status: 400 });
  }

  // Failure mode 1: malformed URL — rejected before any scrape work starts, and
  // with a normal error status rather than a stream, since there is no progress
  // to report and no partial data to preserve.
  const validation = validateUrl(url);
  if (!validation.ok) {
    return Response.json({ error: validation.reason, kind: "malformed-url" }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ScanProgressEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        const result = await crawlSite({
          requestedUrl: validation.url,
          onProgress: send,
        });

        if (!result.ok) {
          // Failure mode 2: unreachable/blocked. No partial data exists, so no
          // draft is created and the client shows an error, not a review form.
          send({ type: "error", kind: result.kind, message: result.message });
          controller.close();
          return;
        }

        send({
          type: "stage",
          stage: "finalizing",
          message: "Assembling the knowledge base draft",
        });

        const draft = rawToDraft(result.raw);
        const scanId = await putScan(result.raw);

        const warnings: string[] = [];
        if (result.raw.status === "partial") {
          // Failure mode 3: timeout mid-crawl. Everything fetched is kept.
          warnings.push(
            `The scan ran out of time with ${result.raw.failedPages.length} page(s) incomplete. Everything already fetched has been kept.`,
          );
        }
        // When two sources state different founding years, say so. Silently
        // picking one is how a wrong year reaches a reviewer looking correct.
        const yearConflict = yearFoundedConflict(yearFoundedCandidates(buildContext(result.raw)));
        if (yearConflict) {
          const others = yearConflict.rejected
            .map((candidate) => `${candidate.year} (from ${candidate.source}: "${candidate.phrase}")`)
            .join("; ");
          warnings.push(
            `Sources disagree on Year Founded. Using ${yearConflict.chosen.year} from ${yearConflict.chosen.source} — "${yearConflict.chosen.phrase}". Also found: ${others}. Prose on the About page is preferred over schema.org foundingDate, which site platforms often auto-populate with the account creation date; check the field if that looks wrong.`,
          );
        }

        if (result.raw.discovery.navLinksUnusable) {
          warnings.push(
            "No navigation link on the homepage could be classified, so discovery fell back to every in-site link. This usually means the navigation is rendered by JavaScript — which this crawler does not execute, since it fetches HTML rather than running the page.",
          );
        }
        if (result.raw.discovery.sitemapFallbackUsed.length > 0) {
          warnings.push(
            `No navigation link was found for ${result.raw.discovery.sitemapFallbackUsed.join(", ")} — those pages came from sitemap.xml instead.`,
          );
        }

        const probedPages = result.raw.discovery.candidates.filter(
          (candidate) => candidate.discoveredVia === "path-probe",
        );
        if (probedPages.length > 0) {
          warnings.push(
            `${probedPages.length} page(s) were found by trying conventional paths (${probedPages
              .map((candidate) => new URL(candidate.url).pathname)
              .join(", ")}) after nav and sitemap discovery came up empty.`,
          );
        }

        if (result.raw.discovery.unmatchedPageTypes.length > 0) {
          warnings.push(
            `This site appears to have no ${result.raw.discovery.unmatchedPageTypes.join(", ")} page. Fields that would come from those pages are marked "not found".`,
          );
        }

        // The most useful message for a genuinely thin site: say plainly that a
        // sparse profile reflects the site rather than a failed scan, so an empty
        // form doesn't read as a broken tool.
        if (result.raw.pages.length === 1) {
          warnings.push(
            "Only the homepage could be read — no other page on this site was discoverable. Most fields draw on dedicated About, Services, Team or Contact pages, so a largely empty profile here is an accurate reflection of what this site publishes, not a scan failure.",
          );
        }

        send({ type: "done", draft: { ...draft, scanId }, warnings });
      } catch (error) {
        send({
          type: "error",
          kind: "internal",
          message: error instanceof Error ? error.message : "The scan failed unexpectedly.",
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
      "X-Accel-Buffering": "no",
    },
  });
}
