//! Isolated, memory-only public-health ownership and writeback state.
//! No consultation state, patient contents, or credentials enter the legacy event bus.
use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet, VecDeque};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::watch;
use uuid::Uuid;

pub const SCHEMA: &str = "public-health.v1";
pub const TTL_MS: u64 = 30 * 60 * 1000;
const MAX_SESSIONS: usize = 32;
const MAX_TASKS: usize = 128;
const MAX_REQUESTS: usize = 16;
const MAX_WRITES: usize = 32;
const MAX_EVENTS: usize = 128;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BridgeError {
    pub error_code: String,
    pub message: String,
}
pub type BridgeResult<T> = Result<T, BridgeError>;
pub fn error(code: &str, message: &str) -> BridgeError {
    BridgeError {
        error_code: code.into(),
        message: message.into(),
    }
}
impl BridgeError {
    pub fn status(&self) -> u16 {
        match self.error_code.as_str() {
            "BRIDGE_NOT_CONFIGURED" => 503,
            "BRIDGE_AUTH_FAILED" | "BRIDGE_SESSION_EXPIRED" => 401,
            "ORIGIN_NOT_ALLOWED" | "BRIDGE_OWNER_MISMATCH" => 403,
            "CAPACITY_EXCEEDED" => 429,
            "INVALID_REQUEST" => 400,
            _ => 409,
        }
    }
}
pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
pub fn iso(ms: u64) -> String {
    DateTime::<Utc>::from_timestamp_millis(ms as i64)
        .unwrap_or_default()
        .to_rfc3339_opts(SecondsFormat::Millis, true)
}
fn digest(value: &[u8]) -> String {
    format!("{:x}", Sha256::digest(value))
}
fn equal_secret(a: &str, b: &str) -> bool {
    let left = Sha256::digest(a.as_bytes());
    let right = Sha256::digest(b.as_bytes());
    left.iter()
        .zip(right.iter())
        .fold(0u8, |v, (a, b)| v | (a ^ b))
        == 0
}
fn canonical_value(value: &Value) -> Value {
    match value {
        Value::Object(values) => Value::Object(
            values
                .iter()
                .map(|(key, value)| (key.clone(), canonical_value(value)))
                .collect(),
        ),
        Value::Array(values) => Value::Array(values.iter().map(canonical_value).collect()),
        Value::Number(number) => match number.as_f64() {
            Some(n) if n.is_finite() && n.abs() <= 9_007_199_254_740_991.0 && n.fract() == 0.0 => {
                json!(n as i64)
            }
            _ => value.clone(),
        },
        _ => value.clone(),
    }
}
fn validate_numbers(value: &Value) -> BridgeResult<()> {
    match value {
        Value::Object(values) => {
            for value in values.values() {
                validate_numbers(value)?;
            }
        }
        Value::Array(values) => {
            for value in values {
                validate_numbers(value)?;
            }
        }
        Value::Number(number) => {
            if !number
                .as_f64()
                .is_some_and(|n| n.is_finite() && n.abs() <= 9_007_199_254_740_991.0)
            {
                return Err(error("INVALID_REQUEST", "数字必须在JavaScript安全范围内"));
            }
        }
        _ => {}
    }
    Ok(())
}
pub fn request_hash(v: &Value) -> String {
    // Sorted object keys and semantic integer numbers survive the Rust/JS boundary.
    digest(
        serde_json::to_string(&canonical_value(v))
            .unwrap_or_default()
            .as_bytes(),
    )
}
fn random_token() -> String {
    // Three independent UUIDv4s contain 366 random bits, exceeding the 256-bit floor.
    let mut bytes = Vec::with_capacity(48);
    for _ in 0..3 {
        bytes.extend_from_slice(Uuid::new_v4().as_bytes());
    }
    STANDARD.encode(bytes)
}
fn str_field<'a>(v: &'a Value, key: &str) -> BridgeResult<&'a str> {
    v.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| error("INVALID_REQUEST", "缺少合法的必填字段"))
}
fn uuid_field(v: &Value, key: &str) -> BridgeResult<()> {
    Uuid::parse_str(str_field(v, key)?)
        .map(|_| ())
        .map_err(|_| error("INVALID_REQUEST", "业务标识必须为UUID"))
}
fn date_field(v: &Value, key: &str) -> BridgeResult<()> {
    DateTime::parse_from_rfc3339(str_field(v, key)?)
        .map(|_| ())
        .map_err(|_| error("INVALID_REQUEST", "时间必须包含时区"))
}
fn keys(v: &Value, allowed: &[&str]) -> BridgeResult<()> {
    let obj = v
        .as_object()
        .ok_or_else(|| error("INVALID_REQUEST", "请求必须为JSON对象"))?;
    if obj.keys().any(|k| !allowed.contains(&k.as_str())) {
        return Err(error("INVALID_REQUEST", "包含不支持的字段"));
    }
    Ok(())
}
const IDENTITY: &[&str] = &[
    "originRequestId",
    "capability",
    "scene",
    "patientId",
    "businessRecordId",
    "recordVersion",
    "snapshotAt",
];
fn same_fields(a: &Value, b: &Value, fields: &[&str]) -> bool {
    fields.iter().all(|k| a.get(*k) == b.get(*k))
}
fn validate_identity(v: &Value) -> BridgeResult<()> {
    if str_field(v, "schemaVersion")? != SCHEMA {
        return Err(error("INVALID_REQUEST", "协议版本不支持"));
    }
    uuid_field(v, "requestId")?;
    uuid_field(v, "originRequestId")?;
    for field in ["patientId", "businessRecordId", "recordVersion"] {
        if str_field(v, field)?.chars().count() > 128 {
            return Err(error("INVALID_REQUEST", "业务标识过长"));
        }
    }
    if !["health_prescription", "weight_management"].contains(&str_field(v, "capability")?)
        || !["hypertension_followup", "diabetes_followup", "elderly_exam"]
            .contains(&str_field(v, "scene")?)
    {
        return Err(error("INVALID_REQUEST", "业务能力或场景不支持"));
    }
    date_field(v, "snapshotAt")
}
fn bounded_field<'a>(value: &'a Value, field: &str, max: usize) -> BridgeResult<&'a str> {
    let text = str_field(value, field)?;
    if text.chars().count() > max {
        return Err(error("INVALID_REQUEST", "字段文本超过长度限制"));
    }
    Ok(text)
}
fn optional_text(value: &Value, field: &str, max: usize) -> BridgeResult<()> {
    if value.get(field).is_some() {
        bounded_field(value, field, max)?;
    }
    Ok(())
}
fn validate_source(value: &Value) -> BridgeResult<()> {
    keys(value, &["system", "recordId"])?;
    bounded_field(value, "system", 64)?;
    bounded_field(value, "recordId", 128)?;
    if value["system"] == "PCIE_MANUAL" {
        uuid_field(value, "recordId")?;
    }
    Ok(())
}
fn validate_fact_entries(facts: &Value) -> BridgeResult<()> {
    let mut observation_ids = HashSet::new();
    for item in facts["observations"].as_array().unwrap() {
        keys(
            item,
            &["id", "code", "value", "unit", "observedAt", "source"],
        )?;
        if !observation_ids.insert(bounded_field(item, "id", 128)?) {
            return Err(error("INVALID_REQUEST", "观察记录标识重复"));
        }
        bounded_field(item, "code", 128)?;
        if !item["value"].is_number() {
            bounded_field(item, "value", 2000)?;
        }
        optional_text(item, "unit", 64)?;
        date_field(item, "observedAt")?;
        validate_source(&item["source"])?;
    }
    for item in facts["conditions"].as_array().unwrap() {
        keys(item, &["code", "name", "status"])?;
        bounded_field(item, "code", 128)?;
        bounded_field(item, "name", 200)?;
        bounded_field(item, "status", 64)?;
    }
    for item in facts["medicationClasses"].as_array().unwrap() {
        keys(item, &["code", "name"])?;
        bounded_field(item, "code", 128)?;
        bounded_field(item, "name", 200)?;
    }
    let lifestyle = &facts["lifestyle"];
    let fields = [
        "smoking",
        "alcohol",
        "exercise",
        "diet",
        "exerciseAbility",
        "occupation",
    ];
    keys(lifestyle, &fields)?;
    for field in fields {
        optional_text(lifestyle, field, 2000)?;
    }
    optional_text(facts, "historySummary", 12000)?;
    if facts.get("nextFollowUpDate").is_some() {
        let date = str_field(facts, "nextFollowUpDate")?;
        if chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .ok()
            .filter(|parsed| parsed.format("%Y-%m-%d").to_string() == date)
            .is_none()
        {
            return Err(error("INVALID_REQUEST", "随访日期格式无效"));
        }
    }
    if let Some(profile) = facts.get("weightProfile") {
        keys(
            profile,
            &[
                "heightCm",
                "weightKg",
                "region",
                "season",
                "activityDescription",
                "dietPreferences",
                "limitations",
                "heightObservationId",
                "weightObservationId",
                "contextSource",
            ],
        )?;
        for (field, max) in [("heightCm", 300.0), ("weightKg", 1000.0)] {
            if !profile[field].as_f64().is_some_and(|n| n > 0.0 && n <= max) {
                return Err(error("INVALID_REQUEST", "减重资料数值超出限制"));
            }
        }
        if !["东北", "华北", "华东", "华中", "华南", "西南", "西北"]
            .contains(&str_field(profile, "region")?)
            || !["spring", "summer", "autumn", "winter"].contains(&str_field(profile, "season")?)
        {
            return Err(error("INVALID_REQUEST", "地区或季节无效"));
        }
        for field in ["activityDescription", "dietPreferences", "limitations"] {
            optional_text(profile, field, 4000)?;
        }
        for field in ["heightObservationId", "weightObservationId"] {
            optional_text(profile, field, 128)?;
        }
        if let Some(source) = profile.get("contextSource") {
            validate_source(source)?;
        }
    }
    Ok(())
}
pub fn validate_request(v: &Value) -> BridgeResult<()> {
    validate_numbers(v)?;
    keys(
        v,
        &[
            "schemaVersion",
            "requestId",
            "originRequestId",
            "capability",
            "scene",
            "patientId",
            "businessRecordId",
            "recordVersion",
            "snapshotAt",
            "patient",
            "facts",
            "writebackTargets",
        ],
    )?;
    validate_identity(v)?;
    if serde_json::to_vec(v).unwrap_or_default().len() > 524_288 {
        return Err(error("INVALID_REQUEST", "资料超过大小限制"));
    }
    let patient = &v["patient"];
    keys(patient, &["name", "sex", "ageYears", "sexSource"])?;
    if str_field(patient, "name")?.chars().count() > 100
        || !["male", "female", "unknown"].contains(&str_field(patient, "sex")?)
        || !patient["ageYears"]
            .as_f64()
            .is_some_and(|n| n.is_finite() && n.fract() == 0.0 && (0.0..=150.0).contains(&n))
    {
        return Err(error("INVALID_REQUEST", "居民基本资料无效"));
    }
    if let Some(source) = patient.get("sexSource") {
        validate_source(source)?;
    }
    let facts = &v["facts"];
    keys(
        facts,
        &[
            "observations",
            "conditions",
            "medicationClasses",
            "lifestyle",
            "historySummary",
            "nextFollowUpDate",
            "weightProfile",
        ],
    )?;
    for (field, max) in [
        ("observations", 256),
        ("conditions", 64),
        ("medicationClasses", 64),
    ] {
        if facts[field].as_array().filter(|a| a.len() <= max).is_none() {
            return Err(error("INVALID_REQUEST", "事实列表缺失或超限"));
        }
    }
    if !facts["lifestyle"].is_object() {
        return Err(error("INVALID_REQUEST", "生活方式资料无效"));
    }
    validate_fact_entries(facts)?;
    let targets = v["writebackTargets"]
        .as_array()
        .filter(|a| !a.is_empty() && a.len() <= 3)
        .ok_or_else(|| error("INVALID_REQUEST", "回写目标缺失或超限"))?;
    let expected: Vec<&str> = if v["capability"] == "health_prescription" {
        vec!["check_plan", "medication_guidance", "lifestyle_guidance"]
    } else {
        vec!["exercise_plan", "meal_plan"]
    };
    let mut ids = HashSet::new();
    let mut sections = HashSet::new();
    for target in targets {
        keys(
            target,
            &[
                "targetFieldId",
                "label",
                "sourceSections",
                "valueType",
                "mode",
            ],
        )?;
        if !ids.insert(bounded_field(target, "targetFieldId", 128)?)
            || target["mode"] != "replace"
            || target["valueType"] != "string"
        {
            return Err(error("INVALID_REQUEST", "回写字段重复或类型不支持"));
        }
        bounded_field(target, "label", 200)?;
        let list = target["sourceSections"]
            .as_array()
            .filter(|a| !a.is_empty())
            .ok_or_else(|| error("INVALID_REQUEST", "章节映射缺失"))?;
        let mut previous = None;
        for section in list {
            let s = section
                .as_str()
                .ok_or_else(|| error("INVALID_REQUEST", "章节标识无效"))?;
            let position = expected
                .iter()
                .position(|id| *id == s)
                .ok_or_else(|| error("INVALID_REQUEST", "章节不属于当前能力"))?;
            if previous.is_some_and(|p| p >= position) || !sections.insert(s) {
                return Err(error("INVALID_REQUEST", "章节映射重复或顺序错误"));
            }
            previous = Some(position);
        }
    }
    if sections.len() != expected.len() {
        return Err(error("INVALID_REQUEST", "回写映射必须完整覆盖能力章节"));
    }
    Ok(())
}

pub struct BridgeConfig {
    origins: HashSet<String>,
    pairing_hash: Option<String>,
}
impl BridgeConfig {
    pub fn from_env() -> Self {
        Self::new(
            &std::env::var("PCIE_PUBLIC_HEALTH_ALLOWED_ORIGINS").unwrap_or_default(),
            &std::env::var("PCIE_PUBLIC_HEALTH_PAIRING_SECRET").unwrap_or_default(),
        )
    }
    pub fn new(origins: &str, secret: &str) -> Self {
        let mut valid = HashSet::new();
        for value in origins.split(',').map(str::trim).filter(|s| !s.is_empty()) {
            let Ok(url) = url::Url::parse(value) else {
                return Self {
                    origins: HashSet::new(),
                    pairing_hash: None,
                };
            };
            if !["http", "https"].contains(&url.scheme())
                || url.origin().ascii_serialization() != value
            {
                return Self {
                    origins: HashSet::new(),
                    pairing_hash: None,
                };
            }
            valid.insert(value.to_owned());
        }
        let pairing_hash = STANDARD
            .decode(secret)
            .ok()
            .filter(|b| b.len() >= 32)
            .map(|_| digest(secret.as_bytes()));
        Self {
            origins: valid,
            pairing_hash,
        }
    }
    pub fn origin(&self, origin: &str) -> BridgeResult<()> {
        if self.origins.is_empty() || self.pairing_hash.is_none() {
            return Err(error("BRIDGE_NOT_CONFIGURED", "公卫接入尚未完成部署配置"));
        }
        if !self.origins.contains(origin) {
            return Err(error("ORIGIN_NOT_ALLOWED", "当前页面来源不允许公卫接入"));
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HandshakeRequest {
    pub schema_version: String,
    pub sdk_instance_id: String,
    pub resume_session_id: Option<String>,
}
struct Session {
    origin: String,
    sdk_instance_id: String,
    token_hash: String,
    current_token: String,
    previous_token_hash: Option<String>,
    previous_renew_until: u64,
    expires_at: u64,
    renew_until: u64,
    events: VecDeque<Value>,
    notice: watch::Sender<u64>,
    revision: u64,
}
impl Session {
    fn enqueue_result(
        &mut self,
        session_id: &str,
        payload: &Value,
        now: u64,
    ) -> BridgeResult<String> {
        if self.events.len() >= MAX_EVENTS {
            return Err(error("CAPACITY_EXCEEDED", "公卫结果事件容量已满"));
        }
        let event_id = Uuid::new_v4().to_string();
        let envelope = json!({"state":"ready","traceId":Uuid::new_v4().to_string(),"event":{"id":event_id,"type":"public-health-result-confirmed","bridgeSessionId":session_id,"timestamp":now,"payload":payload}});
        self.events.push_back(envelope);
        self.revision += 1;
        self.notice.send_replace(self.revision);
        Ok(event_id)
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSnapshot {
    pub bridge_session_id: String,
    pub origin_request_id: String,
    pub request: Value,
    pub phase: String,
    pub pending_writeback: Option<Value>,
    pub last_feedback: Option<Value>,
}
struct WriteIntent {
    payload: Value,
    feedback: Option<Value>,
    event_id: String,
}
struct Task {
    snapshot: TaskSnapshot,
    initial: Value,
    requests: HashMap<String, String>,
    writes: HashMap<String, WriteIntent>,
}
pub struct PublicHealthRegistry {
    pub config: BridgeConfig,
    sessions: HashMap<String, Session>,
    tasks: HashMap<String, Task>,
    active: Option<String>,
    request_owners: HashMap<String, String>,
    write_owners: HashMap<(String, String), String>,
}
impl PublicHealthRegistry {
    pub fn new(config: BridgeConfig) -> Self {
        Self {
            config,
            sessions: HashMap::new(),
            tasks: HashMap::new(),
            active: None,
            request_owners: HashMap::new(),
            write_owners: HashMap::new(),
        }
    }
    pub fn purge_expired(&mut self, now: u64) {
        self.sessions.retain(|_, session| now < session.renew_until);
        self.tasks
            .retain(|_, task| self.sessions.contains_key(&task.snapshot.bridge_session_id));
        self.request_owners
            .retain(|_, origin| self.tasks.contains_key(origin));
        self.write_owners.retain(|(session, _), origin| {
            self.sessions.contains_key(session) && self.tasks.contains_key(origin)
        });
        if self
            .active
            .as_ref()
            .is_some_and(|origin| !self.tasks.contains_key(origin))
        {
            self.active = None;
        }
    }
    pub fn handshake(
        &mut self,
        origin: &str,
        pairing: &str,
        old_token: &str,
        request: HandshakeRequest,
        now: u64,
    ) -> BridgeResult<Value> {
        self.purge_expired(now);
        self.config.origin(origin)?;
        if request.schema_version != SCHEMA || Uuid::parse_str(&request.sdk_instance_id).is_err() {
            return Err(error("INVALID_REQUEST", "公卫握手参数无效"));
        }
        if !equal_secret(
            &digest(pairing.as_bytes()),
            self.config.pairing_hash.as_deref().unwrap_or_default(),
        ) {
            return Err(error("BRIDGE_AUTH_FAILED", "公卫实例认证失败"));
        }
        let id = if let Some(id) = request.resume_session_id {
            let session = self
                .sessions
                .get(&id)
                .ok_or_else(|| error("BRIDGE_AUTH_FAILED", "原会话不存在，不能恢复任务"))?;
            if session.origin != origin || session.sdk_instance_id != request.sdk_instance_id {
                return Err(error("BRIDGE_AUTH_FAILED", "原实例凭据不匹配"));
            }
            let old_hash = digest(old_token.as_bytes());
            if !equal_secret(&session.token_hash, &old_hash) {
                if session
                    .previous_token_hash
                    .as_ref()
                    .is_some_and(|hash| equal_secret(hash, &old_hash))
                    && now < session.previous_renew_until
                {
                    return Ok(
                        json!({"status":"ready","schemaVersion":SCHEMA,"bridgeSessionId":id,"publicHealthBridgeToken":session.current_token,"expiresAt":iso(session.expires_at),"renewUntil":iso(session.renew_until)}),
                    );
                }
                return Err(error("BRIDGE_AUTH_FAILED", "原实例凭据不匹配"));
            }
            if now >= session.renew_until {
                return Err(error("BRIDGE_SESSION_EXPIRED", "公卫会话已超出续期时间"));
            }
            id
        } else {
            if self.sessions.len() >= MAX_SESSIONS {
                return Err(error("CAPACITY_EXCEEDED", "公卫会话容量已满"));
            }
            // An instance identity is never enough to recover an existing credential.
            if self
                .sessions
                .values()
                .any(|s| s.origin == origin && s.sdk_instance_id == request.sdk_instance_id)
            {
                return Err(error("BRIDGE_OWNER_MISMATCH", "该实例须使用原凭据续期"));
            }
            let id = Uuid::new_v4().to_string();
            let (notice, _) = watch::channel(0);
            self.sessions.insert(
                id.clone(),
                Session {
                    origin: origin.into(),
                    sdk_instance_id: request.sdk_instance_id,
                    token_hash: String::new(),
                    current_token: String::new(),
                    previous_token_hash: None,
                    previous_renew_until: 0,
                    expires_at: 0,
                    renew_until: 0,
                    events: VecDeque::new(),
                    notice,
                    revision: 0,
                },
            );
            id
        };
        let token = random_token();
        let session = self.sessions.get_mut(&id).unwrap();
        session.previous_token_hash = if session.token_hash.is_empty() {
            None
        } else {
            Some(session.token_hash.clone())
        };
        session.previous_renew_until = session.renew_until;
        session.current_token = token.clone();
        session.token_hash = digest(token.as_bytes());
        session.expires_at = now + TTL_MS;
        session.renew_until = now + TTL_MS * 2;
        session.revision += 1;
        session.notice.send_replace(session.revision);
        Ok(
            json!({"status":"ready","schemaVersion":SCHEMA,"bridgeSessionId":id,"publicHealthBridgeToken":token,"expiresAt":iso(session.expires_at),"renewUntil":iso(session.renew_until)}),
        )
    }
    pub fn authenticate(&mut self, origin: &str, token: &str, now: u64) -> BridgeResult<String> {
        self.purge_expired(now);
        self.config.origin(origin)?;
        let hash = digest(token.as_bytes());
        let (id, session) = self
            .sessions
            .iter()
            .find(|(_, s)| equal_secret(&s.token_hash, &hash))
            .ok_or_else(|| error("BRIDGE_AUTH_FAILED", "公卫会话凭据无效"))?;
        if session.origin != origin {
            return Err(error("BRIDGE_OWNER_MISMATCH", "公卫会话不属于当前来源"));
        }
        if now >= session.expires_at {
            return Err(error(
                "BRIDGE_SESSION_EXPIRED",
                "公卫会话已过期，请重新认证",
            ));
        }
        Ok(id.clone())
    }
    fn active_session(&mut self, id: &str, now: u64) -> BridgeResult<()> {
        self.purge_expired(now);
        let s = self
            .sessions
            .get(id)
            .ok_or_else(|| error("BRIDGE_SESSION_EXPIRED", "公卫会话不存在或已失效"))?;
        if now >= s.expires_at {
            return Err(error(
                "BRIDGE_SESSION_EXPIRED",
                "公卫会话已过期，请重新认证",
            ));
        }
        Ok(())
    }
    pub fn subscribe(
        &self,
        id: &str,
        after: Option<&str>,
    ) -> BridgeResult<(watch::Receiver<u64>, Vec<Value>, u64)> {
        let s = self
            .sessions
            .get(id)
            .ok_or_else(|| error("BRIDGE_AUTH_FAILED", "公卫会话不存在"))?;
        Ok((
            s.notice.subscribe(),
            self.events_after(id, after)?,
            s.expires_at,
        ))
    }
    pub fn events_after(&self, id: &str, after: Option<&str>) -> BridgeResult<Vec<Value>> {
        let s = self
            .sessions
            .get(id)
            .ok_or_else(|| error("BRIDGE_AUTH_FAILED", "公卫会话不存在"))?;
        let start = match after.filter(|s| !s.is_empty()) {
            Some(cursor) => s
                .events
                .iter()
                .position(|e| e["event"]["id"] == cursor)
                .map(|n| n + 1)
                .ok_or_else(|| error("EVENT_CURSOR_INVALID", "公卫事件游标不属于当前会话"))?,
            None => 0,
        };
        Ok(s.events.iter().skip(start).cloned().collect())
    }
    pub fn assist(&mut self, session_id: &str, request: Value, now: u64) -> BridgeResult<Value> {
        validate_numbers(&request)?;
        let request = canonical_value(&request);
        self.active_session(session_id, now)?;
        validate_request(&request)?;
        let origin = str_field(&request, "originRequestId")?.to_owned();
        if request["requestId"] != origin {
            return Err(error(
                "INVALID_REQUEST",
                "首次调入的originRequestId必须等于requestId",
            ));
        }
        if self
            .request_owners
            .get(&origin)
            .is_some_and(|owner| owner != &origin)
        {
            return Err(error("REQUEST_ID_CONFLICT", "调入标识已被其他任务使用"));
        }
        if let Some(task) = self.tasks.get(&origin) {
            if task.snapshot.bridge_session_id != session_id {
                return Err(error("BRIDGE_OWNER_MISMATCH", "公卫任务不属于当前实例"));
            }
            if request_hash(&task.initial) != request_hash(&request) {
                return Err(error("REQUEST_ID_CONFLICT", "同一请求标识对应不同资料"));
            }
            if task.snapshot.phase == "closed" {
                return Err(error(
                    "TASK_CONTEXT_MISMATCH",
                    "已放弃任务不能恢复，请重新调入",
                ));
            }
        } else {
            if self.tasks.len() >= MAX_TASKS {
                return Err(error("CAPACITY_EXCEEDED", "公卫任务容量已满"));
            }
            self.tasks.insert(
                origin.clone(),
                Task {
                    snapshot: TaskSnapshot {
                        bridge_session_id: session_id.into(),
                        origin_request_id: origin.clone(),
                        request: request.clone(),
                        phase: "ready".into(),
                        pending_writeback: None,
                        last_feedback: None,
                    },
                    initial: request.clone(),
                    requests: HashMap::new(),
                    writes: HashMap::new(),
                },
            );
            self.request_owners.insert(origin.clone(), origin.clone());
        }
        self.active = Some(origin);
        let mut accepted = request.as_object().unwrap().clone();
        for field in ["patient", "facts", "writebackTargets"] {
            accepted.remove(field);
        }
        accepted.insert("status".into(), json!("accepted"));
        accepted.insert("bridgeSessionId".into(), json!(session_id));
        accepted.insert("acceptedAt".into(), json!(iso(now)));
        Ok(Value::Object(accepted))
    }
    pub fn active_task(&self) -> Option<TaskSnapshot> {
        self.active
            .as_ref()
            .and_then(|id| self.tasks.get(id))
            .map(|t| t.snapshot.clone())
    }
    pub fn prepare(&mut self, session_id: &str, request: Value, now: u64) -> BridgeResult<Value> {
        validate_numbers(&request)?;
        let request = canonical_value(&request);
        self.active_session(session_id, now)?;
        validate_request(&request)?;
        let origin = str_field(&request, "originRequestId")?.to_owned();
        if self.active.as_deref() != Some(&origin) {
            return Err(error("TASK_CONTEXT_MISMATCH", "当前公卫任务已切换"));
        }
        let task = self
            .tasks
            .get_mut(&origin)
            .ok_or_else(|| error("TASK_CONTEXT_MISMATCH", "原公卫任务不存在"))?;
        if task.snapshot.bridge_session_id != session_id {
            return Err(error("BRIDGE_OWNER_MISMATCH", "公卫任务不属于当前实例"));
        }
        if ["closed", "saved", "awaiting-writeback"].contains(&task.snapshot.phase.as_str()) {
            return Err(error("TASK_CONTEXT_MISMATCH", "当前状态不允许开始生成"));
        }
        if !same_fields(
            &task.initial,
            &request,
            &[
                "originRequestId",
                "capability",
                "scene",
                "patientId",
                "businessRecordId",
                "recordVersion",
                "writebackTargets",
            ],
        ) || !same_fields(
            &task.initial["patient"],
            &request["patient"],
            &["name", "ageYears"],
        ) {
            return Err(error(
                "TASK_CONTEXT_MISMATCH",
                "生成资料不属于原任务或映射发生变化",
            ));
        }
        if task.snapshot.request["patient"]["sex"] != request["patient"]["sex"] {
            if task.snapshot.request["patient"]["sex"] != "unknown"
                || !["male", "female"].contains(&str_field(&request["patient"], "sex")?)
                || request["patient"]["sexSource"]["system"] != "PCIE_MANUAL"
            {
                return Err(error("TASK_CONTEXT_MISMATCH", "明确的性别更正须重新调入"));
            }
            uuid_field(&request["patient"]["sexSource"], "recordId")?;
        }
        let id = str_field(&request, "requestId")?.to_owned();
        let hash = request_hash(&request);
        if self
            .request_owners
            .get(&id)
            .is_some_and(|owner| owner != &origin)
        {
            return Err(error("REQUEST_ID_CONFLICT", "生成标识已被其他任务使用"));
        }
        if let Some(old) = task.requests.get(&id) {
            if old != &hash {
                return Err(error("REQUEST_ID_CONFLICT", "同一生成请求对应不同资料"));
            }
        } else {
            if task.requests.len() >= MAX_REQUESTS {
                return Err(error("CAPACITY_EXCEEDED", "当前任务生成快照容量已满"));
            }
            // The original input identity cannot be reused for a doctor-edited snapshot.
            if id == origin && request_hash(&task.initial) != hash {
                return Err(error(
                    "REQUEST_ID_CONFLICT",
                    "补充资料必须使用新的requestId",
                ));
            }
            task.requests.insert(id.clone(), hash.clone());
            self.request_owners.insert(id.clone(), origin.clone());
        }
        task.snapshot.request = request;
        task.snapshot.phase = "prepared".into();
        task.snapshot.pending_writeback = None;
        task.snapshot.last_feedback = None;
        Ok(
            json!({"originRequestId":origin,"requestId":id,"requestHash":hash,"preparedAt":iso(now)}),
        )
    }
    pub fn confirm(&mut self, session_id: &str, payload: Value, now: u64) -> BridgeResult<Value> {
        self.active_session(session_id, now)?;
        keys(
            &payload,
            &[
                "schemaVersion",
                "requestId",
                "originRequestId",
                "generationId",
                "writebackRequestId",
                "capability",
                "scene",
                "patientId",
                "businessRecordId",
                "recordVersion",
                "snapshotAt",
                "items",
                "confirmedAt",
            ],
        )?;
        validate_identity(&payload)?;
        uuid_field(&payload, "generationId")?;
        uuid_field(&payload, "writebackRequestId")?;
        date_field(&payload, "confirmedAt")?;
        let origin = str_field(&payload, "originRequestId")?.to_owned();
        let write_id = str_field(&payload, "writebackRequestId")?.to_owned();
        if self
            .write_owners
            .get(&(session_id.into(), write_id.clone()))
            .is_some_and(|owner| owner != &origin)
        {
            return Err(error("WRITEBACK_ID_CONFLICT", "保存标识已被其他任务使用"));
        }
        if self.active.as_deref() != Some(&origin) {
            return Err(error("TASK_CONTEXT_MISMATCH", "当前公卫任务已切换"));
        }
        let task = self
            .tasks
            .get_mut(&origin)
            .ok_or_else(|| error("TASK_CONTEXT_MISMATCH", "公卫任务不存在"))?;
        if task.snapshot.bridge_session_id != session_id {
            return Err(error("BRIDGE_OWNER_MISMATCH", "公卫任务不属于当前实例"));
        }
        if !same_fields(&task.snapshot.request, &payload, IDENTITY)
            || task.snapshot.request["requestId"] != payload["requestId"]
            || !task
                .requests
                .contains_key(str_field(&payload, "requestId")?)
        {
            return Err(error(
                "TASK_CONTEXT_MISMATCH",
                "回写内容未匹配已登记生成快照",
            ));
        }
        if let Some(intent) = task.writes.get_mut(&write_id) {
            if intent.payload != payload {
                return Err(error("WRITEBACK_ID_CONFLICT", "保存标识对应不同内容"));
            }
            if intent.feedback.is_none() {
                // Redelivery has a new transport id; PHIS still deduplicates the immutable save id.
                let session = self.sessions.get_mut(session_id).unwrap();
                intent.event_id = session.enqueue_result(session_id, &intent.payload, now)?;
            }
            return Ok(
                json!({"status":"accepted","originRequestId":origin,"requestId":payload["requestId"],"generationId":payload["generationId"],"writebackRequestId":write_id,"eventId":intent.event_id,"duplicate":true}),
            );
        }
        if !["prepared", "failed"].contains(&task.snapshot.phase.as_str()) {
            return Err(error("TASK_CONTEXT_MISMATCH", "当前状态不允许确认保存"));
        }
        if task.writes.len() >= MAX_WRITES {
            return Err(error("CAPACITY_EXCEEDED", "当前任务保存意图容量已满"));
        }
        let items = payload["items"]
            .as_array()
            .filter(|a| !a.is_empty() && a.len() <= 3)
            .ok_or_else(|| error("INVALID_REQUEST", "回写内容为空或超限"))?;
        let targets = task.initial["writebackTargets"].as_array().unwrap();
        let mut seen = HashSet::new();
        let mut total = 0;
        for item in items {
            keys(item, &["targetFieldId", "sourceSections", "value"])?;
            let id = str_field(item, "targetFieldId")?;
            let target = targets
                .iter()
                .find(|t| t["targetFieldId"] == id)
                .ok_or_else(|| error("INVALID_REQUEST", "回写字段不属于白名单"))?;
            if !seen.insert(id) || target["sourceSections"] != item["sourceSections"] {
                return Err(error("INVALID_REQUEST", "回写目标重复或合并章节不完整"));
            }
            let value = item["value"]
                .as_str()
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| error("INVALID_REQUEST", "回写正文不能为空"))?;
            total += value.chars().count();
        }
        if total > 64000 {
            return Err(error("INVALID_REQUEST", "回写正文超过限制"));
        }
        let session = self.sessions.get_mut(session_id).unwrap();
        let event_id = session.enqueue_result(session_id, &payload, now)?;
        task.writes.insert(
            write_id.clone(),
            WriteIntent {
                payload: payload.clone(),
                feedback: None,
                event_id: event_id.clone(),
            },
        );
        self.write_owners
            .insert((session_id.into(), write_id.clone()), origin.clone());
        task.snapshot.phase = "awaiting-writeback".into();
        task.snapshot.pending_writeback = Some(payload.clone());
        task.snapshot.last_feedback = None;
        Ok(
            json!({"status":"accepted","originRequestId":origin,"requestId":payload["requestId"],"generationId":payload["generationId"],"writebackRequestId":write_id,"eventId":event_id,"duplicate":false}),
        )
    }
    pub fn confirmation_feedback(&self, session_id: &str, payload: &Value) -> Option<Value> {
        let origin = payload["originRequestId"].as_str()?;
        if self.active.as_deref() != Some(origin) {
            return None;
        }
        let task = self.tasks.get(origin)?;
        if task.snapshot.bridge_session_id != session_id || task.snapshot.phase == "closed" {
            return None;
        }
        let intent = task.writes.get(payload["writebackRequestId"].as_str()?)?;
        if intent.payload != *payload {
            return None;
        }
        intent.feedback.clone()
    }
    pub fn feedback(
        &mut self,
        session_id: &str,
        feedback: Value,
        now: u64,
    ) -> BridgeResult<(Value, bool)> {
        self.active_session(session_id, now)?;
        keys(
            &feedback,
            &[
                "schemaVersion",
                "requestId",
                "originRequestId",
                "generationId",
                "writebackRequestId",
                "capability",
                "scene",
                "patientId",
                "businessRecordId",
                "recordVersion",
                "snapshotAt",
                "status",
                "savedRecordVersion",
                "errorCode",
                "message",
                "feedbackAt",
            ],
        )?;
        validate_identity(&feedback)?;
        uuid_field(&feedback, "generationId")?;
        uuid_field(&feedback, "writebackRequestId")?;
        date_field(&feedback, "feedbackAt")?;
        match str_field(&feedback, "status")? {
            "success" => {
                str_field(&feedback, "savedRecordVersion")?;
                if feedback.get("errorCode").is_some() {
                    return Err(error("INVALID_REQUEST", "成功回执不能携带错误码"));
                }
            }
            "failed" => {
                str_field(&feedback, "errorCode")?;
                str_field(&feedback, "message")?;
                if feedback.get("savedRecordVersion").is_some() {
                    return Err(error("INVALID_REQUEST", "失败回执不能携带保存版本"));
                }
            }
            _ => return Err(error("INVALID_REQUEST", "仅接受真实保存终态回执")),
        }
        let origin = str_field(&feedback, "originRequestId")?.to_owned();
        let task = self
            .tasks
            .get_mut(&origin)
            .ok_or_else(|| error("TASK_CONTEXT_MISMATCH", "公卫任务不存在"))?;
        if task.snapshot.bridge_session_id != session_id {
            return Err(error("BRIDGE_OWNER_MISMATCH", "回执不属于当前实例"));
        }
        let intent = task
            .writes
            .get_mut(str_field(&feedback, "writebackRequestId")?)
            .ok_or_else(|| error("TASK_CONTEXT_MISMATCH", "保存意图不存在"))?;
        if !same_fields(&intent.payload, &feedback, IDENTITY)
            || !same_fields(
                &intent.payload,
                &feedback,
                &["requestId", "generationId", "writebackRequestId"],
            )
        {
            return Err(error("TASK_CONTEXT_MISMATCH", "回执与冻结保存意图不匹配"));
        }
        if let Some(old) = &intent.feedback {
            if !same_fields(
                old,
                &feedback,
                &["status", "savedRecordVersion", "errorCode"],
            ) {
                return Err(error("WRITEBACK_ID_CONFLICT", "保存终态不能相互覆盖"));
            }
        } else {
            intent.feedback = Some(feedback.clone());
        }
        let current = task.snapshot.phase != "closed"
            && task
                .snapshot
                .pending_writeback
                .as_ref()
                .is_some_and(|p| p["writebackRequestId"] == feedback["writebackRequestId"]);
        if current {
            task.snapshot.phase = if feedback["status"] == "success" {
                "saved"
            } else {
                "failed"
            }
            .into();
            task.snapshot.last_feedback = Some(feedback.clone());
        }
        let mut ack = feedback.as_object().unwrap().clone();
        for key in [
            "status",
            "savedRecordVersion",
            "errorCode",
            "message",
            "feedbackAt",
        ] {
            ack.remove(key);
        }
        ack.insert("status".into(), json!("accepted"));
        ack.insert("feedbackStatus".into(), feedback["status"].clone());
        ack.insert("receivedAt".into(), json!(iso(now)));
        Ok((
            Value::Object(ack),
            current && self.active.as_deref() == Some(&origin),
        ))
    }
    pub fn close(&mut self, origin: &str) -> BridgeResult<Value> {
        let task = self
            .tasks
            .get_mut(origin)
            .ok_or_else(|| error("TASK_CONTEXT_MISMATCH", "公卫任务不存在"))?;
        task.snapshot.phase = "closed".into();
        if self.active.as_deref() == Some(origin) {
            self.active = None;
        }
        Ok(json!({"status":"closed","originRequestId":origin}))
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    const ORIGIN: &str = "https://phis.example.invalid";
    fn key() -> String {
        STANDARD.encode([42u8; 32])
    }
    fn fixture() -> (PublicHealthRegistry, String, String) {
        let mut registry = PublicHealthRegistry::new(BridgeConfig::new(ORIGIN, &key()));
        let request = HandshakeRequest {
            schema_version: SCHEMA.into(),
            sdk_instance_id: Uuid::new_v4().to_string(),
            resume_session_id: None,
        };
        let response = registry
            .handshake(ORIGIN, &key(), "", request, 1000)
            .unwrap();
        (
            registry,
            response["bridgeSessionId"].as_str().unwrap().into(),
            response["publicHealthBridgeToken"].as_str().unwrap().into(),
        )
    }
    pub(crate) fn request() -> Value {
        let id = Uuid::new_v4().to_string();
        json!({"schemaVersion":SCHEMA,"requestId":id,"originRequestId":id,"capability":"health_prescription","scene":"hypertension_followup","patientId":"synthetic-resident","businessRecordId":"synthetic-followup","recordVersion":"v1","snapshotAt":"2026-09-29T10:00:00+08:00","patient":{"name":"合成居民","sex":"unknown","ageYears":65},"facts":{"observations":[],"conditions":[],"medicationClasses":[],"lifestyle":{}},"writebackTargets":[{"targetFieldId":"synthetic-guidance","label":"指导","sourceSections":["check_plan","medication_guidance","lifestyle_guidance"],"valueType":"string","mode":"replace"}]})
    }
    pub(crate) fn payload(request: &Value) -> Value {
        let mut value = request.as_object().unwrap().clone();
        for key in ["patient", "facts", "writebackTargets"] {
            value.remove(key);
        }
        value.insert("generationId".into(), json!(Uuid::new_v4().to_string()));
        value.insert(
            "writebackRequestId".into(),
            json!(Uuid::new_v4().to_string()),
        );
        value.insert("confirmedAt".into(), json!("2026-09-29T10:01:00+08:00"));
        value.insert("items".into(), json!([{"targetFieldId":"synthetic-guidance","sourceSections":["check_plan","medication_guidance","lifestyle_guidance"],"value":"合成显示内容"}]));
        Value::Object(value)
    }
    fn feedback(payload: &Value, success: bool) -> Value {
        let mut value = payload.as_object().unwrap().clone();
        value.remove("items");
        value.remove("confirmedAt");
        value.insert("feedbackAt".into(), json!("2026-09-29T10:02:00+08:00"));
        value.insert(
            "status".into(),
            json!(if success { "success" } else { "failed" }),
        );
        if success {
            value.insert("savedRecordVersion".into(), json!("v2"));
        } else {
            value.insert("errorCode".into(), json!("PHIS_SAVE_FAILED"));
            value.insert("message".into(), json!("合成失败"));
        }
        Value::Object(value)
    }
    #[test]
    fn config_denies_missing_wildcard_and_wrong_origin() {
        assert!(BridgeConfig::new("", "").origin(ORIGIN).is_err());
        assert!(BridgeConfig::new("https://*.invalid", &key())
            .origin(ORIGIN)
            .is_err());
        assert!(
            BridgeConfig::new("https://phis.example.invalid/path", &key())
                .origin(ORIGIN)
                .is_err()
        );
        let (mut registry, _, token) = fixture();
        assert_eq!(
            registry
                .authenticate("https://other.invalid", &token, 1001)
                .unwrap_err()
                .status(),
            403
        );
        assert!(registry.authenticate(ORIGIN, "wrong", 1001).is_err());
        assert!(registry
            .authenticate(ORIGIN, &token, 1000 + TTL_MS)
            .is_err());
    }
    #[test]
    fn renewal_preserves_owner_and_rejects_wrong_instance_or_credential() {
        let (mut registry, session, token) = fixture();
        let req = request();
        registry.assist(&session, req.clone(), 1001).unwrap();
        let instance = registry.sessions[&session].sdk_instance_id.clone();
        let renewal = || HandshakeRequest {
            schema_version: SCHEMA.into(),
            sdk_instance_id: instance.clone(),
            resume_session_id: Some(session.clone()),
        };
        assert!(registry
            .handshake(ORIGIN, &key(), "wrong", renewal(), 1000 + TTL_MS)
            .is_err());
        let result = registry
            .handshake(ORIGIN, &key(), &token, renewal(), 1000 + TTL_MS + 1)
            .unwrap();
        assert_eq!(result["bridgeSessionId"], session);
        assert_eq!(
            registry.active_task().unwrap().origin_request_id,
            req["originRequestId"]
        );
        assert!(registry
            .authenticate(ORIGIN, &token, 1000 + TTL_MS + 2)
            .is_err());
        assert!(registry
            .authenticate(
                ORIGIN,
                result["publicHealthBridgeToken"].as_str().unwrap(),
                1000 + TTL_MS + 2
            )
            .is_ok());
        assert_eq!(registry.sessions.len(), 1);
    }
    #[test]
    fn renewal_response_loss_replays_same_token_but_never_authorizes_previous_token() {
        let (mut registry, session, token) = fixture();
        let instance = registry.sessions[&session].sdk_instance_id.clone();
        let renewal = || HandshakeRequest {
            schema_version: SCHEMA.into(),
            sdk_instance_id: instance.clone(),
            resume_session_id: Some(session.clone()),
        };
        let first = registry
            .handshake(ORIGIN, &key(), &token, renewal(), 2000)
            .unwrap();
        let replay = registry
            .handshake(ORIGIN, &key(), &token, renewal(), 3000)
            .unwrap();
        assert_eq!(first, replay);
        assert!(registry.authenticate(ORIGIN, &token, 3000).is_err());
        assert!(registry
            .handshake(ORIGIN, "incorrect-pairing", &token, renewal(), 3000)
            .is_err());
        assert!(registry
            .handshake(ORIGIN, &key(), &token, renewal(), 1000 + 2 * TTL_MS)
            .is_err());
        let current = first["publicHealthBridgeToken"].as_str().unwrap();
        registry
            .handshake(ORIGIN, &key(), current, renewal(), 4000)
            .unwrap();
        assert!(registry
            .handshake(ORIGIN, &key(), &token, renewal(), 5000)
            .is_err());
    }
    #[test]
    fn origin_ownership_and_request_hash_are_enforced() {
        let (mut registry, session, _) = fixture();
        let req = request();
        registry.assist(&session, req.clone(), 1001).unwrap();
        registry.assist(&session, req.clone(), 1002).unwrap();
        let mut changed = req.clone();
        changed["recordVersion"] = json!("v2");
        assert_eq!(
            registry
                .assist(&session, changed, 1003)
                .unwrap_err()
                .error_code,
            "REQUEST_ID_CONFLICT"
        );
        assert!(registry
            .prepare("other-session", req.clone(), 1003)
            .is_err());
        registry.prepare(&session, req.clone(), 1003).unwrap();
        let mut changed = req.clone();
        changed["facts"]["historySummary"] = json!("changed");
        assert_eq!(
            registry
                .prepare(&session, changed.clone(), 1004)
                .unwrap_err()
                .error_code,
            "REQUEST_ID_CONFLICT"
        );
        changed["requestId"] = json!(Uuid::new_v4().to_string());
        assert!(registry.prepare(&session, changed, 1005).is_ok());
    }
    #[test]
    fn manual_sex_can_only_resolve_unknown_once() {
        let (mut registry, session, _) = fixture();
        let req = request();
        registry.assist(&session, req.clone(), 1001).unwrap();
        let mut changed = req.clone();
        changed["requestId"] = json!(Uuid::new_v4().to_string());
        changed["patient"]["sex"] = json!("female");
        assert!(registry.prepare(&session, changed.clone(), 1002).is_err());
        changed["patient"]["sexSource"] =
            json!({"system":"PCIE_MANUAL","recordId":Uuid::new_v4().to_string()});
        registry.prepare(&session, changed.clone(), 1003).unwrap();
        changed["requestId"] = json!(Uuid::new_v4().to_string());
        changed["patient"]["sex"] = json!("male");
        assert!(registry.prepare(&session, changed, 1004).is_err());
    }
    #[test]
    fn confirm_requires_prepared_request_and_exact_combined_target() {
        let (mut registry, session, _) = fixture();
        let req = request();
        let result = payload(&req);
        registry.assist(&session, req.clone(), 1001).unwrap();
        assert!(registry.confirm(&session, result.clone(), 1002).is_err());
        registry.prepare(&session, req, 1003).unwrap();
        let mut partial = result.clone();
        partial["items"][0]["sourceSections"] = json!(["check_plan"]);
        assert!(registry.confirm(&session, partial, 1004).is_err());
        let mut blank = result.clone();
        blank["items"][0]["value"] = json!("  ");
        assert!(registry.confirm(&session, blank, 1004).is_err());
        registry.confirm(&session, result, 1005).unwrap();
        assert_eq!(registry.sessions[&session].events.len(), 1);
    }
    #[test]
    fn pending_redelivery_keeps_save_id_and_terminal_replay_never_resends() {
        let (mut registry, session, _) = fixture();
        let req = request();
        let mut result = payload(&req);
        registry.assist(&session, req.clone(), 1001).unwrap();
        registry.prepare(&session, req, 1002).unwrap();
        let first = registry.confirm(&session, result.clone(), 1003).unwrap();
        let (notice, _, _) = registry.subscribe(&session, None).unwrap();
        let duplicate = registry.confirm(&session, result.clone(), 1004).unwrap();
        assert_ne!(first["eventId"], duplicate["eventId"]);
        assert_eq!(duplicate["duplicate"], true);
        assert!(notice.has_changed().unwrap());
        let queue = &registry.sessions[&session].events;
        assert_eq!(queue.len(), 2);
        assert_eq!(queue[0]["event"]["payload"], queue[1]["event"]["payload"]);
        assert_eq!(queue[1]["event"]["payload"], result);
        assert_eq!(
            registry.tasks[result["originRequestId"].as_str().unwrap()]
                .writes
                .len(),
            1
        );
        registry
            .feedback(&session, feedback(&result, false), 1005)
            .unwrap();
        let failed_duplicate = registry.confirm(&session, result.clone(), 1006).unwrap();
        assert_eq!(failed_duplicate["duplicate"], true);
        assert_eq!(failed_duplicate["eventId"], duplicate["eventId"]);
        assert_eq!(registry.sessions[&session].events.len(), 2);
        assert_eq!(
            registry.confirmation_feedback(&session, &result).unwrap()["status"],
            "failed"
        );
        assert_eq!(registry.active_task().unwrap().phase, "failed");
        let original_failed = result.clone();
        result["writebackRequestId"] = json!(Uuid::new_v4().to_string());
        registry.confirm(&session, result.clone(), 1007).unwrap();
        assert_eq!(
            registry
                .confirm(&session, original_failed.clone(), 1007)
                .unwrap()["duplicate"],
            true
        );
        assert_eq!(registry.active_task().unwrap().phase, "awaiting-writeback");
        assert_eq!(
            registry
                .active_task()
                .unwrap()
                .pending_writeback
                .as_ref()
                .unwrap()["writebackRequestId"],
            result["writebackRequestId"]
        );
        assert_eq!(registry.sessions[&session].events.len(), 3);
        registry
            .feedback(&session, feedback(&result, true), 1008)
            .unwrap();
        assert!(registry
            .feedback(&session, feedback(&result, false), 1009)
            .is_err());
        assert_eq!(registry.active_task().unwrap().phase, "saved");
    }
    #[test]
    fn old_feedback_and_closed_task_do_not_change_current_task() {
        let (mut registry, session, _) = fixture();
        let req = request();
        let result = payload(&req);
        registry.assist(&session, req.clone(), 1001).unwrap();
        registry.prepare(&session, req.clone(), 1002).unwrap();
        registry.confirm(&session, result.clone(), 1003).unwrap();
        registry
            .close(req["originRequestId"].as_str().unwrap())
            .unwrap();
        let next = request();
        registry.assist(&session, next.clone(), 1004).unwrap();
        assert!(
            !registry
                .feedback(&session, feedback(&result, true), 1005)
                .unwrap()
                .1
        );
        assert_eq!(
            registry.active_task().unwrap().origin_request_id,
            next["originRequestId"]
        );
        assert_eq!(registry.active_task().unwrap().phase, "ready");
    }
    #[test]
    fn same_patient_in_other_session_cannot_read_or_confirm_first_session() {
        let (mut registry, session, _) = fixture();
        let req = request();
        let result = payload(&req);
        registry.assist(&session, req.clone(), 1001).unwrap();
        registry.prepare(&session, req, 1002).unwrap();
        registry.confirm(&session, result.clone(), 1003).unwrap();
        let other = registry
            .handshake(
                ORIGIN,
                &key(),
                "",
                HandshakeRequest {
                    schema_version: SCHEMA.into(),
                    sdk_instance_id: Uuid::new_v4().to_string(),
                    resume_session_id: None,
                },
                1004,
            )
            .unwrap();
        let other = other["bridgeSessionId"].as_str().unwrap();
        assert_eq!(registry.events_after(other, None).unwrap().len(), 0);
        let event_id = registry.sessions[&session].events[0]["event"]["id"]
            .as_str()
            .unwrap();
        assert!(registry.events_after(other, Some(event_id)).is_err());
        assert!(registry
            .feedback(other, feedback(&result, true), 1005)
            .is_err());
    }
    #[test]
    fn same_write_id_is_rejected_across_tasks_and_capacity_is_explicit() {
        let (mut registry, session, _) = fixture();
        let req = request();
        let result = payload(&req);
        registry.assist(&session, req.clone(), 1001).unwrap();
        registry.prepare(&session, req, 1002).unwrap();
        registry.confirm(&session, result.clone(), 1003).unwrap();
        let next = request();
        let mut next_result = payload(&next);
        next_result["writebackRequestId"] = result["writebackRequestId"].clone();
        registry.assist(&session, next.clone(), 1004).unwrap();
        registry.prepare(&session, next, 1005).unwrap();
        assert_eq!(
            registry
                .confirm(&session, next_result, 1006)
                .unwrap_err()
                .error_code,
            "WRITEBACK_ID_CONFLICT"
        );
        let s = registry.sessions.get_mut(&session).unwrap();
        while s.events.len() < MAX_EVENTS {
            s.events.push_back(json!({}));
        }
        let valid = payload(&registry.active_task().unwrap().request);
        assert_eq!(
            registry
                .confirm(&session, valid, 1007)
                .unwrap_err()
                .error_code,
            "CAPACITY_EXCEEDED"
        );
    }
    #[test]
    fn numeric_canonicalization_survives_javascript_and_preserves_changes() {
        let (mut registry, session, _) = fixture();
        let mut original = request();
        original["patientId"] = json!("居".repeat(128));
        original["recordVersion"] = json!(" opaque v1 ");
        original["patient"]["ageYears"] = json!(40.0);
        original["facts"]["observations"] = json!([{ "id":"height-1", "code":"height", "value":170.0, "unit":"cm", "observedAt":"2026-09-29T10:00:00+08:00", "source":{"system":"PHIS","recordId":"measurement-1"} }]);
        let mut from_js = original.clone();
        from_js["patient"]["ageYears"] = json!(40);
        let mut fraction_age = original.clone();
        fraction_age["patient"]["ageYears"] = json!(40.5);
        assert!(validate_request(&fraction_age).is_err());
        assert!(validate_request(&original).is_ok());
        from_js["facts"]["observations"][0]["value"] = json!(170);
        assert_eq!(
            request_hash(&json!({"nested":[-0.0,1.5]})),
            request_hash(&json!({"nested":[0,1.5]}))
        );
        assert_eq!(request_hash(&original), request_hash(&from_js));
        registry.assist(&session, original, 1001).unwrap();
        registry.prepare(&session, from_js.clone(), 1002).unwrap();
        from_js["facts"]["observations"][0]["value"] = json!(171);
        assert_eq!(
            registry
                .prepare(&session, from_js, 1003)
                .unwrap_err()
                .error_code,
            "REQUEST_ID_CONFLICT"
        );
        for unsafe_number in [
            json!(9_007_199_254_740_992u64),
            json!(u64::MAX),
            json!(-9_007_199_254_740_992i64),
        ] {
            let mut bad = request();
            bad["facts"]["observations"] = json!([{ "value":unsafe_number }]);
            assert_eq!(
                registry.assist(&session, bad, 1004).unwrap_err().error_code,
                "INVALID_REQUEST"
            );
        }
    }
    #[test]
    fn expiry_cleanup_reclaims_private_data_without_transferring_task_ownership() {
        let (mut registry, session, token) = fixture();
        let instance = registry.sessions[&session].sdk_instance_id.clone();
        let req = request();
        let intent = payload(&req);
        registry.assist(&session, req.clone(), 1001).unwrap();
        registry.prepare(&session, req.clone(), 1002).unwrap();
        registry.confirm(&session, intent.clone(), 1003).unwrap();
        registry.purge_expired(1000 + TTL_MS * 2 - 1);
        assert_eq!(registry.tasks.len(), 1);
        assert_eq!(registry.sessions.len(), 1);
        let after_grace = 1000 + TTL_MS * 2;
        registry.purge_expired(after_grace);
        assert!(
            registry.sessions.is_empty()
                && registry.tasks.is_empty()
                && registry.request_owners.is_empty()
                && registry.write_owners.is_empty()
        );
        assert!(registry.active_task().is_none());
        assert!(registry.authenticate(ORIGIN, &token, after_grace).is_err());
        assert!(registry
            .handshake(
                ORIGIN,
                &key(),
                &token,
                HandshakeRequest {
                    schema_version: SCHEMA.into(),
                    sdk_instance_id: instance.clone(),
                    resume_session_id: Some(session)
                },
                after_grace
            )
            .is_err());
        let auth = registry
            .handshake(
                ORIGIN,
                &key(),
                "",
                HandshakeRequest {
                    schema_version: SCHEMA.into(),
                    sdk_instance_id: instance,
                    resume_session_id: None,
                },
                after_grace,
            )
            .unwrap();
        let fresh = auth["bridgeSessionId"].as_str().unwrap();
        assert!(registry.prepare(fresh, req.clone(), after_grace).is_err());
        assert!(registry
            .confirm(fresh, intent.clone(), after_grace)
            .is_err());
        assert!(registry
            .feedback(fresh, feedback(&intent, true), after_grace)
            .is_err());
        assert!(registry.events_after(fresh, None).unwrap().is_empty());
        // Misbehaving PHIS UUID reuse creates new empty state; no old writeback survives.
        registry.assist(fresh, req, after_grace).unwrap();
        assert_eq!(registry.active_task().unwrap().phase, "ready");
        assert!(registry.active_task().unwrap().pending_writeback.is_none());
    }
    #[test]
    fn expired_sessions_release_capacity_for_new_instances() {
        let (mut registry, _, _) = fixture();
        for _ in 1..MAX_SESSIONS {
            registry
                .handshake(
                    ORIGIN,
                    &key(),
                    "",
                    HandshakeRequest {
                        schema_version: SCHEMA.into(),
                        sdk_instance_id: Uuid::new_v4().to_string(),
                        resume_session_id: None,
                    },
                    1000,
                )
                .unwrap();
        }
        let new_request = || HandshakeRequest {
            schema_version: SCHEMA.into(),
            sdk_instance_id: Uuid::new_v4().to_string(),
            resume_session_id: None,
        };
        assert_eq!(
            registry
                .handshake(ORIGIN, &key(), "", new_request(), 1001)
                .unwrap_err()
                .error_code,
            "CAPACITY_EXCEEDED"
        );
        registry
            .handshake(ORIGIN, &key(), "", new_request(), 1000 + TTL_MS * 2)
            .unwrap();
        assert_eq!(registry.sessions.len(), 1);
    }
    #[test]
    fn facts_validate_types_provenance_dates_and_unknown_keys_before_remote_generation() {
        let mut valid = request();
        valid["patient"]["sexSource"] =
            json!({"system":"PCIE_MANUAL", "recordId":Uuid::new_v4().to_string()});
        valid["facts"]["observations"] = json!([{"id":"measurement-1", "code":"height", "value":170, "unit":"cm", "observedAt":"2026-09-29T10:00:00+08:00", "source":{"system":"PHIS","recordId":"measurement-1"}}]);
        assert!(validate_request(&valid).is_ok());
        for (pointer, value) in [
            ("/facts/observations/0/value", json!(true)),
            ("/facts/observations/0/observedAt", json!("bad")),
            (
                "/facts/observations/0/source",
                json!({"system":"PCIE_MANUAL","recordId":"not-uuid"}),
            ),
            ("/patient/sexSource/recordId", json!("not-uuid")),
            ("/facts/lifestyle", json!({"unrecognized":"x"})),
            (
                "/facts/conditions",
                json!([{"code":"x","name":"x","status":true}]),
            ),
        ] {
            let mut bad = valid.clone();
            *bad.pointer_mut(pointer).unwrap() = value;
            assert!(
                validate_request(&bad).is_err(),
                "accepted invalid field {pointer}"
            );
        }
        let mut weight = request();
        weight["capability"] = json!("weight_management");
        weight["writebackTargets"][0]["sourceSections"] = json!(["exercise_plan", "meal_plan"]);
        assert!(validate_request(&weight).is_ok());
        weight["facts"]["weightProfile"] =
            json!({"heightCm":170,"weightKg":90,"region":"华中","season":"autumn"});
        assert!(validate_request(&weight).is_ok()); // Local supplementation may still add measurement refs.
    }
    #[test]
    fn pending_redelivery_capacity_error_does_not_mutate_frozen_intent() {
        let (mut registry, session, _) = fixture();
        let req = request();
        let result = payload(&req);
        registry.assist(&session, req.clone(), 1001).unwrap();
        registry.prepare(&session, req, 1002).unwrap();
        let first = registry.confirm(&session, result.clone(), 1003).unwrap();
        let s = registry.sessions.get_mut(&session).unwrap();
        while s.events.len() < MAX_EVENTS {
            s.events.push_back(json!({}));
        }
        let revision = s.revision;
        assert_eq!(
            registry
                .confirm(&session, result.clone(), 1004)
                .unwrap_err()
                .error_code,
            "CAPACITY_EXCEEDED"
        );
        let task = &registry.tasks[result["originRequestId"].as_str().unwrap()];
        let intent = &task.writes[result["writebackRequestId"].as_str().unwrap()];
        assert_eq!(intent.event_id, first["eventId"]);
        assert_eq!(intent.payload, result);
        assert_eq!(registry.sessions[&session].revision, revision);
        assert_eq!(task.snapshot.phase, "awaiting-writeback");
        // Terminal replay remains available even when the transport queue is full.
        registry
            .feedback(&session, feedback(&result, false), 1005)
            .unwrap();
        assert_eq!(
            registry.confirm(&session, result, 1006).unwrap()["duplicate"],
            true
        );
        assert_eq!(registry.sessions[&session].revision, revision);
    }
}
