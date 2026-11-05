import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

const EDGE = 84;
const SCROLL_STEP = 14;

export function useDragReorder(ids: readonly string[], moveTo: (id: string, index: number) => void) {
  const listRef = useRef<HTMLUListElement>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const startDrag = useCallback((event: ReactPointerEvent<HTMLElement>, id: string) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    listRef.current?.setPointerCapture(event.pointerId);
    setDraggingId(id);
  }, []);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLUListElement>) => {
      const list = listRef.current;
      if (!draggingId || !list) return;
      if (event.clientY < EDGE) window.scrollBy(0, -SCROLL_STEP);
      else if (event.clientY > window.innerHeight - EDGE) window.scrollBy(0, SCROLL_STEP);
      const rows = Array.from(list.children) as HTMLElement[];
      let target = rows.length - 1;
      for (let i = 0; i < rows.length; i++) {
        const rect = rows[i].getBoundingClientRect();
        if (event.clientY < rect.top + rect.height / 2) {
          target = i;
          break;
        }
      }
      if (target !== ids.indexOf(draggingId)) moveTo(draggingId, target);
    },
    [draggingId, ids, moveTo]
  );

  const endDrag = useCallback((event: ReactPointerEvent<HTMLUListElement>) => {
    if (listRef.current?.hasPointerCapture(event.pointerId)) listRef.current.releasePointerCapture(event.pointerId);
    setDraggingId(null);
  }, []);

  return {
    draggingId,
    startDrag,
    listProps: { ref: listRef, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag },
  };
}
