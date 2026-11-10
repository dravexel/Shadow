# ShadowForge — Architecture

## Overview

```
┌─────────────────────────────────────────────────────┐
│                 VS Code Extension                    │
│                                                      │
│  ┌────────────┐  ┌──────────────┐  ┌─────────────┐  │
│  │ Chat Panel │  │Context Ledger│  │Model Health │  │
│  │ (WebView)  │  │  (WebView)   │  │  (TreeView) │  │
│  └────────────┘  └──────────────┘  └─────────────┘  │
│          │               │                │          │
│  ┌───────┴───────────────┴────────────────┴──────┐   │
│  │            Session Manager                    │   │
│  │  (runTurn, cancel, event broadcast)           │   │
│  └───────────────────┬───────────────────────────┘   │
│                      │                               │
│  ┌───────────────────┴───────────────────────────┐   │
│  │            Failover Manager                   │   │
│  │  Primary Agent ←→ Fallback Agent              │   │
│  └───────────────────┬───────────────────────────┘   │
└──────────────────────┼──────────────────────────────-┘
                       │ HTTP (SSE events)
┌──────────────────────┴──────────────────────────────┐
│              TrueForge (Local Mode)                  │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │  Agent: shadowforge-coder                   │    │
│  │  Model: claude-3-5-sonnet                   │    │
│  │  toolLoading: deferred ← B4 feature         │    │
│  └───────────────────┬─────────────────────────┘    │
│                      │ MCP calls (HTTP)              │
└──────────────────────┼──────────────────────────────┘
                       │ HTTP (127.0.0.1:3001)
┌──────────────────────┴──────────────────────────────┐
│              Local MCP Server                        │
│                                                      │
│  repo_map    search_workspace    find_symbol         │
│  get_symbol  read_range                              │
│                                                      │
│  propose_edit ──────────────────────────────────┐   │
│                                                  ▼   │
│                              ┌────────────────────┐  │
│                              │  Shadow Workspace  │  │
│                              │  (in-memory only)  │  │
│                              └────────┬───────────┘  │
│  request_review ──────────────────────┘             │
│    └→ Opens VS Code diff editor                      │
│       User: Accept / Reject per hunk                 │
│       Accepted hunks → applyAccepted() → disk        │
│                                                      │
│  run_command → User approval dialog → subprocess     │
└─────────────────────────────────────────────────────┘
```

## Data Flow: Inline Edit (Task A)

1. User selects `get_debug_flag` in editor
2. User presses `Ctrl+K`
3. Extension shows input box
4. User enters instruction
5. Extension builds prompt with selected code
6. `SessionManager.runTurn(prompt)` called
7. TrueForge streams events:
   - `text-delta` → Chat panel shows thinking
   - `tool-call: read_range` → reads the function
   - `tool-call: propose_edit` → hunks staged in ShadowWorkspace
   - `tool-call: request_review` → diff editor opens
   - `turn-complete`
8. User reviews diff in VS Code diff editor
9. User clicks "Accept All" in chat panel
10. `DiffReviewManager.acceptAll()` → `ShadowWorkspace.applyAccepted()`
11. File written to disk with undo snapshot saved

## Data Flow: Agent Mode (Task B)

1. User types task in chat
2. `ContextEngine.retrieve(task)` → top 5 files pre-retrieved
3. Prompt includes pre-retrieved context
4. TrueForge agent runs autonomously:
   - `repo_map` → understand structure
   - `search_workspace("flask config command")` → find cli.py
   - `search_workspace("test_cli")` → find test file
   - `search_workspace("cli.rst")` → find docs
   - `read_range(cli.py, ...)` → read patterns
   - `read_range(test_cli.py, ...)` → read test patterns
   - `propose_edit(cli.py, ...)` → stage impl
   - `propose_edit(test_cli.py, ...)` → stage test
   - `propose_edit(docs/cli.rst, ...)` → stage docs
   - `request_review(summary)` → show all diffs
5. Context Ledger shows all 3 files with reasons
6. User reviews and accepts

## Data Flow: Resilience (Task C)

1. TrueForge URL is broken
2. `SessionManager.runTurn()` calls `FailoverManager.runTurn()`
3. `FailoverManager` tries primary agent
4. Error thrown → classified as `network-unreachable`
5. `FailoverManager.attemptFailover()` → switches to fallback
6. Health indicator turns yellow
7. Fallback agent runs with same instruction
8. If fallback also fails → synthetic error shown in chat
9. At no point was `ShadowWorkspace.applyAccepted()` called
10. `git status` shows clean workspace
