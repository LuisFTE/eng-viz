import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import rehypeRaw from 'rehype-raw';
import type { Components } from 'react-markdown';
import { fetchFileContent, fetchTodoFiles, writeFileContent } from '../../hooks/useGraph';
import styles from './TodoView.module.css';

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
}

export default function TodoView() {
  const [files, setFiles] = useState<string[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [content, setContent] = useState<string>('');
  const [editing, setEditing] = useState(false);
  const [editBuffer, setEditBuffer] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  const suppressNextReload = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // ── File loading ─────────────────────────────────────────────────────────

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
  useEffect(() => {
    if (selected) {
      setEditing(false);
      void loadFile(selected);
    }
  }, [selected, loadFile]);

  useEffect(() => {
    const es = new EventSource('/api/watch');
    es.onmessage = () => {
      if (suppressNextReload.current) { suppressNextReload.current = false; return; }
      if (selected) void loadFile(selected);
    };
    return () => es.close();
  }, [selected, loadFile]);

  // ── Save ─────────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    setSaving(true);
    suppressNextReload.current = true;
    await writeFileContent(selected, editBuffer, 'todo');
    setContent(editBuffer);
    setEditing(false);
    setSaving(false);
  }, [selected, editBuffer]);

  const handleCancel = useCallback(() => {
    setEditBuffer(content);
    setEditing(false);
  }, [content]);

  // Cmd/Ctrl+S to save, Escape to cancel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!editing) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void handleSave();
      }
      if (e.key === 'Escape') handleCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editing, handleSave, handleCancel]);

  // Auto-resize textarea to fit content
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta || !editing) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, [editBuffer, editing]);

  // Focus textarea, restore scroll position, and jump cursor to clicked word
  const enterEdit = useCallback((cursorSearch?: string) => {
    const savedScroll = contentRef.current?.scrollTop ?? 0;
    setEditBuffer(content);
    setEditing(true);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      // Restore scroll position on the content container
      if (contentRef.current) contentRef.current.scrollTop = savedScroll;
      ta.focus();
      if (cursorSearch) {
        const pos = content.indexOf(cursorSearch);
        if (pos !== -1) ta.setSelectionRange(pos, pos);
      }
    });
  }, [content]);

  // ── Checkbox toggle ──────────────────────────────────────────────────────

  const handleCheckboxToggle = useCallback(async (lineIndex: number) => {
    const lines = content.split('\n');
    const line = lines[lineIndex];
    if (line === undefined) return;
    lines[lineIndex] = line.replace(
      /^(\s*[-*+] \[)([xX ])(\])/,
      (_, pre, state, post) => `${pre}${state === ' ' ? 'x' : ' '}${post}`
    );
    const updated = lines.join('\n');
    setContent(updated);
    setEditBuffer(updated);
    suppressNextReload.current = true;
    await writeFileContent(selected, updated, 'todo');
  }, [content, selected]);

  // ── Tab key inserts spaces in textarea ───────────────────────────────────

  const handleTabKey = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const ta = e.currentTarget;
    const { selectionStart: start, selectionEnd: end } = ta;
    const next = editBuffer.slice(0, start) + '  ' + editBuffer.slice(end);
    setEditBuffer(next);
    requestAnimationFrame(() => ta.setSelectionRange(start + 2, start + 2));
  }, [editBuffer]);

  // ── Markdown components ───────────────────────────────────────────────────

  const mdComponents: Components = {
    h1: ({ children, ...props }) => <h1 id={slugify(String(children))} {...props}>{children}</h1>,
    h2: ({ children, ...props }) => <h2 id={slugify(String(children))} {...props}>{children}</h2>,
    h3: ({ children, ...props }) => <h3 id={slugify(String(children))} {...props}>{children}</h3>,
    h4: ({ children, ...props }) => <h4 id={slugify(String(children))} {...props}>{children}</h4>,

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

    a: ({ href, children, ...props }) => {
      const isAnchor = href?.startsWith('#');
      return (
        <a
          href={href}
          target={isAnchor ? undefined : '_blank'}
          rel={isAnchor ? undefined : 'noreferrer'}
          onClick={isAnchor ? (e) => {
            e.preventDefault();
            document.getElementById(href!.slice(1))?.scrollIntoView({ behavior: 'smooth' });
          } : undefined}
          {...props}
        >
          {children}
        </a>
      );
    },
  };

  // ── Sidebar grouping ─────────────────────────────────────────────────────

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

  // ── Render ────────────────────────────────────────────────────────────────

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
          <div className={styles.actions}>
            {editing ? (
              <>
                <span className={styles.hint}>Esc cancel · ⌘S save</span>
                <button onClick={() => void handleSave()} disabled={saving}>
                  {saving ? 'saving…' : 'save'}
                </button>
                <button onClick={handleCancel}>cancel</button>
              </>
            ) : (
              <button onClick={() => enterEdit()}>edit</button>
            )}
          </div>
        </div>

        <div className={styles.content} ref={contentRef}>
          {editing ? (
            <textarea
              ref={textareaRef}
              className={styles.editor}
              value={editBuffer}
              onChange={e => setEditBuffer(e.target.value)}
              onKeyDown={handleTabKey}
              spellCheck={false}
            />
          ) : (
            <div
              className={styles.rendered}
              onDoubleClick={() => {
                const sel = window.getSelection()?.toString();
                enterEdit(sel ?? undefined);
              }}
            >
              <ReactMarkdown
                remarkPlugins={[remarkFrontmatter, remarkGfm]}
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
