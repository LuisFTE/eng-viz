import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import styles from './Terminal.module.css';

interface Props {
  kbPath?: string;
}

export default function Terminal({ kbPath }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const mountedKbPath = useRef<string | undefined>(undefined);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const term = new XTerm({
      theme: {
        background: '#0f1117',
        foreground: '#e2e4ed',
        cursor: '#7c6af7',
        selectionBackground: '#2e3245',
        black: '#1a1d27',
        red: '#e05c5c',
        green: '#4caf7d',
        yellow: '#f5a623',
        blue: '#7c6af7',
        magenta: '#a78bfa',
        cyan: '#4fc3f7',
        white: '#e2e4ed',
      },
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(el);
    fit.fit();

    xtermRef.current = term;
    fitRef.current = fit;

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws/terminal`);
    wsRef.current = ws;

    ws.onopen = () => {
      const { cols, rows } = term;
      ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    };

    ws.onmessage = (e) => {
      term.write(typeof e.data === 'string' ? e.data : '');
    };

    ws.onclose = () => {
      term.write('\r\n\x1b[31mConnection closed.\x1b[0m\r\n');
    };

    ws.onerror = () => {
      term.write('\r\n\x1b[31mWebSocket error.\x1b[0m\r\n');
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'data', data }));
      }
    });

    const ro = new ResizeObserver(() => {
      fit.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    });
    ro.observe(el);

    // Record the path the terminal was spawned with so the cd effect can skip the first value
    mountedKbPath.current = kbPath;

    return () => {
      ro.disconnect();
      ws.close();
      term.dispose();
    };
  // kbPath intentionally omitted — terminal spawns once; path changes are handled below
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If the active KB changes while the terminal is open, cd into the new path
  useEffect(() => {
    if (!kbPath) return;
    // Skip the initial value — the pty already starts in the right dir
    if (kbPath === mountedKbPath.current) return;
    mountedKbPath.current = kbPath;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'data', data: `cd ${JSON.stringify(kbPath)}\r` }));
    }
  }, [kbPath]);

  return (
    <div className={styles.container}>
      <div ref={containerRef} className={styles.terminal} />
    </div>
  );
}
