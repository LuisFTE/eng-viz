import { useEffect, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import type { Components } from 'react-markdown';
import { fetchFileContent, fetchTodoFiles, writeFileContent } from '../../hooks/useGraph';
import styles from './TodoView.module.css';

// Generate heading anchor slug matching GitHub/Obsidian convention
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

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
      setEditBuffer(c);
    } catch {
      setContent('Could not load file.');
    }
  }, []);

  useEffect(() => { void loadFiles(); }, [loadFiles]);
  useEffect(() => { if (selected) void loadFile(selected); }, [selected, loadFile]);

  useEffect(() => {
    const es = new EventSource('/api/watch');
    es.onmessage = () => { if (selected) void loadFile(selected); };
    return () => es.close();
  }, [selected, loadFile]);

  // Toggle the nth checkbox (0-indexed) in the source
  const handleCheckboxToggle = useCallback(async (index: number) => {
    let count = -1;
    const updated = content.replace(/^(\s*[-*+] \[)([xX ])(\])/gm, (match, pre, state, post) => {
      count++;
      if (count !== index) return match;
      return `${pre}${state === ' ' ? 'x' : ' '}${post}`;
    });
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

  const grouped: Record<string, string[]> = {};
  for (const f of filteredFiles) {
    const parts = f.split('/');
    const group = parts.length > 1 ? parts[0] : '_root';
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push(f);
  }

  // Count checkboxes seen so far during a single render pass
  let checkboxCounter = -1;

  const mdComponents: Components = {
    // Headings — add id for ToC anchor links
    h1: ({ children, ...props }) => {
      const text = String(children);
      return <h1 id={slugify(text)} {...props}>{children}</h1>;
    },
    h2: ({ children, ...props }) => {
      const text = String(children);
      return <h2 id={slugify(text)} {...props}>{children}</h2>;
    },
    h3: ({ children, ...props }) => {
      const text = String(children);
      return <h3 id={slugify(text)} {...props}>{children}</h3>;
    },
    h4: ({ children, ...props }) => {
      const text = String(children);
      return <h4 id={slugify(text)} {...props}>{children}</h4>;
    },

    // Intercept checkboxes rendered by remark-gfm.
    // Destructure `disabled` out so it never reaches the DOM element —
    // remark-gfm always passes disabled={true} which would block clicks.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    input: ({ type, checked, disabled: _disabled, ...props }) => {
      if (type === 'checkbox') {
        checkboxCounter++;
        const idx = checkboxCounter;
        return (
          <input
            type="checkbox"
            checked={checked}
            onChange={() => void handleCheckboxToggle(idx)}
            className={styles.checkbox}
            {...props}
          />
        );
      }
      return <input type={type} checked={checked} {...props} />;
    },

    // Style task list items
    li: ({ children, className, ...props }) => {
      const isTask = className?.includes('task-list-item');
      return (
        <li
          className={[styles.li, isTask ? styles.taskItem : ''].filter(Boolean).join(' ')}
          {...props}
        >
          {children}
        </li>
      );
    },

    // Open links in new tab; ToC anchors scroll within the panel
    a: ({ href, children, ...props }) => {
      const isAnchor = href?.startsWith('#');
      return (
        <a
          href={href}
          target={isAnchor ? undefined : '_blank'}
          rel={isAnchor ? undefined : 'noreferrer'}
          onClick={isAnchor ? (e) => {
            e.preventDefault();
            const id = href!.slice(1);
            document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
          } : undefined}
          {...props}
        >
          {children}
        </a>
      );
    },
  };

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
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeRaw]}
                components={mdComponents}
              >
                {content}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
