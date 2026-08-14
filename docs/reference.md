<!-- markdownlint-disable MD013 -->

# 命令参考与内部机制 / Command reference and internals

日常使用只需要 [`README.md`](../README.md) 的「快速开始」；本页是完整字段、状态机和维护者验证细节。

---

## 简体中文

### 状态输出

```bash
python3 grok-keysmith.py --status
```

稳定字段示例：

```text
[status] Grok 配置目录: /Users/you/.grok

  rules/99-keysmith.md: 已部署 (5787 bytes, sha256=b5be2fe24e90...)
  config.toml: 存在 (664 bytes)
  compat 隔离块: 已注入
  active hooks: 0 个
  disabled hooks: 0 个
  部署清单: 存在 (deployment_id=20260813-101500)
  中断事务日志: 0 个

  可部署性: 就绪
```

### 会修改哪些文件

| 路径 | 确认部署行为 |
| --- | --- |
| `~/.grok/rules/99-keysmith.md` | 新建；已有普通文件时先创建时间戳备份再替换。`~/.grok/AGENTS.md` 不被触碰，人物卡/agent 档案与部署解耦 |
| `~/.grok/config.toml` | 备份后注入带 begin/end marker 的 `[compat.*]` 隔离块；已有块先移除再重注入 |
| `~/.grok/hooks/*.json` | 每个 active hook 改名为 `.json.disabled`；已有 `.disabled` 先归档 |
| `~/.grok/.grok-keysmith-manifest.json` | 记录指令文件/config 指纹、隔离的 hooks、备份路径、上一层 manifest |
| `~/.grok/.grok-keysmith-transaction-<id>/` | 保存 immutable `intent.json` (0444) 和 phased `journal.json` |
| `~/.grok/config.toml.keysmith-backup-*` | 时间戳备份，不自动删除 |
| `~/.grok/.grok-keysmith-manifest.json.uninstalled-*` | 卸载时归档的 manifest，不自动删除 |

### 卸载

```bash
python3 grok-keysmith.py --uninstall          # 预览
python3 grok-keysmith.py --uninstall --yes    # 执行
```

卸载会：删除部署的指令文件（v0.2.x 为 `~/.grok/rules/99-keysmith.md`，v0.1.x 为 manifest 记录的路径）；从 `config.toml` 精确移除 compat 隔离块（按 begin/end marker）；把 `.json.disabled` hooks 恢复为 `.json`；把 manifest 归档为 `.uninstalled-<timestamp>`。删除前做内容所有权校验：当前文件 SHA-256 与 manifest 记录不一致时保留文件（防止误删后来替换的内容，如人物卡）。

### 中断恢复

如果部署被 SIGKILL 中断，`--status` 会检测到未达 committed/recovered 终态的 journal，标记"不可部署，请先 --recover"。

```bash
python3 grok-keysmith.py --recover --yes
```

恢复会按 journal 记录的 phase 回滚已执行的步骤（删除本事务写入的指令文件、移除 config compat 块、恢复已隔离的 hooks），标记 recovered，清理 journal 目录。指令文件删除同样经过 SHA-256 所有权校验。

### 仅恢复 hooks

```bash
python3 grok-keysmith.py --restore-hooks --yes
```

把 `.json.disabled` 恢复为 `.json`，不影响指令文件和 config.toml。

### 自定义提示词

```bash
python3 grok-keysmith.py --file my-rules.md --name my-rules --yes
```

部署自定义 Markdown 而非内置提示词。manifest 会记录 `prompt_source: custom:<path>`。

### 维护者验证

仓库没有第三方运行时依赖或已提交的测试套件。提交前至少执行：

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
├── docs/
│   ├── reference.md
│   ├── agent-install.md
│   └── legacy/
├── README.md / README.en.md      # 使用与边界说明
├── CHANGELOG.md                  # 版本变更
├── SECURITY.md                   # 漏洞私密通报、回滚与完整性校验
├── LICENSE                       # MIT License
├── AGENTS.md                     # 项目内 Agent 协作规则
└── .gitignore                    # 本地与运行时产物忽略规则
```

### 已知限制

- 更早的 private-only `0.1.0` snapshot 不属于本公开仓库历史；其 MIT 授权条款存在转录错误，且不包含 compat section 修正。
- `~/.grok/rules/` 是全局 home rules，没有项目级隔离。
- compat 隔离块在部署时会先剥离 `config.toml` 中所有已存在的 `[compat.claude]` / `[compat.cursor]` / `[compat.codex]` 段（无论来源），再注入 keysmith 自己的 marker 块，使其成为这些表的唯一来源。这是因为 TOML 不允许同名表出现两次（重复会直接解析失败），而非 last-wins 覆盖。被剥离的原文件完整保存在时间戳备份中（`config.toml.keysmith-backup-*`），卸载只移除 keysmith 的 marker 块，不会恢复被剥离的外部 compat 段——需要时从备份手动恢复。
- hooks 是整目录改名隔离，不能选择性保留个别 hook。
- 内置指令不能保证在不同 Grok CLI 或模型版本下行为一致。

---

## English

### Status output

```bash
python3 grok-keysmith.py --status
```

### Files modified

| Path | Deploy behavior |
| --- | --- |
| `~/.grok/rules/99-keysmith.md` | Created; existing file backed up with timestamp before replacement. `~/.grok/AGENTS.md` is not touched; persona cards and agent profiles stay decoupled |
| `~/.grok/config.toml` | Backed up, then compat isolation block injected with begin/end markers; existing block removed and re-injected |
| `~/.grok/hooks/*.json` | Each active hook renamed to `.json.disabled`; existing `.disabled` archived first |
| `~/.grok/.grok-keysmith-manifest.json` | Records instruction-file/config fingerprints, isolated hooks, backup paths, previous manifest |
| `~/.grok/.grok-keysmith-transaction-<id>/` | Holds immutable `intent.json` (0444) and phased `journal.json` |
| `~/.grok/config.toml.keysmith-backup-*` | Timestamped backups, not auto-deleted |
| `~/.grok/.grok-keysmith-manifest.json.uninstalled-*` | Archived manifest on uninstall, not auto-deleted |

### Uninstall

```bash
python3 grok-keysmith.py --uninstall          # preview
python3 grok-keysmith.py --uninstall --yes    # execute
```

Removes the deployed instruction file (`~/.grok/rules/99-keysmith.md` for v0.2.x, or the manifest-recorded path for v0.1.x), strips the compat isolation block from `config.toml` (by begin/end markers), restores `.json.disabled` hooks, and archives the manifest. Deletion is ownership-checked: a file whose current SHA-256 no longer matches the manifest record is preserved.

### Recovery

```bash
python3 grok-keysmith.py --recover --yes
```

If a deployment was interrupted by SIGKILL, `--status` detects journals not in committed/recovered terminal state and blocks further deployment. `--recover` rolls back participants based on the recorded phase.

### Hooks-only restore

```bash
python3 grok-keysmith.py --restore-hooks --yes
```

Restores `.json.disabled` to `.json` without affecting the instruction file or config.toml.

### Custom prompt

```bash
python3 grok-keysmith.py --file my-rules.md --name my-rules --yes
```

### Maintainer verification

The repository has no third-party runtime dependencies or committed test suite. Before committing, run the verification block in the Chinese section above: parse the Python source, compare the embedded prompt byte-for-byte with `examples/grok-unrestricted.md`, verify its SHA-256, exercise `--status` and `--dry-run` under an isolated temporary `HOME`, and finish with `git diff --check`.

### Project layout

```text
grok-keysmith/
├── grok-keysmith.py
├── examples/grok-unrestricted.md
├── VERSION
├── docs/
├── README.md / README.en.md
├── CHANGELOG.md
├── SECURITY.md
├── LICENSE
├── AGENTS.md
└── .gitignore
```

### Known limitations

- The earlier private-only `0.1.0` snapshot is not part of this public repository history; it contains a transcription error in the MIT grant clause and predates the compat-section fix.
- `~/.grok/rules/` is global home rules; no per-project isolation.
- At deploy time the compat isolation block first strips every pre-existing `[compat.claude]` / `[compat.cursor]` / `[compat.codex]` section from `config.toml` (regardless of source) before injecting keysmith's own marked block, making that block the sole source for these tables. This is because TOML forbids duplicate table headers (a duplicate is a parse error, not a last-wins override). Stripped original content is preserved in full in the timestamped backup (`config.toml.keysmith-backup-*`); uninstall removes only keysmith's marked block and does not restore externally-owned compat sections — recover them from the backup if needed.
- Hooks are isolated as a complete directory rename; individual hooks cannot be selectively retained.
- The bundled instruction cannot guarantee identical model behavior across Grok CLI or model versions.
