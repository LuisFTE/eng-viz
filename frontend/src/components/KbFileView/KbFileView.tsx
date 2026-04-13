import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import rehypeRaw from 'rehype-raw';
import { fetchFileContent } from '../../hooks/useGraph';
import styles from './KbFileView.module.css';

interface Props {
  filePath: string;
  onClose: () => void;
}

export default function KbFileView({ filePath, onClose }: Props) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    setContent('');
    void fetchFileContent(filePath)
      .then(c => setContent(c))
      .catch(() => setContent('Could not load file.'))
      .finally(() => setLoading(false));
  }, [filePath]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.filePath}>{filePath}</span>
        <button onClick={onClose} title="Close" className={styles.closeBtn}>✕</button>
      </div>
      <div className={styles.body}>
        {loading ? (
          <span className={styles.loading}>loading…</span>
        ) : (
          <div className={styles.rendered}>
            <ReactMarkdown
              remarkPlugins={[remarkFrontmatter, remarkGfm]}
              rehypePlugins={[rehypeRaw]}
            >
              {content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
