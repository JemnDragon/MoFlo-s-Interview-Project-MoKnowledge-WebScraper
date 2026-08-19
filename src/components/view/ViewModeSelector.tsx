"use client";

import { useEffect } from "react";
import { MOBILE_BREAKPOINT, useMediaQuery } from "@/hooks/useMediaQuery";

export type ViewMode = "card" | "table" | "detailed";

/**
 * Table is removed as an option below the mobile breakpoint, not merely hidden.
 *
 * A ten-column comparison table has no honest phone layout: horizontal scrolling
 * hides the columns that make it a comparison, and stacking it turns each row
 * into a card, which is the card view. Offering it and then degrading it would be
 * worse than not offering it. If Table is active when the viewport shrinks, the
 * selector switches to Card rather than leaving a dead option selected.
 */
export function ViewModeSelector({
  mode,
  onChange,
}: {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  const isMobile = useMediaQuery(MOBILE_BREAKPOINT);

  useEffect(() => {
    if (isMobile && mode === "table") onChange("card");
  }, [isMobile, mode, onChange]);

  const options: { id: ViewMode; label: string }[] = [
    { id: "card", label: "Card" },
    ...(isMobile ? [] : [{ id: "table" as const, label: "Table" }]),
    { id: "detailed", label: "Detailed" },
  ];

  return (
    <div
      role="tablist"
      aria-label="View mode"
      className="inline-flex rounded-lg border border-ink-200 bg-surface p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.id}
          role="tab"
          aria-selected={mode === option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
            mode === option.id ? "bg-accent-500 text-white" : "text-ink-500 hover:text-ink-900"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
