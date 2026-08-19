"use client";

import type { ImageEvidence } from "@/types/knowledge";
import { ImageCandidateCard } from "./ImageCandidateCard";

/**
 * The evidence panel for Art Style: the images themselves.
 *
 * `SnippetList`'s counterpart. Every other Category 2 field shows source-tagged
 * text beside its editor because the reviewer's job there is to condense text
 * they can read. Art Style's job is to describe pictures, so showing text would
 * be showing the wrong thing — the reviewer would be describing alt attributes
 * instead of a brand.
 *
 * Always expanded, unlike a synthesis snippet list. The images ARE the task;
 * collapsing them would hide the only input the field has.
 *
 * The per-image card lives in `ImageCandidateCard` because the Detailed view
 * renders the same images from the persisted `logos` field.
 */
export function ImageEvidenceList({ images }: { images: ImageEvidence[] }) {
  if (images.length === 0) return null;

  return (
    <div className="rounded-lg border border-ink-200 bg-ink-50">
      <div className="px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
          {images.length} candidate image{images.length === 1 ? "" : "s"} · located, not analysed
        </span>
        <p className="hint mt-0.5">
          The scan found these. It cannot see them — that part is yours. Save any you want to
          keep alongside your description.
        </p>
      </div>

      <ul className="space-y-2 border-t border-ink-200 px-3 py-2">
        {images.map((image, index) => (
          <li key={`${image.url}-${index}`}>
            <ImageCandidateCard image={image} />
          </li>
        ))}
      </ul>
    </div>
  );
}
