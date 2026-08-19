"use client";

import { useEffect, useRef, useState } from "react";
import type { KnowledgeBaseSummary } from "@/lib/db/types";
import { useCardColumns } from "@/hooks/useMediaQuery";
import { CARD_GAP, CARD_HEIGHT, KnowledgeCard } from "./KnowledgeCard";

/**
 * Virtualised card grid.
 *
 * Windowing is structured around the column count, not the item count: at three
 * columns the list is rows of three, and only the rows intersecting the viewport
 * are mounted. That is why the column count comes from `matchMedia` rather than
 * from CSS — the component has to know the layout shape before it can decide what
 * to render, and a pure-CSS grid would leave it guessing.
 *
 * Cards are a fixed height for the same reason: variable heights would require
 * measuring every item to know where the window starts.
 */

const OVERSCAN_ROWS = 2;

export function CardGrid({
  items,
  onOpen,
}: {
  items: KnowledgeBaseSummary[];
  onOpen: (id: string) => void;
}) {
  const columns = useCardColumns();
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(900);
  const [containerTop, setContainerTop] = useState(0);

  useEffect(() => {
    const measure = () => {
      setViewportHeight(window.innerHeight);
      setContainerTop(containerRef.current?.offsetTop ?? 0);
    };
    const onScroll = () => setScrollTop(window.scrollY);

    measure();
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", measure);
    };
  }, [items.length, columns]);

  const rowHeight = CARD_HEIGHT + CARD_GAP;
  const rowCount = Math.ceil(items.length / columns);

  const relativeScroll = Math.max(0, scrollTop - containerTop);
  const firstVisibleRow = Math.max(0, Math.floor(relativeScroll / rowHeight) - OVERSCAN_ROWS);
  const visibleRowCount = Math.ceil(viewportHeight / rowHeight) + OVERSCAN_ROWS * 2;
  const lastVisibleRow = Math.min(rowCount, firstVisibleRow + visibleRowCount);

  const topSpacer = firstVisibleRow * rowHeight;
  const bottomSpacer = Math.max(0, (rowCount - lastVisibleRow) * rowHeight);

  const visibleItems = items.slice(firstVisibleRow * columns, lastVisibleRow * columns);

  if (items.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm font-semibold text-ink-700">No knowledge bases match</p>
        <p className="hint mt-1">
          Adjust the filters, or scan a site on the Build page to create one.
        </p>
      </div>
    );
  }

  return (
    <div ref={containerRef}>
      <div style={{ height: topSpacer }} aria-hidden />
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {visibleItems.map((item) => (
          <KnowledgeCard key={item.id} item={item} onOpen={onOpen} />
        ))}
      </div>
      <div style={{ height: bottomSpacer }} aria-hidden />
      <p className="hint mt-3 text-center">
        Showing rows {firstVisibleRow + 1}–{lastVisibleRow} of {rowCount} ({items.length} profiles,{" "}
        {columns} per row)
      </p>
    </div>
  );
}
