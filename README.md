# Codex Desktop Bridge (v0.3.0)

让 Antigravity 中的 Gemini 与本机 **ChatGPT 桌面端 Codex** 深度协同：支持**自动创建项目会话、自主选择模型与推理深度、遇到桌面端激活窗口自动回退实时队列（`codex queue`）**，并内置 **Antigravity 侧边栏可视化监控面板（Sidecar UI）** 与 **MCP Server / 内嵌状态卡片**。

---

## 核心特性

1. **全自动新建会话与动态选模型（`start` / `codex_start`）**
   - 无需提前手动在 ChatGPT 桌面端建窗口；Gemini 可根据任务类型自动挑选 `gpt-6.2-sol`、`gpt-6.2-astra`、`gpt-6.1-terra`、`gpt-6-luna` 及推理深度（`low` / `medium` / `high` / `xhigh`）。
2. **只读旁观不抢锁的 Sidecar 可视化控制台（`sidecars/codex_bridge`）**
   - 在 Antigravity 右侧分屏或侧边栏直接实时查看 Codex 会话的**用户提示词、中间推理思考（`commentary`）、执行的终端命令及退出码/输出预览（`commands`）、修改的文件列表（`fileChanges`）和最终回复**。
   - 解决了直接点开 ChatGPT 桌面端窗口会导致 `ChatGPT.exe` 独占 `active writer` 写入锁、进而无法从外部动态切模型的痛点；需要人工介入时点一下面板右上角 **「↗ 桌面端打开」** 即可一键唤起原生桌面窗口。
   - 支持在面板底部直接**新建桌面会话、续聊当前会话、切换模型/沙箱权限、一键分支会话（Fork）和停止运行中回合（Interrupt）**。
3. **智能双通道续聊与自动回退（`send --via auto`）**
   - 当目标会话未在桌面端焦点打开时，走 `codex app-server` 支持动态覆写模型与推理深度；
   - 当检测到你已在 ChatGPT 桌面端打开该会话（`already has an active writer`）时，自动无缝回退到 `codex queue`，把任务实时投进你正在查看的桌面端窗口中滚动执行。
4. **内置零依赖 MCP Server 与聊天内嵌卡片（`scripts/mcp-server.mjs` + `ui/mcp-card.html`）**
   - 提供 `codex_models`、`codex_projects`、`codex_open_project`、`codex_threads`、`codex_thread_detail`、`codex_start`、`codex_send`、`codex_status`、`codex_interrupt`、`codex_fork` 等 10 个原生 MCP 工具，并在对话流内渲染交互式状态卡片。

---

## 安装与更新

需要将仓库目录同步或安装到 `~/.gemini/config/plugins/codex-desktop-bridge`：

```powershell
git clone https://github.com/tfrgcvb/codex-desktop-bridge.git
Copy-Item -Path .\codex-desktop-bridge\* -Destination "$env:USERPROFILE\.gemini\config\plugins\codex-desktop-bridge" -Recurse -Force
```

---

## CLI 快速参考

```powershell
# 1. 查看本机 Codex 可用模型与推理深度
node scripts/desktop-bridge.mjs models

# 2. 查看最近会话列表 / 查看指定会话完整回合详情（含命令与思考过程）
node scripts/desktop-bridge.mjs threads --limit 10
node scripts/desktop-bridge.mjs thread-detail --thread <UUID>

# 3. 自动新建会话并派发任务
node scripts/desktop-bridge.mjs start --cwd . --model gpt-6.2-sol --effort high --title "Sol 代码审查" --sandbox read-only --prompt-file prompt.txt --wait

# 4. 在已有会话继续追问（若已在桌面端打开会自动回退到 codex queue）
node scripts/desktop-bridge.mjs send --thread <UUID> --model gpt-6.2-sol --prompt-file followup.txt --wait

# 5. 分支已有会话 / 中断当前正在运行的回合
node scripts/desktop-bridge.mjs fork --thread <UUID> --title "方案 B 实验"
node scripts/desktop-bridge.mjs interrupt --thread <UUID>
```
