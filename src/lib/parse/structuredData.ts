/**
 * Structured metadata: JSON-LD, Open Graph, and plain meta tags.
 *
 * No library needed beyond JSON.parse — these are already machine-readable, which
 * is exactly why they are the highest-confidence source for Category 1 fields.
 * Anything sourced from here is a stated fact, not an inference from prose.
 */

import * as cheerio from "cheerio";
import type { StructuredData } from "@/types/scrape";
import { collapseWhitespace } from "@/lib/utils/text";

/** JSON-LD often wraps everything in an @graph array; flatten it out. */
function flattenGraph(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(flattenGraph);
  if (typeof value !== "object" || value === null) return [];

  const record = value as Record<string, unknown>;
  const graph = record["@graph"];
  if (Array.isArray(graph)) {
    return [...graph.flatMap(flattenGraph), omitGraph(record)];
  }
  return [record];
}

function omitGraph(record: Record<string, unknown>): Record<string, unknown> {
  const { ["@graph"]: _graph, ...rest } = record;
  return rest;
}

export function parseStructuredData($: cheerio.CheerioAPI): StructuredData {
  const jsonLd: Record<string, unknown>[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw.trim()) return;
    try {
      jsonLd.push(...flattenGraph(JSON.parse(raw)));
    } catch {
      // Malformed JSON-LD is extremely common in the wild. Skipping one block is
      // correct; there is nothing to salvage and nothing to guess.
    }
  });

  const openGraph: Record<string, string> = {};
  const meta: Record<string, string> = {};

  $("meta").each((_, el) => {
    const content = $(el).attr("content");
    if (!content) return;
    const value = collapseWhitespace(content);
    if (!value) return;

    const property = $(el).attr("property");
    const name = $(el).attr("name");

    if (property && /^(og|twitter|article|business|place):/i.test(property)) {
      openGraph[property.toLowerCase()] = value;
    } else if (name && /^(og|twitter):/i.test(name)) {
      openGraph[name.toLowerCase()] = value;
    } else if (name) {
      meta[name.toLowerCase()] = value;
    }
  });

  return { jsonLd, openGraph, meta };
}

/** Finds the first JSON-LD node whose @type matches any of `types`. */
export function findJsonLdByType(
  jsonLd: Record<string, unknown>[],
  types: string[],
): Record<string, unknown> | null {
  const wanted = new Set(types.map((type) => type.toLowerCase()));
  for (const node of jsonLd) {
    const rawType = node["@type"];
    const typeList = Array.isArray(rawType) ? rawType : [rawType];
    const match = typeList.some(
      (type) => typeof type === "string" && wanted.has(type.toLowerCase()),
    );
    if (match) return node;
  }
  return null;
}

export function jsonLdString(node: Record<string, unknown> | null, key: string): string | null {
  if (!node) return null;
  const value = node[key];
  if (typeof value === "string" && value.trim().length > 0) return collapseWhitespace(value);
  if (typeof value === "number") return String(value);
  return null;
}
