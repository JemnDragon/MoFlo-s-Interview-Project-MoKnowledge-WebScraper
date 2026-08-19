"use client";

import { useEffect, useState } from "react";

/**
 * matchMedia-backed breakpoint detection.
 *
 * Used only where JavaScript genuinely has to know the layout shape:
 *
 *  - the virtualised card grid must know its column count *before* it renders,
 *    because the number of columns determines how many rows exist and therefore
 *    which slice of the list is in the window. CSS cannot tell it that.
 *  - the Table view mode is removed from the selector below the mobile
 *    breakpoint rather than hidden with CSS, so a dense ten-column table is never
 *    a reachable state on a phone.
 *
 * Everything else responsive in this app — the detail view's column layout, the
 * snippet/editor pairing — is a plain CSS media query with no JS involved.
 */
export function useMediaQuery(query: string): boolean {
  // Starts false and corrects after mount. SSR has no viewport, and guessing one
  // causes a hydration mismatch on whichever guess is wrong.
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const list = window.matchMedia(query);
    setMatches(list.matches);

    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

export const MOBILE_BREAKPOINT = "(max-width: 767px)";

/** Column count for the card grid, matched to the CSS grid at each breakpoint. */
export function useCardColumns(): number {
  const isMobile = useMediaQuery(MOBILE_BREAKPOINT);
  const isMedium = useMediaQuery("(min-width: 768px) and (max-width: 1199px)");
  const isWide = useMediaQuery("(min-width: 1600px)");

  if (isMobile) return 1;
  if (isMedium) return 2;
  if (isWide) return 4;
  return 3;
}
