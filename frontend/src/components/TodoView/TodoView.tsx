import { useEffect, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { fetchFileContent, fetchTodoFiles, writeFileContent } from '../../hooks/useGraph';
import styles from './TodoView.module.css';

export default function TodoView() {
  const [files, setFiles] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [content, setContent] = useState<string>('');
  const [editing, setEditing] = useState(false);
  const [editBuffer, setEditBuffer] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const loadFiles = useCallback(async () => {
    const list = await fetchTodoFiles();
    setFiles(list);
    // Auto-select current sprint or daily file
    const today = new Date().toISOString().slice(0, 10);
    const daily = list.find(f => f.includes(today));
    const sprint = list.find(f => f.includes('current-sprint'));
    const first = daily ?? sprint ?? list[0];
    if (first && !selected) {
      setSelected(first);
    }
  }, [selected]);

  const loadFile = useCallback(async (path: string) => {
    try {
      const c = await fetchFileContent(path, 'todo');
      setContent(c);
      setEditBuffer(c);
    } catch {
      setContent('Could not load file.');
    }
  }, []);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    if (selected) void loadFile(selected);
  }, [selected, loadFile]);

  // SSE reload
  useEffect(() => {
    const es = new EventSource('/api/watch');
    es.onmessage = () => {
      if (selected) void loadFile(selected);
    };
    return () => es.close();
  }, [selected, loadFile]);

  const handleCheckboxToggle = useCallback(async (lineIndex: number) => {
    const lines = content.split('\n');
    const line = lines[lineIndex];
    if (!line) return;
    if (line.includes('- [x]') || line.includes('- [X]')) {
      lines[lineIndex] = line.replace(/- \[[xX]\]/, '- [ ]');
    } else {
      lines[lineIndex] = line.replace('- [ ]', '- [x]');
    }
    const updated = lines.join('\n');
    setContent(updated);
    setEditBuffer(updated);
    await writeFileContent(selected, updated, 'todo');
  }, [content, selected]);

  const handleSave = async () => {
    setSaving(true);
    await writeFileContent(selected, editBuffer, 'todo');
    setContent(editBuffer);
    setEditing(false);
    setSaving(false);
  };

  const filteredFiles = files.filter(f =>
    search === '' || f.toLowerCase().includes(search.toLowerCase())
  );

  // Group files by top-level folder
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
                    onClick={() => { setSelected(f); setEditing(false); }}
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
          <div className={styles.actions}>
            {editing ? (
              <>
                <button onClick={handleSave} disabled={saving}>{saving ? 'saving…' : 'save'}</button>
                <button onClick={() => { setEditing(false); setEditBuffer(content); }}>cancel</button>
              </>
            ) : (
              <button onClick={() => setEditing(true)}>edit</button>
            )}
          </div>
        </div>

        <div className={styles.content}>
          {editing ? (
            <textarea
              className={styles.editor}
              value={editBuffer}
              onChange={e => setEditBuffer(e.target.value)}
              spellCheck={false}
            />
          ) : (
            <div className={styles.rendered}>
              <InteractiveMarkdown content={content} onCheckboxToggle={handleCheckboxToggle} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function InteractiveMarkdown({
  content,
  onCheckboxToggle,
}: {
  content: string;
  onCheckboxToggle: (lineIndex: number) => void;
}) {
  const lines = content.split('\n');

  return (
    <div>
      {lines.map((line, i) => {
        const isChecked = /^(\s*)- \[[xX]\]/.test(line);
        const isUnchecked = /^(\s*)- \[ \]/.test(line);

        if (isChecked || isUnchecked) {
          const text = line.replace(/^(\s*)- \[[xX ]\]\s*/, '');
          const indent = (line.match(/^(\s*)/)?.[1]?.length ?? 0);
          return (
            <div
              key={i}
              className={styles.checkboxLine}
              style={{ paddingLeft: indent * 8 + 4 }}
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => onCheckboxToggle(i)}
                className={styles.checkbox}
              />
              <span className={isChecked ? styles.checkedText : ''}>{text}</span>
            </div>
          );
        }

        // Render non-checkbox lines as markdown
        return (
          <ReactMarkdown key={i} components={{ p: ({ children }) => <p className={styles.mdParagraph}>{children}</p> }}>
            {line}
          </ReactMarkdown>
        );
      })}
    </div>
  );
}
