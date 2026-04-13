import { useCallback, useState } from 'react';
import { DropZone, LayoutNode } from '../layout/types';
import { swapLeafPanels, movePanel, dockPanel } from '../layout/tree';

type SetLayout = (updater: (prev: LayoutNode) => LayoutNode) => void;

export function useDrag(setLayout: SetLayout) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropZone, setDropZone] = useState<DropZone>(null);

  const handleZoneDrop = useCallback(() => {
    if (!dragging || !dropZone) return;

    if (dropZone.zone === 'dock') {
      setLayout(prev => dockPanel(prev, dragging));
    } else {
      const { leafId, zone } = dropZone as { leafId: string; zone: 'top' | 'bottom' | 'left' | 'right' };
      if (zone === 'top') {
        setLayout(prev => swapLeafPanels(prev, dragging, leafId));
      } else if (zone === 'bottom') {
        setLayout(prev => movePanel(prev, dragging, leafId, 'v', false));
      } else if (zone === 'left') {
        setLayout(prev => movePanel(prev, dragging, leafId, 'h', true));
      } else {
        setLayout(prev => movePanel(prev, dragging, leafId, 'h', false));
      }
    }

    setDragging(null);
    setDropZone(null);
  }, [dragging, dropZone, setLayout]);

  return { dragging, setDragging, dropZone, setDropZone, handleZoneDrop };
}
