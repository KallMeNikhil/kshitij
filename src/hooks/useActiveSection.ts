import { useEffect, useState } from "react";

export interface UseActiveSectionOptions {
  selectors: readonly string[];
  rootMargin?: string;
  enabled?: boolean;
  topThreshold?: number;
}

export function useActiveSection({
  selectors,
  rootMargin = "-45% 0px -50% 0px",
  enabled = true,
  topThreshold = 0.6,
}: UseActiveSectionOptions): string {
  const [active, setActive] = useState("");

  useEffect(() => {
    if (!enabled) {
      setActive("");
      return;
    }

    const elements = selectors
      .map((selector) => [selector, document.querySelector(selector)] as const)
      .filter((pair): pair is [string, Element] => Boolean(pair[1]));

    const inBand = new Set<Element>();
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) inBand.add(entry.target);
        else inBand.delete(entry.target);
      }
      const current = elements.filter(([, el]) => inBand.has(el));
      setActive(current.length > 0 ? current[current.length - 1][0] : "");
    }, { rootMargin });

    elements.forEach(([, el]) => io.observe(el));

    const onTop = () => {
      if (topThreshold > 0 && window.scrollY < window.innerHeight * topThreshold) setActive("");
    };
    if (topThreshold > 0) window.addEventListener("scroll", onTop, { passive: true });

    return () => {
      io.disconnect();
      if (topThreshold > 0) window.removeEventListener("scroll", onTop);
    };
  }, [enabled, selectors, rootMargin, topThreshold]);

  return active;
}
