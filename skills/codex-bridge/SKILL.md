---
name: codex-bridge
description: Delegate coding, review, debugging, or architecture tasks from Antigravity to ChatGPT Desktop Codex threads with autonomous model selection, live sidecar UI inspection, and automatic active-writer queue fallback.
---

# Codex Desktop Bridge (`/codex-bridge`)

Use `codex-desktop-bridge` when the user wants OpenAI Codex (`gpt-6.2-sol`, `gpt-6.2-astra`, `gpt-6.1-terra`, `gpt-6-luna`) to collaborate on the current project while keeping the full conversation and execution trace visible in the **Codex Bridge** side pane (`[Codex Bridge](sidecar://codex-desktop-bridge/codex_bridge/)`) and in the **ChatGPT Desktop** app (`codex://threads/<threadId>`).

## 1. Preferred Path: Native MCP Tools (`codex_*`)

When the `codex-desktop-bridge` MCP server is active, call its tools directly (no temporary prompt files required, and tasks render an interactive status card in chat):

- **`codex_models`**: List available Codex models and `supportedEfforts`.
- **`codex_start`**: Create a new Codex Desktop thread and dispatch the initial task:
  - `prompt` *(required)*: Detailed task description, scope, and acceptance criteria.
  - `cwd`: Project directory path (e.g., current workspace root).
  - `model`: Model ID (e.g., `gpt-6.2-sol` for review/engineering, `gpt-6.2-astra` for deep architecture, `gpt-6.1-terra` for UI/vision, `gpt-6-luna` for fast checks).
  - `effort`: Reasoning depth (`low`, `medium`, `high`, `xhigh`).
  - `title`: Human-readable session title shown in ChatGPT Desktop and the Codex Bridge panel.
  - `sandbox`: `read-only` (default for reviews/audits) or `workspace-write` (when file edits are requested).
  - `open`: `true` to immediately surface the thread in ChatGPT Desktop, or `false` to inspect silently in the Antigravity sidecar panel without acquiring `ChatGPT.exe`'s active writer lock.
- **`codex_send`**: Continue or follow up in an existing `threadId`:
  - `threadId` *(required)*, `prompt` *(required)*, optional `model`, `effort`, `sandbox`, `via` (`auto` | `queue` | `app-server`).
  - With `via: "auto"` (default), if the thread is currently open in ChatGPT Desktop (`already has an active writer`), the bridge automatically falls back to `codex queue` so the task executes live inside the open desktop window.
- **`codex_status`**: Poll a submitted job (`threadId`, `jobId`) and retrieve intermediate `commentary`, executed `commands`, `fileChanges`, and the final `reply`.
- **`codex_thread_detail`**: Fetch full turn-by-turn history and telemetry for `threadId`.
- **`codex_threads`** / **`codex_projects`** / **`codex_open_project`** / **`codex_interrupt`** / **`codex_fork`**.

## 2. CLI Fallback (`scripts/desktop-bridge.mjs`)

If MCP tools are not yet loaded in the current session, invoke `node "$env:USERPROFILE\.gemini\config\plugins\codex-desktop-bridge\scripts\desktop-bridge.mjs"`:

```powershell
# Start a new thread with model & effort selection
node "$env:USERPROFILE\.gemini\config\plugins\codex-desktop-bridge\scripts\desktop-bridge.mjs" start `
  --cwd "<workspace>" --model gpt-6.2-sol --effort high --title "<标题>" `
  --sandbox read-only --approval never --prompt-file "<prompt-file>" --wait

# Follow up on an existing thread (auto-falls back to codex queue if open in ChatGPT Desktop)
node "$env:USERPROFILE\.gemini\config\plugins\codex-desktop-bridge\scripts\desktop-bridge.mjs" send `
  --thread <threadId> --model gpt-6.2-sol --effort high --prompt-file "<prompt-file>" --wait

# Inspect full turn telemetry (commentary, commands, fileChanges, reply)
node "$env:USERPROFILE\.gemini\config\plugins\codex-desktop-bridge\scripts\desktop-bridge.mjs" thread-detail --thread <threadId>
```

## 3. Opening the Sidecar Visual Console

Offer the user the one-click pill `[Codex Bridge](sidecar://codex-desktop-bridge/codex_bridge/)` so they can watch Codex's live reasoning commentary, shell commands, and diffs in Antigravity's right-hand auxiliary pane without locking the thread in `ChatGPT.exe`.
