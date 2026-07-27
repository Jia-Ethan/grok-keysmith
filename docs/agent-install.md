<!-- markdownlint-disable MD013 -->

# 复制给智能体安装 / Copy this to an agent

```text
请从公开仓库安装 grok-keysmith v0.1.1。只使用 annotated tag `v0.1.1` 或对应 GitHub Release,不要从浮动 `main` 安装;检出后确认当前 checkout 精确匹配 `v0.1.1` tag,并校验 examples/grok-unrestricted.md 的 SHA-256 为 `cfee264f4f4683c6470595de90616744521e4f65ad81cc9a0a6f0061abaedc7b`。运行 --version、--status 和 --dry-run,报告目标 ~/.grok 目录、内置提示词来源与 SHA-256、全局行为范围、compat 隔离计划、hooks 隔离计划和备份路径;如果 status 发现 durable journal,只预览 --recover 并等我确认后才添加 --yes。完成后开启新 Grok 会话,运行 grok inspect 验证 AGENTS.md scope=global enabled、Claude/Cursor 全部 compatibility surface 为 OFF,且 Codex sessions 为 OFF。不要删除任何备份或事务日志,不修改 Grok 二进制、网络、运行中进程或凭证。
```
