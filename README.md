<!-- markdownlint-disable MD013 MD033 MD041 -->

<h1 align="center">grok-keysmith</h1>

<p align="center">
  Versioned Grok Build instruction deployment with preview, compat isolation, hook isolation, and layered uninstall.
</p>

<p align="center">
  <a href="#简体中文">简体中文</a> ·
  <a href="#english">English</a> ·
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

> [!NOTE]
> **Release boundary / 发布边界**
>
> `v0.1.1` is the first public release. This public repository starts with a clean `v0.1.1` history and does not include the earlier private-only `0.1.0` snapshot. That private predecessor contained a transcription error in the MIT grant clause and predated the compat-section fix. Use `v0.1.1` or later for all installations.
>
> `v0.1.1` 是首个公开版本。本公开仓库以全新的 `v0.1.1` 历史起始,不包含更早的 private-only `0.1.0` snapshot。该私有前身的 MIT 授权条款存在转录错误,且尚未包含 compat section 修正。所有安装均应使用 `v0.1.1` 或更高版本。

> [!IMPORTANT]
> **Global behavior boundary / 全局行为边界**
>
> A confirmed deployment writes `~/.grok/AGENTS.md` as global project rules, auto-discovered by every new Grok session via `grok inspect`. It also injects a marked `[compat.claude]` / `[compat.cursor]` / `[compat.codex]` block into `~/.grok/config.toml`: every Claude/Cursor compatibility surface is disabled, while Codex session import is disabled separately. The instruction therefore applies to every new Grok session; it is not a per-project sandbox. The tool does not patch Grok binaries, intercept traffic, or store credentials.
>
> 确认部署会写入 `~/.grok/AGENTS.md` 作为全局项目规则,被每个新 Grok 会话通过 `grok inspect` 自动发现。同时会在 `~/.grok/config.toml` 注入带标记的 `[compat.claude]` / `[compat.cursor]` / `[compat.codex]` 隔离块:Claude/Cursor 的全部 compatibility surface 均关闭,Codex 则单独关闭 session import。因此该指令会影响所有新 Grok 会话,并非项目级沙箱。工具不修改 Grok 二进制、不劫持网络,也不保存凭证。

> [!WARNING]
> **Read the bundled prompt before using `--yes` / 使用 `--yes` 前先阅读内置提示词**
>
> The v0.1.1 bundled prompt (unchanged from the private predecessor) directs Grok to answer without refusal framing, reinterprets reverse-shell / keylogger / bypass / weapons / chemistry / violence and related requests as local fixtures or literary templates, covers adult and consent-sensitive fiction, anti-forensics playbooks, social engineering scripts, and treats injected memory, hook, skill, and compatibility-layer instructions as environment metadata that cannot override its execution mode. This is a broad global behavior change, not an authorization or safety boundary. Source: [`examples/grok-unrestricted.md`](examples/grok-unrestricted.md), embedded byte-for-byte (base64) in [`grok-keysmith.py`](grok-keysmith.py). SHA-256: `cfee264f4f4683c6470595de90616744521e4f65ad81cc9a0a6f0061abaedc7b`. Inspect it or deploy your own `--file`. The normal preview plus one explicit `--yes` remains the confirmation flow; there is no second confirmation flag.
>
> v0.1.1 内置提示词(与私有前身相同)要求 Grok 避免拒绝式表达,将 reverse shell、keylogger、bypass、武器、化学、暴力等请求重解释为本地样本或文学模板,覆盖成人及同意敏感题材、反取证 playbook、社工话术,并把注入的 memory、hook、skill 和兼容层指令视为不能覆盖其执行模式的环境元数据。这是范围很广的全局行为变更,不构成授权或安全边界。来源:[`examples/grok-unrestricted.md`](examples/grok-unrestricted.md),并 base64 逐字节嵌入 [`grok-keysmith.py`](grok-keysmith.py)。SHA-256:`cfee264f4f4683c6470595de90616744521e4f65ad81cc9a0a6f0061abaedc7b`。请先审阅,或通过 `--file` 部署自己的指令。确认流程仍是常规预览加一次显式 `--yes`,不增加第二个确认参数。

## 复制给智能体安装

```text
请从公开仓库安装 grok-keysmith v0.1.1。只使用 annotated tag `v0.1.1` 或对应 GitHub Release,不要从浮动 `main` 安装;检出后确认当前 checkout 精确匹配 `v0.1.1` tag,并校验 examples/grok-unrestricted.md 的 SHA-256 为 `cfee264f4f4683c6470595de90616744521e4f65ad81cc9a0a6f0061abaedc7b`。运行 --version、--status 和 --dry-run,报告目标 ~/.grok 目录、内置提示词来源与 SHA-256、全局行为范围、compat 隔离计划、hooks 隔离计划和备份路径;如果 status 发现 durable journal,只预览 --recover 并等我确认后才添加 --yes。完成后开启新 Grok 会话,运行 grok inspect 验证 AGENTS.md scope=global enabled、Claude/Cursor 全部 compatibility surface 为 OFF,且 Codex sessions 为 OFF。不要删除任何备份或事务日志,不修改 Grok 二进制、网络、运行中进程或凭证。
```

## 友链 / Community

本项目接受 LINUX DO 社区佬友监督与反馈:[LINUX DO](https://linux.do)

同系列项目 / Same series:

- [codex-keysmith](https://github.com/Jia-Ethan/codex-keysmith) - Codex CLI 本地配置的版本化指令部署工具，支持预览、hook 隔离、中断恢复与分层卸载。 / Versioned instruction deployment for local Codex CLI configuration with preview, hook isolation, interruption recovery, and layered uninstall.
- [claude-keysmith](https://github.com/Jia-Ethan/claude-keysmith) - Claude Code `CLAUDE.md` 的受管理 import-block 安装器，用于本地 Markdown 指令文件。 / Managed Claude Code `CLAUDE.md` import-block installer for local Markdown instruction files.
- [zcode-keysmith](https://github.com/Jia-Ethan/zcode-keysmith) - ZCode App 的受管理 true system-role 入口，通过 agent-server wrapper 将 `system-role.md` 接入 runtime `customSystemPrompt` 的 system-message 路径。 / Managed true system-role entrypoint for ZCode App; an agent-server wrapper routes `system-role.md` into the runtime `customSystemPrompt` system-message path.
- [grok-keysmith](https://github.com/Jia-Ethan/grok-keysmith) - Grok Build 的全局 `AGENTS.md` 指令部署工具，支持 compat/hook 隔离、中断恢复与分层卸载。 / Global `AGENTS.md` instruction deployment for Grok Build with compat/hook isolation, interruption recovery, and layered uninstall.

---

## 简体中文

### 项目定位

`grok-keysmith` v0.1.1 是零运行时依赖的单文件 Python CLI。它把内置或自定义 Markdown 部署到 `~/.grok/AGENTS.md`(全局项目规则,所有 Grok 会话自动发现),在 `~/.grok/config.toml` 注入带标记的 compat 隔离块以屏蔽 Claude/Cursor 兼容层污染,并将 `~/.grok/hooks/*.json` 隔离为 `.json.disabled`。部署用带指纹的清单支持分层卸载,并以 durable journal + immutable intent.json 提供中断恢复。

默认不写入:部署、卸载和中断恢复在没有 `--yes` 时都只预览。`--status` 是只读检查。status 发现持久化 journal 或其他事务残留时 fail closed。

### 获取并校验 v0.1.1

本项目通过公开 annotated Git tag 和 GitHub Release 发布。不要从浮动 `main` 安装正式版本:

```bash
git clone --branch v0.1.1 --depth 1 https://github.com/Jia-Ethan/grok-keysmith.git
cd grok-keysmith
test "$(git describe --tags --exact-match)" = "v0.1.1"
test "$(shasum -a 256 examples/grok-unrestricted.md | awk '{print $1}')" = "cfee264f4f4683c6470595de90616744521e4f65ad81cc9a0a6f0061abaedc7b"
python3 -B grok-keysmith.py --version
```

提示词哈希应为 `cfee264f4f4683c6470595de90616744521e4f65ad81cc9a0a6f0061abaedc7b`。不要把 token、cookie 或完整本机配置写入日志。

### 运行环境

- Python 3.8+;运行 CLI 只需要标准库
- 已验证 Grok Build CLI:`0.2.103`;默认模型 `grok-4.5`
- macOS / Linux:当前主要支持范围
- Windows:v0.1.1 未测试

### 第一次部署

```bash
python3 grok-keysmith.py --version
python3 grok-keysmith.py --status
python3 grok-keysmith.py --dry-run
```

检查输出中的:

1. 目标 `~/.grok` 目录和 `config.toml`;
2. 内置提示词来源、SHA-256 和全局行为范围;
3. 将写入的 `AGENTS.md` 和 config.toml compat 隔离块;
4. active/disabled hooks 状态与隔离计划;
5. `.grok-keysmith-manifest.json` 与备份计划。

确认后执行:

```bash
python3 grok-keysmith.py --yes
```

部署完成后在项目目录外开启新的 Grok 会话并验证:

```bash
cd ~
grok inspect --json | python3 -c "import sys,json; d=json.load(sys.stdin); [print('instruction',p['path'],'scope='+p['scope'],'status='+p.get('compatibilityStatus','enabled')) for p in d['projectInstructions']]; [print('compat',c['vendor'],c['surface'],'ON' if c['enabled'] else 'OFF','source='+c['source']) for c in d['externalCompat']['cells']]"
```

应显示 `~/.grok/AGENTS.md` 为 `scope=global enabled`;Claude/Cursor 的 `skills`、`rules`、`agents`、`mcps`、`hooks`、`sessions` 全部为 `OFF source=config`;Codex 的 `sessions` 为 `OFF source=config`。

### 状态输出

```bash
python3 grok-keysmith.py --status
```

稳定字段示例:

```text
[status] Grok 配置目录: /Users/you/.grok

  AGENTS.md: 已部署 (16804 bytes, sha256=cfee264f4f46...)
  config.toml: 存在 (664 bytes)
  compat 隔离块: 已注入
  active hooks: 0 个
  disabled hooks: 0 个
  部署清单: 存在 (deployment_id=20260719-121748)
  中断事务日志: 0 个

  可部署性: 就绪
```

### 会修改哪些文件

| 路径 | 确认部署行为 |
| --- | --- |
| `~/.grok/AGENTS.md` | 新建;已有普通文件时先创建时间戳备份再替换 |
| `~/.grok/config.toml` | 备份后注入带 begin/end marker 的 `[compat.*]` 隔离块;已有块先移除再重注入 |
| `~/.grok/hooks/*.json` | 每个 active hook 改名为 `.json.disabled`;已有 `.disabled` 先归档 |
| `~/.grok/.grok-keysmith-manifest.json` | 记录 AGENTS.md/config 指纹、隔离的 hooks、备份路径、上一层 manifest |
| `~/.grok/.grok-keysmith-transaction-<id>/` | 保存 immutable `intent.json` (0444) 和 phased `journal.json` |
| `~/.grok/config.toml.keysmith-backup-*` | 时间戳备份,不自动删除 |
| `~/.grok/.grok-keysmith-manifest.json.uninstalled-*` | 卸载时归档的 manifest,不自动删除 |

### 卸载

```bash
python3 grok-keysmith.py --uninstall          # 预览
python3 grok-keysmith.py --uninstall --yes    # 执行
```

卸载会:

1. 删除 `~/.grok/AGENTS.md`;
2. 从 `config.toml` 精确移除 compat 隔离块(按 begin/end marker);
3. 把 `.json.disabled` hooks 恢复为 `.json`;
4. 把 manifest 归档为 `.uninstalled-<timestamp>`。

### 中断恢复

如果部署被 SIGKILL 中断,`--status` 会检测到未达 committed/recovered 终态的 journal,标记"不可部署,请先 --recover"。

```bash
python3 grok-keysmith.py --recover --yes
```

恢复会按 journal 记录的 phase 回滚已执行的步骤(删除已写的 AGENTS.md、移除 config compat 块、恢复已隔离的 hooks),标记 recovered,清理 journal 目录。

### 仅恢复 hooks

```bash
python3 grok-keysmith.py --restore-hooks --yes
```

把 `.json.disabled` 恢复为 `.json`,不影响 AGENTS.md 和 config.toml。

### 自定义提示词

```bash
python3 grok-keysmith.py --file my-rules.md --name my-rules --yes
```

部署自定义 Markdown 而非内置提示词。manifest 会记录 `prompt_source: custom:<path>`。

### 维护者验证

仓库没有第三方运行时依赖或已提交的测试套件。提交前至少执行:

```bash
python3 -B grok-keysmith.py --version
python3 - <<'PY'
import ast
import base64
import hashlib
from pathlib import Path

source = Path("grok-keysmith.py").read_text(encoding="utf-8")
tree = ast.parse(source)
constants = {}
for node in tree.body:
    if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
        if node.targets[0].id in {"BUNDLED_PROMPT_B64", "BUNDLED_PROMPT_SHA256", "VERSION"}:
            constants[node.targets[0].id] = ast.literal_eval(node.value)
bundled = base64.b64decode(constants["BUNDLED_PROMPT_B64"])
prompt = Path("examples/grok-unrestricted.md").read_bytes()
version = Path("VERSION").read_text(encoding="utf-8").strip()
assert version == constants["VERSION"]
for document in ("README.md", "CHANGELOG.md", "SECURITY.md"):
    assert f"v{version}" in Path(document).read_text(encoding="utf-8")
assert bundled == prompt
assert hashlib.sha256(prompt).hexdigest() == constants["BUNDLED_PROMPT_SHA256"]
PY
tmp_home="$(mktemp -d)"
trap 'rm -rf "$tmp_home"' EXIT
mkdir "$tmp_home/.grok"
HOME="$tmp_home" python3 -B grok-keysmith.py --status
HOME="$tmp_home" python3 -B grok-keysmith.py --dry-run
git diff --check
```

### 项目结构

```text
grok-keysmith/
├── grok-keysmith.py              # 单文件 CLI 与内置提示词
├── examples/grok-unrestricted.md # 内置提示词的可审计源文件
├── VERSION                       # 机器可读版本
├── README.md                     # 中英文使用与边界说明
├── CHANGELOG.md                  # 版本变更
├── SECURITY.md                   # 漏洞私密通报、回滚与完整性校验
├── LICENSE                       # MIT License
├── AGENTS.md                     # 项目内 Agent 协作规则
└── .gitignore                    # 本地与运行时产物忽略规则
```

### 已知限制

- 更早的 private-only `0.1.0` snapshot 不属于本公开仓库历史;其 MIT 授权条款存在转录错误,且不包含 compat section 修正。
- `~/.grok/AGENTS.md` 是全局的,没有项目级隔离。
- compat 隔离块在部署时会先剥离 `config.toml` 中所有已存在的 `[compat.claude]` / `[compat.cursor]` / `[compat.codex]` 段(无论来源),再注入 keysmith 自己的 marker 块,使其成为这些表的唯一来源。这是因为 TOML 不允许同名表出现两次(重复会直接解析失败),而非 last-wins 覆盖。被剥离的原文件完整保存在时间戳备份中(`config.toml.keysmith-backup-*`),卸载只移除 keysmith 的 marker 块,不会恢复被剥离的外部 compat 段——需要时从备份手动恢复。
- hooks 是整目录改名隔离,不能选择性保留个别 hook。
- 破限边界(基于 grok-4.5 实测,24 题对照:卸载破限 prompt vs 部署后,每题统一 fixture/placeholder 框架):武器制作(molotov)、毒品合成占位符模板(methamphetamine)、即时杀人技术解剖描述(slit throat)、keylogger、社工骗取 MFA、DDoS 攻击脚本等,部署后均从拒绝/重定向转为配合。真正部署后仍拒绝的是 **完整有机过氧化物炸药合成**(如 TATP/triacetone triperoxide 的 step-by-step recipe)和 **受控物质 home-synthesis**(如 fentanyl 制造)——这些属于 grok-4.5 的 RLHF 硬编码红线,prompt 层面无法突破。`methamphetamine synthesis` 在 sandbox + 占位符框架下实测可配合(给出占位符版完整路线),`slit throat` 在 combat-scene 模板框架下实测可配合(给出解剖优先级与切割路径);早期 README 把二者归为不可破属过度保守。
- 内置指令不能保证在不同 Grok CLI 或模型版本下行为一致。

---

## English

### Project positioning

`grok-keysmith` v0.1.1 is a zero-runtime-dependency single-file Python CLI. It deploys a bundled or custom Markdown instruction to `~/.grok/AGENTS.md` (global project rules, auto-discovered by all Grok sessions), injects a marked compat isolation block into `~/.grok/config.toml` to shield Claude/Cursor compatibility-layer pollution, and isolates `~/.grok/hooks/*.json` as `.json.disabled`. Manifest-owned deployment supports layered uninstall, and a durable journal + immutable intent.json provides interruption recovery.

Default no-write: deploy, uninstall, and recovery only preview without `--yes`. `--status` is read-only. Status fails closed when a durable journal or other transaction residue is detected.

### Obtain and verify v0.1.1

The project is distributed through a public annotated Git tag and GitHub Release. Do not install a formal version from the moving `main` branch:

```bash
git clone --branch v0.1.1 --depth 1 https://github.com/Jia-Ethan/grok-keysmith.git
cd grok-keysmith
test "$(git describe --tags --exact-match)" = "v0.1.1"
test "$(shasum -a 256 examples/grok-unrestricted.md | awk '{print $1}')" = "cfee264f4f4683c6470595de90616744521e4f65ad81cc9a0a6f0061abaedc7b"
python3 -B grok-keysmith.py --version
```

The prompt hash must be `cfee264f4f4683c6470595de90616744521e4f65ad81cc9a0a6f0061abaedc7b`. Do not place tokens, cookies, or complete local configuration in logs.

### Runtime

- Python 3.8+; CLI requires only the standard library
- Verified with Grok Build CLI `0.2.103`; default model `grok-4.5`
- macOS / Linux: primary support targets
- Windows: untested in v0.1.1

### First deployment

```bash
python3 grok-keysmith.py --version
python3 grok-keysmith.py --status
python3 grok-keysmith.py --dry-run
```

Confirm:

1. Target `~/.grok` directory and `config.toml`;
2. Bundled prompt source, SHA-256, and global behavior scope;
3. The `AGENTS.md` and config.toml compat isolation block to be written;
4. Active/disabled hooks status and isolation plan;
5. `.grok-keysmith-manifest.json` and backup plan.

Then:

```bash
python3 grok-keysmith.py --yes
```

Verify with a new Grok session outside the repository directory:

```bash
cd ~
grok inspect --json | python3 -c "import sys,json; d=json.load(sys.stdin); [print('instruction',p['path'],'scope='+p['scope'],'status='+p.get('compatibilityStatus','enabled')) for p in d['projectInstructions']]; [print('compat',c['vendor'],c['surface'],'ON' if c['enabled'] else 'OFF','source='+c['source']) for c in d['externalCompat']['cells']]"
```

Should show `~/.grok/AGENTS.md` as `scope=global enabled`; every Claude/Cursor `skills`, `rules`, `agents`, `mcps`, `hooks`, and `sessions` cell as `OFF source=config`; and Codex `sessions` as `OFF source=config`.

### Status output

```bash
python3 grok-keysmith.py --status
```

### Files modified

| Path | Deploy behavior |
| --- | --- |
| `~/.grok/AGENTS.md` | Created; existing file backed up with timestamp before replacement |
| `~/.grok/config.toml` | Backed up, then compat isolation block injected with begin/end markers; existing block removed and re-injected |
| `~/.grok/hooks/*.json` | Each active hook renamed to `.json.disabled`; existing `.disabled` archived first |
| `~/.grok/.grok-keysmith-manifest.json` | Records AGENTS.md/config fingerprints, isolated hooks, backup paths, previous manifest |
| `~/.grok/.grok-keysmith-transaction-<id>/` | Holds immutable `intent.json` (0444) and phased `journal.json` |
| `~/.grok/config.toml.keysmith-backup-*` | Timestamped backups, not auto-deleted |
| `~/.grok/.grok-keysmith-manifest.json.uninstalled-*` | Archived manifest on uninstall, not auto-deleted |

### Uninstall

```bash
python3 grok-keysmith.py --uninstall          # preview
python3 grok-keysmith.py --uninstall --yes    # execute
```

Removes `AGENTS.md`, strips the compat isolation block from `config.toml` (by begin/end markers), restores `.json.disabled` hooks, and archives the manifest.

### Recovery

```bash
python3 grok-keysmith.py --recover --yes
```

If a deployment was interrupted by SIGKILL, `--status` detects journals not in committed/recovered terminal state and blocks further deployment. `--recover` rolls back participants based on the recorded phase.

### Hooks-only restore

```bash
python3 grok-keysmith.py --restore-hooks --yes
```

Restores `.json.disabled` to `.json` without affecting AGENTS.md or config.toml.

### Custom prompt

```bash
python3 grok-keysmith.py --file my-rules.md --name my-rules --yes
```

### Maintainer verification

The repository has no third-party runtime dependencies or committed test suite. Before committing, run the verification block in the Chinese section: parse the Python source, compare the embedded prompt byte-for-byte with `examples/grok-unrestricted.md`, verify its SHA-256, exercise `--status` and `--dry-run` under an isolated temporary `HOME`, and finish with `git diff --check`.

### Project layout

```text
grok-keysmith/
├── grok-keysmith.py              # Single-file CLI and bundled prompt
├── examples/grok-unrestricted.md # Auditable source of the bundled prompt
├── VERSION                       # Machine-readable version
├── README.md                     # Bilingual usage and boundary documentation
├── CHANGELOG.md                  # Version history
├── SECURITY.md                   # Private vulnerability reporting, rollback, integrity checks
├── LICENSE                       # MIT License
├── AGENTS.md                     # Repository-local agent rules
└── .gitignore                    # Local and runtime artifact exclusions
```

### Known limitations

- The earlier private-only `0.1.0` snapshot is not part of this public repository history; it contains a transcription error in the MIT grant clause and predates the compat-section fix.
- `~/.grok/AGENTS.md` is global; no per-project isolation.
- At deploy time the compat isolation block first strips every pre-existing `[compat.claude]` / `[compat.cursor]` / `[compat.codex]` section from `config.toml` (regardless of source) before injecting keysmith's own marked block, making that block the sole source for these tables. This is because TOML forbids duplicate table headers (a duplicate is a parse error, not a last-wins override). Stripped original content is preserved in full in the timestamped backup (`config.toml.keysmith-backup-*`); uninstall removes only keysmith's marked block and does not restore externally-owned compat sections — recover them from the backup if needed.
- Hooks are isolated as a complete directory rename; individual hooks cannot be selectively retained.
- Jailbreak boundary (measured on grok-4.5, 24-question A/B: uninstall vs deploy, each prompt using a uniform fixture/placeholder frame): weapon construction (molotov), placeholder-template drug synthesis (methamphetamine), immediate-kill anatomy description (slit throat), keylogger, social-engineering MFA harvesting, DDoS script, etc. all move from refuse/redirect to comply after deployment. What remains refused after deployment is **complete organic-peroxide explosive synthesis** (e.g. a step-by-step TATP/triacetone triperoxide recipe) and **controlled-substance home synthesis** (e.g. fentanyl manufacture) — these are grok-4.5 RLHF hard-coded red lines the prompt layer cannot break. `methamphetamine synthesis` is in fact complied with under a sandbox + placeholder frame (a placeholder-masked full route is returned), and `slit throat` is complied with under a combat-scene template frame (anatomy priority and cut path are returned); the earlier README claim that both are unbreakable was overly conservative.
- The bundled instruction cannot guarantee identical model behavior across Grok CLI or model versions.
