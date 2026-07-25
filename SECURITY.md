<!-- markdownlint-disable MD013 -->

# 安全政策 / Security Policy

## 支持版本

| 版本 | 安全支持 |
| --- | --- |
| 最新已发布的 `0.1.x` GitHub Release | 支持;安全修复以最新补丁版本为准 |
| `Unreleased` / `main` | Best effort 开发状态;不视为稳定 Release |
| 更早版本与未标记快照 | 不支持 |

v0.1.1 的 Windows 运行支持未测试。Python 3.8+ 可用;建议 Python 3.10+。

## 私密报告漏洞

不要通过公开 Issue 报告安全漏洞。请在仓库的 Security 页面选择 **Report a vulnerability**,通过 GitHub [Private Vulnerability Reporting](https://github.com/Jia-Ethan/grok-keysmith/security/advisories/new) 创建私密报告。只有报告参与者和仓库维护者可以查看报告内容。如果该入口不可见,请只创建不含漏洞细节的公开 Issue,请求维护者恢复私密报告入口;不要在 Issue 中披露技术细节。

报告中请尽量包含:

- `python3 grok-keysmith.py --version` 输出,以及 Git tag 和 commit SHA;
- 操作系统、Python 版本和 Grok Build CLI 版本(`grok --version`);
- 可复现的最小步骤;
- 涉及的 deploy、status、recover、restore-hooks 或 uninstall 模式,以及是否存在 `.grok-keysmith-transaction-<id>`;
- 影响范围,以及已知缓解方式。

提交前删除 token、cookie、用户名、私人路径、完整配置和其他可识别数据。维护者会在对应的 GitHub Security Advisory 中跟进;本仓库不承诺固定响应时限。

## 回滚边界

代码回滚与用户配置恢复是两件独立的事:

- **代码版本回滚**:从公开仓库检出并校验目标旧 Git tag 的脚本,再运行其 `--version`。如果已发布 GitHub Release,也必须校验对应资产。切换脚本版本不会自动改变 `~/.grok`。
- **中断部署恢复**:status 检出 durable journal 后,先运行 `--recover` 预览,再用 `--recover --yes` 恢复该 transaction 的全部参与者。不要编辑 `journal.json` 或 `intent.json` 来强制继续。
- **用户配置卸载**:使用当前受信任脚本运行 `--uninstall` 预览,再用 `--uninstall --yes` 撤销最新一层 manifest-owned AGENTS.md/config/hooks 状态。
- **仅恢复 hooks**:使用 `--restore-hooks` 把 `.json.disabled` 恢复为 `.json`;它不卸载 AGENTS.md,也不修改 config.toml。
- **所有权冲突**:如果 manifest、受管理节点或必要备份发生漂移,工具会 fail closed。不要为了继续而编辑 manifest 或覆盖冲突文件;先复制整个 `~/.grok` 目录并在私密报告中提供脱敏指纹与最小复现。

journal、intent、manifest、cleanup evidence 是防止意外漂移和普通并发竞态的一致性证据,不是带密钥的密码学认证。同一账户若协同改写多份证据,超出工具可证明的互斥边界。

## prompt 完整性与 SHA-256 校验

v0.1.1 内置提示词来源为 [`examples/grok-unrestricted.md`](examples/grok-unrestricted.md),SHA-256 `cfee264f4f4683c6470595de90616744521e4f65ad81cc9a0a6f0061abaedc7b`。该文件以 base64 逐字节嵌入 [`grok-keysmith.py`](grok-keysmith.py),部署时写入 `~/.grok/AGENTS.md` 的内容应与源文件 byte-for-byte 一致。

部署后应校验:

```bash
shasum -a 256 ~/.grok/AGENTS.md
# 应输出: cfee264f4f4683c6470595de90616744521e4f65ad81cc9a0a6f0061abaedc7b  /Users/you/.grok/AGENTS.md
```

如果校验失败,说明部署过程中内容被篡改或写入异常。不要使用校验失败的部署;先 `--uninstall --yes` 撤销,再重新部署。

---

## Supported versions

| Version | Security support |
| --- | --- |
| Latest published `0.1.x` GitHub Release | Supported; fixes target the latest patch version |
| `Unreleased` / `main` | Best-effort development state, not a stable Release |
| Older releases and untagged snapshots | Unsupported |

Windows runtime support is untested in v0.1.1. Python 3.8+ is supported; Python 3.10+ is recommended.

## Private vulnerability reporting

Do not report vulnerabilities through public issues. On the repository Security page, select **Report a vulnerability** to submit through GitHub [Private Vulnerability Reporting](https://github.com/Jia-Ethan/grok-keysmith/security/advisories/new). Only report participants and repository maintainers can view the report. If the entry point is unavailable, create only a detail-free public issue asking maintainers to restore private reporting; do not disclose technical details in the issue.

Include:

- the output of `python3 grok-keysmith.py --version`, plus the Git tag and commit SHA;
- operating system, Python version, and Grok Build CLI version (`grok --version`);
- minimal reproduction steps;
- whether deploy, status, recover, restore-hooks, or uninstall is involved, and whether `.grok-keysmith-transaction-<id>` exists;
- impact and any known mitigation.

Remove tokens, cookies, usernames, private paths, complete configuration, and other identifying data. Maintainers will follow up in the corresponding GitHub Security Advisory; this repository does not promise a fixed response time.

## Rollback boundary

Code rollback and user-configuration recovery are separate operations:

- **Code-version rollback:** check out and verify the target older Git tag from the public repository, then check its `--version`. If a GitHub Release exists, verify its assets as well. Switching script versions does not automatically modify `~/.grok`.
- **Interrupted-deployment recovery:** after status detects a durable journal, preview with `--recover`, then run `--recover --yes` to restore every participant in that transaction. Do not edit `journal.json` or `intent.json` to force progress.
- **User-configuration uninstall:** preview with `--uninstall`, then run `--uninstall --yes` to undo the newest manifest-owned AGENTS.md/config/hooks layer.
- **Hooks-only restore:** `--restore-hooks` restores `.json.disabled` as `.json`; it does not uninstall AGENTS.md or edit config.toml.
- **Ownership conflict:** manifest, managed-node, or required-backup drift fails closed. Do not edit the manifest or overwrite conflicting files to force progress. Copy the complete `~/.grok` directory first and include only redacted fingerprints and a minimal reproduction in the private report.

Journal, intent, manifest, and cleanup-marker data is consistency evidence against accidental drift and ordinary races, not keyed cryptographic authentication. Coordinated same-user edits to multiple evidence files are outside the provable mutual-exclusion boundary.

## Prompt integrity and SHA-256 verification

The v0.1.1 bundled prompt source is [`examples/grok-unrestricted.md`](examples/grok-unrestricted.md), SHA-256 `cfee264f4f4683c6470595de90616744521e4f65ad81cc9a0a6f0061abaedc7b`. It is embedded byte-for-byte (base64) in [`grok-keysmith.py`](grok-keysmith.py); the content written to `~/.grok/AGENTS.md` should match the source file byte-for-byte.

Verify after deployment:

```bash
shasum -a 256 ~/.grok/AGENTS.md
# should output: cfee264f4f4683c6470595de90616744521e4f65ad81cc9a0a6f0061abaedc7b  /Users/you/.grok/AGENTS.md
```

If verification fails, the content was tampered with or written abnormally. Do not use a failed deployment; run `--uninstall --yes` first, then redeploy.
