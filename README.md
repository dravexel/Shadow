# ShadowForge

**AI Coding Agent powered by TrueForge — Approval-first editing for VS Code**

> Built for the Techfest IIT Bombay TrueFoundry Forge-a-thon 2026-27.

---

## What is ShadowForge?

ShadowForge is an Antigravity-like AI coding agent that runs inside VS Code.

Its central philosophy: **The AI can propose anything, but YOU control what reaches your files.**

Every proposed change is staged in an in-memory *shadow workspace* and shown as a diff. You accept or reject individual hunks before anything is written to disk.

---

## Features

| Feature | Status |
|---|---|
| Chat with AI agent | ✅ |
| Inline edit (Ctrl+K) | ✅ |
| Multi-file agent mode | ✅ |
| Live event streaming | ✅ |
| Task cancellation | ✅ |
| Shadow workspace (never writes directly) | ✅ |
| Per-hunk accept/reject | ✅ |
| Undo accepted changes | ✅ |
| Conflict detection | ✅ |
| Context Ledger (file selection reasoning) | ✅ |
| Model failover (primary → fallback) | ✅ |
| MCP tool server | ✅ |
| TrueForge deferred tool loading | ✅ |

---

## Quick Start

### 1. Prerequisites

- Node.js 18+
- VS Code 1.90+
- TrueForge local mode

### 2. Start TrueForge

```bash
npx @truefoundry/trueforge@latest
```

This starts the TrueForge server on `http://localhost:8790`.

### 3. Configure agents in TrueForge

1. Open `http://localhost:3000` in your browser.
2. Import `agents/coder.yaml` as a new agent named `shadowforge-coder`.
3. Import `agents/fallback/agent.yaml` as `shadowforge-fallback`.
4. Add your model API key in TrueForge settings.

### 4. Install the extension

```bash
cd shadowforge
npm install
npm run compile
```

Then press `F5` in VS Code to launch the Extension Development Host, OR:

```bash
npx vsce package
code --install-extension shadowforge-0.1.0.vsix
```

### 5. Configure the extension

Open VS Code Settings and search for "ShadowForge":

| Setting | Default | Description |
|---|---|---|
| `shadowforge.trueforgeUrl` | `http://localhost:8790` | TrueForge server URL |
| `shadowforge.primaryAgentId` | `shadowforge-coder` | Primary agent |
| `shadowforge.fallbackAgentId` | `shadowforge-fallback` | Fallback agent |
| `shadowforge.mcpPort` | `3001` | Local MCP server port |

### 6. Use it

- **Chat**: Click the ⬛ ShadowForge icon in the Activity Bar.
- **Inline Edit**: Select code, press `Ctrl+K`, enter your instruction.
- **Cancel**: Click the ✕ Cancel button or run `ShadowForge: Cancel Current Task`.

---

## Architecture

```
VS Code Extension
├── Chat Panel (WebviewView)
├── Context Ledger (WebviewView)
├── Model Health (TreeView)
└── Commands (inlineEdit, cancel, accept, reject, undo)

TrueForge (local mode, port 8790)
├── Sessions & Turns
├── Agent: shadowforge-coder (primary)
│   └── Model: claude-3-5-sonnet (or configured)
├── Agent: shadowforge-fallback
│   └── Model: gpt-4o-mini (or configured)
└── Event stream → VS Code extension

Local MCP Server (port 3001, 127.0.0.1 only)
├── repo_map
├── search_workspace
├── find_symbol / get_symbol
├── read_range
├── propose_edit → Shadow Workspace (in-memory)
├── request_review → VS Code diff editor
└── run_command (allowlisted, approval required)

Shadow Workspace (in-memory)
├── Proposed contents overlay
├── Per-hunk accept/reject
├── Conflict detection
└── Undo history
```

---

## MCP Tools

| Tool | Description |
|---|---|
| `repo_map` | Compact repository tree |
| `search_workspace` | BM25 lexical search |
| `find_symbol` | Find function/class/variable |
| `get_symbol` | Read symbol implementation |
| `read_range` | Read line range from file |
| `propose_edit` | Stage changes (shadow only) |
| `request_review` | Trigger diff review panel |
| `run_command` | Run allowlisted commands (with approval) |

---

## Evaluation Tasks

See [`eval/evaluation.md`](eval/evaluation.md) for detailed setup and verification steps for all three official tasks.

---

## License

MIT

