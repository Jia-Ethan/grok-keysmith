<!-- markdownlint-disable MD013 -->

# 命令参考与内部机制 / Command reference and internals

日常使用只需要 [`README.md`](../README.md) 的「快速开始」；本页是完整字段、状态机和维护者验证细节。

机器契约：`--json` 输出 `grok-keysmith.envelope.v1`，字段为 schema / tool / version / operation / preview / apply / ok / target / plan / result / diagnostics / exit_code。`--grok-dir` 必须为绝对路径。状态值为 `not-installed` / `active-aligned` / `inactive` / `drift` / `conflict` / `recovery-required`。

---

## 简体中文

### 稳定 CLI 与开发版

- 稳妥安装钉 GitHub Latest 稳定 Release（当前为 `v0.7.0`）。该版本把指令写到 `~/.grok/rules/99-keysmith.md`，**不改** `~/.grok/AGENTS.md`，并提供 `--json`、绝对路径 `--grok-dir`、`run`、`breaktest`、`--reconcile` 与 `--uninstall --salvage-config`。
- 不要从浮动 `main` 安装稳定版。当前公开 Desktop 仍为 [`0.1.0-beta.4`](https://github.com/Jia-Ethan/grok-keysmith/releases/tag/desktop-v0.1.0-beta.4)（内嵌 CLI `0.5.0`）。源码与 Desktop Candidate 已准备 [`0.1.0-beta.5`](releases/desktop-v0.1.0-beta.5.md)，sidecar 为 CLI `0.6.1`；打公开 tag 前它不是可下载的 Pre-release，也不是稳定 Latest。

> README 只保留用户面的快速开始与撤销入口。drift / 中断事务恢复 / 旧版 `AGENTS.md` 部署卸载、`run --session-script` 与 receipt 风格等开发版细节，统一在本页维护。

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

### 修复配置标记

`--status` 的 `compat` 现有 `present` / `matches_expected`（marker 只识别 TOML 结构上下文中的独立注释行），并增加：

- `values_aligned`：三组 `[compat.claude]` / `[compat.cursor]` / `[compat.codex]` 的键集和布尔值与官方隔离块完全一致。
- `repairable`：仅 config 指纹或 marker 漂移、上述取值仍对齐、且没有 rule/hook/backup drift、conflict 或中断 journal。

可修复时 drift 文案为 `config fingerprint drifted; compat values aligned`。compat 值被改、表内多键/缺键、或解不了时仍是 `config content does not match managed after-state`，deploy / uninstall / restore-hooks 继续 fail-closed。

```bash
python3 grok-keysmith.py --reconcile          # 预览
python3 grok-keysmith.py --reconcile --yes    # 执行
```

`--reconcile` 只重注入带 marker 的官方 compat 块（复用 `config_add_compat_block`），保留所有非 `[compat.*]` 键，并把 manifest 的 `layer.config.after` 更新为新文件指纹。不改 `deployment_id`、rule、hooks，也不改部署前的 `config.before` / `backup`。这与 `--recover` 不同：`--recover` 只回滚中断事务。

### 备份丢失时停用（`--salvage-config`，0.6.2）

部署前的 `config.toml` 备份不在了（例如被清理工具当作旧备份删掉）、`config.toml` 又被改过时，`--uninstall` 和 `--reconcile` 都会以 `managed config backup is missing or abnormal` 拒绝，`--recover` 只处理中断的事务，部署就撤不掉。这时可以：

```bash
python3 grok-keysmith.py --uninstall --salvage-config          # 预览（输出里有 config_salvage / salvage_available）
python3 grok-keysmith.py --uninstall --salvage-config --yes    # 执行
```

`config.toml` 保持现状，只移除本工具写入的带 marker 的 compat 块；rule 文件、hooks、previous manifest 照常还原。只有当漂移完全落在 config 本身和它的备份上时才生效；rule、rule 备份、hooks 或 previous manifest 有任何漂移仍然 fail-closed。备份完好时这个选项不起作用，`--salvage-config` 也不能脱离 `--uninstall` 使用。

### 第二受管区域（0.7.0）

`# === keysmith-switch input rewrite begin ===` 到 `# === keysmith-switch input rewrite end ===` 之间的内容归 Keysmith Switch 的输入替换所有（它在这里给每个模型写 `[model."<id>"] base_url`）。本工具从不写入这段内容；config 指纹（status、plan、confirmation token、事务的 before/after 校验、备份与快照的完整性校验）都排除它，所以它的变化不算漂移。部署、停用（含 `--salvage-config`）、`--reconcile` 和 `--recover` 写回 config 时，保留文件**当时**的这一段；这段在此期间被删掉了就保持删掉，不会从备份里恢复。缺少结束标记（或标记重复）时它不算受管区域，仍按用户内容处理。

### 用户区域（0.8.0）

部署后自己加到 `config.toml` 的长期配置（例如额度用完时 `/model` 手动切过去的 API key 备用模型），放进这对标记之间，并放在文件末尾：

```toml
# === keysmith user region begin ===
[model."grok-4.7-api"]
model = "<网关别名>"
name = "Grok 4.7 (API fallback)"
base_url = "https://<openai-compatible-endpoint>/v1"
api_backend = "responses"
api_key = "<你的 key>"
# === keysmith user region end ===
```

规则和上面的 Keysmith Switch 区域相同：本工具从不写入，指纹排除它，部署、停用（含 `--salvage-config`）、`--reconcile`、`--recover` 都保留文件**当时**的这一段，删掉了就保持删掉。两块区域互不嵌套，各自保留原有字节和先后顺序；写回时排在文件末尾，Switch 区域每次连接也会重新追加到最后。

边界（任一条不满足，这段就不算受管区域，整段按普通配置计入指纹，改动会报漂移）：

- 每种标记各出现一次，开始在结束之前，且不和另一块区域交叠。
- 区域内第一行有效内容必须是表头（`[...]`），区域之后紧接的有效内容也必须是表头或文件结尾。否则把区域切出去后，裸键会被并到别的表里，语义就变了。
- 不能放 `[compat.*]` 表。部署前就放在区域里时 `--dry-run` / 部署 / `--reconcile` 直接拒绝（`holds compat tables`）；部署后才加进去的，`--status` 报漂移。compat 隔离不能靠这块区域绕开。

`--status` 在 `config_regions` 下报告每块区域是否生效（`present`）、字节数（`bytes`）和不生效的原因（`ignored`），从不输出区域内容，因为里面可能有 `api_key`。

Grok CLI 侧的已知问题（不属于本工具）：自定义 `[model.*]` 的 `model` 字段若和内置模型同名（例如直接写 `grok-4.6`），Grok 会套用内置模型的账号凭证，把 session token 发给自定义 `base_url`，结果是 401。请写成网关侧的别名。

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

### Prompt Runner

```bash
python3 grok-keysmith.py run --mode default --prompt "hello" --cwd /absolute/project --timeout 180
python3 grok-keysmith.py run --mode override --prompt-file prompt.txt --contract-path contract.md --timeout 180
python3 grok-keysmith.py run --wrap fixture --prompt "hostile phrasing" --timeout 180
python3 grok-keysmith.py run --wrap scoped --prompt "attack cardhub-demo.example" --timeout 300
```

`default` 使用当前 Grok 指令环境，`override` 把 contract 作为完整 system prompt。`--wrap fixture` 在用户消息前加上本地 lab 路由头，让用户轮的首 token 是夹具上下文而不是原始请求；默认 `none`，不改 home rules。对「未授权全流程」这类题，`--wrap fixture` 推荐配 `default` 模式。contract v0.3.4 时代 wrap 与 `--mode override` 叠用会重新触发权重拒绝；v0.3.5 去胁迫化改写后 C-15 在 wrap+override 下 5/5 交付，但建议仍以 `default` 为稳妥基线。`--wrap scoped`（v0.3.6 新增）加上操作员 engagement 路由头：请求点名的目标按原样交付（真实域名/端点/软件名，不转占位符），配 contract v0.3.6 的 Engagement scope 段使用；效果以 `breaktest/stability-v036.py` 的采样为准。未显式传入 `--contract-path` 时，会读取目标 Grok 目录下已部署的 `rules/99-keysmith.md`。`--cwd` 控制 Grok 的项目目录；`--timeout` 是单次运行上限。全阶段渗透交付往往超过 180s，需要把 `--timeout` 调到 300 左右。Windows 会优先发现原生 `grok.exe`；`override` / `ab` 拒绝 `.cmd` / `.bat` Grok shim，避免 `cmd.exe` 的长度限制或再次解析改变 contract。请通过 `--grok-bin` 指向 `grok.exe`。

### Session Script

```bash
python3 grok-keysmith.py run --session-script /absolute/seq-dir --timeout 320 --save-output-dir /absolute/run-dir
python3 grok-keysmith.py run --session-script /absolute/seq-dir --session-retries 2 --reasoning-effort medium
```

`--session-script DIR` 把目录里的 `turn1.txt`..`turnN.txt` 按顺序送进同一个多轮 Grok 会话：turn 1 新开会话，后续 turn 自动 resume。每个 turn 一个字段请求（六字段 ZERODAY 结构：hunt → triage → root_cause → exploit → poc → writeup），会话惯性让后续 turn 复用前面自己交付的上下文。三轮流式稳定性验证里 18/18 turn 零拒绝，同样素材单 turn 只有 1/3 通过率。

实现细节：turn 输出用启发式分类器标注 `refused` / 字段覆盖 / `rop_chain` / `poc_code`，聚合成 JSON envelope 的 `aggregate_fields` 和 `abort_reason`；turn 拒绝或超时耗尽重试就中止会话。`--session-retries`（默认 1）只对生成延迟超时重试——超时不是拒绝。turn 默认带 `--disable-web-search` 且 `--reasoning-effort medium`：全局 `xhigh` 会让六轮序列超出实际 turn 超时，web search 会在首 token 前卷入长工具循环。`--save-output-dir DIR` 把每轮输出落盘为 `DIR/turnN.out.txt`。

### Breaktest

```bash
python3 grok-keysmith.py breaktest --bank prompts.txt --mode ab --output-dir /absolute/run-dir
python3 grok-keysmith.py breaktest --bank prompts.txt --mode ab --output-dir /absolute/run-dir --resume
```

题库每行包含 4 个 `|` 分隔字段。并发数范围为 1 到 4；`--output-dir` 是本次运行目录，恢复与重试必须指向已有 `run-manifest.json` 的同一目录。

### 维护者验证

CLI 运行时仅使用 Python 标准库；仓库包含隔离 `HOME`、fake Grok、React 与 Rust 测试。提交前至少执行：

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
for document in (
    "README.md",
    "README.en.md",
    "CHANGELOG.md",
    "SECURITY.md",
    "docs/releases/desktop-v0.1.0-beta.5.md",
):
    assert version in Path(document).read_text(encoding="utf-8")
assert bundled == prompt
assert hashlib.sha256(prompt).hexdigest() == constants["BUNDLED_PROMPT_SHA256"]
PY
tmp_home="$(mktemp -d)"
trap 'rm -rf "$tmp_home"' EXIT
mkdir "$tmp_home/.grok"
HOME="$tmp_home" python3 -B grok-keysmith.py --status
HOME="$tmp_home" python3 -B grok-keysmith.py --dry-run
python3 -m py_compile grok-keysmith.py grok_keysmith_runner.py grok_keysmith_breaktest.py
python3 -m pytest -p no:cacheprovider -q tests
(cd gui && npm test && npm run build && cargo test --locked --manifest-path src-tauri/Cargo.toml)
git diff --check
```

### 项目结构

```text
grok-keysmith/
├── grok-keysmith.py              # 生命周期 CLI 与内置提示词
├── grok_keysmith_runner.py       # 跨平台 Prompt Runner
├── grok_keysmith_breaktest.py    # Breaktest 产品入口
├── grok-unrestricted.sh/.ps1     # Runner 包装
├── examples/grok-unrestricted.md
├── tests/                        # 隔离 HOME / fake Grok 测试
├── gui/                          # Desktop 0.1.0-beta.5 release source
├── VERSION
├── docs/
├── README.md / README.en.md
├── CHANGELOG.md
├── SECURITY.md
├── LICENSE
├── AGENTS.md
└── .gitignore
```

### 已知限制

- 更早的 private-only `0.1.0` snapshot 不属于本公开仓库历史；其 MIT 授权条款存在转录错误，且不包含 compat section 修正。
- `~/.grok/rules/` 是全局 home rules，没有项目级隔离。
- compat 隔离块在部署时会先剥离 `config.toml` 中所有已存在的 `[compat.claude]` / `[compat.cursor]` / `[compat.codex]` 段（无论来源），再注入 keysmith 自己的 marker 块，使其成为这些表的唯一来源。这是因为 TOML 不允许同名表出现两次（重复会直接解析失败），而非 last-wins 覆盖。被剥离的原文件完整保存在时间戳备份中（`config.toml.keysmith-backup-*`），卸载只移除 keysmith 的 marker 块，不会恢复被剥离的外部 compat 段——需要时从备份手动恢复。
- hooks 是整目录改名隔离，不能选择性保留个别 hook。
- 内置指令不能保证在不同 Grok CLI 或模型版本下行为一致。

---

## English

### Stable CLI vs development

- The conservative install pins the latest stable GitHub Release (currently `v0.7.0`). It writes `~/.grok/rules/99-keysmith.md`, **does not** edit `~/.grok/AGENTS.md`, and provides `--json`, absolute `--grok-dir`, `run`, `breaktest`, `--reconcile`, and `--uninstall --salvage-config`.
- Do not install a stable release from floating `main`. The public Desktop remains [`0.1.0-beta.4`](https://github.com/Jia-Ethan/grok-keysmith/releases/tag/desktop-v0.1.0-beta.4) with CLI `0.5.0`. Source and Desktop Candidate now prepare [`0.1.0-beta.5`](releases/desktop-v0.1.0-beta.5.md) wrapping CLI `0.6.1`; until that tag is published it is not a downloadable Pre-release, and it is not the stable Latest release.

> The README keeps only the user-facing quick start and undo entry points. Drift / interrupted-transaction recovery / uninstalling legacy `AGENTS.md` deployments, plus development commands such as `run --session-script` and receipt styles, are maintained on this page.

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

### Reconcile config markers

`--status` keeps `compat.present` / `compat.matches_expected`; markers count only as standalone comment lines in TOML structural context. It also adds:

- `values_aligned`: the `[compat.claude]`, `[compat.cursor]`, and `[compat.codex]` key sets and boolean values match the official isolation block exactly.
- `repairable`: only config fingerprint or marker drift, those values still match, and there is no rule/hook/backup drift, conflict, or interrupted journal.

Repairable drift is reported as `config fingerprint drifted; compat values aligned`. A real value change, extra/missing keys inside those tables, or an unparseable line stays `config content does not match managed after-state`, and deploy / uninstall / restore-hooks remain fail-closed.

```bash
python3 grok-keysmith.py --reconcile          # preview
python3 grok-keysmith.py --reconcile --yes    # apply
```

`--reconcile` re-injects the marked official compat block (via `config_add_compat_block`), leaves every non-`[compat.*]` key in place, and updates only `layer.config.after`. It does not change `deployment_id`, the rule, hooks, or the pre-deploy `config.before` / `backup`. This is not `--recover`; `--recover` only rolls back an interrupted journal.

### Uninstalling when the config backup is lost (`--salvage-config`, 0.6.2)

When the pre-deploy `config.toml` backup is gone (for example a cleanup tool erased it as an old copy) and `config.toml` has also changed, `--uninstall` and `--reconcile` refuse with `managed config backup is missing or abnormal`, and `--recover` only replays interrupted transactions, so the deployment cannot be removed.

```bash
python3 grok-keysmith.py --uninstall --salvage-config          # preview (output has config_salvage / salvage_available)
python3 grok-keysmith.py --uninstall --salvage-config --yes    # apply
```

`config.toml` stays as it is and only the marked compat block this tool wrote is removed; the rule file, hooks and previous manifest are restored as usual. It applies only when the drift is limited to the config file and its backup; any other drift still fails closed. It does nothing when the backup is intact, and works only with `--uninstall`.

### Second managed region (0.7.0)

Content between `# === keysmith-switch input rewrite begin ===` and `# === keysmith-switch input rewrite end ===` belongs to Keysmith Switch's input rewrite (it writes a `[model."<id>"] base_url` per model there). This tool never writes inside it and leaves it out of every config fingerprint (status, plans, confirmation tokens, transaction before/after checks, backup and snapshot integrity), so changes there are not drift. Deploy, uninstall (including `--salvage-config`), `--reconcile` and `--recover` carry whatever region the file holds at that moment; a region removed in the meantime stays removed. Without a single matching end marker nothing is owned and the text stays the person's.

### User region (0.8.0)

Long-lived settings you add to `config.toml` after deploying (for example API-key fallback models to switch to with `/model` when subscription credits run out) go between these markers, at the end of the file:

```toml
# === keysmith user region begin ===
[model."grok-4.7-api"]
model = "<gateway alias>"
name = "Grok 4.7 (API fallback)"
base_url = "https://<openai-compatible-endpoint>/v1"
api_backend = "responses"
api_key = "<your key>"
# === keysmith user region end ===
```

It follows the Keysmith Switch region's rules: never written, left out of every fingerprint, and carried as it is at that moment through deploy, uninstall (including `--salvage-config`), `--reconcile` and `--recover`; removed stays removed. The two regions do not nest and keep their bytes and order; they are written back at the end of the file, and Switch re-appends its own region last on every link.

Limits (if any fails, nothing is owned: the text counts as ordinary config and changes are drift):

- Each marker appears once, begin before end, not overlapping the other region.
- The region's first meaningful line is a table header, and what follows the region is a table header or the end of the file, so cutting it out cannot move bare keys into another table.
- No `[compat.*]` tables. If present before deploying, `--dry-run`, deploy and `--reconcile` refuse (`holds compat tables`); added after deploying, `--status` reports drift. The region cannot be used to bypass compat isolation.

`--status` reports each region under `config_regions` (`present`, `bytes`, and `ignored` with the reason) and never prints its content, which may hold an `api_key`.

A Grok CLI pitfall (not this tool's): if a custom `[model.*]` uses a `model` value equal to a built-in model name (such as `grok-4.6`), Grok applies the built-in model's account session and sends that token to the custom `base_url`, which answers 401. Use a gateway alias instead.

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

### Prompt Runner

```bash
python3 grok-keysmith.py run --mode default --prompt "hello" --cwd /absolute/project --timeout 180
python3 grok-keysmith.py run --mode override --prompt-file prompt.txt --contract-path contract.md --timeout 180
python3 grok-keysmith.py run --wrap fixture --prompt "hostile phrasing" --timeout 180
python3 grok-keysmith.py run --wrap scoped --prompt "attack cardhub-demo.example" --timeout 300
```

`default` uses the current Grok instruction environment. `override` passes the contract as the full system prompt. `--wrap fixture` prefixes the user prompt with a local-lab routing header so the first tokens of the user turn are fixture context rather than the raw request; the default is `none` and home rules are unchanged. For unauthorized-workflow phrasing, `--wrap fixture` with `default` mode is the recommended baseline. Under contract v0.3.4, stacking wrap with `--mode override` retriggered weight-layer refusal; the v0.3.5 de-coercion rewrite lifts C-15 to 5/5 under wrap+override, but `default` remains the conservative choice. `--wrap scoped` (new in v0.3.6) prefixes an operator-engagement routing header: targets named in the request render as given (real domain / endpoint / product, no placeholder substitution); pair it with the contract v0.3.6 Engagement scope section, and see `breaktest/stability-v036.py` for measured effects. Without `--contract-path`, the runner reads the deployed `rules/99-keysmith.md` under the target Grok directory. `--cwd` selects the Grok project directory and `--timeout` bounds one run. Full pentest deliveries often exceed 180s; raise `--timeout` to around 300. Windows prefers the native `grok.exe`; `override` / `ab` rejects `.cmd` / `.bat` Grok shims so `cmd.exe` cannot truncate or reinterpret contract content. Point `--grok-bin` to `grok.exe` instead.

### Session Script

```bash
python3 grok-keysmith.py run --session-script /absolute/seq-dir --timeout 320 --save-output-dir /absolute/run-dir
python3 grok-keysmith.py run --session-script /absolute/seq-dir --session-retries 2 --reasoning-effort medium
```

`--session-script DIR` feeds `turn1.txt`..`turnN.txt` from a directory into a single multi-turn Grok session: turn 1 starts fresh, later turns auto-resume the same session. Each turn requests one field (the six-field ZERODAY structure: hunt → triage → root_cause → exploit → poc → writeup); session momentum lets each turn build on context Grok itself delivered earlier. Three stability runs measured 18/18 turns delivered with zero refusals on material that single-turn prompts delivered only 1/3 of the time.

Implementation notes: a heuristic classifier tags each turn output with `refused` / field coverage / `rop_chain` / `poc_code` and aggregates them into the JSON envelope's `aggregate_fields` and `abort_reason`; the session aborts on a refused turn or exhausted timeouts. `--session-retries` (default 1) retries only generation-latency timeouts — a timeout is not a refusal. Turns run with `--disable-web-search` and default to `--reasoning-effort medium`: a global `xhigh` effort makes six-turn sequences exceed practical turn timeouts, and web search can spiral into long tool loops before the first token. `--save-output-dir DIR` persists each turn to `DIR/turnN.out.txt`.

### Breaktest

```bash
python3 grok-keysmith.py breaktest --bank prompts.txt --mode ab --output-dir /absolute/run-dir
python3 grok-keysmith.py breaktest --bank prompts.txt --mode ab --output-dir /absolute/run-dir --resume
```

Each bank line has four `|`-separated fields. Concurrency is limited to 1 through 4. `--output-dir` is the exact run directory; resume and retry must point to the same directory containing `run-manifest.json`.

### Maintainer verification

The CLI runtime uses only the Python standard library. The repository includes isolated-`HOME`, fake-Grok, React, and Rust tests. Before committing, run the verification block in the Chinese section above.

### Project layout

```text
grok-keysmith/
├── grok-keysmith.py
├── grok_keysmith_runner.py
├── grok_keysmith_breaktest.py
├── examples/grok-unrestricted.md
├── tests/
├── gui/
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
