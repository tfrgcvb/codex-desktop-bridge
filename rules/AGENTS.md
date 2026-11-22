# Codex 桌面协作

当用户要求 Codex 参与且要在桌面端看见协作时，由当前 Gemini 会话负责拆任务、协调和验收。已明确绑定桌面会话后，可以主动委派边界清楚的独立诊断、审查或实现。使用用户指定的会话 ID，或采用当前终端的 `CODEX_DESKTOP_THREAD_ID`。目标须是同一台机器上已经在 Codex 模式打开的会话。对每个桌面会话一次委派一个任务，独立任务可分别使用不同会话。

在系统终端调用 `node <插件目录>/scripts/desktop-bridge.mjs`。用户级 `agy plugin install` 的默认目录是 `~/.gemini/config/plugins/codex-desktop-bridge`。用户给出桌面会话标题时，可用 `find --title <完整标题>` 查 ID，确认结果唯一且目录符合用户指定的项目。把子任务的背景、范围和验收要求写到临时提示文件，用 `send --thread <会话ID> --prompt-file <提示文件>` 投递。设置了 `CODEX_DESKTOP_THREAD_ID` 时可省略 `--thread`。保留返回的 `threadId` 和 `jobId`，汇报已投递后继续做独立工作。

用 `status --thread <会话ID> --job <任务ID>` 读取对应回复。`submitted` 代表提交给队列，`pending` 代表历史中尚未找到这条任务，`inProgress` 代表对应回合正在工作，`completed` 才代表有最终回复。投递结果为 `uncertain` 时，使用返回的任务 ID 查询，避免重复投递。如果当前任务需要等待结果，在做完独立工作后查询并告诉用户当前状态。完成后依据实际 diff、测试或证据验收。
