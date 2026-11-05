import { useCallback, useEffect, useState } from "react";

export function useInView<T extends Element>(threshold = 0.1) {
  const [node, setNode] = useState<T | null>(null);
  const [seen, setSeen] = useState(false);
  const ref = useCallback((el: T | null) => setNode(el), []);

  useEffect(() => {
    if (!node || seen) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold }
    );
    io.observe(node);
    return () => io.disconnect();
  }, [node, seen, threshold]);

  return { ref, seen };
}
