import { useEffect, useState } from 'react';
import GraphView from './components/GraphView/GraphView';
import TodoView from './components/TodoView/TodoView';
import Terminal from './components/Terminal/Terminal';
import { useGraph } from './hooks/useGraph';
import { fetchCompanies, setActiveCompany } from './hooks/useGraph';
import type { View } from './types';
import styles from './App.module.css';

export default function App() {
  const [view, setView] = useState<View>('graph');
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

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.logo}>eng-viz</div>

        <nav className={styles.nav}>
          {(['graph', 'todo', 'terminal'] as View[]).map(v => (
            <button
              key={v}
              className={view === v ? 'active' : ''}
              onClick={() => setView(v)}
            >
              {v}
            </button>
          ))}
        </nav>

        <div className={styles.kbSwitcher}>
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
          {error && <span className={styles.error}>error: {error}</span>}
        </div>
      </header>

      <main className={styles.main}>
        {view === 'graph' && <GraphView data={data} />}
        {view === 'todo' && <TodoView />}
        {view === 'terminal' && <Terminal />}
      </main>
    </div>
  );
}
