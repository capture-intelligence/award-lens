import { useEffect, useMemo, useRef, useState } from 'react';

export function useResizeObserver<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [rect, setRect] = useState({ width: 0, height: 0 });

  const observer = useMemo(() => {
    if (typeof ResizeObserver === 'undefined') return null;
    return new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const cr = entry.contentRect;
      setRect({ width: cr.width, height: cr.height });
    });
  }, []);

  useEffect(() => {
    if (!observer) return;
    if (!ref.current) return;
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [observer]);

  return { ref, rect };
}
