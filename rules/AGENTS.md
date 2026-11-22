# Codex 桌面协作

当用户要求 Codex 参与且要在桌面端看见协作时，由当前 Gemini 会话负责选型、拆任务、协调和验收。

在系统终端调用 `node <插件目录>/scripts/desktop-bridge.mjs`。用户级安装目录通常是 `~/.gemini/config/plugins/codex-desktop-bridge`（若当前工作区存在该目录也可直接调用）。

## 工作模式

1. **查看可用模型与已注册项目（按需）**：
   - `models`：获取当前可用模型与支持的推理深度（`supportedEfforts`），由 Gemini 根据任务复杂度自行选择（如复杂代码设计/深查用 `gpt-6.2-astra` 或 `gpt-6.2-sol`，计算机视觉/界面排查用 `gpt-6.1-terra`，轻量快速排查用 `gpt-6-luna`）。
   - `projects`：查看 ChatGPT 桌面端已记录的项目目录。若目标目录是全新文件夹，可先用 `open-project --cwd <目录> [--mkdir]` 或在 `start` 时加 `--open-project` 让桌面端加载该工作区。

2. **自动新开桌面会话并选模型（推荐，无需用户提前手动开窗口）**：
   - 把子任务背景、范围和验收标准写入临时提示文件（如系统临时目录）。
   - 在 Antigravity 工具环境中调用时，**建议加上 `--wait` 并将命令行工具设为较短的异步等待时间让系统在后台托管执行**（因为终端工具退出时可能会回收脱离终端的子进程，不加 `--wait` 仅适合独立常驻 shell）：
     `start --cwd <项目目录> --model <模型ID> --effort <深度> --title "<易辨认标题>" --sandbox read-only --approval never --prompt-file <提示文件> --wait [--open]`
   - 默认以只读沙箱 `read-only` + `never` 执行审查/诊断；需要修改代码时再按需指定 `--sandbox workspace-write`。
   - stderr 会立即输出 `threadId` 与 `desktopUrl`（`codex://threads/<threadId>`），执行完成后 stdout 输出完整 JSON（含 `reply`）。如果需要立刻在桌面端展示，可加 `--open` 或把 `desktopUrl` 给用户点击直达。

3. **在已有桌面会话中继续协作 / 追问**：
   - 若用户指定了已有会话标题、UUID 或终端设置了 `CODEX_DESKTOP_THREAD_ID`，可用 `find --title "<完整标题>" [--cwd <目录>]` 确认唯一的 `threadId`。
   - 对同一 `threadId` 派发后续追问时：
     - 若目标会话正在 ChatGPT 桌面端打开且无需改模型，可直接用 `send --thread <会话ID> --prompt-file <提示文件>`（走 `codex queue` 投递），随后用 `status --thread <会话ID> --job <任务ID>` 查回复。
     - 若需切换模型、推理深度、沙箱策略，或对非桌面活动线程直接续跑，加上 `--model` / `--effort` / `--via app-server --wait`。每个会话同一时间只派发一个任务。

4. **后台轮询与验收**：
   - 投递返回 `submitted` 后，Gemini 可先并行做本端独立工作，随后用 `status --thread <会话ID> --job <任务ID>` 获取结果。
   - `inProgress` 表示仍在处理，`completed` 才表示已有最终回复；若返回 `pending` 且带 `workerState: "failed"`，查看附带 `error` 并向用户汇报。
   - 若投递返回 `uncertain`，先用返回的 `jobId` 调 `status` 确认，避免重复派发。完成后结合实际 diff、测试或文件证据完成验收。
