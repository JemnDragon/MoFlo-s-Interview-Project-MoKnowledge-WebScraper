/**
 * Headless scrape, for testing the pipeline without the UI.
 *
 *   npm run scrape -- https://example.com
 *   npm run scrape -- https://example.com --out ./examples/real-scan.json
 *   npm run scrape -- https://example.com --raw   # dump the RawScrape instead
 *
 * Useful because the entire extraction path is separable from React: crawl →
 * parse → transform is plain TypeScript, so it can be exercised, diffed and
 * regression-tested from the command line.
 */

import { writeFile } from "node:fs/promises";
import { crawlSite } from "../src/lib/fetch/crawl";
import {
  buildContext,
  industryGroupingCandidates,
  rawToDraft,
  yearFoundedCandidates,
} from "../src/lib/transform";
import { computeCompleteness } from "../src/lib/validate/completeness";

async function main() {
  const args = process.argv.slice(2);
  const url = args.find((arg) => !arg.startsWith("--"));
  const outIndex = args.indexOf("--out");
  const outPath = outIndex >= 0 ? args[outIndex + 1] : undefined;
  const wantRaw = args.includes("--raw");

  if (!url) {
    console.error("Usage: npm run scrape -- <url> [--out file.json] [--raw]");
    process.exit(1);
  }

  const result = await crawlSite({
    requestedUrl: url,
    onProgress: (event) => {
      if (event.type === "stage") console.error(`  [${event.stage}] ${event.message}`);
      if (event.type === "page-progress") {
        console.error(`  [fetching] ${event.completed}/${event.total} ${event.currentUrl}`);
      }
      if (event.type === "page-failed") console.error(`  [failed] ${event.url} — ${event.message}`);
    },
  });

  if (!result.ok) {
    console.error(`\nScan failed (${result.kind}): ${result.message}`);
    process.exit(1);
  }

  const draft = rawToDraft(result.raw);
  const completeness = computeCompleteness(draft);

  console.error(`\nStatus:       ${result.raw.status}`);
  console.error(`Pages read:   ${result.raw.pages.length}`);
  console.error(`Pages failed: ${result.raw.failedPages.length}`);
  console.error(`Completeness: ${completeness.score}% (${completeness.populated}/${completeness.counted})`);
  console.error(
    `Absent:       ${completeness.missing.map((field) => field.label).join(", ") || "none"}`,
  );

  const context = buildContext(result.raw);

  // Provenance for the field most likely to be wrong-but-plausible. Shows every
  // candidate the site offered and which one won, so a suspicious value can be
  // traced to its source without guessing.
  const years = yearFoundedCandidates(context);
  console.error(`\nYear Founded candidates (${years.length}):`);
  if (years.length === 0) {
    console.error("  none — no schema.org foundingDate and no founding phrase on About/homepage");
  }
  years.forEach((candidate, index) => {
    console.error(
      `  ${index === 0 ? "USED  " : "      "}${candidate.year}  [${candidate.source}/${candidate.strength}]  "${candidate.phrase}"`,
    );
  });

  // Raw-candidate provenance for the fields where the symptom (a blank row, a
  // "Close" button) is visible in the UI but the *cause* is upstream. Printing
  // the value at the point of extraction, before cleaning, is the only way to
  // tell "it was never there" apart from "something downstream stripped it" —
  // the two look identical in the rendered output.
  const rawGroupings = industryGroupingCandidates(context);
  console.error(`\nIndustry Groupings candidates (${rawGroupings.length} raw):`);
  if (rawGroupings.length === 0) {
    console.error("  none — no service-page headings and no schema.org category");
  }
  for (const candidate of rawGroupings) {
    const verdict = candidate.kept ? "KEPT  " : `DROP  (${candidate.droppedBecause})`;
    // JSON.stringify so zero-width characters are visible as escapes rather than
    // printing as an empty pair of quotes — the entire point of this line.
    console.error(
      `  ${verdict.padEnd(22)} ${JSON.stringify(candidate.raw)}  [${candidate.origin}]`,
    );
  }

  // What survived into CTAs, so chrome leaking back in is visible at a glance
  // rather than only in the rendered review UI.
  const ctaLabels = draft.marketAndCustomers.ctas.map((cta) => cta.label ?? "");
  console.error(`\nCTAs kept (${ctaLabels.length}):`);
  console.error(`  ${ctaLabels.map((label) => JSON.stringify(label)).join(", ") || "none"}`);

  const payload = JSON.stringify(wantRaw ? result.raw : draft, null, 2);
  if (outPath) {
    await writeFile(outPath, payload, "utf8");
    console.error(`\nWritten to ${outPath}`);
  } else {
    process.stdout.write(`${payload}\n`);
  }
}

void main();
