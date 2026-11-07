"use client";

import { useEffect, useRef } from "react";

/* Class the hook toggles on the scroll container while the user is
   scrolling; the matching rules live in app/globals.css and only change
   scrollbar colours (the gutter is always reserved, so nothing reflows). */
const VISIBLE_CLASS = "sidebar-scrollbar-visible";

/* Hide the scrollbar this long after the last scroll event. */
const HIDE_DELAY_MS = 800;

/* Auto-hide the scrollbar of a sidebar navigation scroll container.
 *
 * Attach the returned ref to the element that owns the scrolling (the
 * sidebar <nav>). Every scroll event — wheel, touchpad, touch, keyboard,
 * scrollbar drag, programmatic scroll — re-adds the visible class and
 * restarts an 800ms hide timer held in a useRef, so the scrollbar shows
 * while the user scrolls and disappears again once they stop.
 *
 * The class is toggled directly on the DOM node, so no React state is
 * involved and no re-renders happen. The scroll listener, the timer and
 * the visible class are all removed when the element unmounts. */
export default function useAutoHideScrollbar() {
  const containerRef = useRef(null);
  const hideTimerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const hide = () => {
      hideTimerRef.current = null;
      container.classList.remove(VISIBLE_CLASS);
    };

    const onScroll = () => {
      container.classList.add(VISIBLE_CLASS);
      if (hideTimerRef.current !== null) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(hide, HIDE_DELAY_MS);
    };

    container.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      container.removeEventListener("scroll", onScroll);
      if (hideTimerRef.current !== null) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      container.classList.remove(VISIBLE_CLASS);
    };
  }, []);

  return containerRef;
}
