"use client";

import Image from "next/image";
import type { KnowledgeBaseSummary } from "@/lib/db/types";

/**
 * Fixed-height card. The uniform height is a requirement, not a style choice:
 * the grid is virtualised, and virtualisation needs to know an item's height
 * before it renders one.
 *
 * Logo handling: shrink to fit, never stretch — a distorted logo is worse than no
 * logo. When there is none, the fallback is an initial circle tinted with the
 * company's own extracted brand colour, and the *absence* of a logo is noted
 * explicitly in the Detailed view rather than silently papered over here.
 */

export const CARD_HEIGHT = 168;
export const CARD_GAP = 12;

/** Readable text colour for an arbitrary background, via relative luminance. */
function readableInk(background: string): string {
  const hex = background.replace("#", "");
  if (hex.length !== 6) return "#ffffff";
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const channel = (value: number) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  const luminance =
    0.2126 * channel(r ?? 0) + 0.7152 * channel(g ?? 0) + 0.0722 * channel(b ?? 0);
  return luminance > 0.55 ? "#10131a" : "#ffffff";
}

export function KnowledgeCard({
  item,
  onOpen,
}: {
  item: KnowledgeBaseSummary;
  onOpen: (id: string) => void;
}) {
  const deleted = item.status === "soft_deleted";
  const brand = item.brandColor && /^#[0-9a-f]{6}$/i.test(item.brandColor) ? item.brandColor : "#4571e6";
  const initials = item.companyName
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");

  // Capped at three, with a +N overflow indicator, and visually secondary to the
  // name and industry — languages are a filter aid, not a headline.
  const languages = item.siteLanguage.slice(0, 3);
  const overflow = item.siteLanguage.length - languages.length;

  return (
    <article
      style={{ height: CARD_HEIGHT }}
      className={`card flex flex-col justify-between p-3.5 transition ${
        deleted ? "opacity-55 grayscale" : "hover:border-accent-500"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0">
          {item.logoUrl ? (
            <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-lg border border-ink-200 bg-surface">
              {/* object-contain: shrink to fit the box, never stretch to fill it. */}
              <Image
                src={item.logoUrl}
                alt=""
                width={44}
                height={44}
                unoptimized
                className="max-h-11 max-w-11 object-contain"
              />
            </span>
          ) : (
            <span
              aria-hidden
              className="flex h-11 w-11 items-center justify-center rounded-lg text-sm font-bold"
              style={{ background: brand, color: readableInk(brand) }}
            >
              {initials || "?"}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate text-sm font-bold text-ink-900">{item.companyName}</h3>
            {deleted && (
              <span className="shrink-0 rounded-full bg-hidden-100 px-1.5 py-0.5 text-[10px] font-semibold text-hidden-600">
                Deleted
              </span>
            )}
          </div>
          <p className="truncate text-xs text-ink-500">
            {item.industry ?? <span className="text-ink-400">Industry not found</span>}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {languages.map((code) => (
              <span
                key={code}
                className="rounded bg-ink-100 px-1 py-px text-[10px] font-medium text-ink-500"
              >
                {code.toUpperCase()}
              </span>
            ))}
            {overflow > 0 && (
              <span className="rounded bg-ink-100 px-1 py-px text-[10px] font-medium text-ink-500">
                +{overflow}
              </span>
            )}
            {item.siteLanguage.length === 0 && (
              <span className="rounded bg-ink-100 px-1 py-px text-[10px] font-medium text-ink-400">
                No lang
              </span>
            )}
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between text-[11px] text-ink-500">
          <span>Completeness</span>
          <span className="font-semibold text-ink-700">{item.completenessScore}%</span>
        </div>
        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-ink-100">
          <div
            className={`h-full rounded-full ${
              item.completenessScore >= 70
                ? "bg-good-600"
                : item.completenessScore >= 40
                  ? "bg-mock-500"
                  : "bg-danger-600"
            }`}
            style={{ width: `${item.completenessScore}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between">
          <time className="text-[10px] text-ink-400" dateTime={item.updatedAt}>
            Updated {new Date(item.updatedAt).toLocaleDateString()}
          </time>
          <button
            type="button"
            onClick={() => onOpen(item.id)}
            className="text-[11px] font-semibold text-accent-600 hover:underline"
          >
            Open
          </button>
        </div>
      </div>
    </article>
  );
}
