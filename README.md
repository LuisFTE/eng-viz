# Chromagram

Local visualization tool for engineering knowledge bases. Force-directed graph, interactive todo tracker, and embedded terminal — all pointing at your local markdown files.

## Table of Contents

1. [Views](#views)
2. [Setup](#setup)
3. [Connecting a Knowledge Base](#connecting-a-knowledge-base)
4. [Knowledge Base Format](#knowledge-base-format)
5. [Switching Between KBs](#switching-between-kbs)
6. [Stack](#stack)

---

## Views

| View | Description |
|---|---|
| **Graph** | Force-directed graph built from `_*.md` node files. Draggable, filterable by type, searchable (Ctrl+F), shift+hover highlights neighbors, click opens detail file. |
| **Todo** | Browse and edit eng-todo markdown files. Checkbox state saves back to disk live. |
| **Terminal** | Embedded shell (xterm.js) opened at your active KB root. Run Claude, git, grep without leaving the app. |

---

## Setup

### 1. Install dependencies

```bash
npm run install:all
```

### 2. Connect a knowledge base

See [Connecting a Knowledge Base](#connecting-a-knowledge-base) below.

### 3. Run

```bash
npm run dev
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:3001

---

## Connecting a Knowledge Base

Edit `config.json` in the repo root. The `active` field can be either a folder name inside `kbs/` or an absolute path anywhere on your filesystem.

### Pointing at a KB outside this repo (recommended)

```json
{
  "active": "/home/youruser/Projects/eng-kb",
  "externals": ["/home/youruser/Projects/eng-kb"]
}
```

`externals` is the list that populates the switcher dropdown. Add every KB you want to be able to switch to.

### Using a local folder inside `kbs/`

```json
{
  "active": "acme-corp",
  "externals": []
}
```

Resolves to `kbs/acme-corp/`. Useful for sample data or testing. The `kbs/` directory is gitignored so nothing here gets committed.

### Mixing both

```json
{
  "active": "/home/youruser/Projects/eng-kb",
  "externals": [
    "/home/youruser/Projects/eng-kb",
    "/home/youruser/Projects/client-kb"
  ]
}
```

Local `kbs/` folders and externals all appear together in the switcher dropdown.

> **Windows / WSL note:** Symlinks on NTFS require elevated permissions and are unreliable. Use absolute paths in `externals` instead — no symlinks needed.

---

## Knowledge Base Format

The graph walker scans the active KB directory recursively for files matching `_*.md` (underscore prefix). Each one becomes a graph node.

### Node file (`_service-name.md`)

```markdown
---
title: Order Service
type: service
status: active
---

Short description or notes.

## Links

- [[Services/payment-service/_payment-service]] (calls) -- processes payments for orders
- [[Tech/Infrastructure/_postgres]] (uses) -- stores order records
```

**Frontmatter fields:**

| Field | Required | Description |
|---|---|---|
| `title` | no | Display label in the graph. Defaults to the filename. |
| `type` | no | Controls node color and filter buttons. See types below. |
| `status` | no | Optional. Shown in graph (e.g. `active`, `deprecated`). |

**Node types:**

| Type | Color |
|---|---|
| `service` | blue |
| `pipeline` | purple |
| `component` | teal |
| `db` / `database` | orange |
| `topic` / `kafka-topic` | yellow |
| `tech` / `language` / `build-tool` | grey |
| anything else | dim grey |

### Link format

Links live in a `## Links` section:

```
- [[relative/path/to/_node]] (type) -- reason
```

- Path is relative to the KB root (Obsidian wiki-link style, no `.md` extension needed)
- `type` is the edge label shown on the graph (e.g. `calls`, `uses`, `publishes-to`)
- `-- reason` is optional freetext shown as an edge tooltip

### Detail file

Place a file named `service-name.md` (no underscore) next to `_service-name.md` and it becomes the detail content — shown on hover and in the full panel when you click the node. Supports full markdown including Mermaid diagrams:

```markdown
# Order Service

## Flow

​```mermaid
flowchart TD
    A["POST /orders"] --> B{Validator}
    B -- valid --> C["Persist to Postgres"]
    C --> D["Publish OrderCreated"]
​```
```

> **Mermaid tip:** Quote any node label that contains `<`, `>`, `/`, or special characters: `A["label with / slash"]`

### Todo integration

If your KB has a todo plugin at `plugins/eng-todo/`, the todo panel activates automatically on startup. Any markdown files in that directory are browsable and editable.

---

## Switching Between KBs

The dropdown in the top-right lists all available KBs — local `kbs/` folders and anything in `externals`. Selecting one updates `config.json` and reloads the graph, todo, and terminal to point at the new KB. The terminal opens at the KB root automatically.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Graph | D3 v7 (force simulation) |
| Markdown | react-markdown + remark-gfm + rehype-raw |
| Diagrams | Mermaid 11 |
| Editor | Milkdown (ProseMirror) |
| Terminal | xterm.js + node-pty |
| Backend | Express + TypeScript |
| WebSocket | ws |
| File watching | chokidar (SSE push to frontend) |
| Frontmatter parsing | gray-matter |
| Testing | Vitest |
