/**
 * Main-content extraction with @mozilla/readability (over a jsdom document).
 *
 * Why not just `$('body').text()` with cheerio? Because narrative fields —
 * Overview, Founding Story, Writing Style — get badly polluted by nav labels,
 * cookie banners, footer link farms and "© 2024 All rights reserved". Readability
 * is purpose-built to find the article body and drop the furniture. cheerio still
 * does all the *structural* selection elsewhere; the two are complementary.
 */

import "server-only";
import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import { collapseWhitespace, toParagraphs } from "@/lib/utils/text";

export type MainContent = {
  title: string | null;
  text: string | null;
  paragraphs: string[];
  excerpt: string | null;
  byline: string | null;
};

const EMPTY: MainContent = {
  title: null,
  text: null,
  paragraphs: [],
  excerpt: null,
  byline: null,
};

/**
 * jsdom logs a great deal of noise about CSS it cannot parse on real-world
 * sites. None of it is actionable, so it is silenced rather than spammed.
 */
function quietConsole(): VirtualConsole {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", () => {});
  virtualConsole.on("error", () => {});
  virtualConsole.on("warn", () => {});
  return virtualConsole;
}

export function extractMainContent(html: string, url: string): MainContent {
  let dom: JSDOM;
  try {
    dom = new JSDOM(html, { url, virtualConsole: quietConsole() });
  } catch {
    return EMPTY;
  }

  try {
    const reader = new Readability(dom.window.document, {
      charThreshold: 120,
      keepClasses: false,
    });
    const article = reader.parse();

    if (!article) return fallbackContent(dom);

    const text = collapseWhitespace(article.textContent ?? "");
    return {
      title: article.title ? collapseWhitespace(article.title) : null,
      text: text.length > 0 ? text : null,
      paragraphs: paragraphsFromArticleHtml(article.content ?? "", dom),
      excerpt: article.excerpt ? collapseWhitespace(article.excerpt) : null,
      byline: article.byline ? collapseWhitespace(article.byline) : null,
    };
  } catch {
    return fallbackContent(dom);
  } finally {
    dom.window.close();
  }
}

/**
 * Readability gives up on very short pages — common for SMB "Contact" pages that
 * are mostly a form. Falling back to the largest text container is better than
 * returning nothing, and it is still boilerplate-aware (main/article first).
 */
function fallbackContent(dom: JSDOM): MainContent {
  const doc = dom.window.document;
  for (const selector of ["main", "article", '[role="main"]', "body"]) {
    const el = doc.querySelector(selector);
    if (!el) continue;
    el.querySelectorAll("nav, header, footer, script, style, noscript").forEach((node) =>
      node.remove(),
    );
    const raw = el.textContent ?? "";
    const text = collapseWhitespace(raw);
    if (text.length === 0) continue;
    const paragraphs = Array.from(el.querySelectorAll("p, li"))
      .map((node) => collapseWhitespace(node.textContent ?? ""))
      .filter((value) => value.length > 0);
    return {
      title: doc.title ? collapseWhitespace(doc.title) : null,
      text,
      paragraphs: paragraphs.length > 0 ? paragraphs : toParagraphs(raw),
      excerpt: null,
      byline: null,
    };
  }
  return EMPTY;
}

function paragraphsFromArticleHtml(articleHtml: string, dom: JSDOM): string[] {
  if (!articleHtml) return [];
  const container = dom.window.document.createElement("div");
  container.innerHTML = articleHtml;
  const paragraphs = Array.from(container.querySelectorAll("p, li, blockquote"))
    .map((node) => collapseWhitespace(node.textContent ?? ""))
    .filter((value) => value.length > 0);
  return paragraphs;
}
