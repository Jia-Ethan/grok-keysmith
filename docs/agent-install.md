<!-- markdownlint-disable MD013 -->

# 复制给智能体安装 / Copy this to an agent

```text
请从公开仓库安装 grok-keysmith v0.4.0。只使用签名 annotated tag `v0.4.0` 或对应 GitHub Release,不要从浮动 `main` 安装;检出后确认当前 checkout 精确匹配 `v0.4.0` tag,并校验 examples/grok-unrestricted.md 的 SHA-256 为 `d693411fd79f57c5e805e7bcbb27b42bacdd11e6a6af8858ab998017196dc898`。运行 --version、--status 和 --dry-run,报告目标 ~/.grok 目录、内置提示词来源与 SHA-256、全局行为范围、compat 隔离计划、hooks 隔离计划和备份路径;如果 status 发现 durable journal,只预览 --recover 并等我确认后才添加 --yes。完成后开启新 Grok 会话,验证 ~/.grok/rules/99-keysmith.md 已加载、Claude/Cursor 全部 compatibility surface 为 OFF,且 Codex sessions 为 OFF;确认 ~/.grok/AGENTS.md 未被改动。不要删除任何备份或事务日志,不修改 Grok 二进制、网络、运行中进程或凭证。
```
