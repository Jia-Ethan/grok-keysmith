<!-- markdownlint-disable MD013 MD033 MD041 -->

<h1 align="center">grok-keysmith</h1>

<p align="center">
  Versioned Grok Build instruction deployment with preview, compat isolation, hook isolation, and layered uninstall.
</p>

<p align="center">
  <a href="#简体中文">简体中文</a> ·
  <a href="README.en.md">English</a> ·
  <a href="docs/reference.md">Reference</a> ·
  <a href="docs/agent-install.md">智能体安装 / Agent install</a> ·
  <a href="CHANGELOG.md">Changelog</a> ·
  <a href="SECURITY.md">Security</a> ·
  <a href="LICENSE">License</a>
</p>

<p align="center">
  <img alt="Release v0.3.0" src="https://img.shields.io/badge/release-v0.3.0-0099CC">
  <img alt="Public repository" src="https://img.shields.io/badge/repository-public-2DA44E">
  <img alt="Python 3.8+" src="https://img.shields.io/badge/Python-3.8+-3776AB?logo=python&logoColor=white">
  <img alt="Grok 4.6 targeted" src="https://img.shields.io/badge/Grok_Build-4.6_targeted-FF6600">
  <img alt="License MIT" src="https://img.shields.io/badge/license-MIT-6DB33F">
</p>

## 简体中文

### 这是什么

`grok-keysmith` 是零依赖的单文件 Python 脚本，把一份指令 Markdown 部署为 `~/.grok/rules/99-keysmith.md`，让每个新 Grok 会话自动加载。默认预览、显式确认才写入，可随时撤销。`v0.1.1` 是首个公开版本；`v0.3.0` 针对 Grok 4.6 的对齐层重构部署面与内置指令；更早的 private-only `0.1.0` 不在本仓库历史中，不要使用。

**这会改变 Grok 的全局行为，不是项目级设置**：部署写入 `~/.grok/rules/99-keysmith.md`（home rules，所有会话总是扫描），并在 `~/.grok/config.toml` 注入 compat 隔离块——关闭 Claude/Cursor 全部兼容层，单独关闭 Codex session import。**`~/.grok/AGENTS.md` 不再被本工具触碰**：人物卡、agent 档案或任何全局指令都可以继续放在那里，与 keysmith 的部署互不影响。内置示例指令以交付契约形式覆盖逆向工程与渗透测试工作流（本地样本/占位符框架），也会明显降低模型对敏感请求的拒绝率。**这不是安全边界，是一次影响很广的行为切换**——用前请打开 [`examples/grok-unrestricted.md`](examples/grok-unrestricted.md) 看一眼，或用 `--file` 换成你自己的指令。

内置指令覆盖到什么边界与模型版本相关，也会随模型更新变化；Grok 4.6 的对齐在模型权重层，指令契约提升的是已覆盖领域的配合度，不改变权重层硬拒绝的领域。本项目不在公开文档中给出针对性测试方法或具体绕过案例。

### 快速开始（macOS / Linux）

```bash
git clone --branch v0.3.0 --depth 1 https://github.com/Jia-Ethan/grok-keysmith.git
cd grok-keysmith
test "$(git describe --tags --exact-match)" = "v0.3.0"
test "$(shasum -a 256 examples/grok-unrestricted.md | awk '{print $1}')" = "d693411fd79f57c5e805e7bcbb27b42bacdd11e6a6af8858ab998017196dc898"

python3 grok-keysmith.py --version
python3 grok-keysmith.py --status
python3 grok-keysmith.py --dry-run

# 确认目标目录、提示词来源、compat/hooks 隔离计划无误后：
python3 grok-keysmith.py --yes
```

不要从浮动 `main` 安装正式版本。部署完成后在项目目录外开启新的 Grok 会话验证：

```bash
cd ~
grok inspect --json | python3 -c "import sys,json; d=json.load(sys.stdin); [print('instruction',p['path'],'scope='+p['scope'],'status='+p.get('compatibilityStatus','enabled')) for p in d['projectInstructions']]; [print('compat',c['vendor'],c['surface'],'ON' if c['enabled'] else 'OFF','source='+c['source']) for c in d['externalCompat']['cells']]"
```

应显示 `~/.grok/rules/99-keysmith.md` 已启用；Claude/Cursor 的全部 compatibility surface 为 `OFF`；Codex 的 `sessions` 为 `OFF`。`~/.grok/AGENTS.md` 不受影响。

### 它会改哪些文件

| 路径 | 会发生什么 |
| --- | --- |
| `~/.grok/rules/99-keysmith.md` | 新建，或先备份再替换 |
| `~/.grok/config.toml` | 注入带标记的 `[compat.*]` 隔离块（先备份） |
| `~/.grok/hooks/*.json` | 整体隔离为 `.json.disabled`（先备份） |
| `~/.grok/.grok-keysmith-manifest.json` | 记录这次部署改了什么，供后续卸载用 |

不触碰 `~/.grok/AGENTS.md`：人物卡、agent 档案与 keysmith 部署完全解耦。卸载时若指令文件内容已不是本次部署写入的（如 AGENTS.md 后来换成了人物卡），会保留原文件。

完整字段和边界条件见 [`docs/reference.md`](docs/reference.md)。

### 撤销

```bash
# 只想拿回 hooks：
python3 grok-keysmith.py --restore-hooks --yes

# 整体撤销这次部署：
python3 grok-keysmith.py --uninstall          # 先预览
python3 grok-keysmith.py --uninstall --yes    # 确认卸载
```

### 出问题了怎么办

| 现象 | 应该做的事 |
| --- | --- |
| 部署被 SIGKILL 中断 | `--status` 会报告未达终态的 journal 并阻止继续部署；先 `--recover` 预览，确认后 `--recover --yes` |
| 想彻底清掉旧备份 | 工具从不自动删除 `*.keysmith-backup-*` 或 `.uninstalled-*`，需人工确认后再清理 |

### 兼容性与限制

- Python 3.8+；内置指令针对 Grok Build 模型 `grok-4.6` 重写。
- macOS / Linux 是主要支持范围；Windows 未测试。
- `~/.grok/rules/` 是全局 home rules，没有项目级隔离；hooks 是整目录改名隔离，不能选择性保留个别 hook。
- v0.1.x 部署（写入 `~/.grok/AGENTS.md`）仍可被 v0.3.0 卸载，卸载前会做内容所有权校验。
- 完整限制清单、compat 隔离细节、维护者验证步骤见 [`docs/reference.md`](docs/reference.md)。

### 友链 / Community

本项目接受 LINUX DO 社区佬友监督与反馈: [LINUX DO](https://linux.do)

同系列项目 / Same series:

- [codex-keysmith](https://github.com/Jia-Ethan/codex-keysmith) - Codex CLI 本地配置的版本化指令部署工具，支持预览、hook 隔离、中断恢复与分层卸载。
- [claude-keysmith](https://github.com/Jia-Ethan/claude-keysmith) - Claude Code `CLAUDE.md` 的受管理 import-block 安装器，用于本地 Markdown 指令文件。
- [zcode-keysmith](https://github.com/Jia-Ethan/zcode-keysmith) - ZCode App 的受管理 true system-role 入口。
- [grok-keysmith](https://github.com/Jia-Ethan/grok-keysmith) - Grok Build 的 home rules 指令部署工具（`~/.grok/rules/99-keysmith.md`），与 AGENTS.md 人物卡解耦，支持 compat/hook 隔离、中断恢复与分层卸载。

---

English version: [`README.en.md`](README.en.md)。智能体安装提示词见 [`docs/agent-install.md`](docs/agent-install.md)。
