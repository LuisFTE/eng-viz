import { useCallback, useRef } from 'react';
import { LayoutNode } from '../layout/types';
import { findSplitNode, updateNodeSizes } from '../layout/tree';

type SetLayout = (updater: (prev: LayoutNode) => LayoutNode) => void;

export function useSplitResize(
  getLayout: () => LayoutNode,
  setLayout: SetLayout,
  minPanelPx: number,
) {
  const splitRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const startResize = useCallback(
    (splitId: string, index: number, dir: 'h' | 'v') =>
      (e: React.MouseEvent) => {
        e.preventDefault();
        document.body.style.cursor = dir === 'h' ? 'col-resize' : 'row-resize';
        document.body.style.userSelect = 'none';

        const container = splitRefs.current.get(splitId);
        if (!container) return;

        const rect = container.getBoundingClientRect();
        const total = dir === 'h' ? rect.width : rect.height;
        const startPos = dir === 'h' ? e.clientX : e.clientY;
        const minFrac = minPanelPx / total;

        // Read layout synchronously at drag-start time via the stable getter.
        const node = findSplitNode(getLayout(), splitId);
        if (!node) return;
        const initSizes = [...node.sizes];

        const onMove = (ev: MouseEvent) => {
          const pos = dir === 'h' ? ev.clientX : ev.clientY;
          const delta = (pos - startPos) / total;
          const combined = initSizes[index] + initSizes[index + 1];
          const newSizes = [...initSizes];
          newSizes[index] = Math.max(minFrac, Math.min(combined - minFrac, initSizes[index] + delta));
          newSizes[index + 1] = combined - newSizes[index];
          setLayout(prev => updateNodeSizes(prev, splitId, newSizes));
        };

        const onUp = () => {
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      },
    [getLayout, setLayout, minPanelPx],
  );

  return { splitRefs, startResize };
}
