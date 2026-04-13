import { useEffect, useRef, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
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
  // Suppress the next SSE reload when we ourselves just wrote the file
  const suppressNextReload = useRef(false);

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
    es.onmessage = () => {
      if (suppressNextReload.current) {
        suppressNextReload.current = false;
        return;
      }
      if (selected) void loadFile(selected);
    };
    return () => es.close();
  }, [selected, loadFile]);

  // Toggle the checkbox at a specific line index in the source
  const handleCheckboxToggle = useCallback(async (lineIndex: number) => {
    const lines = content.split('\n');
    const line = lines[lineIndex];
    if (line === undefined) return;
    lines[lineIndex] = line.replace(
      /^(\s*[-*+] \[)([xX ])(\])/,
      (_, pre, state, post) => `${pre}${state === ' ' ? 'x' : ' '}${post}`
    );
    const updated = lines.join('\n');
    // Update state immediately so UI responds without waiting for the write
    setContent(updated);
    setEditBuffer(updated);
    // Flag to skip the SSE reload that will fire after the write
    suppressNextReload.current = true;
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
    // remark-rehype copies the mdast listItem's source position onto the
    // synthesized input element, so node.position.start.line is the exact
    // 1-indexed source line — no counters, no index mapping needed.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    input: ({ type, checked, disabled: _disabled, node, ...props }) => {
      if (type === 'checkbox') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sourceLine: number | undefined = (node as any)?.position?.start?.line;
        const lineIndex = sourceLine !== undefined ? sourceLine - 1 : undefined;
        return (
          <input
            type="checkbox"
            checked={checked}
            onChange={() => lineIndex !== undefined && void handleCheckboxToggle(lineIndex)}
            className={styles.checkbox}
            {...props}
          />
        );
      }
      return <input type={type} checked={checked} {...props} />;
    },

    // Style task list items — keep 'task-list-item' so the CSS :has() selector
    // for strikethrough can still find it alongside our module class.
    li: ({ children, className, ...props }) => {
      const isTask = className?.includes('task-list-item');
      return (
        <li
          className={[styles.li, isTask ? styles.taskItem : '', isTask ? 'task-list-item' : ''].filter(Boolean).join(' ')}
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

        <div className={editing ? styles.contentSplit : styles.content}>
          {editing && (
            <textarea
              className={styles.editor}
              value={editBuffer}
              onChange={e => setEditBuffer(e.target.value)}
              spellCheck={false}
              autoFocus
            />
          )}
          <div
            className={styles.rendered}
            onDoubleClick={() => !editing && setEditing(true)}
            style={{ cursor: editing ? 'default' : 'text' }}
          >
            <ReactMarkdown
              remarkPlugins={[remarkFrontmatter, remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              components={mdComponents}
            >
              {editing ? editBuffer : content}
            </ReactMarkdown>
          </div>
        </div>
      </main>
    </div>
  );
}
