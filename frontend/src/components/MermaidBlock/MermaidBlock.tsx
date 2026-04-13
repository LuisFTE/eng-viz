import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

interface Props {
  chart: string;
}

export default function MermaidBlock({ chart }: Props) {
  // Use a stable random ID per instance — avoids stale DOM elements from
  // HMR reloads or StrictMode double-mount that share a counter.
  const id = useRef(`mermaid-${crypto.randomUUID()}`);
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    void (async () => {
      try {
        const { svg } = await mermaid.render(id.current, chart);
        // Mermaid v10+ sometimes returns an error SVG instead of throwing.
        // Detect it and fall back to plain source.
        if (svg.includes('Syntax error')) {
          throw new Error('Syntax error in diagram');
        }
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Mermaid render failed');
        }
      }
    })();

    return () => { cancelled = true; };
  }, [chart]);

  if (error) {
    return (
      <pre style={{ color: 'var(--node-unknown)', fontSize: 11, whiteSpace: 'pre-wrap' }}>
        {chart}
      </pre>
    );
  }

  return <div ref={containerRef} style={{ overflowX: 'auto' }} />;
}
