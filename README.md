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
  <img alt="Release v0.1.1" src="https://img.shields.io/badge/release-v0.1.1-0099CC">
  <img alt="Public repository" src="https://img.shields.io/badge/repository-public-2DA44E">
  <img alt="Python 3.8+" src="https://img.shields.io/badge/Python-3.8+-3776AB?logo=python&logoColor=white">
  <img alt="Grok 0.2.103 verified" src="https://img.shields.io/badge/Grok_Build-0.2.103_verified-FF6600">
  <img alt="License MIT" src="https://img.shields.io/badge/license-MIT-6DB33F">
</p>

## 简体中文

### 这是什么

`grok-keysmith` 是零依赖的单文件 Python 脚本，把一份指令 Markdown 部署为 `~/.grok/AGENTS.md`，让每个新 Grok 会话自动加载。默认预览、显式确认才写入，可随时撤销。`v0.1.1` 是首个公开版本；更早的 private-only `0.1.0` 不在本仓库历史中，不要使用。

**这会改变 Grok 的全局行为，不是项目级设置**：部署写入 `~/.grok/AGENTS.md`（全局规则，所有会话自动发现），并在 `~/.grok/config.toml` 注入 compat 隔离块——关闭 Claude/Cursor 全部兼容层，单独关闭 Codex session import。内置示例提示词会让模型不再用拒绝式话术回答，把 reverse-shell / bypass 一类请求当作本地样本或文学模板处理，也覆盖成人题材内容。**这不是安全边界，是一次影响很广的行为切换**——用前请打开 [`examples/grok-unrestricted.md`](examples/grok-unrestricted.md) 看一眼，或用 `--file` 换成你自己的指令。

内置指令确实会显著降低模型对敏感请求的拒绝率，具体覆盖到什么边界与模型版本相关，也会随模型更新变化；本项目不在公开文档中给出针对性测试方法或具体绕过案例。

### 快速开始（macOS / Linux）

```bash
git clone --branch v0.1.1 --depth 1 https://github.com/Jia-Ethan/grok-keysmith.git
cd grok-keysmith
test "$(git describe --tags --exact-match)" = "v0.1.1"
test "$(shasum -a 256 examples/grok-unrestricted.md | awk '{print $1}')" = "cfee264f4f4683c6470595de90616744521e4f65ad81cc9a0a6f0061abaedc7b"

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

应显示 `~/.grok/AGENTS.md` 为 `scope=global enabled`；Claude/Cursor 的全部 compatibility surface 为 `OFF`；Codex 的 `sessions` 为 `OFF`。

### 它会改哪些文件

| 路径 | 会发生什么 |
| --- | --- |
| `~/.grok/AGENTS.md` | 新建，或先备份再替换 |
| `~/.grok/config.toml` | 注入带标记的 `[compat.*]` 隔离块（先备份） |
| `~/.grok/hooks/*.json` | 整体隔离为 `.json.disabled`（先备份） |
| `~/.grok/.grok-keysmith-manifest.json` | 记录这次部署改了什么，供后续卸载用 |

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

- Python 3.8+；已验证 Grok Build CLI `0.2.103`，默认模型 `grok-4.5`。
- macOS / Linux 是主要支持范围；Windows 在 v0.1.1 未测试。
- `~/.grok/AGENTS.md` 是全局的，没有项目级隔离；hooks 是整目录改名隔离，不能选择性保留个别 hook。
- 完整限制清单、compat 隔离细节、维护者验证步骤见 [`docs/reference.md`](docs/reference.md)。

---

English version: [`README.en.md`](README.en.md). 智能体安装提示词和同系列项目见 [`docs/agent-install.md`](docs/agent-install.md)。
