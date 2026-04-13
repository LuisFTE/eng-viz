import { useCallback, useEffect, useRef, useState } from 'react';
import { writeFileContent, fetchFileContent, fetchTodoFiles } from '../../hooks/useGraph';
import MilkdownEditor from './MilkdownEditor';
import styles from './TodoView.module.css';

const SAVE_DEBOUNCE_MS = 800;

export default function TodoView() {
  const [files, setFiles] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [content, setContent] = useState<string>('');
  const [search, setSearch] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');

  const suppressNextReload = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadFiles = useCallback(async () => {
    const list = await fetchTodoFiles();
    setFiles(list);
    if (!selected) {
      const today = new Date().toISOString().slice(0, 10);
      const pick =
        list.find(f => f.includes(today)) ??
        list.find(f => f.includes('current-sprint')) ??
        list[0];
      if (pick) setSelected(pick);
    }
  }, [selected]);

  const loadFile = useCallback(async (path: string) => {
    try {
      const c = await fetchFileContent(path, 'todo');
      setContent(c);
    } catch {
      setContent('Could not load file.');
    }
  }, []);

  useEffect(() => { void loadFiles(); }, [loadFiles]);
  useEffect(() => { if (selected) void loadFile(selected); }, [selected, loadFile]);

  useEffect(() => {
    const es = new EventSource('/api/watch');
    es.onmessage = () => {
      if (suppressNextReload.current) {
        suppressNextReload.current = false;
        return;
      }
      if (selected) void loadFile(selected);
    };
    return () => es.close();
  }, [selected, loadFile]);

  // Debounced auto-save triggered by Milkdown edits
  const handleChange = useCallback((markdown: string) => {
    setContent(markdown);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState('saving');
    saveTimer.current = setTimeout(async () => {
      suppressNextReload.current = true;
      await writeFileContent(selected, markdown, 'todo');
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 1200);
    }, SAVE_DEBOUNCE_MS);
  }, [selected]);

  const filteredFiles = files.filter(f =>
    search === '' || f.toLowerCase().includes(search.toLowerCase())
  );

  const grouped: Record<string, string[]> = {};
  for (const f of filteredFiles) {
    const parts = f.split('/');
    const group = parts.length > 1 ? parts[0] : '_root';
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push(f);
  }

  return (
    <div className={styles.container}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarHeader}>
          <input
            type="text"
            placeholder="Filter files…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <nav className={styles.fileTree}>
          {Object.entries(grouped).map(([group, groupFiles]) => (
            <div key={group} className={styles.group}>
              <div className={styles.groupLabel}>{group}</div>
              {groupFiles.map(f => {
                const parts = f.split('/');
                const name = parts[parts.length - 1] ?? f;
                return (
                  <button
                    key={f}
                    className={`${styles.fileItem} ${selected === f ? styles.fileItemActive : ''}`}
                    onClick={() => setSelected(f)}
                    title={f}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      <main className={styles.main}>
        <div className={styles.mainHeader}>
          <span className={styles.filePath}>{selected}</span>
          {saveState === 'saving' && <span className={styles.saveStatus}>saving…</span>}
          {saveState === 'saved' && <span className={styles.saveStatusSaved}>saved</span>}
        </div>

        <div className={styles.content}>
          {/* key forces full remount when switching files */}
          {selected && (
            <MilkdownEditor
              key={selected}
              content={content}
              onChange={handleChange}
            />
          )}
        </div>
      </main>
    </div>
  );
}
