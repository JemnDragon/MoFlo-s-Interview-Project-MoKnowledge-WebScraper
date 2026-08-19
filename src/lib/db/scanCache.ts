/**
 * Short-lived cache of completed scrapes, keyed by scan id.
 *
 * This is what makes "retry only the pages that didn't complete" actually true
 * rather than a relabelled full rescan. The draft alone cannot support it: it
 * records which URLs failed, but not the parsed content of the pages that
 * succeeded, so a retry driven by the draft would have to re-fetch everything.
 *
 * Cached to disk rather than memory so the retry survives a dev-server reload.
 * Entries expire; this is a cache, not storage.
 */

import "server-only";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { RawScrape } from "@/types/scrape";

const CACHE_DIR = path.join(process.cwd(), ".data", "scans");
const TTL_MS = 60 * 60 * 1000;

function fileFor(scanId: string): string {
  // Guard against path traversal via a caller-supplied id.
  const safe = scanId.replace(/[^a-zA-Z0-9-]/g, "");
  return path.join(CACHE_DIR, `${safe}.json`);
}

export async function putScan(raw: RawScrape): Promise<string> {
  const scanId = randomUUID();
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(fileFor(scanId), JSON.stringify(raw), "utf8");
  void pruneExpired();
  return scanId;
}

export async function getScan(scanId: string): Promise<RawScrape | null> {
  try {
    const contents = await readFile(fileFor(scanId), "utf8");
    return JSON.parse(contents) as RawScrape;
  } catch {
    return null;
  }
}

export async function replaceScan(scanId: string, raw: RawScrape): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(fileFor(scanId), JSON.stringify(raw), "utf8");
}

async function pruneExpired(): Promise<void> {
  try {
    const entries = await readdir(CACHE_DIR);
    const cutoff = Date.now() - TTL_MS;
    await Promise.all(
      entries.map(async (entry) => {
        const full = path.join(CACHE_DIR, entry);
        const info = await stat(full);
        if (info.mtimeMs < cutoff) await unlink(full);
      }),
    );
  } catch {
    // A cache that cannot be pruned is not a reason to fail a request.
  }
}
