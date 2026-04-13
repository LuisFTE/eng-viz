import { useCallback, useEffect, useRef, useState } from 'react';
import GraphView from './components/GraphView/GraphView';
import TodoView from './components/TodoView/TodoView';
import Terminal from './components/Terminal/Terminal';
import { useGraph, fetchCompanies, setActiveCompany } from './hooks/useGraph';
import styles from './App.module.css';

const MIN_PANEL_PX = 120;
const TERMINAL_MIN_PX = 80;
const TERMINAL_DEFAULT_PX = 260;

export default function App() {
  // Panel visibility
  const [showGraph, setShowGraph] = useState(true);
  const [showTodo, setShowTodo] = useState(true);
  const [showTerminal, setShowTerminal] = useState(false);

  // Split positions
  // hSplit: fraction of the main-row width given to graph (0–1)
  const [hSplit, setHSplit] = useState(0.55);
  // termHeight: px height of the terminal panel
  const [termHeight, setTermHeight] = useState(TERMINAL_DEFAULT_PX);

  // KB switcher
  const [companies, setCompanies] = useState<string[]>([]);
  const [activeCompany, setActiveCompanyState] = useState<string>('');
  const { data, loading, error } = useGraph();

  useEffect(() => {
    void (async () => {
      const list = await fetchCompanies();
      setCompanies(list);
      const res = await fetch('/api/kb/active');
      const json = await res.json() as { active: string };
      setActiveCompanyState(json.active);
    })();
  }, []);

  const handleCompanySwitch = async (company: string) => {
    await setActiveCompany(company);
    setActiveCompanyState(company);
    window.location.reload();
  };

  // ── Horizontal divider drag (graph | todo) ──────────────────────────────
  const mainRowRef = useRef<HTMLDivElement>(null);
  const draggingH = useRef(false);

  const onHDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingH.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!draggingH.current || !mainRowRef.current) return;
      const rect = mainRowRef.current.getBoundingClientRect();
      const raw = (ev.clientX - rect.left) / rect.width;
      // Clamp so neither panel collapses below MIN_PANEL_PX
      const minFrac = MIN_PANEL_PX / rect.width;
      const maxFrac = 1 - minFrac;
      setHSplit(Math.max(minFrac, Math.min(maxFrac, raw)));
    };

    const onUp = () => {
      draggingH.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  // ── Vertical divider drag (main | terminal) ─────────────────────────────
  const workspaceRef = useRef<HTMLDivElement>(null);
  const draggingV = useRef(false);

  const onVDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingV.current = true;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!draggingV.current || !workspaceRef.current) return;
      const rect = workspaceRef.current.getBoundingClientRect();
      const fromBottom = rect.bottom - ev.clientY;
      setTermHeight(Math.max(TERMINAL_MIN_PX, Math.min(rect.height - MIN_PANEL_PX, fromBottom)));
    };

    const onUp = () => {
      draggingV.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  // When both graph and todo are hidden, show both again (prevent blank state)
  const toggleGraph = () => {
    if (showGraph && !showTodo) { setShowTodo(true); }
    setShowGraph(v => !v);
  };
  const toggleTodo = () => {
    if (showTodo && !showGraph) { setShowGraph(true); }
    setShowTodo(v => !v);
  };
  const toggleTerminal = () => setShowTerminal(v => !v);

  const bothVisible = showGraph && showTodo;

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.logo}>eng-viz</div>

        <div className={styles.panelToggles}>
          <button
            className={showGraph ? 'active' : ''}
            onClick={toggleGraph}
            title="Toggle graph panel"
          >
            graph
          </button>
          <button
            className={showTodo ? 'active' : ''}
            onClick={toggleTodo}
            title="Toggle todo panel"
          >
            todo
          </button>
          <button
            className={showTerminal ? 'active' : ''}
            onClick={toggleTerminal}
            title="Toggle terminal panel"
          >
            terminal
          </button>
        </div>

        <div className={styles.right}>
          {companies.length > 0 && (
            <select
              value={activeCompany}
              onChange={e => void handleCompanySwitch(e.target.value)}
              title="Switch KB"
            >
              {companies.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}
          {loading && <span className={styles.status}>loading…</span>}
          {error && <span className={styles.error}>⚠ {error}</span>}
        </div>
      </header>

      {/* Workspace: main row + terminal */}
      <div className={styles.workspace} ref={workspaceRef}>

        {/* Main row: graph + todo */}
        <div
          className={styles.mainRow}
          ref={mainRowRef}
          style={{ flex: 1, minHeight: 0 }}
        >
          {showGraph && (
            <div
              className={styles.panel}
              style={{ flex: bothVisible ? hSplit : 1 }}
            >
              <div className={styles.panelLabel}>graph</div>
              <GraphView data={data} />
            </div>
          )}

          {bothVisible && (
            <div
              className={styles.hDivider}
              onMouseDown={onHDividerMouseDown}
              title="Drag to resize"
            />
          )}

          {showTodo && (
            <div
              className={styles.panel}
              style={{ flex: bothVisible ? 1 - hSplit : 1 }}
            >
              <div className={styles.panelLabel}>todo</div>
              <TodoView />
            </div>
          )}
        </div>

        {/* Vertical divider + terminal */}
        {showTerminal && (
          <>
            <div
              className={styles.vDivider}
              onMouseDown={onVDividerMouseDown}
              title="Drag to resize"
            />
            <div
              className={styles.termPanel}
              style={{ height: termHeight, flexShrink: 0 }}
            >
              <div className={styles.panelLabel}>terminal</div>
              <Terminal />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
