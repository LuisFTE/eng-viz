export type PanelId = 'graph' | 'todo' | 'terminal';

export interface LayoutLeaf {
  type: 'leaf';
  id: string;
  panel: PanelId | null;
}

export interface LayoutSplit {
  type: 'split';
  id: string;
  dir: 'h' | 'v';
  children: LayoutNode[];
  sizes: number[];
}

export type LayoutNode = LayoutLeaf | LayoutSplit;

export type DropZone =
  | { leafId: string; zone: 'top' | 'bottom' | 'left' | 'right' }
  | { zone: 'dock' }
  | null;

export type SetLayout = (updater: LayoutNode | ((prev: LayoutNode) => LayoutNode)) => void;
