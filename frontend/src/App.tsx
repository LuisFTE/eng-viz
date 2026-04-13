import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import GraphView from './components/GraphView/GraphView';
import TodoView from './components/TodoView/TodoView';
import KbFileView from './components/KbFileView/KbFileView';
import Terminal from './components/Terminal/Terminal';
import { useGraph, fetchCompanies, setActiveCompany } from './hooks/useGraph';
import styles from './App.module.css';

// ── Types ─────────────────────────────────────────────────────────────────────

type PanelId = 'graph' | 'todo' | 'terminal';

interface LayoutLeaf { type: 'leaf'; id: string; panel: PanelId | null; }
interface LayoutSplit { type: 'split'; id: string; dir: 'h' | 'v'; children: LayoutNode[]; sizes: number[]; }
type LayoutNode = LayoutLeaf | LayoutSplit;

// ── Tree utilities (pure) ─────────────────────────────────────────────────────

let _id = 0;
const genId = () => `n${++_id}`;

function findFirstLeaf(node: LayoutNode): LayoutLeaf | null {
  if (node.type === 'leaf') return node;
  for (const c of node.children) { const r = findFirstLeaf(c); if (r) return r; }
  return null;
}

function findLeafByPanel(node: LayoutNode, panel: PanelId): LayoutLeaf | null {
  if (node.type === 'leaf') return node.panel === panel ? node : null;
  for (const c of node.children) { const r = findLeafByPanel(c, panel); if (r) return r; }
  return null;
}

function countLeaves(node: LayoutNode): number {
  if (node.type === 'leaf') return 1;
  return node.children.reduce((s, c) => s + countLeaves(c), 0);
}

function collectPanels(node: LayoutNode, out = new Set<PanelId>()): Set<PanelId> {
  if (node.type === 'leaf') { if (node.panel) out.add(node.panel); }
  else node.children.forEach(c => collectPanels(c, out));
  return out;
}

function splitLeaf(root: LayoutNode, leafId: string, dir: 'h' | 'v', newPanel: PanelId | null, before: boolean): LayoutNode {
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

function closeLeaf(root: LayoutNode, leafId: string): LayoutNode | null {
  if (root.type === 'leaf') return root.id === leafId ? null : root;
  const results = root.children.map(c => closeLeaf(c, leafId));
  const remaining = results.filter((c): c is LayoutNode => c !== null);
  if (remaining.length === 0) return null;
  if (remaining.length === 1) return remaining[0]; // collapse single-child split
  // Distribute removed children's sizes proportionally among survivors
  const removedTotal = root.sizes.filter((_, i) => results[i] === null).reduce((a, b) => a + b, 0);
  const keptSizes = root.sizes.filter((_, i) => results[i] !== null);
  const keptTotal = keptSizes.reduce((a, b) => a + b, 0);
  const newSizes = keptSizes.map(s => s + removedTotal * (s / keptTotal));
  return { ...root, children: remaining, sizes: newSizes };
}

function updateNodeSizes(root: LayoutNode, splitId: string, sizes: number[]): LayoutNode {
  if (root.id === splitId && root.type === 'split') return { ...root, sizes };
  if (root.type === 'split') return { ...root, children: root.children.map(c => updateNodeSizes(c, splitId, sizes)) };
  return root;
}

function assignPanel(root: LayoutNode, leafId: string, panel: PanelId): LayoutNode {
  if (root.type === 'leaf') return root.id === leafId ? { ...root, panel } : root;
  return { ...root, children: root.children.map(c => assignPanel(c, leafId, panel)) };
}

function swapLeafPanels(root: LayoutNode, idA: string, idB: string): LayoutNode {
  let panelA: PanelId | null = null;
  let panelB: PanelId | null = null;
  function collect(n: LayoutNode) {
    if (n.type === 'leaf') { if (n.id === idA) panelA = n.panel; if (n.id === idB) panelB = n.panel; }
    else n.children.forEach(collect);
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

function findSplitNode(root: LayoutNode, id: string): LayoutSplit | null {
  if (root.id === id && root.type === 'split') return root;
  if (root.type === 'split') {
    for (const c of root.children) { const r = findSplitNode(c, id); if (r) return r; }
  }
  return null;
}

function findLeafById(root: LayoutNode, id: string): LayoutLeaf | null {
  if (root.type === 'leaf') return root.id === id ? root : null;
  for (const c of root.children) { const r = findLeafById(c, id); if (r) return r; }
  return null;
}

// Find the direct parent split of a node by id
function findParentSplit(root: LayoutNode, childId: string): LayoutSplit | null {
  if (root.type === 'leaf') return null;
  for (const c of root.children) {
    if (c.id === childId) return root;
    const r = findParentSplit(c, childId);
    if (r) return r;
  }
  return null;
}

// Insert a new leaf as a sibling of targetId inside an existing split
function insertSiblingInSplit(root: LayoutNode, splitId: string, targetId: string, panel: PanelId | null, before: boolean): LayoutNode {
  if (root.type === 'split' && root.id === splitId) {
    const idx = root.children.findIndex(c => c.id === targetId);
    if (idx === -1) return root;
    const newLeaf: LayoutLeaf = { type: 'leaf', id: genId(), panel };
    const insertAt = before ? idx : idx + 1;
    const children = [...root.children];
    children.splice(insertAt, 0, newLeaf);
    // Give new sibling equal share, scale others proportionally
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
// If target's parent is already a split in the same direction, insert as sibling (no nesting).
function movePanel(root: LayoutNode, sourceId: string, targetId: string, dir: 'h' | 'v', before: boolean): LayoutNode {
  const source = findLeafById(root, sourceId);
  if (!source) return root;
  const panel = source.panel;
  const afterClose = closeLeaf(root, sourceId) ?? { type: 'leaf', id: genId(), panel: null };

  // After closing source, the target may have moved up in a collapsed split —
  // re-check its parent in the updated tree
  const parent = findParentSplit(afterClose, targetId);
  if (parent && parent.dir === dir) {
    // Target is already inside a split going the same direction: just add as sibling
    return insertSiblingInSplit(afterClose, parent.id, targetId, panel, before);
  }

  return splitLeaf(afterClose, targetId, dir, panel, before);
}

// Remove source leaf, wrap remaining tree in a vertical split with source panel docked at bottom
function dockPanel(root: LayoutNode, sourceId: string): LayoutNode {
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

type DropZone = { leafId: string; zone: 'top' | 'bottom' | 'left' | 'right' } | { zone: 'dock' } | null;

function getZone(clientX: number, clientY: number, rect: DOMRect): 'top' | 'bottom' | 'left' | 'right' {
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  const d = { top: y, bottom: 1 - y, left: x, right: 1 - x } as const;
  return (Object.keys(d) as Array<keyof typeof d>).reduce((a, b) => d[a] < d[b] ? a : b);
}

// ── Constants ──────────────────────────────────────────────────────────────────

const MIN_PANEL_PX = 80;
const PANEL_NAMES: Record<PanelId, string> = { graph: 'graph', todo: 'todo', terminal: 'terminal' };
const ALL_PANELS: PanelId[] = ['graph', 'todo', 'terminal'];

// ── App ────────────────────────────────────────────────────────────────────────

export default function App() {

  // ── Layout state ──────────────────────────────────────────────────────────
  const [layout, setLayoutState] = useState<LayoutNode>({ type: 'leaf', id: genId(), panel: 'graph' });
  const layoutRef = useRef<LayoutNode>(layout);
  const layoutInitialized = useRef(false);

  const setLayout = useCallback((updater: LayoutNode | ((prev: LayoutNode) => LayoutNode)) => {
    setLayoutState(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      layoutRef.current = next;
      return next;
    });
  }, []);

  // ── Split popover ─────────────────────────────────────────────────────────
  const [splitPopover, setSplitPopover] = useState<string | null>(null);

  // ── Zone-based drag state ─────────────────────────────────────────────────
  const [dragging, setDragging] = useState<string | null>(null); // leaf id
  const [dropZone, setDropZone] = useState<DropZone>(null);

  useEffect(() => {
    if (!splitPopover) return;
    const handler = () => setSplitPopover(null);
    const timer = setTimeout(() => document.addEventListener('click', handler), 0);
    return () => { clearTimeout(timer); document.removeEventListener('click', handler); };
  }, [splitPopover]);

  // ── KB detail (inside graph panel) ───────────────────────────────────────
  const [selectedKbFile, setSelectedKbFile] = useState<string | null>(null);
  const [kbSplit, setKbSplit] = useState(0.55);
  const graphInnerRef = useRef<HTMLDivElement>(null);
  const draggingKb = useRef(false);

  const onKbDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingKb.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => {
      if (!draggingKb.current || !graphInnerRef.current) return;
      const rect = graphInnerRef.current.getBoundingClientRect();
      const raw = (ev.clientX - rect.left) / rect.width;
      setKbSplit(Math.max(MIN_PANEL_PX / rect.width, Math.min(1 - MIN_PANEL_PX / rect.width, raw)));
    };
    const onUp = () => {
      draggingKb.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  // ── KB switcher ───────────────────────────────────────────────────────────
  const [companies, setCompanies] = useState<string[]>([]);
  const [activeCompany, setActiveCompanyState] = useState<string>('');
  const [activeKbPath, setActiveKbPath] = useState<string>('');
  const [hasTodo, setHasTodo] = useState(false);
  const { data, loading, error } = useGraph();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void (async () => {
    if (layoutInitialized.current) return;
    layoutInitialized.current = true;

    const list = await fetchCompanies();
    setCompanies(list);
    const res = await fetch('/api/kb/active');
    const json = await res.json() as { active: string; path: string; hasTodo: boolean };
    setActiveCompanyState(json.active);
    setActiveKbPath(json.path);
    setHasTodo(json.hasTodo);

    const terminalLeaf: LayoutNode = { type: 'leaf', id: genId(), panel: 'terminal' };
    const topRow: LayoutNode = json.hasTodo
      ? {
          type: 'split', id: genId(), dir: 'h',
          children: [
            { type: 'leaf', id: genId(), panel: 'graph' },
            { type: 'leaf', id: genId(), panel: 'todo' },
          ],
          sizes: [0.55, 0.45],
        }
      : { type: 'leaf', id: genId(), panel: 'graph' };

    setLayout({
      type: 'split', id: genId(), dir: 'v',
      children: [topRow, terminalLeaf],
      sizes: [0.7, 0.3],
    });
  })(); }, []); // setLayout is stable

  const handleCompanySwitch = async (company: string) => {
    await setActiveCompany(company);
    setActiveCompanyState(company);
    const res = await fetch('/api/kb/active');
    const json = await res.json() as { active: string; path: string; hasTodo: boolean };
    setActiveKbPath(json.path);
    setHasTodo(json.hasTodo);
    window.location.reload();
  };

  // ── Resize ────────────────────────────────────────────────────────────────
  const splitRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const startResize = useCallback((splitId: string, index: number, dir: 'h' | 'v') => (e: React.MouseEvent) => {
    e.preventDefault();
    document.body.style.cursor = dir === 'h' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';

    const container = splitRefs.current.get(splitId);
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const total = dir === 'h' ? rect.width : rect.height;
    const startPos = dir === 'h' ? e.clientX : e.clientY;
    const minFrac = MIN_PANEL_PX / total;

    const node = findSplitNode(layoutRef.current, splitId);
    if (!node) return;
    const initSizes = [...node.sizes];

    const onMove = (ev: MouseEvent) => {
      const pos = dir === 'h' ? ev.clientX : ev.clientY;
      const delta = (pos - startPos) / total;
      const newSizes = [...initSizes];
      const combined = initSizes[index] + initSizes[index + 1];
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
  }, [setLayout]);

  // ── Tree operations ───────────────────────────────────────────────────────
  const handleSplit = useCallback((leafId: string, dir: 'h' | 'v', newPanel: PanelId | null, before: boolean) => {
    setLayout(prev => splitLeaf(prev, leafId, dir, newPanel, before));
    setSplitPopover(null);
  }, [setLayout]);

  const handleClose = useCallback((leafId: string) => {
    setLayout(prev => closeLeaf(prev, leafId) ?? { type: 'leaf', id: genId(), panel: null });
  }, [setLayout]);

  const handleAssignPanel = useCallback((leafId: string, panel: PanelId) => {
    setLayout(prev => assignPanel(prev, leafId, panel));
  }, [setLayout]);

  // ── Derived state ─────────────────────────────────────────────────────────
  const panelsInTree = useMemo(() => collectPanels(layout), [layout]);
  const totalLeaves = useMemo(() => countLeaves(layout), [layout]);

  const togglePanel = (panel: PanelId) => {
    if (panel === 'todo' && !hasTodo) return;
    if (panelsInTree.has(panel)) {
      const leaf = findLeafByPanel(layout, panel);
      if (leaf) handleClose(leaf.id);
    } else {
      const first = findFirstLeaf(layout);
      if (first) setLayout(prev => splitLeaf(prev, first.id, 'h', panel, false));
    }
  };

  // ── Panel content ─────────────────────────────────────────────────────────
  const renderContent = (panel: PanelId): React.ReactNode => {
    switch (panel) {
      case 'graph':
        return (
          <div className={styles.graphInner} ref={graphInnerRef}>
            <div style={{ flex: selectedKbFile ? kbSplit : 1, minWidth: 0, overflow: 'hidden' }}>
              <GraphView data={data} onNodeClick={setSelectedKbFile} />
            </div>
            {selectedKbFile && (
              <>
                <div className={styles.hDivider} onMouseDown={onKbDividerMouseDown} title="Drag to resize" />
                <div style={{ flex: 1 - kbSplit, minWidth: 0, overflow: 'hidden' }}>
                  <KbFileView filePath={selectedKbFile} onClose={() => setSelectedKbFile(null)} />
                </div>
              </>
            )}
          </div>
        );
      case 'todo':
        return hasTodo ? <TodoView /> : <div className={styles.emptyPanel}>todo not configured</div>;
      case 'terminal':
        return <Terminal kbPath={activeKbPath} />;
    }
  };

  // ── Drop handling ─────────────────────────────────────────────────────────
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

  // ── Leaf renderer ─────────────────────────────────────────────────────────
  const renderLeaf = (leaf: LayoutLeaf): React.ReactNode => {
    const isPopoverOpen = splitPopover === leaf.id;
    const availablePanels = ALL_PANELS.filter(p => p !== leaf.panel && (p !== 'todo' || hasTodo));
    const isDragging = dragging === leaf.id;
    const leafZone = dropZone && 'leafId' in dropZone && dropZone.leafId === leaf.id ? dropZone.zone : null;

    return (
      <div className={[styles.panel, isDragging ? styles.panelDragging : ''].filter(Boolean).join(' ')}>
        {/* Label bar — drag handle */}
        <div
          className={styles.panelLabel}
          draggable
          onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDragging(leaf.id); setSplitPopover(null); }}
          onDragEnd={() => { setDragging(null); setDropZone(null); }}
        >
          <span className={styles.dragHandle}>⠿</span>
          <span className={styles.panelLabelName}>
            {leaf.panel ? PANEL_NAMES[leaf.panel] : 'empty'}
          </span>
          <div className={styles.panelLabelActions}>
            <div
              className={styles.splitBtnWrap}
              onClick={e => { e.stopPropagation(); setSplitPopover(isPopoverOpen ? null : leaf.id); }}
            >
              <button className={styles.splitBtn} title="Split panel">⊕</button>
              {isPopoverOpen && availablePanels.length > 0 && (
                <div className={styles.splitPopover} onClick={e => e.stopPropagation()}>
                  {(['h', 'v'] as const).map(dir => (
                    <div key={dir} className={styles.splitRow}>
                      <span className={styles.splitDirLabel}>{dir === 'h' ? '→ right' : '↓ below'}</span>
                      {availablePanels.map(p => (
                        <button key={p} onClick={() => handleSplit(leaf.id, dir, p, false)}>
                          {PANEL_NAMES[p]}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {totalLeaves > 1 && (
              <button className={styles.closePanelBtn} onClick={() => handleClose(leaf.id)} title="Close panel">✕</button>
            )}
          </div>
        </div>

        {/* Content */}
        {leaf.panel ? renderContent(leaf.panel) : (
          <div className={styles.emptyPanel}>
            <span>pick a panel</span>
            <div className={styles.emptyPanelBtns}>
              {availablePanels.map(p => (
                <button key={p} onClick={() => handleAssignPanel(leaf.id, p)}>{PANEL_NAMES[p]}</button>
              ))}
            </div>
          </div>
        )}

        {/* Drop zone overlay — visible only when another panel is being dragged */}
        {dragging && !isDragging && (
          <div
            className={styles.dropOverlay}
            onDragOver={e => {
              e.preventDefault();
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              setDropZone({ leafId: leaf.id, zone: getZone(e.clientX, e.clientY, rect) });
            }}
            onDragLeave={e => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropZone(null);
            }}
            onDrop={e => { e.preventDefault(); handleZoneDrop(); }}
          >
            {leafZone && leafZone !== 'top' && (
              <div className={`${styles.zoneIndicator} ${styles[`zone_${leafZone}`]}`} />
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Recursive split renderer ──────────────────────────────────────────────
  const renderNode = (node: LayoutNode): React.ReactNode => {
    if (node.type === 'leaf') return renderLeaf(node);

    return (
      <div
        key={node.id}
        ref={el => { if (el) splitRefs.current.set(node.id, el as HTMLDivElement); else splitRefs.current.delete(node.id); }}
        style={{ flex: 1, display: 'flex', flexDirection: node.dir === 'h' ? 'row' : 'column', overflow: 'hidden', minWidth: 0, minHeight: 0 }}
      >
        {node.children.map((child, i) => (
          <React.Fragment key={child.id}>
            <div style={{ flex: node.sizes[i], overflow: 'hidden', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              {renderNode(child)}
            </div>
            {i < node.children.length - 1 && (
              <div
                className={node.dir === 'h' ? styles.hDivider : styles.vDivider}
                onMouseDown={startResize(node.id, i, node.dir)}
                title="Drag to resize"
              />
            )}
          </React.Fragment>
        ))}
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.logo}>Chromagram</div>

        <div className={styles.panelToggles}>
          {ALL_PANELS.filter(p => p !== 'todo' || hasTodo).map(p => (
            <button
              key={p}
              className={panelsInTree.has(p) ? 'active' : ''}
              onClick={() => togglePanel(p)}
              title={panelsInTree.has(p) ? `close ${p}` : `open ${p}`}
            >
              {PANEL_NAMES[p]}
            </button>
          ))}
        </div>

        <div className={styles.right}>
          {companies.length > 0 && (
            <select value={activeCompany} onChange={e => void handleCompanySwitch(e.target.value)} title="Switch KB">
              {companies.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {loading && <span className={styles.status}>loading…</span>}
          {error && <span className={styles.error}>⚠ {error}</span>}
        </div>
      </header>

      <div className={styles.workspace}>
        {renderNode(layout)}

        {/* Full-width bottom dock zone — visible only while dragging */}
        {dragging && (
          <div
            className={[styles.dockZone, dropZone?.zone === 'dock' ? styles.dockZoneActive : ''].filter(Boolean).join(' ')}
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDropZone({ zone: 'dock' }); }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropZone(null); }}
            onDrop={e => { e.preventDefault(); handleZoneDrop(); }}
          >
            dock full width
          </div>
        )}
      </div>
    </div>
  );
}
