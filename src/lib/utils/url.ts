/**
 * URL normalisation and validation.
 *
 * Malformed-URL is one of the three distinct scrape failure modes (§9) and is
 * the only one caught *before* any network call. Both the client input and the
 * Route Handler run the same check, so the client can give instant feedback
 * without the server trusting it.
 */

export type UrlValidation =
  | { ok: true; url: string; hostname: string }
  | { ok: false; reason: string };

const DISALLOWED_PROTOCOLS = new Set([
  "javascript:",
  "data:",
  "file:",
  "mailto:",
  "tel:",
  "ftp:",
]);

/** A hostname must have at least one dot and a plausible TLD. */
const HOSTNAME_PATTERN = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;

export function validateUrl(input: string): UrlValidation {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "Enter a website address." };
  }
  if (/\s/.test(trimmed)) {
    return { ok: false, reason: "A web address cannot contain spaces." };
  }

  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    return { ok: false, reason: `"${trimmed}" is not a valid web address.` };
  }

  if (DISALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return { ok: false, reason: `${parsed.protocol} addresses cannot be scanned.` };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "Only http and https addresses can be scanned." };
  }
  if (!HOSTNAME_PATTERN.test(parsed.hostname)) {
    return {
      ok: false,
      reason: `"${parsed.hostname}" does not look like a real domain name.`,
    };
  }

  parsed.hash = "";
  return { ok: true, url: parsed.toString(), hostname: parsed.hostname };
}

/** Resolves a possibly-relative href against a base, returning null on failure. */
export function absolutize(href: string, base: string): string | null {
  try {
    const resolved = new URL(href, base);
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return null;
    resolved.hash = "";
    return resolved.toString();
  } catch {
    return null;
  }
}

/** Strips trailing slash and hash so the same page isn't crawled twice. */
export function canonicalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = parsed.search === "?" ? "" : parsed.search;
    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }
    parsed.pathname = pathname;
    return parsed.toString();
  } catch {
    return url;
  }
}

export function sameRegistrableSite(a: string, b: string): boolean {
  try {
    const hostA = new URL(a).hostname.replace(/^www\./, "").toLowerCase();
    const hostB = new URL(b).hostname.replace(/^www\./, "").toLowerCase();
    return hostA === hostB;
  } catch {
    return false;
  }
}

export function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}
