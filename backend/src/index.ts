import express from 'express';
import cors from 'cors';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { WebSocketServer } from 'ws';
import chokidar from 'chokidar';
import { kbRouter } from './routes/kb';

const PORT = 3001;
const ROOT = path.resolve(__dirname, '../../');
const KBS_ROOT = path.join(ROOT, 'kbs');
const CONFIG_PATH = path.join(ROOT, 'config.json');

function getActive(): string {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as { active: string };
    return cfg.active;
  } catch {
    return 'acme-corp';
  }
}

function getExternals(): string[] {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as { externals?: string[] };
    return cfg.externals ?? [];
  } catch {
    return [];
  }
}

function setActive(company: string): void {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as Record<string, unknown>;
  cfg['active'] = company;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

const app = express();
app.use(cors());
app.use(express.json());

// KB API
app.use('/api/kb', kbRouter(KBS_ROOT, getActive, getExternals));

// Switch active company
app.post('/api/kb/active', (req, res) => {
  const { company } = req.body as { company: string };
  if (!company) {
    res.status(400).json({ error: 'company required' });
    return;
  }
  setActive(company);
  res.json({ ok: true, active: company });
});

// SSE endpoint for file-change notifications
const sseClients = new Set<express.Response>();

app.get('/api/watch', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// Watch kbs/ for changes and notify SSE clients
const watcher = chokidar.watch(KBS_ROOT, {
  persistent: true,
  ignoreInitial: true,
  ignored: /(^|[/\\])\./,
});

function notifyClients(event: string, filePath: string) {
  const data = JSON.stringify({ event, path: filePath });
  for (const client of sseClients) {
    client.write(`data: ${data}\n\n`);
  }
}

watcher.on('change', (p) => notifyClients('change', p));
watcher.on('add', (p) => notifyClients('add', p));
watcher.on('unlink', (p) => notifyClients('unlink', p));

// HTTP + WebSocket server
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/terminal' });

wss.on('connection', (ws) => {
  let pty: ReturnType<typeof import('node-pty').spawn> | null = null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodePty = require('node-pty') as typeof import('node-pty');
    const shell = process.env['SHELL'] || 'bash';
    const active = getActive();
    const kbCwd = path.isAbsolute(active) ? active : path.join(KBS_ROOT, active);
    const startCwd = fs.existsSync(kbCwd) ? kbCwd : ROOT;
    pty = nodePty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: startCwd,
      env: process.env as Record<string, string>,
    });

    pty.onData((data: string) => {
      if (ws.readyState === ws.OPEN) ws.send(data);
    });

    ws.on('message', (msg) => {
      const str = msg.toString();
      try {
        const parsed = JSON.parse(str) as { type: string; cols?: number; rows?: number; data?: string };
        if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
          pty?.resize(parsed.cols, parsed.rows);
        } else if (parsed.type === 'data') {
          pty?.write(parsed.data || '');
        }
      } catch {
        pty?.write(str);
      }
    });

    ws.on('close', () => pty?.kill());
  } catch (err) {
    console.warn('node-pty not available, terminal disabled:', err);
    ws.send('Terminal unavailable: node-pty failed to load.\r\n');
    ws.close();
  }
});

server.listen(PORT, () => {
  console.log(`eng-viz backend running on http://localhost:${PORT}`);
});
