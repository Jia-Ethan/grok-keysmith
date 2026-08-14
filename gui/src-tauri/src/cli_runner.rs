//! Process boundary between the desktop client and grok-keysmith CLI.

use serde::Serialize;
use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::process::{Child, Command};
use tokio::time::{timeout, Duration};
use uuid::Uuid;

const MANIFEST_FILENAME: &str = ".grok-keysmith-manifest.json";
const DEFAULT_TIMEOUT_MS: u64 = 30_000;
const VERSION_TIMEOUT_MS: u64 = 15_000;
const MAX_OUTPUT_BYTES: usize = 2 * 1024 * 1024;
const SIDECAR_BASENAME: &str = "grok-keysmith-cli";
const SCRIPT_NAME: &str = "grok-keysmith.py";

#[derive(Default)]
struct CapturedOutput {
    bytes: Vec<u8>,
    truncated: bool,
    error: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CliRuntime {
    Bundled,
    Executable,
    Python,
}

impl CliRuntime {
    fn key(self) -> &'static str {
        match self {
            Self::Bundled => "bundled",
            Self::Executable => "executable",
            Self::Python => "python",
        }
    }
}

#[derive(Clone, Debug)]
struct CliInvocation {
    path: PathBuf,
    program: PathBuf,
    prefix_args: Vec<OsString>,
    runtime: CliRuntime,
}

impl CliInvocation {
    fn command(&self) -> Command {
        let mut command = Command::new(&self.program);
        command.args(&self.prefix_args);
        command
    }
}

#[derive(Serialize)]
pub struct CliDescriptor {
    path: String,
    runtime: &'static str,
}

impl From<&CliInvocation> for CliDescriptor {
    fn from(invocation: &CliInvocation) -> Self {
        Self {
            path: invocation.path.to_string_lossy().into_owned(),
            runtime: invocation.runtime.key(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct CliOutput {
    stdout: String,
    stderr: String,
    exit_code: i32,
    timed_out: bool,
    run_id: Option<String>,
}

fn live_runs() -> &'static Mutex<HashMap<String, u32>> {
    static RUNS: OnceLock<Mutex<HashMap<String, u32>>> = OnceLock::new();
    RUNS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn register_run(run_id: &str, pid: u32) {
    if let Ok(mut guard) = live_runs().lock() {
        guard.insert(run_id.to_string(), pid);
    }
}

fn forget_run(run_id: &str) {
    if let Ok(mut guard) = live_runs().lock() {
        guard.remove(run_id);
    }
}

#[tauri::command]
pub async fn cli_run(
    cli_path: Option<String>,
    args: Vec<String>,
    timeout_ms: Option<u64>,
) -> Result<CliOutput, String> {
    let invocation = resolve_invocation(cli_path.as_deref())?;
    run_invocation(
        &invocation,
        &args,
        Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS)),
        None,
    )
    .await
}

#[tauri::command]
pub async fn cli_run_stream(
    app: AppHandle,
    cli_path: Option<String>,
    args: Vec<String>,
    timeout_ms: Option<u64>,
) -> Result<CliOutput, String> {
    let invocation = resolve_invocation(cli_path.as_deref())?;
    run_invocation(
        &invocation,
        &args,
        Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS)),
        Some(app),
    )
    .await
}

#[tauri::command]
pub async fn cli_cancel(run_id: String) -> Result<(), String> {
    let pid = {
        let guard = live_runs()
            .lock()
            .map_err(|_| "run table lock poisoned".to_string())?;
        guard.get(&run_id).copied()
    };
    let Some(pid) = pid else {
        return Err(format!("unknown run: {run_id}"));
    };
    terminate_pid(pid).await;
    Ok(())
}

async fn run_invocation(
    invocation: &CliInvocation,
    args: &[String],
    limit: Duration,
    stream_to: Option<AppHandle>,
) -> Result<CliOutput, String> {
    let run_id = Uuid::new_v4().to_string();
    let mut command = invocation.command();
    configure_process_tree(&mut command);
    command.kill_on_drop(true);
    let mut child = command
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            format!(
                "无法启动 CLI（{}）: {error}",
                invocation.path.to_string_lossy()
            )
        })?;
    if let Some(pid) = child.id() {
        register_run(&run_id, pid);
    }

    let stdout_reader = child.stdout.take().expect("stdout pipe");
    let stderr_reader = child.stderr.take().expect("stderr pipe");
    let stdout_app = stream_to.clone();
    let stderr_app = stream_to.clone();
    let run_id_out = run_id.clone();
    let run_id_err = run_id.clone();
    let read_task = tokio::spawn(async move {
        tokio::join!(
            read_capped(stdout_reader, stdout_app, "stdout", run_id_out),
            read_capped(stderr_reader, stderr_app, "stderr", run_id_err)
        )
    });

    let exit = match timeout(limit, child.wait()).await {
        Ok(Ok(status)) => status.code().unwrap_or(-1),
        Ok(Err(error)) => {
            terminate_process_tree(&mut child).await;
            forget_run(&run_id);
            let _ = read_task.await;
            return Err(format!("等待 CLI 进程失败: {error}"));
        }
        Err(_) => {
            terminate_process_tree(&mut child).await;
            forget_run(&run_id);
            let (stdout, stderr) = read_task.await.unwrap_or_default();
            return Ok(CliOutput {
                stdout: String::from_utf8_lossy(&stdout.bytes).into_owned(),
                stderr: String::from_utf8_lossy(&stderr.bytes).into_owned(),
                exit_code: -1,
                timed_out: true,
                run_id: Some(run_id),
            });
        }
    };

    forget_run(&run_id);
    let (stdout, stderr) = read_task
        .await
        .map_err(|error| format!("读取 CLI 输出任务失败: {error}"))?;
    validate_captured_output(&stdout, &stderr)?;
    Ok(CliOutput {
        stdout: String::from_utf8_lossy(&stdout.bytes).into_owned(),
        stderr: String::from_utf8_lossy(&stderr.bytes).into_owned(),
        exit_code: exit,
        timed_out: false,
        run_id: Some(run_id),
    })
}

#[cfg(unix)]
fn configure_process_tree(command: &mut Command) {
    command.process_group(0);
}

#[cfg(windows)]
fn configure_process_tree(command: &mut Command) {
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    command.creation_flags(CREATE_NEW_PROCESS_GROUP);
}

#[cfg(not(any(unix, windows)))]
fn configure_process_tree(_command: &mut Command) {}

#[cfg(unix)]
async fn terminate_process_tree(child: &mut Child) {
    if let Some(pid) = child.id() {
        terminate_pid(pid).await;
    }
    let _ = child.kill().await;
    let _ = child.wait().await;
}

#[cfg(windows)]
async fn terminate_process_tree(child: &mut Child) {
    if let Some(pid) = child.id() {
        terminate_pid(pid).await;
    }
    let _ = child.kill().await;
    let _ = child.wait().await;
}

#[cfg(not(any(unix, windows)))]
async fn terminate_process_tree(child: &mut Child) {
    let _ = child.kill().await;
    let _ = child.wait().await;
}

#[cfg(unix)]
async fn terminate_pid(pid: u32) {
    if let Ok(pid) = i32::try_from(pid) {
        unsafe {
            libc::kill(-pid, libc::SIGKILL);
        }
    }
}

#[cfg(windows)]
async fn terminate_pid(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await;
}

#[cfg(not(any(unix, windows)))]
async fn terminate_pid(_pid: u32) {}

fn validate_captured_output(
    stdout: &CapturedOutput,
    stderr: &CapturedOutput,
) -> Result<(), String> {
    let mut issues = Vec::new();
    for (label, captured) in [("stdout", stdout), ("stderr", stderr)] {
        if captured.truncated {
            issues.push(format!("{label} 超过 {MAX_OUTPUT_BYTES} 字节上限"));
        }
        if let Some(error) = &captured.error {
            issues.push(format!("读取 {label} 失败: {error}"));
        }
    }
    if issues.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "CLI 输出不完整，已阻止继续操作: {}",
            issues.join("; ")
        ))
    }
}

async fn read_capped<R>(
    mut reader: R,
    app: Option<AppHandle>,
    channel: &'static str,
    run_id: String,
) -> CapturedOutput
where
    R: AsyncRead + Unpin,
{
    let mut captured = CapturedOutput::default();
    let mut chunk = [0_u8; 8192];
    loop {
        let read = match reader.read(&mut chunk).await {
            Ok(0) => break,
            Ok(read) => read,
            Err(error) => {
                captured.error = Some(error.to_string());
                break;
            }
        };
        if let Some(handle) = &app {
            let text = String::from_utf8_lossy(&chunk[..read]).into_owned();
            let _ = handle.emit(
                "cli-stream",
                serde_json::json!({
                    "runId": run_id,
                    "channel": channel,
                    "text": text,
                }),
            );
        }
        let remaining = MAX_OUTPUT_BYTES.saturating_sub(captured.bytes.len());
        if remaining > 0 {
            captured
                .bytes
                .extend_from_slice(&chunk[..read.min(remaining)]);
        }
        if read > remaining {
            captured.truncated = true;
        }
    }
    captured
}

#[tauri::command]
pub async fn read_manifest(grok_dir: String) -> Result<serde_json::Value, String> {
    let dir = PathBuf::from(&grok_dir);
    if !dir.is_dir() {
        return Err(format!("目录不存在: {grok_dir}"));
    }
    let manifest_path = dir.join(MANIFEST_FILENAME);
    if !manifest_path.is_file() {
        return Err(format!("未找到部署清单: {}", manifest_path.display()));
    }
    let canonical_dir = dir
        .canonicalize()
        .map_err(|error| format!("无法解析目录: {error}"))?;
    let canonical_manifest = manifest_path
        .canonicalize()
        .map_err(|error| format!("无法解析清单: {error}"))?;
    if !canonical_manifest.starts_with(&canonical_dir)
        || canonical_manifest
            .file_name()
            .and_then(|name| name.to_str())
            != Some(MANIFEST_FILENAME)
    {
        return Err("拒绝读取清单以外的文件".to_string());
    }
    let content = tokio::fs::read(&canonical_manifest)
        .await
        .map_err(|error| format!("读取部署清单失败: {error}"))?;
    serde_json::from_slice(&content).map_err(|error| format!("部署清单不是合法 JSON: {error}"))
}

#[tauri::command]
pub async fn detect_cli() -> Result<Option<CliDescriptor>, String> {
    Ok(locate_cli()?.as_ref().map(CliDescriptor::from))
}

#[tauri::command]
pub async fn cli_version(cli_path: Option<String>) -> Result<String, String> {
    let invocation = resolve_invocation(cli_path.as_deref())?;
    let output = run_invocation(
        &invocation,
        &["--version".to_string()],
        version_probe_timeout(),
        None,
    )
    .await?;
    if output.timed_out {
        return Err("获取 CLI 版本超时".to_string());
    }
    if output.exit_code != 0 {
        return Err(format!(
            "获取版本失败 (exit {}): {}",
            output.exit_code, output.stderr
        ));
    }
    Ok(output.stdout.trim().to_string())
}

fn version_probe_timeout() -> Duration {
    Duration::from_millis(VERSION_TIMEOUT_MS)
}

#[tauri::command]
pub async fn cli_runtime(cli_path: Option<String>) -> Result<String, String> {
    Ok(resolve_invocation(cli_path.as_deref())?
        .runtime
        .key()
        .to_string())
}

#[tauri::command]
pub async fn detect_grok(grok_bin: Option<String>) -> Result<Option<CliDescriptor>, String> {
    if let Some(path) = grok_bin.filter(|value| !value.trim().is_empty()) {
        return invocation_for_path(PathBuf::from(path), false).map(|item| Some((&item).into()));
    }
    Ok(locate_grok()?.map(|item| (&item).into()))
}

#[tauri::command]
pub async fn grok_inspect(
    grok_bin: Option<String>,
    cwd: Option<String>,
) -> Result<CliOutput, String> {
    let invocation = if let Some(path) = grok_bin.filter(|value| !value.trim().is_empty()) {
        invocation_for_path(PathBuf::from(path), false)?
    } else {
        locate_grok()?.ok_or_else(|| "未找到 Grok 可执行文件".to_string())?
    };
    let mut command = invocation.command();
    if let Some(cwd) = cwd.filter(|value| !value.trim().is_empty()) {
        command.current_dir(cwd);
    }
    configure_process_tree(&mut command);
    command.kill_on_drop(true);
    let mut child = command
        .args(["inspect", "--json"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("无法启动 grok inspect: {error}"))?;
    let stdout_reader = child.stdout.take().expect("stdout pipe");
    let stderr_reader = child.stderr.take().expect("stderr pipe");
    let read_task = tokio::spawn(async move {
        tokio::join!(
            read_capped(stdout_reader, None, "stdout", String::new()),
            read_capped(stderr_reader, None, "stderr", String::new())
        )
    });
    let exit = match timeout(Duration::from_secs(20), child.wait()).await {
        Ok(Ok(status)) => status.code().unwrap_or(-1),
        Ok(Err(error)) => {
            terminate_process_tree(&mut child).await;
            let _ = read_task.await;
            return Err(format!("等待 grok inspect 失败: {error}"));
        }
        Err(_) => {
            terminate_process_tree(&mut child).await;
            let (stdout, stderr) = read_task.await.unwrap_or_default();
            return Ok(CliOutput {
                stdout: String::from_utf8_lossy(&stdout.bytes).into_owned(),
                stderr: String::from_utf8_lossy(&stderr.bytes).into_owned(),
                exit_code: -1,
                timed_out: true,
                run_id: None,
            });
        }
    };
    let (stdout, stderr) = read_task.await.unwrap_or_default();
    Ok(CliOutput {
        stdout: String::from_utf8_lossy(&stdout.bytes).into_owned(),
        stderr: String::from_utf8_lossy(&stderr.bytes).into_owned(),
        exit_code: exit,
        timed_out: false,
        run_id: None,
    })
}

#[tauri::command]
pub async fn write_text_file(path: String, contents: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if target.as_os_str().is_empty() {
        return Err("empty path".to_string());
    }
    tokio::fs::write(&target, contents)
        .await
        .map_err(|error| format!("写入失败: {error}"))
}

#[tauri::command]
pub async fn open_path(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err(format!("路径不存在: {path}"));
    }
    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg(&target).status();
    #[cfg(target_os = "windows")]
    let status = Command::new("explorer").arg(&target).status();
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let status = Command::new("xdg-open").arg(&target).status();
    status
        .await
        .map_err(|error| format!("打开路径失败: {error}"))?;
    Ok(())
}

fn resolve_invocation(cli_path: Option<&str>) -> Result<CliInvocation, String> {
    if let Some(path) = cli_path.filter(|path| !path.trim().is_empty()) {
        return invocation_for_path(PathBuf::from(path), false);
    }
    locate_cli()?.ok_or_else(|| {
        "未找到内置 CLI 或 grok-keysmith.py。请重新安装应用或在设置中指定脚本路径。".to_string()
    })
}

fn locate_cli() -> Result<Option<CliInvocation>, String> {
    if let Some(path) = bundled_sidecar_path().filter(|path| path.is_file()) {
        return invocation_for_path(path, true).map(Some);
    }
    if let Ok(path) = std::env::var("GROK_KEYSMITH_CLI") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return invocation_for_path(path, false).map(Some);
        }
    }
    for path in fallback_candidate_paths() {
        if path.is_file() {
            return invocation_for_path(path, false).map(Some);
        }
    }
    for name in path_candidate_names() {
        if let Some(path) = find_program_in_path(name) {
            return invocation_for_path(path, false).map(Some);
        }
    }
    Ok(None)
}

fn locate_grok() -> Result<Option<CliInvocation>, String> {
    if let Ok(path) = std::env::var("GROK_BIN") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return invocation_for_path(path, false).map(Some);
        }
    }
    if let Some(home) = home_directory() {
        for name in ["grok", "grok.exe"] {
            let candidate = home.join(".grok").join("bin").join(name);
            if candidate.is_file() {
                return invocation_for_path(candidate, false).map(Some);
            }
        }
    }
    for name in ["grok", "grok.exe"] {
        if let Some(path) = find_program_in_path(name) {
            return invocation_for_path(path, false).map(Some);
        }
    }
    Ok(None)
}

fn invocation_for_path(path: PathBuf, bundled: bool) -> Result<CliInvocation, String> {
    if !path.is_file() {
        return Err(format!("CLI 文件不存在: {}", path.display()));
    }
    let runtime = runtime_for_path(&path, bundled);
    if runtime == CliRuntime::Python {
        let python = python_program().ok_or_else(|| {
            "指定的是 Python 脚本，但系统中没有可用的 Python 解释器。".to_string()
        })?;
        return Ok(CliInvocation {
            path: path.clone(),
            program: python,
            prefix_args: vec![path.into_os_string()],
            runtime,
        });
    }
    Ok(CliInvocation {
        program: path.clone(),
        path,
        prefix_args: Vec::new(),
        runtime,
    })
}

fn runtime_for_path(path: &Path, bundled: bool) -> CliRuntime {
    if bundled {
        CliRuntime::Bundled
    } else if path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("py"))
    {
        CliRuntime::Python
    } else {
        CliRuntime::Executable
    }
}

fn bundled_sidecar_path() -> Option<PathBuf> {
    std::env::current_exe()
        .ok()?
        .parent()
        .map(|directory| directory.join(sidecar_filename()))
}

#[cfg(windows)]
fn sidecar_filename() -> String {
    format!("{SIDECAR_BASENAME}.exe")
}

#[cfg(not(windows))]
fn sidecar_filename() -> &'static str {
    SIDECAR_BASENAME
}

fn fallback_candidate_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(executable) = std::env::current_exe() {
        if let Some(directory) = executable.parent() {
            for name in path_candidate_names() {
                paths.push(directory.join(name));
            }
        }
    }
    if let Some(home) = home_directory() {
        for name in path_candidate_names() {
            paths.push(home.join(".grok-keysmith-gui").join(name));
            paths.push(home.join(".local").join("bin").join(name));
            paths.push(home.join("bin").join(name));
        }
    }
    #[cfg(not(windows))]
    for directory in ["/usr/local/bin", "/opt/homebrew/bin"] {
        for name in path_candidate_names() {
            paths.push(PathBuf::from(directory).join(name));
        }
    }
    paths
}

fn home_directory() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn path_candidate_names() -> &'static [&'static str] {
    #[cfg(windows)]
    {
        &["grok-keysmith.exe", "grok-keysmith", SCRIPT_NAME]
    }
    #[cfg(not(windows))]
    {
        &["grok-keysmith", SCRIPT_NAME]
    }
}

fn python_program() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os("GROK_KEYSMITH_PYTHON") {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Some(path);
        }
    }
    #[cfg(windows)]
    let candidates = ["python.exe", "python3.exe"];
    #[cfg(not(windows))]
    let candidates = ["python3", "python"];
    candidates
        .iter()
        .find_map(|candidate| find_program_in_path(candidate))
}

fn find_program_in_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|directory| directory.join(name))
        .find(|candidate| candidate.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_runtime_wins_over_file_extension() {
        assert_eq!(
            runtime_for_path(Path::new("grok-keysmith-cli.py"), true),
            CliRuntime::Bundled
        );
    }

    #[test]
    fn python_scripts_are_fallback_invocations() {
        assert_eq!(
            runtime_for_path(Path::new("grok-keysmith.PY"), false),
            CliRuntime::Python
        );
    }

    #[test]
    fn native_binaries_run_directly() {
        assert_eq!(
            runtime_for_path(Path::new("grok-keysmith.exe"), false),
            CliRuntime::Executable
        );
    }

    #[test]
    fn executable_candidates_precede_python_script() {
        let candidates = path_candidate_names();
        assert_eq!(candidates.last(), Some(&SCRIPT_NAME));
        assert!(candidates[..candidates.len() - 1]
            .iter()
            .all(|candidate| !candidate.ends_with(".py")));
    }
}
