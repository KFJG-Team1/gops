import { useEffect, useState, type RefObject } from "react";

// Reports whether the referenced element's content overflows vertically (i.e. a vertical
// scrollbar is present). Panels use this to render their full-height scroll rule only when
// the inner region actually scrolls, matching native scrollbar visibility.
export function useVerticalOverflow<T extends HTMLElement>(ref: RefObject<T | null>): boolean {
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return undefined;
    }
    const measure = () => setOverflowing(element.scrollHeight - element.clientHeight > 1);
    measure();
    const resizeObserver = new ResizeObserver(measure);
    resizeObserver.observe(element);
    // Row/content changes alter scrollHeight without resizing the container, so watch the
    // subtree too.
    const mutationObserver = new MutationObserver(measure);
    mutationObserver.observe(element, { childList: true, subtree: true, characterData: true });
    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [ref]);

  return overflowing;
}
