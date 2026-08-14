//! Process boundary between the desktop client and grok-keysmith CLI.

use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{ExitStatus, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::{Child, Command};
use tokio::task::JoinHandle;
use tokio::time::{sleep, timeout, Duration};
use uuid::Uuid;

const MANIFEST_FILENAME: &str = ".grok-keysmith-manifest.json";
const DEFAULT_TIMEOUT_MS: u64 = 30_000;
const VERSION_TIMEOUT_MS: u64 = 30_000;
const MAX_STDOUT_BYTES: usize = 16 * 1024 * 1024;
const MAX_STDERR_BYTES: usize = 2 * 1024 * 1024;
const MAX_MANIFEST_BYTES: usize = 1024 * 1024;
const MAX_STREAM_EVENT_BYTES: usize = 256 * 1024 * 1024;
const MAX_STREAM_EVENTS: usize = 100_000;
const SIDECAR_BASENAME: &str = "grok-keysmith-cli";
const SCRIPT_NAME: &str = "grok-keysmith.py";
const STREAM_EVENT_PREFIX: &[u8] = b"GROK_KEYSMITH_EVENT ";
const STREAM_EVENT_SCHEMA: &str = "grok-keysmith.stream.v1";
const CANCEL_GRACE_MS: u64 = 1_000;
const OUTPUT_DRAIN_MS: u64 = 2_000;
const OUTPUT_FORCE_DRAIN_MS: u64 = 2_000;
const PROCESS_TERMINATE_MS: u64 = 5_000;

#[derive(Default)]
struct CapturedOutput {
    bytes: Vec<u8>,
    truncated: bool,
    error: Option<String>,
    stream_events_limited: bool,
}

#[derive(Default)]
struct StreamEventBudget {
    bytes: usize,
    count: usize,
}

#[derive(Clone, Debug)]
struct LiveRun {
    pid: u32,
    cancel_file: PathBuf,
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

fn live_runs() -> &'static Mutex<HashMap<String, LiveRun>> {
    static RUNS: OnceLock<Mutex<HashMap<String, LiveRun>>> = OnceLock::new();
    RUNS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn register_run(run_id: &str, pid: u32, cancel_file: PathBuf) {
    if let Ok(mut guard) = live_runs().lock() {
        guard.insert(run_id.to_string(), LiveRun { pid, cancel_file });
    }
}

fn forget_run(run_id: &str) {
    if let Ok(mut guard) = live_runs().lock() {
        if let Some(run) = guard.remove(run_id) {
            let _ = std::fs::remove_file(run.cancel_file);
        }
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
    let run = {
        let guard = live_runs()
            .lock()
            .map_err(|_| "run table lock poisoned".to_string())?;
        guard.get(&run_id).cloned()
    };
    let Some(run) = run else {
        return Err(format!("unknown run: {run_id}"));
    };
    tokio::fs::write(&run.cancel_file, b"cancel\n")
        .await
        .map_err(|error| format!("写入取消标记失败: {error}"))?;
    sleep(Duration::from_millis(CANCEL_GRACE_MS)).await;
    let still_running = live_runs()
        .lock()
        .map_err(|_| "run table lock poisoned".to_string())?
        .contains_key(&run_id);
    if still_running {
        terminate_pid_bounded(run.pid).await;
    }
    Ok(())
}

async fn run_invocation(
    invocation: &CliInvocation,
    args: &[String],
    limit: Duration,
    stream_to: Option<AppHandle>,
) -> Result<CliOutput, String> {
    let run_id = Uuid::new_v4().to_string();
    let cancel_file = std::env::temp_dir().join(format!("grok-keysmith-cancel-{run_id}"));
    let _ = std::fs::remove_file(&cancel_file);
    let mut command = invocation.command();
    configure_process_tree(&mut command);
    command.kill_on_drop(true);
    command.env("GROK_KEYSMITH_CANCEL_FILE", &cancel_file);
    if stream_to.is_some() {
        command.env("GROK_KEYSMITH_STREAM_EVENTS", "1");
    } else {
        command.env_remove("GROK_KEYSMITH_STREAM_EVENTS");
    }
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
    let root_pid = child.id();
    if let Some(pid) = root_pid {
        register_run(&run_id, pid, cancel_file.clone());
    }
    if let Some(handle) = &stream_to {
        let _ = handle.emit(
            "cli-run-started",
            serde_json::json!({ "runId": run_id.clone() }),
        );
    }

    let stdout_reader = child.stdout.take().expect("stdout pipe");
    let stderr_reader = child.stderr.take().expect("stderr pipe");
    let stderr_app = stream_to;
    let run_id_err = run_id.clone();
    let read_task = tokio::spawn(async move {
        tokio::join!(
            read_capped(stdout_reader, MAX_STDOUT_BYTES),
            read_stderr(stderr_reader, stderr_app, run_id_err)
        )
    });

    let exit = match timeout(limit, child.wait()).await {
        Ok(Ok(status)) => status.code().unwrap_or(-1),
        Ok(Err(error)) => {
            terminate_process_tree_bounded(&mut child).await;
            forget_run(&run_id);
            let _ = drain_read_task(read_task, &mut child, root_pid).await;
            return Err(format!("等待 CLI 进程失败: {error}"));
        }
        Err(_) => {
            let _ = tokio::fs::write(&cancel_file, b"timeout\n").await;
            match timeout(Duration::from_millis(CANCEL_GRACE_MS), child.wait()).await {
                Ok(Ok(_)) => {}
                Ok(Err(_)) | Err(_) => terminate_process_tree_bounded(&mut child).await,
            }
            forget_run(&run_id);
            let (stdout, stderr) = drain_read_task(read_task, &mut child, root_pid).await?;
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
    let (stdout, stderr) = drain_read_task(read_task, &mut child, root_pid).await?;
    validate_captured_output(&stdout, &stderr)?;
    Ok(CliOutput {
        stdout: String::from_utf8_lossy(&stdout.bytes).into_owned(),
        stderr: String::from_utf8_lossy(&stderr.bytes).into_owned(),
        exit_code: exit,
        timed_out: false,
        run_id: Some(run_id),
    })
}

type OutputReadTask = JoinHandle<(CapturedOutput, CapturedOutput)>;

async fn drain_read_task(
    mut read_task: OutputReadTask,
    child: &mut Child,
    root_pid: Option<u32>,
) -> Result<(CapturedOutput, CapturedOutput), String> {
    match timeout(Duration::from_millis(OUTPUT_DRAIN_MS), &mut read_task).await {
        Ok(result) => return result.map_err(|error| format!("读取 CLI 输出任务失败: {error}")),
        Err(_) => {}
    }

    if let Some(pid) = child.id() {
        terminate_pid_bounded(pid).await;
    } else if let Some(pid) = root_pid {
        terminate_lingering_group_bounded(pid).await;
    }
    let _ = timeout(Duration::from_millis(PROCESS_TERMINATE_MS), child.kill()).await;
    let _ = timeout(Duration::from_millis(PROCESS_TERMINATE_MS), child.wait()).await;

    match timeout(Duration::from_millis(OUTPUT_FORCE_DRAIN_MS), &mut read_task).await {
        Ok(result) => result.map_err(|error| format!("读取 CLI 输出任务失败: {error}")),
        Err(_) => {
            read_task.abort();
            let _ = timeout(Duration::from_millis(500), read_task).await;
            Err("CLI 输出管道在进程结束后仍未关闭".to_string())
        }
    }
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
async fn terminate_pid(pid: u32) {
    let mut targets = unix_descendant_pids(pid).await;
    targets.push(pid);
    for target in targets {
        let Ok(target) = i32::try_from(target) else {
            continue;
        };
        unsafe {
            libc::kill(-target, libc::SIGKILL);
            libc::kill(target, libc::SIGKILL);
        }
    }
}

#[cfg(unix)]
async fn unix_descendant_pids(root: u32) -> Vec<u32> {
    let output = match Command::new("ps")
        .args(["-axo", "pid=,ppid="])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .await
    {
        Ok(output) => output,
        Err(_) => return Vec::new(),
    };
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let mut fields = line.split_whitespace();
        let (Some(pid), Some(ppid)) = (fields.next(), fields.next()) else {
            continue;
        };
        let (Ok(pid), Ok(ppid)) = (pid.parse::<u32>(), ppid.parse::<u32>()) else {
            continue;
        };
        children.entry(ppid).or_default().push(pid);
    }
    let mut descendants = Vec::new();
    let mut pending = vec![root];
    while let Some(parent) = pending.pop() {
        if let Some(found) = children.get(&parent) {
            for child in found {
                descendants.push(*child);
                pending.push(*child);
            }
        }
    }
    descendants
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

async fn terminate_pid_bounded(pid: u32) {
    let _ = timeout(
        Duration::from_millis(PROCESS_TERMINATE_MS),
        terminate_pid(pid),
    )
    .await;
}

#[cfg(unix)]
async fn terminate_lingering_group(pid: u32) {
    if let Ok(pid) = i32::try_from(pid) {
        unsafe {
            libc::kill(-pid, libc::SIGKILL);
        }
    }
}

#[cfg(not(unix))]
async fn terminate_lingering_group(_pid: u32) {}

async fn terminate_lingering_group_bounded(pid: u32) {
    let _ = timeout(
        Duration::from_millis(PROCESS_TERMINATE_MS),
        terminate_lingering_group(pid),
    )
    .await;
}

async fn terminate_process_tree_bounded(child: &mut Child) {
    if let Some(pid) = child.id() {
        terminate_pid_bounded(pid).await;
    }
    let _ = timeout(Duration::from_millis(PROCESS_TERMINATE_MS), child.kill()).await;
    let _ = timeout(Duration::from_millis(PROCESS_TERMINATE_MS), child.wait()).await;
}

fn validate_captured_output(
    stdout: &CapturedOutput,
    stderr: &CapturedOutput,
) -> Result<(), String> {
    let mut issues = Vec::new();
    for (label, captured, limit) in [
        ("stdout", stdout, MAX_STDOUT_BYTES),
        ("stderr", stderr, MAX_STDERR_BYTES),
    ] {
        if captured.truncated {
            issues.push(format!("{label} 超过 {limit} 字节上限"));
        }
        if let Some(error) = &captured.error {
            issues.push(format!("读取 {label} 失败: {error}"));
        }
    }
    if stderr.stream_events_limited {
        issues.push(format!(
            "流事件超过 {MAX_STREAM_EVENTS} 条或 {MAX_STREAM_EVENT_BYTES} 字节上限"
        ));
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

fn append_capped(captured: &mut CapturedOutput, bytes: &[u8], limit: usize) {
    let remaining = limit.saturating_sub(captured.bytes.len());
    if remaining > 0 {
        captured
            .bytes
            .extend_from_slice(&bytes[..bytes.len().min(remaining)]);
    }
    if bytes.len() > remaining {
        captured.truncated = true;
    }
}

async fn read_capped<R>(mut reader: R, limit: usize) -> CapturedOutput
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
        append_capped(&mut captured, &chunk[..read], limit);
    }
    captured
}

enum ProtocolLineResult {
    Consumed,
    Invalid,
    Limited,
}

fn emit_protocol_line(
    line: &[u8],
    app: &Option<AppHandle>,
    run_id: &str,
    budget: &mut StreamEventBudget,
) -> ProtocolLineResult {
    let Some(payload) = line.strip_prefix(STREAM_EVENT_PREFIX) else {
        return ProtocolLineResult::Invalid;
    };
    if budget.count >= MAX_STREAM_EVENTS || budget.bytes >= MAX_STREAM_EVENT_BYTES {
        return ProtocolLineResult::Limited;
    }
    let payload = payload.strip_suffix(b"\r").unwrap_or(payload);
    let event: Result<Value, _> = serde_json::from_slice(payload);
    let Ok(mut event) = event else {
        return ProtocolLineResult::Invalid;
    };
    let Some(object) = event.as_object_mut() else {
        return ProtocolLineResult::Invalid;
    };
    if object.get("schema").and_then(Value::as_str) != Some(STREAM_EVENT_SCHEMA) {
        return ProtocolLineResult::Invalid;
    }
    let Some(event_type) = object.get("type").and_then(Value::as_str) else {
        return ProtocolLineResult::Invalid;
    };
    match event_type {
        "output" => {
            if !matches!(
                object.get("channel").and_then(Value::as_str),
                Some("stdout" | "stderr")
            ) || object.get("text").and_then(Value::as_str).is_none()
            {
                return ProtocolLineResult::Invalid;
            }
        }
        "case-start" | "case-complete" | "summary" => {
            if object.contains_key("channel") {
                return ProtocolLineResult::Invalid;
            }
        }
        _ => return ProtocolLineResult::Invalid,
    }

    let Some(next_bytes) = budget.bytes.checked_add(line.len()) else {
        return ProtocolLineResult::Limited;
    };
    if budget.count >= MAX_STREAM_EVENTS || next_bytes > MAX_STREAM_EVENT_BYTES {
        return ProtocolLineResult::Limited;
    }
    budget.count += 1;
    budget.bytes = next_bytes;
    object.insert("runId".to_string(), Value::String(run_id.to_string()));
    if let Some(handle) = app {
        let _ = handle.emit("cli-stream", event);
    }
    ProtocolLineResult::Consumed
}

fn capture_stderr_line(
    captured: &mut CapturedOutput,
    line: &[u8],
    app: &Option<AppHandle>,
    run_id: &str,
    budget: &mut StreamEventBudget,
) {
    match emit_protocol_line(line, app, run_id, budget) {
        ProtocolLineResult::Consumed => return,
        ProtocolLineResult::Limited => {
            captured.stream_events_limited = true;
            return;
        }
        ProtocolLineResult::Invalid => {}
    }
    let before = captured.bytes.len();
    append_capped(captured, line, MAX_STDERR_BYTES);
    append_capped(captured, b"\n", MAX_STDERR_BYTES);
    let emitted = String::from_utf8_lossy(&captured.bytes[before..]).into_owned();
    if !emitted.is_empty() {
        if let Some(handle) = app {
            let _ = handle.emit(
                "cli-stream",
                serde_json::json!({
                    "runId": run_id,
                    "type": "output",
                    "channel": "stderr",
                    "text": emitted,
                }),
            );
        }
    }
}

async fn read_stderr<R>(mut reader: R, app: Option<AppHandle>, run_id: String) -> CapturedOutput
where
    R: AsyncRead + Unpin,
{
    let mut captured = CapturedOutput::default();
    let mut chunk = [0_u8; 8192];
    let mut pending = Vec::new();
    let mut event_budget = StreamEventBudget::default();
    loop {
        let read = match reader.read(&mut chunk).await {
            Ok(0) => break,
            Ok(read) => read,
            Err(error) => {
                captured.error = Some(error.to_string());
                break;
            }
        };
        pending.extend_from_slice(&chunk[..read]);
        while let Some(newline) = pending.iter().position(|byte| *byte == b'\n') {
            let mut line = pending.drain(..=newline).collect::<Vec<_>>();
            line.pop();
            capture_stderr_line(&mut captured, &line, &app, &run_id, &mut event_budget);
        }
        if pending.len() > MAX_STDERR_BYTES {
            append_capped(&mut captured, &pending, MAX_STDERR_BYTES);
            pending.clear();
        }
    }
    if !pending.is_empty() {
        capture_stderr_line(&mut captured, &pending, &app, &run_id, &mut event_budget);
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
    let metadata = tokio::fs::metadata(&canonical_manifest)
        .await
        .map_err(|error| format!("读取部署清单元数据失败: {error}"))?;
    if metadata.len() > MAX_MANIFEST_BYTES as u64 {
        return Err(format!("部署清单超过 {MAX_MANIFEST_BYTES} 字节上限"));
    }
    let file = tokio::fs::File::open(&canonical_manifest)
        .await
        .map_err(|error| format!("读取部署清单失败: {error}"))?;
    let mut reader = file.take((MAX_MANIFEST_BYTES + 1) as u64);
    let mut content = Vec::new();
    reader
        .read_to_end(&mut content)
        .await
        .map_err(|error| format!("读取部署清单失败: {error}"))?;
    if content.len() > MAX_MANIFEST_BYTES {
        return Err(format!("部署清单超过 {MAX_MANIFEST_BYTES} 字节上限"));
    }
    serde_json::from_slice(&content).map_err(|error| format!("部署清单不是合法 JSON: {error}"))
}

#[tauri::command]
pub async fn detect_cli() -> Result<Option<CliDescriptor>, String> {
    Ok(locate_cli()?.as_ref().map(CliDescriptor::from))
}

#[tauri::command]
pub fn default_breaktest_run_dir() -> Result<String, String> {
    let home = home_directory().ok_or_else(|| "无法确定用户目录".to_string())?;
    if !home.is_absolute() {
        return Err("用户目录不是绝对路径".to_string());
    }
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("系统时间无效: {error}"))?
        .as_secs();
    let suffix = Uuid::new_v4().simple().to_string();
    Ok(home
        .join(".grok-keysmith")
        .join("breaktest-runs")
        .join(format!("{seconds}-{}", &suffix[..12]))
        .to_string_lossy()
        .into_owned())
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
    let root_pid = child.id();
    let stdout_reader = child.stdout.take().expect("stdout pipe");
    let stderr_reader = child.stderr.take().expect("stderr pipe");
    let read_task = tokio::spawn(async move {
        tokio::join!(
            read_capped(stdout_reader, MAX_STDOUT_BYTES),
            read_stderr(stderr_reader, None, String::new())
        )
    });
    let exit = match timeout(Duration::from_secs(20), child.wait()).await {
        Ok(Ok(status)) => status.code().unwrap_or(-1),
        Ok(Err(error)) => {
            terminate_process_tree_bounded(&mut child).await;
            let _ = drain_read_task(read_task, &mut child, root_pid).await;
            return Err(format!("等待 grok inspect 失败: {error}"));
        }
        Err(_) => {
            terminate_process_tree_bounded(&mut child).await;
            let (stdout, stderr) = drain_read_task(read_task, &mut child, root_pid).await?;
            validate_captured_output(&stdout, &stderr)?;
            return Ok(CliOutput {
                stdout: String::from_utf8_lossy(&stdout.bytes).into_owned(),
                stderr: String::from_utf8_lossy(&stderr.bytes).into_owned(),
                exit_code: -1,
                timed_out: true,
                run_id: None,
            });
        }
    };
    let (stdout, stderr) = drain_read_task(read_task, &mut child, root_pid).await?;
    validate_captured_output(&stdout, &stderr)?;
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
    if !target.is_absolute() {
        return Err("保存路径必须是绝对路径".to_string());
    }
    let parent = target
        .parent()
        .filter(|path| path.is_dir())
        .ok_or_else(|| "保存目录不存在".to_string())?;
    if let Ok(metadata) = std::fs::symlink_metadata(&target) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err("拒绝覆盖非普通文件".to_string());
        }
    }

    let nonce = Uuid::new_v4().simple().to_string();
    let basename = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("output");
    let temporary = parent.join(format!(".{basename}.{nonce}.tmp"));
    let backup = parent.join(format!(".{basename}.{nonce}.backup"));
    let previous_permissions = std::fs::metadata(&target)
        .ok()
        .map(|metadata| metadata.permissions());

    let mut handle = tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .await
        .map_err(|error| format!("创建临时输出失败: {error}"))?;
    let write_result = async {
        handle
            .write_all(contents.as_bytes())
            .await
            .map_err(|error| format!("写入临时输出失败: {error}"))?;
        handle
            .flush()
            .await
            .map_err(|error| format!("刷新临时输出失败: {error}"))?;
        handle
            .sync_all()
            .await
            .map_err(|error| format!("同步临时输出失败: {error}"))?;
        Ok::<(), String>(())
    }
    .await;
    drop(handle);
    if let Err(error) = write_result {
        let _ = tokio::fs::remove_file(&temporary).await;
        return Err(error);
    }
    if let Some(permissions) = previous_permissions {
        if let Err(error) = tokio::fs::set_permissions(&temporary, permissions).await {
            let _ = tokio::fs::remove_file(&temporary).await;
            return Err(format!("保留输出权限失败: {error}"));
        }
    }

    let had_target = target.is_file();
    if had_target {
        if let Err(error) = tokio::fs::rename(&target, &backup).await {
            let _ = tokio::fs::remove_file(&temporary).await;
            return Err(format!("备份现有输出失败: {error}"));
        }
    }
    if let Err(error) = tokio::fs::rename(&temporary, &target).await {
        if had_target {
            let _ = tokio::fs::rename(&backup, &target).await;
        }
        let _ = tokio::fs::remove_file(&temporary).await;
        return Err(format!("替换输出失败: {error}"));
    }
    if had_target {
        tokio::fs::remove_file(&backup)
            .await
            .map_err(|error| format!("输出已保存，但清理临时备份失败: {error}"))?;
    }
    Ok(())
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
    let status = status
        .await
        .map_err(|error| format!("打开路径失败: {error}"))?;
    ensure_successful_status(status, "打开路径")
}

fn ensure_successful_status(status: ExitStatus, operation: &str) -> Result<(), String> {
    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "{operation}命令失败 (exit {})",
            status.code().unwrap_or(-1)
        ))
    }
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

    fn valid_output_event() -> &'static [u8] {
        br#"GROK_KEYSMITH_EVENT {"schema":"grok-keysmith.stream.v1","type":"output","channel":"stdout","text":"hello"}"#
    }

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

    #[test]
    fn version_probe_allows_frozen_sidecar_cold_start() {
        assert_eq!(version_probe_timeout(), Duration::from_secs(30));
    }

    #[test]
    fn stream_protocol_lines_are_not_captured_as_diagnostics() {
        let mut captured = CapturedOutput::default();
        let mut budget = StreamEventBudget::default();
        capture_stderr_line(
            &mut captured,
            valid_output_event(),
            &None,
            "run-1",
            &mut budget,
        );
        assert!(captured.bytes.is_empty());
        assert_eq!(budget.count, 1);

        capture_stderr_line(
            &mut captured,
            b"plain diagnostic",
            &None,
            "run-1",
            &mut budget,
        );
        assert_eq!(captured.bytes, b"plain diagnostic\n");
    }

    #[test]
    fn malformed_protocol_lines_remain_visible() {
        let mut captured = CapturedOutput::default();
        let mut budget = StreamEventBudget::default();
        capture_stderr_line(
            &mut captured,
            b"GROK_KEYSMITH_EVENT not-json",
            &None,
            "run-1",
            &mut budget,
        );
        assert_eq!(captured.bytes, b"GROK_KEYSMITH_EVENT not-json\n");
    }

    #[test]
    fn protocol_requires_known_schema_type_and_channel() {
        for line in [
            br#"GROK_KEYSMITH_EVENT {"schema":"other","type":"output","channel":"stdout","text":"x"}"#.as_slice(),
            br#"GROK_KEYSMITH_EVENT {"schema":"grok-keysmith.stream.v1","type":"unknown"}"#.as_slice(),
            br#"GROK_KEYSMITH_EVENT {"schema":"grok-keysmith.stream.v1","type":"output","channel":"log","text":"x"}"#.as_slice(),
            br#"GROK_KEYSMITH_EVENT {"schema":"grok-keysmith.stream.v1","type":"output","text":"x"}"#.as_slice(),
            br#"GROK_KEYSMITH_EVENT {"schema":"grok-keysmith.stream.v1","type":"summary","channel":"stdout"}"#.as_slice(),
        ] {
            let mut captured = CapturedOutput::default();
            let mut budget = StreamEventBudget::default();
            capture_stderr_line(&mut captured, line, &None, "run-1", &mut budget);
            assert_eq!(captured.bytes, [line, b"\n"].concat());
            assert_eq!(budget.count, 0);
        }
    }

    #[test]
    fn protocol_enforces_total_event_count_and_bytes() {
        let mut count_captured = CapturedOutput::default();
        let mut count_budget = StreamEventBudget {
            count: MAX_STREAM_EVENTS,
            bytes: 0,
        };
        capture_stderr_line(
            &mut count_captured,
            valid_output_event(),
            &None,
            "run-1",
            &mut count_budget,
        );
        assert!(count_captured.stream_events_limited);
        assert!(count_captured.bytes.is_empty());

        let mut byte_captured = CapturedOutput::default();
        let mut byte_budget = StreamEventBudget {
            count: 0,
            bytes: MAX_STREAM_EVENT_BYTES,
        };
        capture_stderr_line(
            &mut byte_captured,
            valid_output_event(),
            &None,
            "run-1",
            &mut byte_budget,
        );
        assert!(byte_captured.stream_events_limited);
        assert!(validate_captured_output(&CapturedOutput::default(), &byte_captured).is_err());
    }

    #[test]
    fn captured_output_rejects_truncation_and_read_errors() {
        let truncated = CapturedOutput {
            truncated: true,
            ..CapturedOutput::default()
        };
        let failed = CapturedOutput {
            error: Some("pipe closed".to_string()),
            ..CapturedOutput::default()
        };
        assert!(validate_captured_output(&truncated, &CapturedOutput::default()).is_err());
        assert!(validate_captured_output(&CapturedOutput::default(), &failed).is_err());
    }

    #[test]
    fn nonzero_open_command_status_is_rejected() {
        #[cfg(windows)]
        let status = std::process::Command::new("cmd")
            .args(["/C", "exit", "7"])
            .status()
            .expect("cmd status");
        #[cfg(not(windows))]
        let status = std::process::Command::new("sh")
            .args(["-c", "exit 7"])
            .status()
            .expect("sh status");
        let error = ensure_successful_status(status, "fixture").expect_err("nonzero exit");
        assert!(error.contains("exit 7"));
    }

    #[tokio::test]
    async fn manifest_read_rejects_oversized_files() {
        let directory =
            std::env::temp_dir().join(format!("grok-keysmith-manifest-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&directory).expect("fixture directory");
        std::fs::write(
            directory.join(MANIFEST_FILENAME),
            vec![b'x'; MAX_MANIFEST_BYTES + 1],
        )
        .expect("fixture manifest");
        let error = read_manifest(directory.to_string_lossy().into_owned())
            .await
            .expect_err("oversized manifest must fail");
        assert!(error.contains("字节上限"));
        let _ = std::fs::remove_dir_all(directory);
    }

    #[tokio::test]
    async fn text_save_replaces_existing_file_without_residue() {
        let directory =
            std::env::temp_dir().join(format!("grok-keysmith-output-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&directory).expect("fixture directory");
        let target = directory.join("output.txt");
        std::fs::write(&target, b"before").expect("fixture output");
        write_text_file(target.to_string_lossy().into_owned(), "after".to_string())
            .await
            .expect("atomic output save");
        assert_eq!(
            std::fs::read_to_string(&target).expect("saved output"),
            "after"
        );
        assert_eq!(
            std::fs::read_dir(&directory)
                .expect("fixture listing")
                .count(),
            1
        );
        let _ = std::fs::remove_dir_all(directory);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn invocation_bounds_pipe_drain_after_root_exit() {
        let invocation = CliInvocation {
            path: PathBuf::from("/bin/sh"),
            program: PathBuf::from("/bin/sh"),
            prefix_args: vec![OsString::from("-c"), OsString::from("sleep 30 & exit 0")],
            runtime: CliRuntime::Executable,
        };
        let started = std::time::Instant::now();
        let output = run_invocation(&invocation, &[], Duration::from_secs(10), None)
            .await
            .expect("bounded drain");
        assert_eq!(output.exit_code, 0);
        assert!(started.elapsed() < Duration::from_secs(8));
    }
}
