# eng-viz

Local visualization web app for [eng-kb](https://github.com/LuisFTE/eng-kb) and [eng-todo](https://github.com/LuisFTE/eng-todo).

## Views

| View | Description |
|---|---|
| **graph** | Force-directed graph of `_*.md` nodes — draggable, filterable, hover shows detail file, Ctrl+F searchable |
| **todo** | Interactive markdown — browse/edit eng-todo files, check off todos live |
| **terminal** | Embedded shell (xterm.js) — run Claude, git, grep directly |

## Stack

- Frontend: React + Vite + TypeScript
- Backend: Express + TypeScript + WebSocket
- Graph: d3-force
- Terminal: xterm.js + node-pty

## Setup

### 1. Install dependencies

```bash
npm run install:all
```

### 2. Link your KBs

```bash
mkdir -p kbs/bloomberg
ln -s /path/to/eng-kb kbs/bloomberg/eng-kb
ln -s /path/to/eng-todo kbs/bloomberg/eng-todo
```

### 3. Set active company

Edit `config.json`:
```json
{ "active": "bloomberg" }
```

### 4. Run

```bash
npm run dev
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:3001

## Multi-company

To add another company's KBs:

```bash
mkdir -p kbs/acme
ln -s /path/to/their-eng-kb kbs/acme/eng-kb
ln -s /path/to/their-eng-todo kbs/acme/eng-todo
```

Then switch via the dropdown in the top-right.

## File watching

The backend watches `kbs/` with chokidar and pushes SSE events to the frontend — graph and todo views live-reload on file changes.
