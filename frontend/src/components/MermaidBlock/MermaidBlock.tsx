import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

let idCounter = 0;

interface Props {
  chart: string;
}

export default function MermaidBlock({ chart }: Props) {
  const id = useRef(`mermaid-${++idCounter}`);
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    void (async () => {
      try {
        const { svg } = await mermaid.render(id.current, chart);
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
