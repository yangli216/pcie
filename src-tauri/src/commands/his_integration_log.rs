use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{command, AppHandle, Manager};
use uuid::Uuid;

const LOG_FILE_NAME: &str = "his-integration.jsonl";
const MAX_LOG_FILE_BYTES: u64 = 5 * 1024 * 1024;
const MAX_STRING_LEN: usize = 1_200;
const DEFAULT_LIST_LIMIT: usize = 200;
const MAX_LIST_LIMIT: usize = 1_000;
static LOG_FILE_MUTEX: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HisIntegrationLogEntry {
    pub id: String,
    pub trace_id: String,
    pub direction: String,
    pub operation: String,
    pub method: String,
    pub path: String,
    pub url: Option<String>,
    pub status: String,
    pub http_status: Option<u16>,
    pub business_code: Option<String>,
    pub business_message: Option<String>,
    pub duration_ms: Option<u64>,
    pub request_summary: Option<Value>,
    pub response_summary: Option<Value>,
    pub patient_id: Option<String>,
    pub consultation_id: Option<String>,
    pub request_id: Option<String>,
    pub error_message: Option<String>,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HisIntegrationLogInput {
    pub trace_id: Option<String>,
    pub direction: String,
    pub operation: String,
    pub method: String,
    pub path: String,
    pub url: Option<String>,
    pub status: String,
    pub http_status: Option<u16>,
    pub business_code: Option<String>,
    pub business_message: Option<String>,
    pub duration_ms: Option<u64>,
    pub request_summary: Option<Value>,
    pub response_summary: Option<Value>,
    pub patient_id: Option<String>,
    pub consultation_id: Option<String>,
    pub request_id: Option<String>,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HisIntegrationLogQuery {
    pub trace_id: Option<String>,
    pub keyword: Option<String>,
    pub direction: Option<String>,
    pub status: Option<String>,
    pub limit: Option<usize>,
}

pub fn new_trace_id() -> String {
    format!("his-{}-{}", current_millis(), short_uuid())
}

pub fn current_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn sanitize_for_log(value: Value) -> Value {
    sanitize_value(value, None)
}

pub fn record_log_entry(app: &AppHandle, input: HisIntegrationLogInput) -> Result<String, String> {
    let trace_id = input.trace_id.unwrap_or_else(new_trace_id);
    let entry = HisIntegrationLogEntry {
        id: Uuid::new_v4().to_string(),
        trace_id: trace_id.clone(),
        direction: input.direction,
        operation: input.operation,
        method: input.method,
        path: input.path,
        url: input.url.map(truncate_string),
        status: input.status,
        http_status: input.http_status,
        business_code: input.business_code.map(truncate_string),
        business_message: input.business_message.map(truncate_string),
        duration_ms: input.duration_ms,
        request_summary: input.request_summary.map(sanitize_for_log),
        response_summary: input.response_summary.map(sanitize_for_log),
        patient_id: input.patient_id.map(truncate_string),
        consultation_id: input.consultation_id.map(truncate_string),
        request_id: input.request_id.map(truncate_string),
        error_message: input.error_message.map(truncate_string),
        created_at: current_millis(),
    };

    append_entry(app, &entry)?;
    Ok(trace_id)
}

#[command]
pub async fn record_his_integration_log(
    app: AppHandle,
    entry: HisIntegrationLogInput,
) -> Result<String, String> {
    record_log_entry(&app, entry)
}

#[command]
pub async fn list_his_integration_logs(
    app: AppHandle,
    query: Option<HisIntegrationLogQuery>,
) -> Result<Vec<HisIntegrationLogEntry>, String> {
    let query = query.unwrap_or(HisIntegrationLogQuery {
        trace_id: None,
        keyword: None,
        direction: None,
        status: None,
        limit: Some(DEFAULT_LIST_LIMIT),
    });
    let limit = query
        .limit
        .unwrap_or(DEFAULT_LIST_LIMIT)
        .clamp(1, MAX_LIST_LIMIT);
    let mut entries = read_current_entries(&app)?;
    entries.retain(|entry| matches_query(entry, &query));
    entries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    entries.truncate(limit);
    Ok(entries)
}

#[command]
pub async fn clear_his_integration_logs(app: AppHandle) -> Result<(), String> {
    let _guard = LOG_FILE_MUTEX.lock().map_err(|error| error.to_string())?;
    let log_path = log_file_path(&app)?;
    if log_path.exists() {
        fs::remove_file(&log_path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[command]
pub async fn export_his_integration_logs(
    app: AppHandle,
    query: Option<HisIntegrationLogQuery>,
) -> Result<Option<String>, String> {
    let entries = list_his_integration_logs(app.clone(), query).await?;
    let content = entries
        .iter()
        .map(|entry| serde_json::to_string(entry).map_err(|error| error.to_string()))
        .collect::<Result<Vec<_>, _>>()?
        .join("\n");

    let file = rfd::AsyncFileDialog::new()
        .set_file_name("his-integration-logs.jsonl")
        .add_filter("JSON Lines", &["jsonl"])
        .save_file()
        .await;

    if let Some(file) = file {
        let path = file.path().to_path_buf();
        fs::write(
            &path,
            if content.is_empty() {
                String::new()
            } else {
                format!("{}\n", content)
            },
        )
        .map_err(|error| error.to_string())?;
        Ok(Some(path.to_string_lossy().to_string()))
    } else {
        Ok(None)
    }
}

fn short_uuid() -> String {
    Uuid::new_v4()
        .to_string()
        .chars()
        .take(8)
        .collect::<String>()
}

fn log_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("his-integration-logs");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn log_file_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(log_dir(app)?.join(LOG_FILE_NAME))
}

fn append_entry(app: &AppHandle, entry: &HisIntegrationLogEntry) -> Result<(), String> {
    let path = log_file_path(app)?;
    append_entry_at_path(&path, entry)
}

fn append_entry_at_path(path: &Path, entry: &HisIntegrationLogEntry) -> Result<(), String> {
    let _guard = LOG_FILE_MUTEX.lock().map_err(|error| error.to_string())?;
    rotate_if_needed(path)?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| error.to_string())?;
    let mut line = serde_json::to_string(entry).map_err(|error| error.to_string())?;
    line.push('\n');
    file.write_all(line.as_bytes())
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod concurrent_file_tests {
    use super::*;
    use std::collections::HashSet;
    use std::sync::{Arc, Barrier};
    use std::thread;

    #[test]
    fn concurrent_log_records_remain_individually_parseable() {
        let directory = std::env::temp_dir().join(format!("pcie-his-log-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let path = Arc::new(directory.join(LOG_FILE_NAME));
        let barrier = Arc::new(Barrier::new(16));
        let threads: Vec<_> = (0..16).map(|writer| {
            let path = Arc::clone(&path);
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                barrier.wait();
                for sequence in 0..64 {
                    let entry: HisIntegrationLogEntry = serde_json::from_value(json!({
                        "id": format!("synthetic-{writer}-{sequence}"),
                        "traceId": "synthetic", "direction": "outbound", "operation": "synthetic-query",
                        "method": "POST", "path": "/synthetic", "status": "success", "createdAt": 1,
                        "requestSummary": { "shape": "合成摘要".repeat(100) }
                    })).unwrap();
                    append_entry_at_path(&path, &entry).unwrap();
                }
            })
        }).collect();
        for handle in threads {
            handle.join().unwrap();
        }
        let content = fs::read_to_string(path.as_ref()).unwrap();
        fs::remove_dir_all(directory).unwrap();
        let entries: Vec<HisIntegrationLogEntry> = content
            .lines()
            .map(|line| {
                serde_json::from_str(line)
                    .expect("each concurrent log entry must occupy one complete JSON line")
            })
            .collect();
        assert_eq!(entries.len(), 16 * 64);
        assert_eq!(
            entries
                .iter()
                .map(|entry| &entry.id)
                .collect::<HashSet<_>>()
                .len(),
            16 * 64
        );
    }
}

fn rotate_if_needed(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if metadata.len() < MAX_LOG_FILE_BYTES {
        return Ok(());
    }
    let rotated = path.with_file_name(format!("his-integration-{}.jsonl", current_millis()));
    fs::rename(path, rotated).map_err(|error| error.to_string())
}

fn read_current_entries(app: &AppHandle) -> Result<Vec<HisIntegrationLogEntry>, String> {
    let _guard = LOG_FILE_MUTEX.lock().map_err(|error| error.to_string())?;
    let path = log_file_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let file = File::open(path).map_err(|error| error.to_string())?;
    let reader = BufReader::new(file);
    let mut entries = Vec::new();
    for line in reader.lines() {
        let line = line.map_err(|error| error.to_string())?;
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(entry) = serde_json::from_str::<HisIntegrationLogEntry>(&line) {
            entries.push(entry);
        }
    }
    Ok(entries)
}

fn matches_query(entry: &HisIntegrationLogEntry, query: &HisIntegrationLogQuery) -> bool {
    if let Some(trace_id) = query
        .trace_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if !entry.trace_id.contains(trace_id) {
            return false;
        }
    }
    if let Some(direction) = query
        .direction
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if entry.direction != direction {
            return false;
        }
    }
    if let Some(status) = query
        .status
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if entry.status != status {
            return false;
        }
    }
    if let Some(keyword) = query
        .keyword
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let haystack = format!(
            "{} {} {} {} {} {} {}",
            entry.operation,
            entry.method,
            entry.path,
            entry.url.as_deref().unwrap_or_default(),
            entry.business_message.as_deref().unwrap_or_default(),
            entry.patient_id.as_deref().unwrap_or_default(),
            entry.request_id.as_deref().unwrap_or_default(),
        )
        .to_lowercase();
        if !haystack.contains(&keyword.to_lowercase()) {
            return false;
        }
    }
    true
}

fn sanitize_value(value: Value, key: Option<&str>) -> Value {
    if key.map(is_sensitive_key).unwrap_or(false) {
        return Value::String("***".to_string());
    }

    match value {
        Value::String(text) => Value::String(truncate_string(text)),
        Value::Array(items) => {
            if items.len() > 12 {
                json!({
                    "arrayLength": items.len(),
                    "sample": items.into_iter().take(3).map(|item| sanitize_value(item, None)).collect::<Vec<_>>()
                })
            } else {
                Value::Array(
                    items
                        .into_iter()
                        .map(|item| sanitize_value(item, None))
                        .collect(),
                )
            }
        }
        Value::Object(object) => {
            let mut next = Map::new();
            for (child_key, child_value) in object {
                next.insert(
                    child_key.clone(),
                    sanitize_value(child_value, Some(&child_key)),
                );
            }
            Value::Object(next)
        }
        other => other,
    }
}

fn is_sensitive_key(key: &str) -> bool {
    let normalized = key.to_ascii_lowercase();
    [
        "token",
        "authorization",
        "cookie",
        "password",
        "secret",
        "apikey",
        "api_key",
        "mobile",
        "phone",
        "idcard",
        "id_card",
        "certno",
    ]
    .iter()
    .any(|needle| normalized.contains(needle))
}

fn truncate_string(value: String) -> String {
    if value.chars().count() <= MAX_STRING_LEN {
        return value;
    }
    let mut truncated = value.chars().take(MAX_STRING_LEN).collect::<String>();
    truncated.push_str("...(truncated)");
    truncated
}
