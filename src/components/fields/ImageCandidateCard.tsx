"use client";

import { useState } from "react";

/**
 * One located image: thumbnail, provenance, and links to open or save it.
 *
 * Shared by the Art Style evidence panel in the review UI
 * (`ImageEvidenceList`) and the Logos list in the read-only Detailed view
 * (`LogoEntryView`), because those two render the *same images* — Art Style and
 * Logos both read one `logoCandidates()` call in the transform layer.
 *
 * That shared derivation is what makes the Detailed view possible at all.
 * `Category2VisualField` is a draft-only shape: the saved `KnowledgeBase`
 * stores Art Style as a plain resolved string, so the image evidence is gone by
 * the time Detailed view renders it. The URLs survive because `logos` is a
 * Category 1/3 field that *is* persisted — same set, different field.
 *
 * Plain `<img>` rather than `next/image`, deliberately: `next/image` requires
 * every remote host to be declared in `next.config.ts` ahead of time, and the
 * hostname here is whatever the user typed thirty seconds ago.
 */

export type ImageCandidate = {
  url: string;
  alt: string | null;
  detectedVia: string | null;
  /** Page the image was referenced from. Omitted in the saved-record view. */
  sourceUrl?: string | null;
};

/**
 * A logo in a fixed square box, shrunk to fit and never stretched.
 *
 * The same rule the card grid uses, and for the same reason: real logos in this
 * corpus run from a 32×32 favicon to a 2500×785 wordmark, and any rule other
 * than "contain inside a consistent container" makes one of those two look
 * broken. `object-contain` plus matching `max-h`/`max-w` is what keeps a wide
 * wordmark and a square icon sitting on the same baseline.
 *
 * Reports its own load failure upward so callers can fall back to the URL text
 * — a broken-image icon reads as "this app is broken" rather than "this site's
 * asset is gone", which is the actual finding.
 */
export function LogoThumbnail({
  url,
  alt,
  size = 16,
  onFailed,
}: {
  url: string;
  alt: string | null;
  /** Tailwind spacing step, so the box and the max dimensions cannot drift apart. */
  size?: 11 | 16;
  onFailed?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const box = size === 11 ? "h-11 w-11" : "h-16 w-16";
  const cap = size === 11 ? "max-h-11 max-w-11" : "max-h-16 max-w-16";

  return (
    <span
      className={`flex ${box} shrink-0 items-center justify-center overflow-hidden rounded border border-ink-200 bg-surface`}
    >
      {failed || !url ? (
        <span className="px-1 text-center text-[9px] leading-tight text-ink-400">
          Could not load
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote host; see file header
        <img
          src={url}
          alt={alt ?? ""}
          referrerPolicy="no-referrer"
          loading="lazy"
          className={`${cap} object-contain`}
          onError={() => {
            setFailed(true);
            onFailed?.();
          }}
        />
      )}
    </span>
  );
}

export function ImageCandidateCard({ image }: { image: ImageCandidate }) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="flex gap-2.5">
      <a
        href={image.url}
        target="_blank"
        rel="noreferrer noopener"
        className="shrink-0"
        title="Open full size"
      >
        <LogoThumbnail url={image.url} alt={image.alt} onFailed={() => setFailed(true)} />
      </a>

      <div className="min-w-0 flex-1 text-xs">
        {image.detectedVia && (
          <span className="rounded bg-accent-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-600">
            {image.detectedVia}
          </span>
        )}
        {/* The site's own caption, reproduced as a caption. Not presented as a
            description of the art style — that is the distinction the Art Style
            field was rebuilt around. */}
        {image.alt ? (
          <p className="mt-0.5 leading-relaxed text-ink-700">
            <span className="text-ink-400">alt:</span> {image.alt}
          </p>
        ) : (
          <p className="mt-0.5 text-ink-400">No alt text published.</p>
        )}
        {/* When the image will not load, the URL itself is the finding, so it is
            shown rather than left implicit behind a link label. */}
        {failed && <p className="mt-0.5 break-all text-[10px] text-ink-400">{image.url}</p>}

        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <a
            href={image.url}
            download={filenameFor(image.url)}
            target="_blank"
            rel="noreferrer noopener"
            className="text-[10px] font-medium text-accent-600 underline decoration-dotted"
            // Honest about a browser rule rather than pretending it away: the
            // `download` attribute is ignored cross-origin, and every candidate
            // here is cross-origin by definition. On most hosts this opens the
            // image, from where the browser's own save is one click away.
            title="Opens the image directly; some hosts will open rather than save it"
          >
            Save image
          </a>
          {image.sourceUrl && (
            <a
              href={image.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="min-w-0 flex-1 truncate text-[10px] text-ink-400 underline decoration-dotted"
            >
              {image.sourceUrl}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * A filename hint for the save dialog, taken from the URL's last path segment.
 *
 * Only a hint: it is honoured same-origin and ignored cross-origin, which is
 * every case here. Worth setting anyway — it costs nothing and it is correct on
 * the day someone points this at a locally-served fixture.
 */
function filenameFor(url: string): string | undefined {
  try {
    const name = new URL(url).pathname.split("/").filter(Boolean).pop();
    return name && /\.[a-z0-9]{2,5}$/i.test(name) ? name : undefined;
  } catch {
    return undefined;
  }
}
