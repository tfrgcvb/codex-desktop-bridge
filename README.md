# Codex Desktop Bridge

让 Antigravity 中的 Gemini 把任务发给 ChatGPT 桌面端里的 Codex，并取回回复。Gemini 负责拆任务、跟进和验收。你可以直接在 Codex 桌面会话里看到发来的任务和模型回应。

例如，Gemini 可以把代码审查交给 GPT‑6.2 Sol，同时自己跑测试。收到审查结果后，Gemini 可以追问，或者把发现和测试结果一起交给你。

## 快速开始

需要同一台机器上的 Antigravity、ChatGPT 桌面端、Node.js 20+，以及支持 `codex queue` 的 Codex CLI。先在启动 Antigravity 的终端运行 `codex queue --help`。如果 CLI 在其他位置，可以用 `CODEX_BIN` 指定可执行文件的绝对路径。若使用自定义 `CODEX_HOME`，桥接脚本和桌面端需要访问同一份本地会话历史。

```bash
git clone https://github.com/tfrgcvb/codex-desktop-bridge.git
agy plugin install ./codex-desktop-bridge
```

1. 在 ChatGPT 桌面端切到 **Codex**。为项目开一个本地会话，选择模型，发送一条消息，给会话取一个容易辨认的标题，例如「Sol 协作」。
2. 保持 Codex 会话打开，再开启一个新的 Antigravity 会话。第一次派活时，把桌面会话的完整标题或 UUID 告诉 Gemini。也可以在启动 `agy` 的终端设置 `CODEX_DESKTOP_THREAD_ID`。
3. 发一个范围明确的任务，确认它出现在 Codex 桌面端，并让 Gemini 带回结果。

> 用桌面桥接把当前改动交给「Sol 协作」做只读审查，同时继续跑测试。取回 Sol 的意见后，判断哪些问题需要修，并给我文件位置。

## 工作原理

插件在 Antigravity 中加载一条协作规则。Gemini 把任务写入提示文件，脚本加上唯一的任务标记，再用 `codex queue` 投递到指定桌面会话。脚本通过 Codex App Server 的 `thread/turns/list` 查询本地会话历史，按标记找到对应回合，并在回合完成后取回回复。

同一个桌面会话适合一次处理一个派发任务。多个独立任务可以使用不同的 Codex 会话。会话所选的模型和权限会应用到收到的任务。

## 手动检查

在仓库根目录执行。把任务写入 `task.txt`，用 `find` 查出匹配会话的 UUID，确认它属于你的项目。`send` 返回的 `jobId` 用于下一步查询。

```bash
node scripts/desktop-bridge.mjs find --title "Sol 协作"
node scripts/desktop-bridge.mjs send --thread THREAD_UUID --prompt-file task.txt
node scripts/desktop-bridge.mjs status --thread THREAD_UUID --job JOB_UUID
```

| 状态 | 含义 |
| --- | --- |
| `submitted` | 投递命令已返回成功，可以用任务 ID 查询进展。 |
| `pending` | 最近的会话历史里还没找到该任务。请检查目标会话是否打开。 |
| `inProgress` | 已匹配到任务，Codex 正在处理。 |
| `completed` | 对应回合已完成，结果里包含回复。 |
| `mixedTurn` | 同一回合混入了另外一条输入，请在桌面会话里确认回复归属。 |
| `uncertain` | 投递结果未确认。先用原任务 ID 查询，避免重复发送。 |
| `outsideScanWindow` | 脚本查询了最近 60 个回合，未匹配到这条任务。 |

其他结束状态包括 `interrupted`、`failed` 和 `completedWithoutReply`。可以在目标桌面会话里查看详情。

## 当前验证范围

这是 0.1.0 原型。已通过模拟进程验证投递、历史分页、回复匹配和状态处理，并用真实 Codex CLI 验证了历史查询接口。Antigravity 到 ChatGPT 桌面端的完整联动有待实机验证。

[构建 Antigravity 插件](https://antigravity.google/docs/build-plugins) · [Codex CLI](https://learn.chatgpt.com/docs/cli/reference) · [Codex App Server](https://learn.chatgpt.com/docs/app-server)
