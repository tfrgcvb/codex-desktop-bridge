# Codex Desktop Bridge

让 Antigravity 中的 Gemini 自动在本地 Codex（支持在 ChatGPT 桌面端直接查看）创建项目对话、选择模型与推理深度、下发任务并取回回复。同时也兼容往已有 ChatGPT 桌面端会话队列中追加任务。

## 环境要求

- Node.js 20+
- ChatGPT 桌面端（Windows Store 版或桌面端自带的 `codex.exe` 已支持自动发现，也可通过 `CODEX_BIN` 显式指定）
- 若使用自定义 `CODEX_HOME`，桥接脚本和桌面端需指向同一份本地状态目录（默认 `~/.codex`）。

## 安装到 Antigravity

将本插件目录安装（或复制到）`~/.gemini/config/plugins/codex-desktop-bridge`：

```bash
# 若已安装 agy CLI
agy plugin install ./codex-desktop-bridge
```

（Windows 下若无 `agy` CLI，可直接将整个 `codex-desktop-bridge` 目录复制到 `%USERPROFILE%\.gemini\config\plugins\codex-desktop-bridge`。）

## 新增能力与命令一览

```bash
# 1. 查看本机可用的 Codex 模型及支持的推理深度
node scripts/desktop-bridge.mjs models

# 2. 查看桌面端已记录的项目与最近工作目录
node scripts/desktop-bridge.mjs projects

# 3. 在桌面端打开/绑定一个项目目录（可选 --mkdir 自动建目录）
node scripts/desktop-bridge.mjs open-project --cwd "E:\path\to\project"

# 4. 自动新开会话 + 自选模型/推理深度 + 后台执行首轮任务（--open 可同时弹出桌面端窗口）
node scripts/desktop-bridge.mjs start \
  --cwd "E:\path\to\project" \
  --model gpt-6.2-sol \
  --effort high \
  --title "只读审查" \
  --sandbox read-only \
  --prompt-file task.txt \
  --open

# 5. 查询指定任务状态与最终回复
node scripts/desktop-bridge.mjs status --thread THREAD_UUID --job JOB_UUID

# 6. 在已有会话中续聊（无参数覆盖时走 codex queue，带 --model/--effort/--via app-server 时走 app-server）
node scripts/desktop-bridge.mjs send --thread THREAD_UUID --prompt-file followup.txt

# 7. 按标题查找已有桌面会话
node scripts/desktop-bridge.mjs find --title "Sol 协作"
```

## 状态说明

| 状态 | 含义 |
| --- | --- |
| `submitted` | 已提交并确认进入运行或队列，可用 `jobId` 查进度。 |
| `pending` | 历史里暂未出现该任务（若后台 worker 启动失败会附带 `workerState` 和 `error`）。 |
| `inProgress` | 已匹配到回合，Codex 正在处理中。 |
| `completed` | 回合已完成，返回结果中包含 `reply`。 |
| `mixedTurn` | 同一回合混入了其他输入，请在桌面会话里确认归属。 |
| `uncertain` | 投递确认超时或异常，请先用原 `jobId` 查 `status` 避免重复派发。 |
| `outsideScanWindow` | 扫描最近 60 个回合仍未找到该任务。 |

## 注意事项

- Windows 下如果一个全新的 `--cwd` 文件夹从未在 ChatGPT 桌面端里打开过，Electron 侧边栏的项目列表缓存可能不会立刻自动新增项目条目；可配合 `open-project --cwd <目录>` 或在 `start` 时加 `--open` / 点击返回的 `codex://threads/<threadId>` 直达该会话。
- 后台异步执行模式默认使用 `--approval never` 配合 `--sandbox read-only`（或按需 `--sandbox workspace-write`），避免无人值守子进程卡在审批弹窗。
