# Codex 桌面协作 (v0.3.0)

当用户要求 Codex 参与且要在桌面端或侧边栏看见协作时，由当前 Gemini 会话负责选型、拆任务、协调和验收。

## 1. 优先使用内置 MCP 工具与可视化面板

- **侧边栏实时监控面板（只读不抢锁）**：可向用户提供一键开启胶囊 `[Codex Bridge](sidecar://codex-desktop-bridge/codex_bridge/)`，在 Antigravity 右侧面板实时旁观 Codex 的中间思考（`commentary`）、执行的终端命令（`commands`）、修改的文件（`fileChanges`）及最终回复，**不会占用 `ChatGPT.exe` 的 `active writer` 写入锁**，并支持随时点击「↗ 桌面端打开」接管。
- **内置 MCP 工具（若当前会话已加载 `codex-desktop-bridge` MCP 服务）**：
  - `codex_models` / `codex_projects` / `codex_threads` / `codex_thread_detail`
  - `codex_start`：自动新开会话、选定 `model`（如 `gpt-6.2-sol`、`gpt-6.2-astra`、`gpt-6.1-terra`、`gpt-6-luna`）和 `effort`（`low` / `medium` / `high` / `xhigh`），并在聊天流内渲染实时状态卡片。
  - `codex_send`：在已有会话继续追问（默认 `via: "auto"`，若该会话已在 ChatGPT 桌面端打开并持有写入锁，会自动无缝回退到 `codex queue` 实时投递）。
  - `codex_status` / `codex_interrupt` / `codex_fork` / `codex_open_project`。

## 2. CLI 脚本调用方式（通用兼容）

在系统终端调用 `node <插件目录>/scripts/desktop-bridge.mjs`（默认安装路径 `~/.gemini/config/plugins/codex-desktop-bridge`）：

1. **查看可用模型、项目与会话列表**：
   - `models [--include-hidden]`：获取可用模型与支持的推理深度（`supportedEfforts`）。
   - `projects [--limit <N>]` / `open-project --cwd <目录> [--mkdir]`
   - `threads [--cwd <目录>] [--title <关键词>] [--limit <N>]`
   - `thread-detail --thread <会话ID> [--limit <N>]`：读取完整回合链路（含 `commentary`、`commands`、`fileChanges`、`reply`）。

2. **自动新开桌面会话并选模型（无需手动预设窗口）**：
   - 将任务说明写入临时提示文件，执行：
     `start --cwd <项目目录> --model <模型ID> --effort <深度> --title "<易辨认标题>" --sandbox read-only --approval never --prompt-file <提示文件> --wait [--open]`
   - 默认以只读沙箱 `read-only` + `never` 执行审查/诊断；需要修改代码时再指定 `--sandbox workspace-write`。
   - 若希望保持外部 `app-server` 随时切模型，可不加 `--open`，通过 `[Codex Bridge](sidecar://codex-desktop-bridge/codex_bridge/)` 面板旁观；若希望立刻弹出 ChatGPT 桌面窗口，加 `--open`。

3. **在已有会话中继续协作 / 分支 / 中断**：
   - 续聊：`send --thread <会话ID> [--model <模型ID>] [--effort <深度>] [--via auto|queue|app-server] --prompt-file <提示文件> [--wait]`
   - 查询状态：`status --thread <会话ID> --job <任务ID>`
   - 中断当前回合：`interrupt --thread <会话ID> [--turn <回合ID>]`
   - 分支会话：`fork --thread <会话ID> [--title "<新标题>"] [--cwd <目录>] [--model <模型ID>]`
