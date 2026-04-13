import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import GraphView from './components/GraphView/GraphView';
import TodoView from './components/TodoView/TodoView';
import KbFileView from './components/KbFileView/KbFileView';
import Terminal from './components/Terminal/Terminal';
import ErrorBoundary from './components/ErrorBoundary/ErrorBoundary';
import { useGraph } from './hooks/useGraph';
import { useLayout } from './hooks/useLayout';
import { useKb } from './hooks/useKb';
import { useSplitResize } from './hooks/useSplitResize';
import { useDrag } from './hooks/useDrag';
import { PanelId, LayoutNode, LayoutLeaf } from './layout/types';
import {
  genId, splitLeaf, closeLeaf, assignPanel,
  collectPanels, countLeaves, findLeafByPanel, findFirstLeaf,
} from './layout/tree';
import styles from './App.module.css';

// ── Constants ──────────────────────────────────────────────────────────────────

const MIN_PANEL_PX = 80;
const PANEL_NAMES: Record<PanelId, string> = { graph: 'graph', todo: 'todo', terminal: 'terminal' };
const ALL_PANELS: PanelId[] = ['graph', 'todo', 'terminal'];

function getZone(clientX: number, clientY: number, rect: DOMRect): 'top' | 'bottom' | 'left' | 'right' {
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  const d = { top: y, bottom: 1 - y, left: x, right: 1 - x } as const;
  return (Object.keys(d) as Array<keyof typeof d>).reduce((a, b) => d[a] < d[b] ? a : b);
}

// ── App ────────────────────────────────────────────────────────────────────────

export default function App() {
  const { layout, setLayout, getLayout } = useLayout();
  const { companies, activeCompany, activeKbPath, hasTodo, handleCompanySwitch } = useKb(
    (hasTodoOnInit) => {
      const terminalLeaf: LayoutNode = { type: 'leaf', id: genId(), panel: 'terminal' };
      const topRow: LayoutNode = hasTodoOnInit
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
    },
  );

  const { splitRefs, startResize } = useSplitResize(getLayout, setLayout, MIN_PANEL_PX);
  const { dragging, setDragging, dropZone, setDropZone, handleZoneDrop } = useDrag(setLayout);
  const { data, loading, error } = useGraph();

  // ── Split popover ─────────────────────────────────────────────────────────
  const [splitPopover, setSplitPopover] = useState<string | null>(null);

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

  // ── Leaf renderer ─────────────────────────────────────────────────────────
  const renderLeaf = (leaf: LayoutLeaf): React.ReactNode => {
    const isPopoverOpen = splitPopover === leaf.id;
    const availablePanels = ALL_PANELS.filter(p => p !== leaf.panel && (p !== 'todo' || hasTodo));
    const isDragging = dragging === leaf.id;
    const leafZone = dropZone && 'leafId' in dropZone && dropZone.leafId === leaf.id ? dropZone.zone : null;

    return (
      <div className={[styles.panel, isDragging ? styles.panelDragging : ''].filter(Boolean).join(' ')}>
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

        <ErrorBoundary label={leaf.panel ?? 'panel'}>
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
        </ErrorBoundary>

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
              {companies.map(c => {
                const label = c.includes('/') ? c.split('/').pop()! : c;
                return <option key={c} value={c}>{label}</option>;
              })}
            </select>
          )}
          {loading && <span className={styles.status}>loading…</span>}
          {error && <span className={styles.error}>⚠ {error}</span>}
        </div>
      </header>

      <div className={styles.workspace}>
        {renderNode(layout)}

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
