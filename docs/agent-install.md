<!-- markdownlint-disable MD013 -->

# 复制给智能体安装 / Copy this to an agent

## 简体中文

```text
请从公开仓库安装 grok-keysmith v0.7.0。只使用签名 annotated tag `v0.7.0` 或对应 GitHub Release,不要从浮动 `main` 安装;检出后确认当前 checkout 精确匹配 `v0.7.0` tag,并校验 examples/grok-unrestricted.md 的 SHA-256 为 `3c669118d67690856f3ac11cd0f2beb687aa6e718dc76ed3f54c0751e01e48c9`。运行 --version、--status 和 --dry-run,报告目标 ~/.grok 目录、内置提示词来源与 SHA-256、全局行为范围、compat 隔离计划、hooks 隔离计划和备份路径;如果 status 发现 durable journal,只预览 --recover 并等我确认后才添加 --yes。完成后开启新 Grok 会话,验证 ~/.grok/rules/99-keysmith.md 已加载、Claude/Cursor 全部 compatibility surface 为 OFF,且 Codex sessions 为 OFF;确认 ~/.grok/AGENTS.md 未被改动。不要删除任何备份或事务日志,不修改 Grok 二进制、网络、运行中进程或凭证。
```

## English

```text
Install grok-keysmith v0.7.0 from the public repository. Use only the signed annotated tag `v0.7.0` or the matching GitHub Release; do not install from floating `main`. After checkout, confirm the working tree matches the `v0.7.0` tag exactly, and verify that the SHA-256 of examples/grok-unrestricted.md is `3c669118d67690856f3ac11cd0f2beb687aa6e718dc76ed3f54c0751e01e48c9`. Run --version, --status, and --dry-run, then report the target ~/.grok directory, the bundled prompt source and its SHA-256, the global behavior scope, the compat isolation plan, the hooks isolation plan, and backup paths. If --status finds a durable journal, only preview --recover and wait for my confirmation before adding --yes. When finished, open a new Grok session and verify that ~/.grok/rules/99-keysmith.md is loaded, that every Claude/Cursor compatibility surface is OFF and Codex sessions are OFF, and that ~/.grok/AGENTS.md is untouched. Do not delete any backups or transaction journals, and do not modify the Grok binary, network, running processes, or credentials.
```
