"use client";

import type { LogoEntry, OfferingEntry, PersonEntry } from "@/types/knowledge";
import { ImageCandidateCard } from "./ImageCandidateCard";

/**
 * Read-mode presentation for the two entry types the reference profiles format
 * most distinctively: Key People and Offerings.
 *
 * These follow the reference document's field-level conventions closely —
 * "Name — Title" over a gender line over a bio; "Name (Category)" over a
 * *Features:* run, a description, and a *Pricing:* line — because those are the
 * entries a reviewer is most likely to compare side by side with the standard.
 *
 * What they do NOT do is imitate the document's page layout. The reference is a
 * static PDF; this is a working tool. The side-by-side desktop grid, the
 * completeness bar, the delete controls and the honest missing-state indicators
 * all stay exactly as designed — a printed profile has no reason to distinguish
 * "the site never said" from "you hid this", and this app does.
 *
 * So where the reference simply omits an absent field, these render a muted note
 * instead. That is a deliberate divergence: silence in a document is fine,
 * silence in a knowledge base is the failure mode the whole system exists to
 * prevent. Edit mode is untouched — labelled inputs are correct for editing.
 */

function Absent({ label }: { label: string }) {
  return <span className="text-ink-400">{label}</span>;
}

export function PersonEntryView({ person }: { person: PersonEntry }) {
  const { name, title, gender, bio, credentials } = person;

  return (
    <div className="space-y-1">
      <p className="text-sm font-bold text-ink-900">
        {name ?? <Absent label="Name not found" />}
        {title && (
          <>
            <span className="mx-1.5 text-ink-400">—</span>
            <span className="font-semibold text-ink-700">{title}</span>
          </>
        )}
        {!title && name && (
          <span className="ml-1.5 text-xs font-normal">
            <Absent label="— title not found" />
          </span>
        )}
      </p>

      <p className="text-xs text-ink-500">
        {gender ?? <Absent label="Gender not stated on the page" />}
      </p>

      {bio ? (
        <p className="text-xs leading-relaxed text-ink-700">{bio}</p>
      ) : (
        <p className="text-xs">
          <Absent label="No biography found" />
        </p>
      )}

      {credentials.length > 0 && (
        <ul className="flex flex-wrap gap-1 pt-0.5">
          {credentials.map((credential) => (
            <li
              key={credential}
              className="rounded bg-accent-100 px-1.5 py-0.5 text-[10px] font-semibold text-accent-600"
            >
              {credential}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Features read as a sentence run in the reference, not as a bulleted list. */
function featureRun(features: string[]): string {
  return features
    .map((feature) => feature.trim().replace(/[.;]+$/, ""))
    .filter((feature) => feature.length > 0)
    .join(". ")
    .concat(".");
}

export function OfferingEntryView({ offering }: { offering: OfferingEntry }) {
  const { name, category, features, description, pricing } = offering;

  return (
    <div className="space-y-1">
      <p className="text-sm font-bold text-ink-900">
        {name ?? <Absent label="Name not found" />}
        {category && <span className="ml-1.5 font-semibold text-ink-700">({category})</span>}
        {!category && name && (
          <span className="ml-1.5 text-xs font-normal">
            <Absent label="(category not found)" />
          </span>
        )}
      </p>

      {features.length > 0 && (
        <p className="text-xs leading-relaxed text-ink-700">
          <em className="text-ink-500">Features:</em> {featureRun(features)}
        </p>
      )}

      {description ? (
        <p className="text-xs leading-relaxed text-ink-700">{description}</p>
      ) : (
        <p className="text-xs">
          <Absent label="No description found" />
        </p>
      )}

      <p className="text-xs">
        <em className="text-ink-500">Pricing:</em>{" "}
        {pricing ?? <Absent label="not stated" />}
      </p>
    </div>
  );
}

/**
 * Logos in the Detailed view.
 *
 * The generic Category 3 renderer showed these as three labelled strings, one
 * of which was a bare URL. For an image that is close to useless: a reviewer
 * checking a written Art Style description against the brand's actual imagery
 * cannot do it from a URL.
 *
 * So Logos gets the same card the Art Style evidence panel uses in the review
 * UI, including the per-image save link. This is the *only* place the saved
 * record can show those images: `Category2VisualField` is a draft-only shape and
 * the stored Art Style is a plain string, but `logos` is persisted and — since
 * both are derived from one `logoCandidates()` call in the transform — holds the
 * same set.
 *
 * Nothing is added to the export by this. It renders URLs and text that
 * `brandingAndStyle.logos` already carried.
 */
export function LogoEntryView({ logo }: { logo: LogoEntry }) {
  if (!logo.url) {
    return (
      <p className="text-xs">
        <Absent label="No image URL found" />
      </p>
    );
  }
  return <ImageCandidateCard image={{ url: logo.url, alt: logo.alt, detectedVia: logo.detectedVia }} />;
}
