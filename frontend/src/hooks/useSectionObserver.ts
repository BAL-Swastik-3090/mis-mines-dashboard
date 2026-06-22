"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Watches a list of section IDs via IntersectionObserver and returns
 * the ID of whichever section is currently most visible in the viewport.
 */
export function useSectionObserver(ids: string[]): string {
  const [activeId, setActiveId] = useState<string>(ids[0] ?? "");
  const idsRef = useRef(ids);
  idsRef.current = ids;

  useEffect(() => {
    const HEADER_H = 71; // px — fixed header height

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        });
      },
      {
        // Shrink viewport: ignore header at top, activate when section
        // enters the top half of the remaining viewport.
        rootMargin: `-${HEADER_H}px 0px -50% 0px`,
        threshold: 0,
      }
    );

    idsRef.current.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  return activeId;
}
