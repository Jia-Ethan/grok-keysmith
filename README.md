<!-- markdownlint-disable MD013 MD033 MD041 -->

<p align="center">
  <img src="docs/assets/readme/grok-keysmith-preview.png" alt="Illustrative grok-keysmith dry-run terminal preview; actual paths and output vary" width="100%">
</p>
<p align="center"><em>Illustrative preview / 示意预览；实际路径与输出以本机 dry-run 为准。</em></p>

<h1 align="center">grok-keysmith</h1>

<p align="center">先预览、再写入、可撤销的 Grok Build 全局 home-rules 部署工具。</p>

<p align="center">
  <a href="#简体中文">简体中文</a> ·
  <a href="README.en.md">English</a> ·
  <a href="docs/reference.md">Reference</a> ·
  <a href="docs/agent-install.md">智能体安装</a> ·
  <a href="SECURITY.md">Security</a> ·
  <a href="LICENSE">License</a>
</p>

<p align="center">
  <img alt="Python 3.8+" src="https://img.shields.io/badge/Python-3.8+-3776AB?logo=python&logoColor=white">
  <img alt="License MIT" src="https://img.shields.io/badge/license-MIT-6DB33F">
</p>

## 简体中文

Keysmith 系列为本地 AI 工具**安全部署、验证和撤销**自定义指令。`grok-keysmith` 把一份 Markdown 部署为 `~/.grok/rules/99-keysmith.md`，让之后的新 Grok 会话加载它。**不改** `~/.grok/AGENTS.md`。

> [!WARNING]
> 这是**全局 home rules**，没有项目级隔离：会写入 `~/.grok/rules/99-keysmith.md`，向 `config.toml` 注入 compat 隔离块，并把 `~/.grok/hooks/*.json` 整目录改名为 `.disabled`。默认只预览，显式 `--yes` 才写入。先阅读 [`examples/grok-unrestricted.md`](examples/grok-unrestricted.md) 和 [`SECURITY.md`](SECURITY.md)。

### 选择哪个 Keysmith

| 项目 | 目标工具 | 部署面 | 稳妥安装 | Desktop |
| --- | --- | --- | --- | --- |
| [codex-keysmith](https://github.com/Jia-Ethan/codex-keysmith) | Codex | 全局 `~/.codex` 指令 | 稳定 CLI Release | 未签名 Beta |
| [claude-keysmith](https://github.com/Jia-Ethan/claude-keysmith) | Claude Code | 项目 / 用户 `CLAUDE.md` import | 源码 CLI | 未签名 Beta |
| **[grok-keysmith](https://github.com/Jia-Ethan/grok-keysmith)** | Grok Build | 全局 `~/.grok/rules`（不改 `AGENTS.md`） | 稳定 CLI Release | 未签名 Beta |
| [zcode-keysmith](https://github.com/Jia-Ethan/zcode-keysmith) | ZCode App | 用户目录 system-role + wrapper | 仅源码 | 无 |

### 安装方式

1. **稳妥：稳定 CLI。** 使用 [最新稳定 Release](https://github.com/Jia-Ethan/grok-keysmith/releases/latest)（当前 `v0.3.0`）的已校验单文件，或 checkout 同一 tag。该版本没有 `--json` / `--grok-dir`。不要从浮动 `main`（`0.4.0-dev`）当稳定版安装。
2. **更易用：未签名 Desktop Beta。** 见 [desktop-v0.1.0-beta.1](https://github.com/Jia-Ethan/grok-keysmith/releases/tag/desktop-v0.1.0-beta.1)：macOS Apple Silicon DMG 与 Windows x64 NSIS，内嵌开发版 CLI sidecar。无签名、无自动更新、无 Linux GUI。

### 快速开始

**Release 单文件（推荐）：**

```bash
mkdir grok-keysmith-v0.3.0 && cd grok-keysmith-v0.3.0
curl -LO https://github.com/Jia-Ethan/grok-keysmith/releases/download/v0.3.0/grok-keysmith-v0.3.0.py
curl -LO https://github.com/Jia-Ethan/grok-keysmith/releases/download/v0.3.0/SHA256SUMS
grep ' grok-keysmith-v0.3.0.py$' SHA256SUMS | shasum -a 256 -c -
python3 grok-keysmith-v0.3.0.py --version
python3 grok-keysmith-v0.3.0.py --status
python3 grok-keysmith-v0.3.0.py --dry-run
# 确认 ~/.grok 目标、提示词和 isolation 计划后：
python3 grok-keysmith-v0.3.0.py --yes
```

**固定 tag 源码：**

```bash
git clone --branch v0.3.0 --depth 1 https://github.com/Jia-Ethan/grok-keysmith.git
cd grok-keysmith
python3 grok-keysmith.py --version
python3 grok-keysmith.py --status
python3 grok-keysmith.py --dry-run
# 确认 ~/.grok 目标、提示词和 isolation 计划后：
python3 grok-keysmith.py --yes
```

本机需要先有 `~/.grok`（至少运行过一次 Grok）。部署后在项目目录外开一个新会话验证。

### 会修改什么

| 路径 | 会发生什么 |
| --- | --- |
| `~/.grok/rules/99-keysmith.md` | 新建，或先备份再替换 |
| `~/.grok/config.toml` | 注入带标记的 `[compat.*]` 隔离块 |
| `~/.grok/hooks/*.json` | 整目录改名为 `.json.disabled` |
| `~/.grok/.grok-keysmith-manifest.json` | 记录本层所有权，供卸载使用 |

### 如何撤销

以下以 Release 单文件为例；tag checkout 请把文件名换成 `grok-keysmith.py`。

```bash
python3 grok-keysmith-v0.3.0.py --restore-hooks        # 预览 hooks 恢复计划
python3 grok-keysmith-v0.3.0.py --restore-hooks --yes  # 实际恢复 hooks
python3 grok-keysmith-v0.3.0.py --uninstall            # 预览完整卸载
python3 grok-keysmith-v0.3.0.py --uninstall --yes      # 实际执行完整卸载
```

中断事务先 `--status`，再 `--recover` 预览，确认后加 `--yes`。v0.1.x 写在 `AGENTS.md` 的旧部署仍可卸载，但会先做内容所有权校验。

### 平台与 Beta 限制

- CLI CI 覆盖 macOS / Linux / Windows；Python 3.8+。Windows 上 `override` / `ab` 需要原生 `grok.exe`。
- Desktop：仅 macOS Apple Silicon 与 Windows x64，未签名。
- 版本、资产和签名以 [Releases](https://github.com/Jia-Ethan/grok-keysmith/releases) 为准。`main` 上的 `--json` / `run` / `breaktest` 属于开发版。

### 进阶文档

- Compat / hooks / 恢复：[`docs/reference.md`](docs/reference.md)
- Desktop：[`gui/README.md`](gui/README.md) · [`docs/releases/desktop-v0.1.0-beta.1.md`](docs/releases/desktop-v0.1.0-beta.1.md)
- 智能体安装：[`docs/agent-install.md`](docs/agent-install.md)

### 贡献、安全与系列

漏洞走 [`SECURITY.md`](SECURITY.md)。社区：[LINUX DO](https://linux.do)。

- [codex-keysmith](https://github.com/Jia-Ethan/codex-keysmith) — Codex 全局指令
- [claude-keysmith](https://github.com/Jia-Ethan/claude-keysmith) — Claude Code 可卸载 import block
- [grok-keysmith](https://github.com/Jia-Ethan/grok-keysmith) — Grok Build home rules（`~/.grok/rules/99-keysmith.md`，不改 `AGENTS.md`）
- [zcode-keysmith](https://github.com/Jia-Ethan/zcode-keysmith) — ZCode App system-role 入口（仅源码，无 Desktop）
