import { useCallback, useRef, useState } from 'react';
import { LayoutNode, SetLayout } from '../layout/types';
import { genId } from '../layout/tree';

export function useLayout() {
  const [layout, setLayoutState] = useState<LayoutNode>(() => ({
    type: 'leaf',
    id: genId(),
    panel: 'graph',
  }));

  // Kept in sync with state so event-handler closures can read the current
  // layout synchronously without stale-closure issues (e.g. resize drag start).
  const layoutRef = useRef<LayoutNode>(layout);

  const setLayout: SetLayout = useCallback(updater => {
    setLayoutState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      layoutRef.current = next;
      return next;
    });
  }, []);

  // Expose a stable getter instead of leaking the raw ref — callers that need
  // the current value synchronously should call getLayout() rather than
  // caching layoutRef directly, which avoids accidental ref aliasing.
  const getLayout = useCallback((): LayoutNode => layoutRef.current, []);

  return { layout, setLayout, getLayout };
}
