import { describe, it, expect } from 'vitest';
import {
  splitLeaf, closeLeaf, movePanel, dockPanel,
  swapLeafPanels, assignPanel, collectPanels, countLeaves,
  findParentSplit,
} from './tree';
import { LayoutLeaf, LayoutNode, LayoutSplit } from './types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function leaf(id: string, panel: 'graph' | 'todo' | 'terminal' | null = null): LayoutLeaf {
  return { type: 'leaf', id, panel };
}

function hsplit(id: string, left: LayoutNode, right: LayoutNode, sizes = [0.5, 0.5]): LayoutSplit {
  return { type: 'split', id, dir: 'h', children: [left, right], sizes };
}

function vsplit(id: string, top: LayoutNode, bottom: LayoutNode, sizes = [0.5, 0.5]): LayoutSplit {
  return { type: 'split', id, dir: 'v', children: [top, bottom], sizes };
}

// ── countLeaves ───────────────────────────────────────────────────────────────

describe('countLeaves', () => {
  it('counts a single leaf as 1', () => {
    expect(countLeaves(leaf('a'))).toBe(1);
  });

  it('counts leaves in a split', () => {
    expect(countLeaves(hsplit('s', leaf('a'), leaf('b')))).toBe(2);
  });

  it('counts leaves in nested splits', () => {
    const tree = vsplit('root', hsplit('top', leaf('a'), leaf('b')), leaf('c'));
    expect(countLeaves(tree)).toBe(3);
  });
});

// ── collectPanels ─────────────────────────────────────────────────────────────

describe('collectPanels', () => {
  it('collects panels from a split tree', () => {
    const tree = hsplit('s', leaf('a', 'graph'), leaf('b', 'todo'));
    expect(collectPanels(tree)).toEqual(new Set(['graph', 'todo']));
  });

  it('ignores null panels', () => {
    const tree = hsplit('s', leaf('a', 'graph'), leaf('b', null));
    expect(collectPanels(tree)).toEqual(new Set(['graph']));
  });
});

// ── splitLeaf ─────────────────────────────────────────────────────────────────

describe('splitLeaf', () => {
  it('wraps target leaf in a split', () => {
    const tree = leaf('a', 'graph');
    const result = splitLeaf(tree, 'a', 'h', 'todo', false);
    expect(result.type).toBe('split');
    const split = result as LayoutSplit;
    expect(split.dir).toBe('h');
    expect(split.children[0].id).toBe('a');
    expect((split.children[1] as LayoutLeaf).panel).toBe('todo');
  });

  it('inserts before when before=true', () => {
    const tree = leaf('a', 'graph');
    const result = splitLeaf(tree, 'a', 'h', 'todo', true) as LayoutSplit;
    expect((result.children[0] as LayoutLeaf).panel).toBe('todo');
    expect(result.children[1].id).toBe('a');
  });

  it('is a no-op for an unknown leafId', () => {
    const tree = leaf('a', 'graph');
    expect(splitLeaf(tree, 'z', 'h', 'todo', false)).toBe(tree);
  });
});

// ── closeLeaf ─────────────────────────────────────────────────────────────────

describe('closeLeaf', () => {
  it('returns null when closing the only leaf', () => {
    expect(closeLeaf(leaf('a'), 'a')).toBeNull();
  });

  it('collapses a 2-child split to its surviving sibling', () => {
    const tree = hsplit('s', leaf('a', 'graph'), leaf('b', 'todo'));
    const result = closeLeaf(tree, 'a');
    expect(result).not.toBeNull();
    expect(result?.type).toBe('leaf');
    expect((result as LayoutLeaf).id).toBe('b');
  });

  it('redistributes sizes when closing one of three children', () => {
    const s: LayoutSplit = {
      type: 'split', id: 's', dir: 'h',
      children: [leaf('a'), leaf('b'), leaf('c')],
      sizes: [0.2, 0.5, 0.3],
    };
    const result = closeLeaf(s, 'a') as LayoutSplit;
    expect(result.children).toHaveLength(2);
    expect(result.sizes.reduce((x, y) => x + y)).toBeCloseTo(1);
  });
});

// ── swapLeafPanels ────────────────────────────────────────────────────────────

describe('swapLeafPanels', () => {
  it('swaps panels between two leaves', () => {
    const tree = hsplit('s', leaf('a', 'graph'), leaf('b', 'todo'));
    const result = swapLeafPanels(tree, 'a', 'b') as LayoutSplit;
    expect((result.children[0] as LayoutLeaf).panel).toBe('todo');
    expect((result.children[1] as LayoutLeaf).panel).toBe('graph');
  });
});

// ── assignPanel ───────────────────────────────────────────────────────────────

describe('assignPanel', () => {
  it('assigns a panel to the target leaf', () => {
    const tree = leaf('a', null);
    const result = assignPanel(tree, 'a', 'terminal') as LayoutLeaf;
    expect(result.panel).toBe('terminal');
  });
});

// ── movePanel ─────────────────────────────────────────────────────────────────

describe('movePanel', () => {
  it('moves source next to target with a new split', () => {
    const tree = hsplit('s', leaf('a', 'graph'), leaf('b', 'todo'));
    // move 'a' below 'b' → vertical split containing [b, a]
    const result = movePanel(tree, 'a', 'b', 'v', false);
    expect(result.type).toBe('split');
    const outer = result as LayoutSplit;
    expect(outer.dir).toBe('v');
    const bottom = outer.children[1] as LayoutLeaf;
    expect(bottom.panel).toBe('graph');
  });

  it('inserts as a flat sibling when target parent already splits in same direction', () => {
    // [a | b] — horizontal split. Move 'a' to the right of 'b' (h, after).
    // After close: just leaf 'b'. Then split 'b' h → not a flat case (only 1 child).
    // Flat case: 3-pane [a | b | c], move 'a' right of 'c' → [b | c | a]
    const tree: LayoutSplit = {
      type: 'split', id: 's', dir: 'h',
      children: [leaf('a', 'graph'), leaf('b', 'todo'), leaf('c', 'terminal')],
      sizes: [1/3, 1/3, 1/3],
    };
    const result = movePanel(tree, 'a', 'c', 'h', false) as LayoutSplit;
    // Should still be a flat 3-child h-split (not nested)
    expect(result.type).toBe('split');
    expect(result.dir).toBe('h');
    expect(result.children).toHaveLength(3);
    const panels = result.children.map(c => (c as LayoutLeaf).panel);
    expect(panels).toEqual(['todo', 'terminal', 'graph']);
  });
});

// ── dockPanel ─────────────────────────────────────────────────────────────────

describe('dockPanel', () => {
  it('wraps remaining tree in a v-split with docked panel at bottom', () => {
    const tree = hsplit('s', leaf('a', 'graph'), leaf('b', 'todo'));
    const result = dockPanel(tree, 'a') as LayoutSplit;
    expect(result.type).toBe('split');
    expect(result.dir).toBe('v');
    expect((result.children[1] as LayoutLeaf).panel).toBe('graph');
  });

  it('handles docking the only leaf', () => {
    const result = dockPanel(leaf('a', 'graph'), 'a') as LayoutLeaf;
    expect(result.type).toBe('leaf');
    expect(result.panel).toBe('graph');
  });
});

// ── findParentSplit ───────────────────────────────────────────────────────────

describe('findParentSplit', () => {
  it('finds the direct parent of a leaf', () => {
    const tree = hsplit('s', leaf('a'), leaf('b'));
    expect(findParentSplit(tree, 'a')?.id).toBe('s');
  });

  it('returns null for a root-level leaf', () => {
    expect(findParentSplit(leaf('a'), 'a')).toBeNull();
  });

  it('finds nested parent correctly', () => {
    const tree = vsplit('root', hsplit('inner', leaf('a'), leaf('b')), leaf('c'));
    expect(findParentSplit(tree, 'a')?.id).toBe('inner');
    expect(findParentSplit(tree, 'c')?.id).toBe('root');
  });
});
