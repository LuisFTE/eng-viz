import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

export function kbRouter(kbsRoot: string, getActive: () => string, getExternals: () => string[] = () => []): Router {
  const router = Router();

  // active can be a plain name ("acme-corp") resolved under kbsRoot,
  // or an absolute path ("/home/user/eng-kb") for pointing outside kbs/.
  function activeKbPath(): string {
    const active = getActive();
    return path.isAbsolute(active) ? active : path.join(kbsRoot, active);
  }

  function activeTodoPath(): string {
    return path.join(activeKbPath(), 'plugins', 'eng-todo');
  }

  // List available companies (KB switcher).
  // Returns local kbs/ folder names plus any absolute paths from config externals.
  router.get('/companies', (_req: Request, res: Response) => {
    const local: string[] = fs.existsSync(kbsRoot)
      ? fs.readdirSync(kbsRoot, { withFileTypes: true })
          .filter(e => e.isDirectory() || e.isSymbolicLink())
          .map(e => e.name)
      : [];
    const externals = getExternals().filter(p => fs.existsSync(p));
    res.json([...local, ...externals]);
  });

  // Get active company + its KB path + whether todo exists
  router.get('/active', (_req: Request, res: Response) => {
    res.json({
      active: getActive(),
      path: activeKbPath(),
      hasTodo: fs.existsSync(activeTodoPath()),
    });
  });

  // Walk _*.md files and build graph
  router.get('/graph', (_req: Request, res: Response) => {
    const kbPath = activeKbPath();
    if (!fs.existsSync(kbPath)) {
      res.json({ nodes: [], edges: [] });
      return;
    }

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const seen = new Set<string>();

    function walk(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== 'repo') {
          walk(full);
        } else if (entry.isFile() && entry.name.startsWith('_') && entry.name.endsWith('.md')) {
          const rel = path.relative(kbPath, full);
          if (seen.has(rel)) continue;
          seen.add(rel);

          const raw = fs.readFileSync(full, 'utf8');
          const parsed = matter(raw);
          const fm = parsed.data as Record<string, unknown>;

          // Extract links from <details> block
          const detailsMatch = raw.match(/<details>[\s\S]*?<\/details>/);
          const links: ParsedLink[] = [];

          if (detailsMatch) {
            const block = detailsMatch[0];
            const linkMatches = block.matchAll(/- target: "?\[\[([^\]]+)\]\]"?\s*\n\s*type: ([^\n]+)\s*\n\s*reason: "?([^"\n]+)"?/g);
            for (const m of linkMatches) {
              links.push({ target: m[1].trim(), type: m[2].trim(), reason: m[3].trim() });
            }
          }

          // Determine detail file path
          const dir2 = path.dirname(full);
          const baseName = entry.name.slice(1); // strip leading _
          const detailFile = path.join(dir2, baseName);
          const detailRel = fs.existsSync(detailFile)
            ? path.relative(kbPath, detailFile)
            : null;

          nodes.push({
            id: rel,
            label: (fm['title'] as string) || entry.name.replace(/^_|\.md$/g, ''),
            type: (fm['type'] as string) || 'unknown',
            status: (fm['status'] as string) || undefined,
            detailFile: detailRel,
            x: undefined,
            y: undefined,
          });

          for (const link of links) {
            // Normalize target: [[path/to/_node]] -> path/to/_node.md
            let targetId = link.target;
            if (!targetId.endsWith('.md')) targetId += '.md';
            // Make relative to kb root
            if (!path.isAbsolute(targetId)) {
              // target is relative to kb root (Obsidian wiki-link style)
              targetId = targetId.replace(/\\/g, '/');
            }
            edges.push({
              source: rel,
              target: targetId,
              type: link.type,
              reason: link.reason,
            });
          }
        }
      }
    }

    walk(kbPath);
    res.json({ nodes, edges });
  });

  // Get file content (for hover / todo view)
  router.get('/file', (req: Request, res: Response) => {
    const { p, kb } = req.query as { p: string; kb?: string };
    if (!p) {
      res.status(400).json({ error: 'p query param required' });
      return;
    }
    const base = kb === 'todo' ? activeTodoPath() : activeKbPath();
    const full = path.join(base, p);
    // Prevent path traversal
    if (!full.startsWith(base)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    if (!fs.existsSync(full)) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    const content = fs.readFileSync(full, 'utf8');
    res.json({ content, path: p });
  });

  // Write file content (todo checkbox updates / live edit)
  router.put('/file', (req: Request, res: Response) => {
    const { p, kb } = req.query as { p: string; kb?: string };
    const { content } = req.body as { content: string };
    if (!p || content === undefined) {
      res.status(400).json({ error: 'p and content required' });
      return;
    }
    const base = kb === 'todo' ? activeTodoPath() : activeKbPath();
    const full = path.join(base, p);
    if (!full.startsWith(base)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    fs.writeFileSync(full, content, 'utf8');
    res.json({ ok: true });
  });

  // List todo files for nav
  router.get('/todo/files', (_req: Request, res: Response) => {
    const todoPath = activeTodoPath();
    if (!fs.existsSync(todoPath)) {
      res.json([]);
      return;
    }
    const files: string[] = [];
    function walk(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.isFile() && e.name.endsWith('.md')) {
          files.push(path.relative(todoPath, full));
        }
      }
    }
    walk(todoPath);
    res.json(files);
  });

  return router;
}

interface GraphNode {
  id: string;
  label: string;
  type: string;
  status?: string;
  detailFile: string | null;
  x: undefined;
  y: undefined;
}

interface GraphEdge {
  source: string;
  target: string;
  type: string;
  reason: string;
}

interface ParsedLink {
  target: string;
  type: string;
  reason: string;
}
