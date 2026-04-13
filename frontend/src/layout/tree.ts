import { LayoutNode, LayoutLeaf, LayoutSplit, PanelId } from './types';

export const genId = (): string => crypto.randomUUID();

// ── Queries ───────────────────────────────────────────────────────────────────

export function findFirstLeaf(node: LayoutNode): LayoutLeaf | null {
  if (node.type === 'leaf') return node;
  for (const c of node.children) {
    const r = findFirstLeaf(c);
    if (r) return r;
  }
  return null;
}

export function findLeafById(root: LayoutNode, id: string): LayoutLeaf | null {
  if (root.type === 'leaf') return root.id === id ? root : null;
  for (const c of root.children) {
    const r = findLeafById(c, id);
    if (r) return r;
  }
  return null;
}

export function findLeafByPanel(node: LayoutNode, panel: PanelId): LayoutLeaf | null {
  if (node.type === 'leaf') return node.panel === panel ? node : null;
  for (const c of node.children) {
    const r = findLeafByPanel(c, panel);
    if (r) return r;
  }
  return null;
}

export function findSplitNode(root: LayoutNode, id: string): LayoutSplit | null {
  if (root.id === id && root.type === 'split') return root;
  if (root.type === 'split') {
    for (const c of root.children) {
      const r = findSplitNode(c, id);
      if (r) return r;
    }
  }
  return null;
}

export function findParentSplit(root: LayoutNode, childId: string): LayoutSplit | null {
  if (root.type === 'leaf') return null;
  for (const c of root.children) {
    if (c.id === childId) return root;
    const r = findParentSplit(c, childId);
    if (r) return r;
  }
  return null;
}

export function countLeaves(node: LayoutNode): number {
  if (node.type === 'leaf') return 1;
  return node.children.reduce((s, c) => s + countLeaves(c), 0);
}

export function collectPanels(node: LayoutNode, out = new Set<PanelId>()): Set<PanelId> {
  if (node.type === 'leaf') {
    if (node.panel) out.add(node.panel);
  } else {
    node.children.forEach(c => collectPanels(c, out));
  }
  return out;
}

// ── Mutations (pure — return new tree) ───────────────────────────────────────

export function splitLeaf(
  root: LayoutNode,
  leafId: string,
  dir: 'h' | 'v',
  newPanel: PanelId | null,
  before: boolean,
): LayoutNode {
  if (root.id === leafId && root.type === 'leaf') {
    const newLeaf: LayoutLeaf = { type: 'leaf', id: genId(), panel: newPanel };
    const children: LayoutNode[] = before ? [newLeaf, root] : [root, newLeaf];
    return { type: 'split', id: genId(), dir, children, sizes: [0.5, 0.5] };
  }
  if (root.type === 'split') {
    return { ...root, children: root.children.map(c => splitLeaf(c, leafId, dir, newPanel, before)) };
  }
  return root;
}

export function closeLeaf(root: LayoutNode, leafId: string): LayoutNode | null {
  if (root.type === 'leaf') return root.id === leafId ? null : root;
  const results = root.children.map(c => closeLeaf(c, leafId));
  const remaining = results.filter((c): c is LayoutNode => c !== null);
  if (remaining.length === 0) return null;
  if (remaining.length === 1) return remaining[0];
  const removedTotal = root.sizes.filter((_, i) => results[i] === null).reduce((a, b) => a + b, 0);
  const keptSizes = root.sizes.filter((_, i) => results[i] !== null);
  const keptTotal = keptSizes.reduce((a, b) => a + b, 0);
  const newSizes = keptSizes.map(s => s + removedTotal * (s / keptTotal));
  return { ...root, children: remaining, sizes: newSizes };
}

export function updateNodeSizes(root: LayoutNode, splitId: string, sizes: number[]): LayoutNode {
  if (root.id === splitId && root.type === 'split') return { ...root, sizes };
  if (root.type === 'split') {
    return { ...root, children: root.children.map(c => updateNodeSizes(c, splitId, sizes)) };
  }
  return root;
}

export function assignPanel(root: LayoutNode, leafId: string, panel: PanelId): LayoutNode {
  if (root.type === 'leaf') return root.id === leafId ? { ...root, panel } : root;
  return { ...root, children: root.children.map(c => assignPanel(c, leafId, panel)) };
}

export function swapLeafPanels(root: LayoutNode, idA: string, idB: string): LayoutNode {
  let panelA: PanelId | null = null;
  let panelB: PanelId | null = null;
  function collect(n: LayoutNode) {
    if (n.type === 'leaf') {
      if (n.id === idA) panelA = n.panel;
      if (n.id === idB) panelB = n.panel;
    } else {
      n.children.forEach(collect);
    }
  }
  collect(root);
  function swap(n: LayoutNode): LayoutNode {
    if (n.type === 'leaf') {
      if (n.id === idA) return { ...n, panel: panelB };
      if (n.id === idB) return { ...n, panel: panelA };
      return n;
    }
    return { ...n, children: n.children.map(swap) };
  }
  return swap(root);
}

export function insertSiblingInSplit(
  root: LayoutNode,
  splitId: string,
  targetId: string,
  panel: PanelId | null,
  before: boolean,
): LayoutNode {
  if (root.type === 'split' && root.id === splitId) {
    const idx = root.children.findIndex(c => c.id === targetId);
    if (idx === -1) return root;
    const newLeaf: LayoutLeaf = { type: 'leaf', id: genId(), panel };
    const insertAt = before ? idx : idx + 1;
    const children = [...root.children];
    children.splice(insertAt, 0, newLeaf);
    const n = children.length;
    const newFrac = 1 / n;
    const sizes = root.sizes.map(s => s * (n - 1) / n);
    sizes.splice(insertAt, 0, newFrac);
    return { ...root, children, sizes };
  }
  if (root.type === 'split') {
    return { ...root, children: root.children.map(c => insertSiblingInSplit(c, splitId, targetId, panel, before)) };
  }
  return root;
}

// Move source panel to a direction relative to target.
// If target's parent already splits in the same direction, insert as a flat sibling.
export function movePanel(
  root: LayoutNode,
  sourceId: string,
  targetId: string,
  dir: 'h' | 'v',
  before: boolean,
): LayoutNode {
  const source = findLeafById(root, sourceId);
  if (!source) return root;
  const panel = source.panel;
  const afterClose = closeLeaf(root, sourceId) ?? { type: 'leaf', id: genId(), panel: null };
  const parent = findParentSplit(afterClose, targetId);
  if (parent && parent.dir === dir) {
    return insertSiblingInSplit(afterClose, parent.id, targetId, panel, before);
  }
  return splitLeaf(afterClose, targetId, dir, panel, before);
}

// Remove source, wrap remaining tree in a vertical split with source docked at bottom.
export function dockPanel(root: LayoutNode, sourceId: string): LayoutNode {
  const source = findLeafById(root, sourceId);
  if (!source) return root;
  const panel = source.panel;
  const afterClose = closeLeaf(root, sourceId);
  if (!afterClose) return { type: 'leaf', id: genId(), panel };
  return {
    type: 'split', id: genId(), dir: 'v',
    children: [afterClose, { type: 'leaf', id: genId(), panel }],
    sizes: [0.65, 0.35],
  };
}
