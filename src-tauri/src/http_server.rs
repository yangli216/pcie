use actix_cors::Cors;
use actix_web::{web, App, HttpRequest, HttpResponse, HttpServer, Responder};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::io;
use std::time::Instant;
use tauri::{Emitter, Manager};

use crate::{
    append_consultation_event, clear_consultation_events,
    commands::his_integration_log::{self, HisIntegrationLogInput},
    validate_browser_context, BrowserContext, ConsultationResult, PatientInfo, SharedAppState,
};

fn summarize_for_his_log<T: Serialize>(value: &T) -> serde_json::Value {
    serde_json::to_value(value)
        .map(his_integration_log::sanitize_for_log)
        .unwrap_or_else(|_| serde_json::Value::Null)
}

fn summarize_handshake_for_his_log(ctx: &BrowserContext) -> serde_json::Value {
    serde_json::json!({
        "hasOrigin": !ctx.origin.trim().is_empty(),
        "hasHref": !ctx.href.trim().is_empty(),
        "hasCookie": !ctx.cookie.trim().is_empty(),
        "hasUserAgent": !ctx.user_agent.trim().is_empty(),
        "hasSdkVersion": !ctx.sdk_version.trim().is_empty(),
        "hasEmrAccessToken": ctx.emr_access_token().is_some(),
        "timestamp": ctx.timestamp,
    })
}

fn summarize_outpatient_emr_for_his_log(
    request: &OutpatientEmrAnalysisRequest,
) -> serde_json::Value {
    let context_bytes = serde_json::to_vec(&request.record_context)
        .map(|value| value.len())
        .unwrap_or_default();

    serde_json::json!({
        "visitId": request.visit_id,
        "templateId": request.template_id,
        "templateName": request.template_name,
        "requestId": request.request_id,
        "templateHtmlBytes": request.template_html.len(),
        "templateDefinitionBytes": request.template_definition.len(),
        "contextBytes": context_bytes,
        "contextFieldCount": request.record_context.len(),
        "targetFieldCount": request.target_field_ids.len(),
        "hasPatient": request.patient.is_some(),
    })
}

fn summarize_start_voice_for_his_log(patient: Option<&PatientInfo>) -> serde_json::Value {
    let outpatient_emr = patient.and_then(|item| item.extra.get("outpatientEmr"));
    let target_field_count = outpatient_emr
        .and_then(|value| value.get("targetFieldIds"))
        .and_then(|value| value.as_array())
        .map(|value| value.len())
        .unwrap_or_default();
    let template_html_bytes = outpatient_emr
        .and_then(|value| value.get("templateHtml"))
        .and_then(|value| value.as_str())
        .map(str::len)
        .unwrap_or_default();
    let template_definition_bytes = outpatient_emr
        .and_then(|value| value.get("templateDefinition"))
        .and_then(|value| value.as_str())
        .map(str::len)
        .unwrap_or_default();

    serde_json::json!({
        "hasPatient": patient.is_some(),
        "hasPatientId": patient.map(|item| !item.id_pi.trim().is_empty()).unwrap_or(false),
        "hasVisitId": patient.and_then(|item| item.id_vis.as_ref()).is_some(),
        "hasOutpatientEmr": outpatient_emr.is_some(),
        "targetFieldCount": target_field_count,
        "templateHtmlBytes": template_html_bytes,
        "templateDefinitionBytes": template_definition_bytes,
    })
}

fn summarize_simulated_voice_transcript_for_his_log(
    request: &SimulatedVoiceTranscriptRequest,
) -> serde_json::Value {
    serde_json::json!({
        "requestId": request.request_id,
        "transcriptBytes": request.transcript.len(),
    })
}

fn summarize_debug_complete_consultation_for_his_log(
    result: &ConsultationResult,
) -> serde_json::Value {
    let payload = result.record.as_object();
    let field_value_count = payload
        .and_then(|value| value.get("fieldValues"))
        .and_then(serde_json::Value::as_object)
        .map(serde_json::Map::len)
        .unwrap_or_default();
    let dictionary_selection_count = payload
        .and_then(|value| value.get("dictionarySelections"))
        .and_then(serde_json::Value::as_object)
        .map(serde_json::Map::len)
        .unwrap_or_default();
    let diagnosis_count = payload
        .and_then(|value| value.get("diagList"))
        .and_then(serde_json::Value::as_array)
        .map(Vec::len)
        .unwrap_or_default();
    let order_count = payload
        .and_then(|value| value.get("orderList"))
        .and_then(serde_json::Value::as_array)
        .map(Vec::len)
        .unwrap_or_default();
    let scope = payload
        .and_then(|value| value.get("writebackScope"))
        .and_then(serde_json::Value::as_object);
    let record_field_count = scope
        .and_then(|value| value.get("recordFields"))
        .and_then(serde_json::Value::as_array)
        .map(Vec::len)
        .unwrap_or_default();
    let order_type_count = scope
        .and_then(|value| value.get("orderTypes"))
        .and_then(serde_json::Value::as_array)
        .map(Vec::len)
        .unwrap_or_default();

    serde_json::json!({
        "consultationId": result.consultation_id,
        "requestId": payload
            .and_then(|value| value.get("requestId"))
            .and_then(serde_json::Value::as_str),
        "fieldValueCount": field_value_count,
        "dictionarySelectionCount": dictionary_selection_count,
        "diagnosisCount": diagnosis_count,
        "orderCount": order_count,
        "recordFieldCount": record_field_count,
        "includeDiagnosis": scope
            .and_then(|value| value.get("includeDiagnosis"))
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
        "orderTypeCount": order_type_count,
    })
}

fn handshake_console_message(ctx: &BrowserContext) -> String {
    format!(
        "[Handshake] SDK connected: has_origin={}, has_sdk_version={}",
        !ctx.origin.trim().is_empty(),
        !ctx.sdk_version.trim().is_empty()
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn record_bridge_log(
    app_handle: &web::Data<tauri::AppHandle>,
    trace_id: &str,
    operation: &str,
    method: &str,
    path: &str,
    status: &str,
    http_status: u16,
    started_at: Instant,
    request_summary: Option<serde_json::Value>,
    response_summary: Option<serde_json::Value>,
    patient_id: Option<String>,
    consultation_id: Option<String>,
    request_id: Option<String>,
    error_message: Option<String>,
) {
    let _ = his_integration_log::record_log_entry(
        app_handle.get_ref(),
        HisIntegrationLogInput {
            trace_id: Some(trace_id.to_string()),
            direction: "inbound".to_string(),
            operation: operation.to_string(),
            method: method.to_string(),
            path: path.to_string(),
            url: None,
            status: status.to_string(),
            http_status: Some(http_status),
            business_code: None,
            business_message: error_message.clone(),
            duration_ms: Some(started_at.elapsed().as_millis() as u64),
            request_summary,
            response_summary,
            patient_id,
            consultation_id,
            request_id,
            error_message,
        },
    );
}

fn ensure_http_service_access(state: &web::Data<SharedAppState>) -> Result<(), HttpResponse> {
    let browser_context = state.browser_context.lock().unwrap();
    let Some(ctx) = browser_context.as_ref() else {
        return Err(HttpResponse::Unauthorized().json(serde_json::json!({
            "status": "error",
            "message": "桌面应用服务调用被拒绝：尚未完成 SDK 授权握手"
        })));
    };

    if let Err(message) = validate_browser_context(ctx) {
        return Err(HttpResponse::Unauthorized().json(serde_json::json!({
            "status": "error",
            "message": message
        })));
    }

    Ok(())
}

fn bridge_user_error(message: &str, trace_id: &str) -> serde_json::Value {
    serde_json::json!({
        "status": "error",
        "message": message,
        "traceId": trace_id
    })
}

fn bridge_dispatch_error(trace_id: &str) -> serde_json::Value {
    bridge_user_error(
        "桌面端暂时无法处理该请求，请确认全医慧助（PCIE）主窗口已启动后重试",
        trace_id,
    )
}

fn bridge_window_missing_error(trace_id: &str) -> serde_json::Value {
    bridge_user_error(
        "桌面端主窗口暂不可用，请确认全医慧助（PCIE）正常运行后重试",
        trace_id,
    )
}

fn is_normal_websocket_disconnect(error: &actix_ws::ProtocolError) -> bool {
    match error {
        actix_ws::ProtocolError::Io(err) => {
            err.kind() == io::ErrorKind::UnexpectedEof
                || err
                    .to_string()
                    .contains("payload reached EOF before completing")
        }
        _ => false,
    }
}

fn derive_result_state(
    result: &ConsultationResult,
    payload: &serde_json::Map<String, serde_json::Value>,
) -> &'static str {
    let result_type = payload
        .get("resultType")
        .and_then(|value| value.as_str())
        .unwrap_or_default();

    if result.status.as_deref() == Some("cancelled") || result_type == "cancelled" {
        return "cancelled";
    }

    "ready"
}

fn is_terminal_result(result_type: &str, reference_status: Option<&str>, state: &str) -> bool {
    if state == "pending" {
        return false;
    }

    if state == "cancelled" {
        return true;
    }

    match result_type {
        "reference-request" => false,
        "record-confirmed" => reference_status != Some("pending"),
        "reference-feedback" => reference_status != Some("pending"),
        _ => true,
    }
}

fn build_consultation_event(result: &ConsultationResult) -> serde_json::Value {
    let mut payload_map = match &result.record {
        serde_json::Value::Object(map) => map.clone(),
        other => {
            let mut fallback = serde_json::Map::new();
            fallback.insert("value".to_string(), other.clone());
            fallback
        }
    };
    if payload_map.get("emrType").and_then(|value| value.as_str()) == Some("outpatient-emr") {
        payload_map.insert(
            "consultationId".to_string(),
            serde_json::Value::String(result.consultation_id.clone()),
        );
        payload_map.insert(
            "timestamp".to_string(),
            serde_json::Value::Number(result.timestamp.into()),
        );
        if let Some(status) = result.status.as_ref() {
            payload_map.insert(
                "status".to_string(),
                serde_json::Value::String(status.clone()),
            );
        }
    }

    let result_type = payload_map
        .get("resultType")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    let reference_status = payload_map
        .get("referenceStatus")
        .and_then(|value| value.as_str());
    let state = derive_result_state(result, &payload_map);
    let terminal = is_terminal_result(&result_type, reference_status, state);
    let request_id = payload_map
        .get("requestId")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    let event_id = format!(
        "{}:{}:{}:{}",
        result.consultation_id,
        if request_id.is_empty() {
            "-"
        } else {
            request_id
        },
        if result_type.is_empty() {
            "-"
        } else {
            &result_type
        },
        result.timestamp
    );

    serde_json::json!({
        "id": event_id,
        "type": if result_type.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(result_type) },
        "consultationId": result.consultation_id,
        "requestId": if request_id.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(request_id.to_string()) },
        "timestamp": result.timestamp,
        "terminal": terminal,
        "payload": payload_map,
    })
}

fn current_event_id(result: &ConsultationResult) -> String {
    let payload_map = match &result.record {
        serde_json::Value::Object(map) => map,
        _ => return format!("{}:-:-:{}", result.consultation_id, result.timestamp),
    };

    let result_type = payload_map
        .get("resultType")
        .and_then(|value| value.as_str())
        .unwrap_or_default();
    let request_id = payload_map
        .get("requestId")
        .and_then(|value| value.as_str())
        .unwrap_or_default();

    format!(
        "{}:{}:{}:{}",
        result.consultation_id,
        if request_id.is_empty() {
            "-"
        } else {
            request_id
        },
        if result_type.is_empty() {
            "-"
        } else {
            result_type
        },
        result.timestamp
    )
}

fn parse_after_event_id(req: &HttpRequest) -> Option<String> {
    web::Query::<HashMap<String, String>>::from_query(req.query_string())
        .ok()
        .and_then(|query| query.get("after").cloned())
        .filter(|value| !value.trim().is_empty())
}

fn queued_events_after(
    state: &SharedAppState,
    after_event_id: Option<&str>,
    include_latest_without_cursor: bool,
) -> Vec<ConsultationResult> {
    let Ok(event_queue) = state.event_queue.lock() else {
        return Vec::new();
    };

    if event_queue.is_empty() {
        return Vec::new();
    }

    if let Some(after_event_id) = after_event_id.filter(|value| !value.trim().is_empty()) {
        if let Some(index) = event_queue
            .iter()
            .position(|result| current_event_id(result) == after_event_id)
        {
            return event_queue.iter().skip(index + 1).cloned().collect();
        }

        return event_queue.iter().cloned().collect();
    }

    if include_latest_without_cursor {
        return event_queue.back().cloned().into_iter().collect::<Vec<_>>();
    }

    Vec::new()
}

fn build_event_poll_response(result: &ConsultationResult, trace_id: &str) -> serde_json::Value {
    let event = build_consultation_event(result);
    let payload = event
        .get("payload")
        .and_then(|value| value.as_object())
        .cloned()
        .unwrap_or_default();
    let state = derive_result_state(result, &payload);

    serde_json::json!({
        "state": state,
        "traceId": trace_id,
        "event": event,
    })
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConsultationAssistRequest {
    pub action: String,
    #[serde(flatten)]
    pub patient: PatientInfo,
}

#[derive(Debug, Deserialize, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ReportInterpretationPatientInput {
    #[serde(default, alias = "patientId")]
    pub id_pi: Option<String>,
    #[serde(default, alias = "visitId")]
    pub id_vis: Option<String>,
    #[serde(default, alias = "name")]
    pub na_pi: Option<String>,
    #[serde(default, alias = "gender")]
    pub sd_sex_text: Option<String>,
    #[serde(default, alias = "age")]
    pub age_text: Option<String>,
    #[serde(default)]
    pub chief_complaint: Option<String>,
    #[serde(default)]
    pub history_of_present_illness: Option<String>,
    #[serde(default)]
    pub past_medical_history: Option<String>,
    #[serde(default)]
    pub allergy_history: Option<String>,
    #[serde(default)]
    pub diagnosis: Option<String>,
    #[serde(default, flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Deserialize, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OutpatientEmrPatientInput {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id_pi: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sd_sex_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub age_text: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReportInterpretationRequest {
    pub task_id: String,
    pub query: String,
    #[serde(default)]
    pub request_id: Option<String>,
    #[serde(default)]
    pub patient: Option<ReportInterpretationPatientInput>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InpatientEmrGenerationRequest {
    pub admission_id: String,
    pub template_id: String,
    pub html_content: String,
    #[serde(default)]
    pub template_name: Option<String>,
    #[serde(default)]
    pub record_time: Option<String>,
    #[serde(default)]
    pub doctor_supplement: Option<String>,
    #[serde(default)]
    pub request_id: Option<String>,
    #[serde(default)]
    pub patient: Option<ReportInterpretationPatientInput>,
    #[serde(default, flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OutpatientEmrAnalysisRequest {
    pub visit_id: String,
    pub template_id: String,
    pub template_name: String,
    pub template_html: String,
    pub template_definition: String,
    pub target_field_ids: Vec<String>,
    pub record_context: serde_json::Map<String, serde_json::Value>,
    pub request_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub patient: Option<OutpatientEmrPatientInput>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VoiceOutpatientEmrTemplateInput {
    pub template_id: String,
    pub template_name: String,
    pub template_html: String,
    pub template_definition: String,
    pub target_field_ids: Vec<String>,
    pub request_id: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SimulatedVoiceTranscriptRequest {
    pub request_id: String,
    pub transcript: String,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConsultationReferenceItem {
    #[serde(default)]
    pub name: Option<String>,
    pub code: Option<String>,
    #[serde(rename = "type")]
    pub item_type: Option<String>,
    #[serde(default)]
    pub id_srv: Option<String>,
    #[serde(default)]
    pub id_cli: Option<String>,
    #[serde(default)]
    pub na_srv: Option<String>,
    #[serde(default)]
    pub na_cli: Option<String>,
    #[serde(default)]
    pub sd_srv: Option<String>,
    #[serde(default)]
    pub mutual_recognition_code: Option<String>,
    #[serde(default)]
    pub price_sale: Option<serde_json::Value>,
    #[serde(default, flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConsultationReferenceFeedbackRequest {
    pub consultation_id: String,
    pub request_id: String,
    pub reference_type: Option<String>,
    pub action: Option<String>,
    pub status: String,
    pub message: Option<String>,
    #[serde(default, alias = "recognizableItems")]
    pub items: Vec<ConsultationReferenceItem>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RiskItem {
    pub level: u8,        // 1=红色, 2=橙色, 3=黄色
    pub category: String, // allergy/chronic/medication/population/vital/other
    pub content: String,  // 显示文本
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PatientRiskData {
    #[serde(alias = "patientId")]
    pub id_pi: String,
    #[serde(default, alias = "visitId")]
    pub id_vis: Option<String>,
    #[serde(default, alias = "name")]
    pub na_pi: String,
    #[serde(default, alias = "gender")]
    pub sd_sex_text: String,
    #[serde(default, alias = "age")]
    pub age_text: String,

    pub chief_complaint: Option<String>,
    pub history_of_present_illness: Option<String>,
    pub past_medical_history: Option<String>,
    pub diagnosis: Option<String>,
    pub allergy_history: Option<String>,

    #[serde(default)]
    pub risks: Vec<RiskItem>,

    /// 保留未显式建模的患者扩展字段，继续透传给前端标准化层。
    #[serde(default, flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

async fn receive_patient(
    data: web::Json<PatientInfo>,
    app_handle: web::Data<tauri::AppHandle>,
    state: web::Data<SharedAppState>,
) -> impl Responder {
    let started_at = Instant::now();
    let trace_id = his_integration_log::new_trace_id();
    if let Err(response) = ensure_http_service_access(&state) {
        return response;
    }

    let patient = data.into_inner();
    let request_summary = summarize_for_his_log(&patient);
    println!(
        "Received patient reception request for patient ID: {}",
        patient.id_pi
    );

    {
        let mut current = state.current_consultation.lock().unwrap();
        *current = Some(patient.clone());
    }
    if let Err(error) = clear_consultation_events(state.get_ref()) {
        eprintln!("Failed to clear consultation events: {}", error);
    }

    // Emit event to Frontend
    if let Some(window) = app_handle.get_webview_window("main") {
        if let Err(e) = window.emit("receive-patient", &patient) {
            eprintln!("Failed to emit event: {}", e);
        } else {
            println!("Event 'receive-patient' emitted successfully to main window");
        }
    } else {
        println!("Error: Main window not found");
    }

    // Return response
    let response_body = serde_json::json!({
        "status": "success",
        "consultationId": patient.id_pi,
        "traceId": trace_id
    });
    record_bridge_log(
        &app_handle,
        response_body["traceId"].as_str().unwrap_or_default(),
        "consultation.receive",
        "POST",
        "/api/consultation/receive",
        "success",
        200,
        started_at,
        Some(request_summary),
        Some(response_body.clone()),
        Some(patient.id_pi.clone()),
        Some(patient.id_pi.clone()),
        None,
        None,
    );
    HttpResponse::Ok().json(response_body)
}

async fn start_consultation(
    data: web::Json<PatientInfo>,
    app_handle: web::Data<tauri::AppHandle>,
    state: web::Data<SharedAppState>,
) -> impl Responder {
    let started_at = Instant::now();
    let trace_id = his_integration_log::new_trace_id();
    if let Err(response) = ensure_http_service_access(&state) {
        return response;
    }

    let patient = data.into_inner();
    let request_summary = summarize_for_his_log(&patient);
    let patient_label = if patient.na_pi.trim().is_empty() {
        patient.id_pi.as_str()
    } else {
        patient.na_pi.as_str()
    };
    println!(
        "Received consultation request for patient: {}",
        patient_label
    );

    // 1. Update State
    {
        let mut current = state.current_consultation.lock().unwrap();
        *current = Some(patient.clone());
    }
    if let Err(error) = clear_consultation_events(state.get_ref()) {
        eprintln!("Failed to clear consultation events: {}", error);
    }

    // 2. Emit event to Frontend
    if let Some(window) = app_handle.get_webview_window("main") {
        if let Err(e) = window.emit("start-consultation", &patient) {
            eprintln!("Failed to emit event: {}", e);
        } else {
            println!("Event 'start-consultation' emitted successfully to main window");
        }

        // Force window to front
        let _ = window.set_focus();
        let _ = window.unminimize();
        let _ = window.show();
    } else {
        println!("Error: Main window not found");
    }

    // 3. Return response
    let response_body = serde_json::json!({
        "status": "success",
        "consultationId": patient.id_pi,
        "traceId": trace_id
    });
    record_bridge_log(
        &app_handle,
        response_body["traceId"].as_str().unwrap_or_default(),
        "consultation.start",
        "POST",
        "/api/consultation/start",
        "success",
        200,
        started_at,
        Some(request_summary),
        Some(response_body.clone()),
        Some(patient.id_pi.clone()),
        Some(patient.id_pi.clone()),
        None,
        None,
    );
    HttpResponse::Ok().json(response_body)
}

async fn start_voice_consultation(
    data: Option<web::Json<PatientInfo>>,
    app_handle: web::Data<tauri::AppHandle>,
    state: web::Data<SharedAppState>,
) -> impl Responder {
    let started_at = Instant::now();
    let trace_id = his_integration_log::new_trace_id();
    if let Err(response) = ensure_http_service_access(&state) {
        return response;
    }

    println!("Received voice consultation request");

    let patient = data.map(|payload| payload.into_inner());
    let request_summary = summarize_start_voice_for_his_log(patient.as_ref());
    let voice_outpatient_emr = match validate_voice_outpatient_emr_request(patient.as_ref()) {
        Ok(value) => value,
        Err(message) => {
            let response_body = serde_json::json!({
                "status": "error",
                "message": message,
                "traceId": trace_id,
            });
            record_bridge_log(
                &app_handle,
                response_body["traceId"].as_str().unwrap_or_default(),
                "consultation.startVoice",
                "POST",
                "/api/consultation/start-voice",
                "error",
                400,
                started_at,
                Some(request_summary),
                Some(response_body.clone()),
                patient.as_ref().map(|item| item.id_pi.clone()),
                patient.as_ref().and_then(|item| item.id_vis.clone()),
                None,
                Some(message.to_string()),
            );
            return HttpResponse::BadRequest().json(response_body);
        }
    };
    let voice_request_id = voice_outpatient_emr
        .as_ref()
        .map(|template| template.request_id.clone());

    if let Err(error) = clear_consultation_events(state.get_ref()) {
        eprintln!("Failed to clear consultation events: {}", error);
    }

    if let Some(patient) = patient.as_ref() {
        let mut current = state.current_consultation.lock().unwrap();
        *current = Some(patient.clone());
    }

    // Emit event to Frontend
    if let Some(window) = app_handle.get_webview_window("main") {
        if let Err(e) = window.emit("start-voice-consultation", &patient) {
            eprintln!("Failed to emit voice event: {}", e);
            let response_body = bridge_dispatch_error(&trace_id);
            record_bridge_log(
                &app_handle,
                response_body["traceId"].as_str().unwrap_or_default(),
                "consultation.startVoice",
                "POST",
                "/api/consultation/start-voice",
                "error",
                500,
                started_at,
                Some(request_summary),
                Some(response_body.clone()),
                patient.as_ref().map(|item| item.id_pi.clone()),
                patient.as_ref().map(|item| item.id_pi.clone()),
                voice_request_id.clone(),
                Some(e.to_string()),
            );
            return HttpResponse::InternalServerError().json(response_body);
        }
        // Force window to front
        let _ = window.set_focus();
        let _ = window.unminimize();
        let _ = window.show();
    } else {
        let response_body = bridge_window_missing_error(&trace_id);
        record_bridge_log(
            &app_handle,
            response_body["traceId"].as_str().unwrap_or_default(),
            "consultation.startVoice",
            "POST",
            "/api/consultation/start-voice",
            "error",
            500,
            started_at,
            Some(request_summary),
            Some(response_body.clone()),
            patient.as_ref().map(|item| item.id_pi.clone()),
            patient.as_ref().map(|item| item.id_pi.clone()),
            voice_request_id.clone(),
            Some("Main window not found".to_string()),
        );
        return HttpResponse::InternalServerError().json(response_body);
    }

    let consultation_id = patient
        .as_ref()
        .map(|item| item.id_pi.clone())
        .unwrap_or_default();
    let response_body = serde_json::json!({
        "status": "success",
        "consultationId": consultation_id,
        "traceId": trace_id
    });
    record_bridge_log(
        &app_handle,
        response_body["traceId"].as_str().unwrap_or_default(),
        "consultation.startVoice",
        "POST",
        "/api/consultation/start-voice",
        "success",
        200,
        started_at,
        Some(request_summary),
        Some(response_body.clone()),
        patient.as_ref().map(|item| item.id_pi.clone()),
        Some(consultation_id),
        voice_request_id,
        None,
    );
    HttpResponse::Ok().json(response_body)
}

async fn start_consultation_assist(
    data: web::Json<ConsultationAssistRequest>,
    app_handle: web::Data<tauri::AppHandle>,
    state: web::Data<SharedAppState>,
) -> impl Responder {
    let started_at = Instant::now();
    let trace_id = his_integration_log::new_trace_id();
    if let Err(response) = ensure_http_service_access(&state) {
        return response;
    }

    let request = data.into_inner();
    let request_summary = summarize_for_his_log(&request);
    let patient_label = if request.patient.na_pi.trim().is_empty() {
        request.patient.id_pi.as_str()
    } else {
        request.patient.na_pi.as_str()
    };
    println!(
        "Received consultation session assist request for patient: {}, action: {}",
        patient_label, request.action
    );

    {
        let mut current = state.current_consultation.lock().unwrap();
        *current = Some(request.patient.clone());
    }
    if let Err(error) = clear_consultation_events(state.get_ref()) {
        eprintln!("Failed to clear consultation events: {}", error);
    }

    if let Some(window) = app_handle.get_webview_window("main") {
        if let Err(e) = window.emit("start-consultation-session", &request) {
            eprintln!("Failed to emit session event: {}", e);
            let response_body = bridge_dispatch_error(&trace_id);
            record_bridge_log(
                &app_handle,
                response_body["traceId"].as_str().unwrap_or_default(),
                "consultation.assist",
                "POST",
                "/api/consultation/assist",
                "error",
                500,
                started_at,
                Some(request_summary),
                Some(response_body.clone()),
                Some(request.patient.id_pi.clone()),
                Some(request.patient.id_pi.clone()),
                None,
                Some(e.to_string()),
            );
            return HttpResponse::InternalServerError().json(response_body);
        }

        let _ = window.set_focus();
        let _ = window.unminimize();
        let _ = window.show();
    } else {
        let response_body = bridge_window_missing_error(&trace_id);
        record_bridge_log(
            &app_handle,
            response_body["traceId"].as_str().unwrap_or_default(),
            "consultation.assist",
            "POST",
            "/api/consultation/assist",
            "error",
            500,
            started_at,
            Some(request_summary),
            Some(response_body.clone()),
            Some(request.patient.id_pi.clone()),
            Some(request.patient.id_pi.clone()),
            None,
            Some("Main window not found".to_string()),
        );
        return HttpResponse::InternalServerError().json(response_body);
    }

    let response_body = serde_json::json!({
        "status": "success",
        "consultationId": request.patient.id_pi,
        "action": request.action,
        "traceId": trace_id
    });
    record_bridge_log(
        &app_handle,
        response_body["traceId"].as_str().unwrap_or_default(),
        "consultation.assist",
        "POST",
        "/api/consultation/assist",
        "success",
        200,
        started_at,
        Some(request_summary),
        Some(response_body.clone()),
        Some(request.patient.id_pi.clone()),
        Some(request.patient.id_pi.clone()),
        None,
        None,
    );
    HttpResponse::Ok().json(response_body)
}

async fn start_report_interpretation(
    data: web::Json<ReportInterpretationRequest>,
    app_handle: web::Data<tauri::AppHandle>,
    state: web::Data<SharedAppState>,
) -> impl Responder {
    let started_at = Instant::now();
    let trace_id = his_integration_log::new_trace_id();
    if let Err(response) = ensure_http_service_access(&state) {
        return response;
    }

    let request = data.into_inner();
    let request_summary = summarize_for_his_log(&request);
    let task_id = request.task_id.trim().to_string();
    let query = request.query.trim().to_string();

    if task_id != "inspectReport" && task_id != "checkReport" {
        let response_body = serde_json::json!({
            "status": "error",
            "message": "taskId 仅支持 inspectReport 或 checkReport",
            "traceId": trace_id
        });
        record_bridge_log(
            &app_handle,
            response_body["traceId"].as_str().unwrap_or_default(),
            "report.interpret",
            "POST",
            "/api/report/interpret",
            "error",
            400,
            started_at,
            Some(request_summary),
            Some(response_body.clone()),
            request.patient.as_ref().and_then(|item| item.id_pi.clone()),
            None,
            request.request_id.clone(),
            Some("taskId 仅支持 inspectReport 或 checkReport".to_string()),
        );
        return HttpResponse::BadRequest().json(response_body);
    }

    if query.is_empty() {
        let response_body = serde_json::json!({
            "status": "error",
            "message": "query 不能为空",
            "traceId": trace_id
        });
        record_bridge_log(
            &app_handle,
            response_body["traceId"].as_str().unwrap_or_default(),
            "report.interpret",
            "POST",
            "/api/report/interpret",
            "error",
            400,
            started_at,
            Some(request_summary),
            Some(response_body.clone()),
            request.patient.as_ref().and_then(|item| item.id_pi.clone()),
            None,
            request.request_id.clone(),
            Some("query 不能为空".to_string()),
        );
        return HttpResponse::BadRequest().json(response_body);
    }

    if let Some(window) = app_handle.get_webview_window("main") {
        if let Err(error) = window.emit("start-report-interpretation", &request) {
            let response_body = bridge_dispatch_error(&trace_id);
            record_bridge_log(
                &app_handle,
                response_body["traceId"].as_str().unwrap_or_default(),
                "report.interpret",
                "POST",
                "/api/report/interpret",
                "error",
                500,
                started_at,
                Some(request_summary),
                Some(response_body.clone()),
                request.patient.as_ref().and_then(|item| item.id_pi.clone()),
                None,
                request.request_id.clone(),
                Some(error.to_string()),
            );
            return HttpResponse::InternalServerError().json(response_body);
        }

        let _ = window.set_focus();
        let _ = window.unminimize();
        let _ = window.show();
    } else {
        let response_body = bridge_window_missing_error(&trace_id);
        record_bridge_log(
            &app_handle,
            response_body["traceId"].as_str().unwrap_or_default(),
            "report.interpret",
            "POST",
            "/api/report/interpret",
            "error",
            500,
            started_at,
            Some(request_summary),
            Some(response_body.clone()),
            request.patient.as_ref().and_then(|item| item.id_pi.clone()),
            None,
            request.request_id.clone(),
            Some("Main window not found".to_string()),
        );
        return HttpResponse::InternalServerError().json(response_body);
    }

    let response_body = serde_json::json!({
        "status": "success",
        "taskId": task_id,
        "traceId": trace_id,
        "timestamp": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64,
    });
    record_bridge_log(
        &app_handle,
        response_body["traceId"].as_str().unwrap_or_default(),
        "report.interpret",
        "POST",
        "/api/report/interpret",
        "success",
        200,
        started_at,
        Some(request_summary),
        Some(response_body.clone()),
        request.patient.as_ref().and_then(|item| item.id_pi.clone()),
        None,
        request.request_id.clone(),
        None,
    );
    HttpResponse::Ok().json(response_body)
}

async fn start_inpatient_emr_generation(
    data: web::Json<InpatientEmrGenerationRequest>,
    app_handle: web::Data<tauri::AppHandle>,
    state: web::Data<SharedAppState>,
) -> impl Responder {
    let started_at = Instant::now();
    let trace_id = his_integration_log::new_trace_id();
    if let Err(response) = ensure_http_service_access(&state) {
        return response;
    }

    let mut request = data.into_inner();
    let request_summary = summarize_for_his_log(&request);
    request.admission_id = request.admission_id.trim().to_string();
    request.template_id = request.template_id.trim().to_string();
    request.html_content = request.html_content.trim().to_string();
    request.template_name = request
        .template_name
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    request.record_time = request
        .record_time
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if request
        .request_id
        .as_deref()
        .unwrap_or_default()
        .trim()
        .is_empty()
    {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        request.request_id = Some(format!("inpatient-emr-{}", timestamp));
    }

    if request.admission_id.is_empty() {
        let response_body = serde_json::json!({
            "status": "error",
            "message": "admissionId 不能为空",
            "traceId": trace_id
        });
        record_bridge_log(
            &app_handle,
            response_body["traceId"].as_str().unwrap_or_default(),
            "inpatientEmr.generate",
            "POST",
            "/api/inpatient/emr/generate",
            "error",
            400,
            started_at,
            Some(request_summary),
            Some(response_body.clone()),
            request.patient.as_ref().and_then(|item| item.id_pi.clone()),
            Some(request.admission_id.clone()),
            request.request_id.clone(),
            Some("admissionId 不能为空".to_string()),
        );
        return HttpResponse::BadRequest().json(response_body);
    }

    if request.template_id.is_empty() {
        let response_body = serde_json::json!({
            "status": "error",
            "message": "templateId 不能为空",
            "traceId": trace_id
        });
        record_bridge_log(
            &app_handle,
            response_body["traceId"].as_str().unwrap_or_default(),
            "inpatientEmr.generate",
            "POST",
            "/api/inpatient/emr/generate",
            "error",
            400,
            started_at,
            Some(request_summary),
            Some(response_body.clone()),
            request.patient.as_ref().and_then(|item| item.id_pi.clone()),
            Some(request.admission_id.clone()),
            request.request_id.clone(),
            Some("templateId 不能为空".to_string()),
        );
        return HttpResponse::BadRequest().json(response_body);
    }

    if request.template_name.is_none() {
        let response_body = serde_json::json!({
            "status": "error",
            "message": "templateName 不能为空",
            "traceId": trace_id
        });
        record_bridge_log(
            &app_handle,
            response_body["traceId"].as_str().unwrap_or_default(),
            "inpatientEmr.generate",
            "POST",
            "/api/inpatient/emr/generate",
            "error",
            400,
            started_at,
            Some(request_summary),
            Some(response_body.clone()),
            request.patient.as_ref().and_then(|item| item.id_pi.clone()),
            Some(request.admission_id.clone()),
            request.request_id.clone(),
            Some("templateName 不能为空".to_string()),
        );
        return HttpResponse::BadRequest().json(response_body);
    }

    if request.html_content.is_empty() {
        let response_body = serde_json::json!({
            "status": "error",
            "message": "htmlContent 不能为空",
            "traceId": trace_id
        });
        record_bridge_log(
            &app_handle,
            response_body["traceId"].as_str().unwrap_or_default(),
            "inpatientEmr.generate",
            "POST",
            "/api/inpatient/emr/generate",
            "error",
            400,
            started_at,
            Some(request_summary),
            Some(response_body.clone()),
            request.patient.as_ref().and_then(|item| item.id_pi.clone()),
            Some(request.admission_id.clone()),
            request.request_id.clone(),
            Some("htmlContent 不能为空".to_string()),
        );
        return HttpResponse::BadRequest().json(response_body);
    }

    if let Some(window) = app_handle.get_webview_window("main") {
        if let Err(error) = window.emit("start-inpatient-emr-generation", &request) {
            let response_body = bridge_dispatch_error(&trace_id);
            record_bridge_log(
                &app_handle,
                response_body["traceId"].as_str().unwrap_or_default(),
                "inpatientEmr.generate",
                "POST",
                "/api/inpatient/emr/generate",
                "error",
                500,
                started_at,
                Some(request_summary),
                Some(response_body.clone()),
                request.patient.as_ref().and_then(|item| item.id_pi.clone()),
                Some(request.admission_id.clone()),
                request.request_id.clone(),
                Some(error.to_string()),
            );
            return HttpResponse::InternalServerError().json(response_body);
        }

        let _ = window.set_focus();
        let _ = window.unminimize();
        let _ = window.show();
    } else {
        let response_body = bridge_window_missing_error(&trace_id);
        record_bridge_log(
            &app_handle,
            response_body["traceId"].as_str().unwrap_or_default(),
            "inpatientEmr.generate",
            "POST",
            "/api/inpatient/emr/generate",
            "error",
            500,
            started_at,
            Some(request_summary),
            Some(response_body.clone()),
            request.patient.as_ref().and_then(|item| item.id_pi.clone()),
            Some(request.admission_id.clone()),
            request.request_id.clone(),
            Some("Main window not found".to_string()),
        );
        return HttpResponse::InternalServerError().json(response_body);
    }

    let response_body = serde_json::json!({
        "status": "success",
        "admissionId": request.admission_id,
        "requestId": request.request_id,
        "traceId": trace_id,
        "timestamp": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64,
    });
    record_bridge_log(
        &app_handle,
        response_body["traceId"].as_str().unwrap_or_default(),
        "inpatientEmr.generate",
        "POST",
        "/api/inpatient/emr/generate",
        "success",
        200,
        started_at,
        Some(request_summary),
        Some(response_body.clone()),
        request.patient.as_ref().and_then(|item| item.id_pi.clone()),
        Some(request.admission_id.clone()),
        request.request_id.clone(),
        None,
    );
    HttpResponse::Ok().json(response_body)
}

fn has_non_empty_clinical_fact(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Null => false,
        serde_json::Value::Bool(_) | serde_json::Value::Number(_) => true,
        serde_json::Value::String(value) => !value.trim().is_empty(),
        serde_json::Value::Array(values) => values.iter().any(has_non_empty_clinical_fact),
        serde_json::Value::Object(values) => values.values().any(has_non_empty_clinical_fact),
    }
}

fn validate_voice_outpatient_emr_request(
    patient: Option<&PatientInfo>,
) -> Result<Option<VoiceOutpatientEmrTemplateInput>, &'static str> {
    let Some(patient) = patient else {
        return Ok(None);
    };
    let Some(raw_template) = patient.extra.get("outpatientEmr") else {
        return Ok(None);
    };
    let Some(visit_id) = patient.id_vis.as_deref() else {
        return Err("动态门诊模板语音问诊必须提供 idVis");
    };
    if visit_id.trim().is_empty() || visit_id != visit_id.trim() {
        return Err("动态门诊模板语音问诊的 idVis 必须非空且不能包含首尾空白");
    }
    let template = serde_json::from_value::<VoiceOutpatientEmrTemplateInput>(raw_template.clone())
        .map_err(|_| "outpatientEmr 必须且只能包含六个文档化字段")?;
    for value in [
        &template.template_id,
        &template.template_name,
        &template.request_id,
    ] {
        if value.trim().is_empty() || value != value.trim() {
            return Err("outpatientEmr 模板身份必须非空且不能包含首尾空白");
        }
    }
    if template.template_html.trim().is_empty() {
        return Err("outpatientEmr.templateHtml 不能为空");
    }
    if template.template_definition.trim().is_empty() {
        return Err("outpatientEmr.templateDefinition 不能为空");
    }
    if template.target_field_ids.is_empty() {
        return Err("outpatientEmr.targetFieldIds 至少需要一个字段");
    }
    if template
        .target_field_ids
        .iter()
        .any(|field_id| field_id.trim().is_empty() || field_id != field_id.trim())
    {
        return Err("outpatientEmr.targetFieldIds 不能包含空值或首尾空白");
    }
    let unique_target_ids = template.target_field_ids.iter().collect::<HashSet<_>>();
    if unique_target_ids.len() != template.target_field_ids.len() {
        return Err("outpatientEmr.targetFieldIds 不能包含重复字段 ID");
    }
    Ok(Some(template))
}

fn validate_simulated_voice_transcript_request(
    request: &SimulatedVoiceTranscriptRequest,
    patient: Option<&PatientInfo>,
) -> Result<(), &'static str> {
    if request.request_id.trim().is_empty() || request.request_id != request.request_id.trim() {
        return Err("模拟语音转写 requestId 必须非空且不能包含首尾空白");
    }
    if request.transcript.trim().is_empty() || request.transcript != request.transcript.trim() {
        return Err("模拟语音转写 transcript 必须非空且不能包含首尾空白");
    }
    if request.transcript.chars().count() > 20_000 {
        return Err("模拟语音转写 transcript 不能超过 20000 字");
    }

    let template =
        validate_voice_outpatient_emr_request(patient)?.ok_or("当前没有动态门诊模板语音会话")?;
    if template.request_id != request.request_id {
        return Err("模拟语音转写 requestId 与当前模板会话不一致");
    }
    Ok(())
}

#[cfg(debug_assertions)]
async fn simulate_voice_transcript(
    request: web::Json<SimulatedVoiceTranscriptRequest>,
    app_handle: web::Data<tauri::AppHandle>,
    state: web::Data<SharedAppState>,
) -> impl Responder {
    let started_at = Instant::now();
    let trace_id = his_integration_log::new_trace_id();
    if let Err(response) = ensure_http_service_access(&state) {
        return response;
    }

    let request = request.into_inner();
    let request_summary = summarize_simulated_voice_transcript_for_his_log(&request);
    let patient = state
        .current_consultation
        .lock()
        .ok()
        .and_then(|value| value.clone());
    if let Err(message) = validate_simulated_voice_transcript_request(&request, patient.as_ref()) {
        let response_body = serde_json::json!({
            "status": "error",
            "message": message,
            "traceId": trace_id,
        });
        record_bridge_log(
            &app_handle,
            response_body["traceId"].as_str().unwrap_or_default(),
            "debug.simulateVoiceTranscript",
            "POST",
            "/api/debug/voice-transcript",
            "error",
            400,
            started_at,
            Some(request_summary),
            Some(response_body.clone()),
            patient.as_ref().map(|item| item.id_pi.clone()),
            patient.as_ref().and_then(|item| item.id_vis.clone()),
            Some(request.request_id.clone()),
            Some(message.to_string()),
        );
        return HttpResponse::BadRequest().json(response_body);
    }

    let Some(window) = app_handle.get_webview_window("main") else {
        return HttpResponse::ServiceUnavailable().json(bridge_window_missing_error(&trace_id));
    };
    if let Err(error) = window.emit("debug-simulate-voice-transcript", &request) {
        let response_body = serde_json::json!({
            "status": "error",
            "message": "模拟语音转写发送到桌面端失败",
            "traceId": trace_id,
        });
        record_bridge_log(
            &app_handle,
            response_body["traceId"].as_str().unwrap_or_default(),
            "debug.simulateVoiceTranscript",
            "POST",
            "/api/debug/voice-transcript",
            "error",
            500,
            started_at,
            Some(request_summary),
            Some(response_body.clone()),
            patient.as_ref().map(|item| item.id_pi.clone()),
            patient.as_ref().and_then(|item| item.id_vis.clone()),
            Some(request.request_id.clone()),
            Some(error.to_string()),
        );
        return HttpResponse::InternalServerError().json(response_body);
    }

    let response_body = serde_json::json!({
        "status": "success",
        "requestId": request.request_id,
        "traceId": trace_id,
    });
    record_bridge_log(
        &app_handle,
        response_body["traceId"].as_str().unwrap_or_default(),
        "debug.simulateVoiceTranscript",
        "POST",
        "/api/debug/voice-transcript",
        "success",
        200,
        started_at,
        Some(request_summary),
        Some(response_body.clone()),
        patient.as_ref().map(|item| item.id_pi.clone()),
        patient.as_ref().and_then(|item| item.id_vis.clone()),
        Some(request.request_id.clone()),
        None,
    );
    HttpResponse::Ok().json(response_body)
}

fn validate_debug_complete_consultation(
    result: &ConsultationResult,
    patient: Option<&PatientInfo>,
) -> Result<(), &'static str> {
    let template =
        validate_voice_outpatient_emr_request(patient)?.ok_or("当前没有动态门诊模板语音会话")?;
    let visit_id = patient
        .and_then(|value| value.id_vis.as_deref())
        .ok_or("当前动态门诊模板语音会话缺少 idVis")?;
    if result.consultation_id != visit_id {
        return Err("联调完成结果 consultationId 与当前就诊不一致");
    }
    if result.timestamp == 0 {
        return Err("联调完成结果 timestamp 必须大于 0");
    }

    let payload = result
        .record
        .as_object()
        .ok_or("联调完成结果必须是 JSON 对象")?;
    if payload.get("visitId").and_then(serde_json::Value::as_str) != Some(visit_id) {
        return Err("联调完成结果 visitId 与当前就诊不一致");
    }
    if payload.get("requestId").and_then(serde_json::Value::as_str)
        != Some(template.request_id.as_str())
    {
        return Err("联调完成结果 requestId 与当前模板会话不一致");
    }
    if payload
        .get("resultType")
        .and_then(serde_json::Value::as_str)
        != Some("record-confirmed")
    {
        return Err("联调完成结果 resultType 必须为 record-confirmed");
    }
    if payload.get("emrType").and_then(serde_json::Value::as_str) != Some("outpatient-emr") {
        return Err("联调完成结果 emrType 必须为 outpatient-emr");
    }
    if payload
        .get("referenceType")
        .and_then(serde_json::Value::as_str)
        != Some("batch")
        || payload.get("action").and_then(serde_json::Value::as_str) != Some("batch")
    {
        return Err("联调完成结果 referenceType/action 必须为 batch");
    }
    if payload
        .get("referenceStatus")
        .and_then(serde_json::Value::as_str)
        != Some("pending")
    {
        return Err("联调完成结果 referenceStatus 必须为 pending");
    }
    if payload
        .get("templateMetadata")
        .and_then(serde_json::Value::as_object)
        .and_then(|value| value.get("templateId"))
        .and_then(serde_json::Value::as_str)
        != Some(template.template_id.as_str())
    {
        return Err("联调完成结果 templateMetadata.templateId 与当前模板不一致");
    }

    let field_values = payload
        .get("fieldValues")
        .and_then(serde_json::Value::as_object)
        .ok_or("联调完成结果 fieldValues 必须是对象")?;
    if field_values.is_empty() {
        return Err("联调完成结果 fieldValues 不能为空");
    }
    let allowed_fields = template.target_field_ids.iter().collect::<HashSet<_>>();
    if field_values.iter().any(|(field_id, value)| {
        !allowed_fields.contains(field_id)
            || value
                .as_str()
                .map(|text| text.trim().is_empty())
                .unwrap_or(true)
    }) {
        return Err("联调完成结果 fieldValues 只能包含当前目标字段及非空字符串值");
    }
    if payload
        .get("dictionarySelections")
        .and_then(serde_json::Value::as_object)
        .is_none()
    {
        return Err("联调完成结果 dictionarySelections 必须是对象");
    }
    if payload
        .get("orderList")
        .and_then(serde_json::Value::as_array)
        .is_none()
    {
        return Err("联调完成结果 orderList 必须是数组");
    }
    if payload.get("diagList").is_some()
        && payload
            .get("diagList")
            .and_then(serde_json::Value::as_array)
            .is_none()
    {
        return Err("联调完成结果 diagList 必须是数组");
    }
    let scope = payload
        .get("writebackScope")
        .and_then(serde_json::Value::as_object)
        .ok_or("联调完成结果 writebackScope 必须是对象")?;
    if scope
        .get("recordFields")
        .and_then(serde_json::Value::as_array)
        .is_none()
        || scope
            .get("includeDiagnosis")
            .and_then(serde_json::Value::as_bool)
            .is_none()
        || scope
            .get("orderTypes")
            .and_then(serde_json::Value::as_array)
            .is_none()
    {
        return Err("联调完成结果 writebackScope 结构不完整");
    }
    Ok(())
}

fn has_matching_record_confirmed(
    state: &SharedAppState,
    consultation_id: &str,
    request_id: &str,
) -> bool {
    let Ok(events) = state.event_queue.lock() else {
        return true;
    };
    events.iter().any(|event| {
        event.consultation_id == consultation_id
            && event
                .record
                .get("requestId")
                .and_then(serde_json::Value::as_str)
                == Some(request_id)
            && event
                .record
                .get("resultType")
                .and_then(serde_json::Value::as_str)
                == Some("record-confirmed")
    })
}

#[cfg(debug_assertions)]
async fn debug_complete_consultation(
    result: web::Json<ConsultationResult>,
    app_handle: web::Data<tauri::AppHandle>,
    state: web::Data<SharedAppState>,
) -> impl Responder {
    let started_at = Instant::now();
    let trace_id = his_integration_log::new_trace_id();
    if let Err(response) = ensure_http_service_access(&state) {
        return response;
    }

    let result = result.into_inner();
    let request_summary = summarize_debug_complete_consultation_for_his_log(&result);
    let patient = state
        .current_consultation
        .lock()
        .ok()
        .and_then(|value| value.clone());
    let request_id = result
        .record
        .get("requestId")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .to_string();
    if let Err(message) = validate_debug_complete_consultation(&result, patient.as_ref()) {
        let response_body = serde_json::json!({
            "status": "error",
            "message": message,
            "traceId": trace_id,
        });
        record_bridge_log(
            &app_handle,
            response_body["traceId"].as_str().unwrap_or_default(),
            "debug.completeConsultation",
            "POST",
            "/api/debug/complete-consultation",
            "error",
            400,
            started_at,
            Some(request_summary),
            Some(response_body.clone()),
            patient.as_ref().map(|item| item.id_pi.clone()),
            patient.as_ref().and_then(|item| item.id_vis.clone()),
            Some(request_id),
            Some(message.to_string()),
        );
        return HttpResponse::BadRequest().json(response_body);
    }

    if has_matching_record_confirmed(&state, &result.consultation_id, &request_id) {
        let response_body = serde_json::json!({
            "status": "error",
            "message": "当前 requestId 已存在 record-confirmed，拒绝重复提交",
            "traceId": trace_id,
        });
        return HttpResponse::Conflict().json(response_body);
    }

    if let Err(error) = append_consultation_event(state.get_ref(), result.clone()) {
        let response_body = serde_json::json!({
            "status": "error",
            "message": "联调完成结果写入事件队列失败",
            "traceId": trace_id,
        });
        record_bridge_log(
            &app_handle,
            response_body["traceId"].as_str().unwrap_or_default(),
            "debug.completeConsultation",
            "POST",
            "/api/debug/complete-consultation",
            "error",
            500,
            started_at,
            Some(request_summary),
            Some(response_body.clone()),
            patient.as_ref().map(|item| item.id_pi.clone()),
            Some(result.consultation_id.clone()),
            Some(request_id),
            Some(error),
        );
        return HttpResponse::InternalServerError().json(response_body);
    }

    let response_body = serde_json::json!({
        "status": "success",
        "consultationId": result.consultation_id,
        "requestId": request_id,
        "traceId": trace_id,
    });
    record_bridge_log(
        &app_handle,
        response_body["traceId"].as_str().unwrap_or_default(),
        "debug.completeConsultation",
        "POST",
        "/api/debug/complete-consultation",
        "success",
        200,
        started_at,
        Some(request_summary),
        Some(response_body.clone()),
        patient.as_ref().map(|item| item.id_pi.clone()),
        Some(result.consultation_id),
        Some(request_id),
        None,
    );
    HttpResponse::Ok().json(response_body)
}

fn configure_debug_routes(config: &mut web::ServiceConfig) {
    #[cfg(debug_assertions)]
    config
        .route(
            "/api/debug/voice-transcript",
            web::post().to(simulate_voice_transcript),
        )
        .route(
            "/api/debug/complete-consultation",
            web::post().to(debug_complete_consultation),
        );
}

fn validate_outpatient_emr_request(
    request: &OutpatientEmrAnalysisRequest,
) -> Result<(), &'static str> {
    if request.visit_id.trim().is_empty() {
        return Err("visitId 不能为空");
    }
    if request.visit_id != request.visit_id.trim() {
        return Err("visitId 不能包含首尾空白");
    }
    if request.template_id.trim().is_empty() {
        return Err("templateId 不能为空");
    }
    if request.template_id != request.template_id.trim() {
        return Err("templateId 不能包含首尾空白");
    }
    if request.template_name.trim().is_empty() {
        return Err("templateName 不能为空");
    }
    if request.template_name != request.template_name.trim() {
        return Err("templateName 不能包含首尾空白");
    }
    if request.template_html.trim().is_empty() {
        return Err("templateHtml 不能为空");
    }
    if request.template_definition.trim().is_empty() {
        return Err("templateDefinition 不能为空");
    }
    if request.target_field_ids.is_empty() {
        return Err("targetFieldIds 至少需要一个当前可写字段");
    }
    if request
        .target_field_ids
        .iter()
        .any(|field_id| field_id.trim().is_empty())
    {
        return Err("targetFieldIds 不能包含空字段 ID");
    }
    if request
        .target_field_ids
        .iter()
        .any(|field_id| field_id != field_id.trim())
    {
        return Err("targetFieldIds 不能包含首尾空白");
    }
    let unique_target_field_ids = request.target_field_ids.iter().collect::<HashSet<_>>();
    if unique_target_field_ids.len() != request.target_field_ids.len() {
        return Err("targetFieldIds 不能包含重复字段 ID");
    }
    if !request
        .record_context
        .values()
        .any(has_non_empty_clinical_fact)
    {
        return Err("recordContext 至少需要一项非空事实");
    }
    if request.request_id.trim().is_empty() {
        return Err("requestId 不能为空");
    }
    if request.request_id != request.request_id.trim() {
        return Err("requestId 不能包含首尾空白");
    }
    if let Some(patient) = request.patient.as_ref() {
        for value in [
            patient.id_pi.as_deref(),
            patient.name.as_deref(),
            patient.sd_sex_text.as_deref(),
            patient.age_text.as_deref(),
        ]
        .into_iter()
        .flatten()
        {
            if value != value.trim() {
                return Err("patient 字段不能包含首尾空白");
            }
        }
    }
    Ok(())
}

async fn start_outpatient_emr_analysis(
    data: web::Json<OutpatientEmrAnalysisRequest>,
    app_handle: web::Data<tauri::AppHandle>,
    state: web::Data<SharedAppState>,
) -> impl Responder {
    let started_at = Instant::now();
    let trace_id = his_integration_log::new_trace_id();
    if let Err(response) = ensure_http_service_access(&state) {
        return response;
    }

    let request = data.into_inner();
    let request_summary = summarize_outpatient_emr_for_his_log(&request);

    if let Err(message) = validate_outpatient_emr_request(&request) {
        let response_body = serde_json::json!({
            "status": "error",
            "message": message,
            "traceId": trace_id,
        });
        record_bridge_log(
            &app_handle,
            response_body["traceId"].as_str().unwrap_or_default(),
            "outpatientEmr.analyze",
            "POST",
            "/api/outpatient/emr/analyze",
            "error",
            400,
            started_at,
            Some(request_summary),
            Some(response_body.clone()),
            request.patient.as_ref().and_then(|item| item.id_pi.clone()),
            Some(request.visit_id.clone()),
            Some(request.request_id.clone()),
            Some(message.to_string()),
        );
        return HttpResponse::BadRequest().json(response_body);
    }

    if let Some(window) = app_handle.get_webview_window("main") {
        if let Err(error) = window.emit("start-outpatient-emr-analysis", &request) {
            let response_body = bridge_dispatch_error(&trace_id);
            record_bridge_log(
                &app_handle,
                response_body["traceId"].as_str().unwrap_or_default(),
                "outpatientEmr.analyze",
                "POST",
                "/api/outpatient/emr/analyze",
                "error",
                500,
                started_at,
                Some(request_summary),
                Some(response_body.clone()),
                request.patient.as_ref().and_then(|item| item.id_pi.clone()),
                Some(request.visit_id.clone()),
                Some(request.request_id.clone()),
                Some(error.to_string()),
            );
            return HttpResponse::InternalServerError().json(response_body);
        }

        let _ = window.set_focus();
        let _ = window.unminimize();
        let _ = window.show();
    } else {
        let response_body = bridge_window_missing_error(&trace_id);
        record_bridge_log(
            &app_handle,
            response_body["traceId"].as_str().unwrap_or_default(),
            "outpatientEmr.analyze",
            "POST",
            "/api/outpatient/emr/analyze",
            "error",
            500,
            started_at,
            Some(request_summary),
            Some(response_body.clone()),
            request.patient.as_ref().and_then(|item| item.id_pi.clone()),
            Some(request.visit_id.clone()),
            Some(request.request_id.clone()),
            Some("Main window not found".to_string()),
        );
        return HttpResponse::InternalServerError().json(response_body);
    }

    let response_body = serde_json::json!({
        "status": "success",
        "visitId": request.visit_id,
        "requestId": request.request_id,
        "traceId": trace_id,
        "timestamp": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64,
    });
    record_bridge_log(
        &app_handle,
        response_body["traceId"].as_str().unwrap_or_default(),
        "outpatientEmr.analyze",
        "POST",
        "/api/outpatient/emr/analyze",
        "success",
        200,
        started_at,
        Some(request_summary),
        Some(response_body.clone()),
        request.patient.as_ref().and_then(|item| item.id_pi.clone()),
        Some(request.visit_id.clone()),
        Some(request.request_id.clone()),
        None,
    );
    HttpResponse::Ok().json(response_body)
}

async fn stop_consultation(
    app_handle: web::Data<tauri::AppHandle>,
    state: web::Data<SharedAppState>,
) -> impl Responder {
    let started_at = Instant::now();
    let trace_id = his_integration_log::new_trace_id();
    if let Err(response) = ensure_http_service_access(&state) {
        return response;
    }

    println!("Received stop consultation request");

    // 1. Update State + Write cancelled result for SDK polling
    let consultation_id = {
        let mut current = state.current_consultation.lock().unwrap();
        let id = current
            .as_ref()
            .map(|p| p.id_pi.clone())
            .unwrap_or_default();
        *current = None;
        id
    };

    // Write a cancelled result so SDK long-polling can detect the stop
    {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        if let Err(error) = append_consultation_event(
            state.get_ref(),
            ConsultationResult {
                status: Some("cancelled".to_string()),
                consultation_id: consultation_id.clone(),
                timestamp,
                record: serde_json::json!({
                    "resultType": "cancelled",
                    "reason": "Consultation stopped by user"
                }),
            },
        ) {
            eprintln!("Failed to append cancelled consultation event: {}", error);
        }
    }

    // 2. Emit event to Frontend
    if let Some(window) = app_handle.get_webview_window("main") {
        if let Err(e) = window.emit("stop-consultation", ()) {
            eprintln!("Failed to emit event: {}", e);
        } else {
            println!("Event 'stop-consultation' emitted successfully to main window");
        }
    } else {
        println!("Error: Main window not found");
    }

    // 3. Return response
    let response_body = serde_json::json!({
        "status": "success",
        "message": "Consultation stopped",
        "traceId": trace_id
    });
    record_bridge_log(
        &app_handle,
        response_body["traceId"].as_str().unwrap_or_default(),
        "consultation.stop",
        "POST",
        "/api/consultation/stop",
        "success",
        200,
        started_at,
        None,
        Some(response_body.clone()),
        None,
        Some(consultation_id),
        None,
        None,
    );
    HttpResponse::Ok().json(response_body)
}

async fn consultation_events_ws(
    req: HttpRequest,
    stream: web::Payload,
    state: web::Data<SharedAppState>,
) -> Result<HttpResponse, actix_web::Error> {
    if url::form_urlencoded::parse(req.query_string().as_bytes()).any(|(key, value)| key == "channel" && value == "public-health") {
        return crate::public_health_http::events_ws(req, stream, state).await;
    }
    if let Err(response) = ensure_http_service_access(&state) {
        return Ok(response);
    }

    let after_event_id = parse_after_event_id(&req).unwrap_or_default();
    let (response, mut session, mut msg_stream) = actix_ws::handle(&req, stream)?;
    let state = state.get_ref().clone();

    actix_web::rt::spawn(async move {
        let mut last_event_id = after_event_id;

        let replay_events = if last_event_id.is_empty() {
            queued_events_after(&state, None, true)
        } else {
            queued_events_after(&state, Some(&last_event_id), false)
        };
        for result in replay_events {
            let trace_id = his_integration_log::new_trace_id();
            let envelope = build_event_poll_response(&result, &trace_id);
            let Ok(payload) = serde_json::to_string(&envelope) else {
                continue;
            };
            if session.text(payload).await.is_err() {
                return;
            }
            last_event_id = current_event_id(&result);
        }

        let mut rx = state.result_tx.subscribe();
        let mut heartbeat = tokio::time::interval(std::time::Duration::from_secs(30));

        'ws: loop {
            tokio::select! {
                message = msg_stream.next() => {
                    match message {
                        Some(Ok(actix_ws::Message::Ping(bytes))) => {
                            if session.pong(&bytes).await.is_err() {
                                break 'ws;
                            }
                        }
                        Some(Ok(actix_ws::Message::Text(text))) => {
                            if text.trim().eq_ignore_ascii_case("ping") && session.text("pong").await.is_err() {
                                break 'ws;
                            }
                        }
                        Some(Ok(actix_ws::Message::Close(reason))) => {
                            let _ = session.close(reason).await;
                            break 'ws;
                        }
                        Some(Ok(_)) => {}
                        Some(Err(error)) => {
                            if is_normal_websocket_disconnect(&error) {
                                println!("Consultation WebSocket disconnected by peer");
                            } else {
                                eprintln!("Consultation WebSocket receive error: {}", error);
                            }
                            break 'ws;
                        }
                        None => break 'ws,
                    }
                }
                _ = heartbeat.tick() => {
                    if session.ping(b"heartbeat").await.is_err() {
                        break 'ws;
                    }
                }
                recv_result = rx.recv() => {
                    match recv_result {
                        Ok(_) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                            let events = if last_event_id.is_empty() {
                                queued_events_after(&state, None, true)
                            } else {
                                queued_events_after(&state, Some(&last_event_id), false)
                            };

                            for result in events {
                                let trace_id = his_integration_log::new_trace_id();
                                let envelope = build_event_poll_response(&result, &trace_id);
                                let Ok(payload) = serde_json::to_string(&envelope) else {
                                    continue;
                                };
                                if session.text(payload).await.is_err() {
                                    break 'ws;
                                }
                                last_event_id = current_event_id(&result);
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break 'ws,
                    }
                }
            }
        }
    });

    Ok(response)
}

async fn reference_feedback(
    data: web::Json<ConsultationReferenceFeedbackRequest>,
    app_handle: web::Data<tauri::AppHandle>,
    state: web::Data<SharedAppState>,
) -> impl Responder {
    let started_at = Instant::now();
    let trace_id = his_integration_log::new_trace_id();
    if let Err(response) = ensure_http_service_access(&state) {
        return response;
    }

    let request = data.into_inner();
    let request_summary = summarize_for_his_log(&request);
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;

    let (base_record_map, existing_result_type, existing_reference_type) = {
        let last_result = state.last_result.lock().unwrap();
        let Some(existing_result) = last_result.as_ref() else {
            let response_body = serde_json::json!({
                "status": "error",
                "code": "REFERENCE_REQUEST_MISMATCH",
                "message": "No matching pending reference request for current consultation result",
                "traceId": trace_id
            });
            record_bridge_log(
                &app_handle,
                response_body["traceId"].as_str().unwrap_or_default(),
                "consultation.referenceFeedback",
                "POST",
                "/api/consultation/reference-feedback",
                "error",
                409,
                started_at,
                Some(request_summary.clone()),
                Some(response_body.clone()),
                None,
                Some(request.consultation_id.clone()),
                Some(request.request_id.clone()),
                Some(
                    "No matching pending reference request for current consultation result"
                        .to_string(),
                ),
            );
            return HttpResponse::Conflict().json(response_body);
        };

        if existing_result.consultation_id != request.consultation_id {
            let response_body = serde_json::json!({
                "status": "error",
                "code": "REFERENCE_REQUEST_MISMATCH",
                "message": "No matching pending reference request for current consultation result",
                "traceId": trace_id
            });
            record_bridge_log(
                &app_handle,
                response_body["traceId"].as_str().unwrap_or_default(),
                "consultation.referenceFeedback",
                "POST",
                "/api/consultation/reference-feedback",
                "error",
                409,
                started_at,
                Some(request_summary.clone()),
                Some(response_body.clone()),
                None,
                Some(request.consultation_id.clone()),
                Some(request.request_id.clone()),
                Some(
                    "No matching pending reference request for current consultation result"
                        .to_string(),
                ),
            );
            return HttpResponse::Conflict().json(response_body);
        }

        let Some(record_map) = existing_result.record.as_object().cloned() else {
            let response_body = serde_json::json!({
                "status": "error",
                "code": "REFERENCE_REQUEST_MISMATCH",
                "message": "No matching pending reference request for current consultation result",
                "traceId": trace_id
            });
            record_bridge_log(
                &app_handle,
                response_body["traceId"].as_str().unwrap_or_default(),
                "consultation.referenceFeedback",
                "POST",
                "/api/consultation/reference-feedback",
                "error",
                409,
                started_at,
                Some(request_summary.clone()),
                Some(response_body.clone()),
                None,
                Some(request.consultation_id.clone()),
                Some(request.request_id.clone()),
                Some(
                    "No matching pending reference request for current consultation result"
                        .to_string(),
                ),
            );
            return HttpResponse::Conflict().json(response_body);
        };

        let existing_request_id = record_map
            .get("requestId")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string();
        let existing_result_type = record_map
            .get("resultType")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string();
        let existing_reference_type = record_map
            .get("referenceType")
            .or_else(|| record_map.get("action"))
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string();

        if existing_request_id != request.request_id
            || (existing_result_type != "reference-request"
                && existing_result_type != "record-confirmed")
        {
            let response_body = serde_json::json!({
                "status": "error",
                "code": "REFERENCE_REQUEST_MISMATCH",
                "message": "No matching pending reference request for current consultation result",
                "traceId": trace_id
            });
            record_bridge_log(
                &app_handle,
                response_body["traceId"].as_str().unwrap_or_default(),
                "consultation.referenceFeedback",
                "POST",
                "/api/consultation/reference-feedback",
                "error",
                409,
                started_at,
                Some(request_summary.clone()),
                Some(response_body.clone()),
                None,
                Some(request.consultation_id.clone()),
                Some(request.request_id.clone()),
                Some(
                    "No matching pending reference request for current consultation result"
                        .to_string(),
                ),
            );
            return HttpResponse::Conflict().json(response_body);
        }

        (
            record_map.clone(),
            existing_result_type,
            existing_reference_type,
        )
    };

    let resolved_reference_type = match (&request.reference_type, &request.action) {
        (Some(reference_type), Some(action)) if reference_type != action => {
            let response_body = serde_json::json!({
                "status": "error",
                "code": "INVALID_REFERENCE_TYPE",
                "message": "referenceType and action must match when both are provided",
                "traceId": trace_id
            });
            record_bridge_log(
                &app_handle,
                response_body["traceId"].as_str().unwrap_or_default(),
                "consultation.referenceFeedback",
                "POST",
                "/api/consultation/reference-feedback",
                "error",
                400,
                started_at,
                Some(request_summary.clone()),
                Some(response_body.clone()),
                None,
                Some(request.consultation_id.clone()),
                Some(request.request_id.clone()),
                Some("referenceType and action must match when both are provided".to_string()),
            );
            return HttpResponse::BadRequest().json(response_body);
        }
        (Some(reference_type), _) => reference_type.clone(),
        (_, Some(action)) => action.clone(),
        _ if existing_result_type == "record-confirmed" => "batch".to_string(),
        _ => {
            let response_body = serde_json::json!({
                "status": "error",
                "code": "INVALID_REFERENCE_TYPE",
                "message": "referenceType or action is required",
                "traceId": trace_id
            });
            record_bridge_log(
                &app_handle,
                response_body["traceId"].as_str().unwrap_or_default(),
                "consultation.referenceFeedback",
                "POST",
                "/api/consultation/reference-feedback",
                "error",
                400,
                started_at,
                Some(request_summary.clone()),
                Some(response_body.clone()),
                None,
                Some(request.consultation_id.clone()),
                Some(request.request_id.clone()),
                Some("referenceType or action is required".to_string()),
            );
            return HttpResponse::BadRequest().json(response_body);
        }
    };

    if existing_result_type == "record-confirmed" && resolved_reference_type != "batch" {
        let response_body = serde_json::json!({
            "status": "error",
            "code": "INVALID_REFERENCE_TYPE",
            "message": "record-confirmed feedback only supports batch referenceType",
            "traceId": trace_id
        });
        record_bridge_log(
            &app_handle,
            response_body["traceId"].as_str().unwrap_or_default(),
            "consultation.referenceFeedback",
            "POST",
            "/api/consultation/reference-feedback",
            "error",
            400,
            started_at,
            Some(request_summary.clone()),
            Some(response_body.clone()),
            None,
            Some(request.consultation_id.clone()),
            Some(request.request_id.clone()),
            Some("record-confirmed feedback only supports batch referenceType".to_string()),
        );
        return HttpResponse::BadRequest().json(response_body);
    }

    if existing_result_type == "reference-request"
        && existing_reference_type != resolved_reference_type
    {
        let response_body = serde_json::json!({
            "status": "error",
            "code": "REFERENCE_REQUEST_MISMATCH",
            "message": "No matching pending reference request for current consultation result",
            "traceId": trace_id
        });
        record_bridge_log(
            &app_handle,
            response_body["traceId"].as_str().unwrap_or_default(),
            "consultation.referenceFeedback",
            "POST",
            "/api/consultation/reference-feedback",
            "error",
            409,
            started_at,
            Some(request_summary.clone()),
            Some(response_body.clone()),
            None,
            Some(request.consultation_id.clone()),
            Some(request.request_id.clone()),
            Some(
                "No matching pending reference request for current consultation result".to_string(),
            ),
        );
        return HttpResponse::Conflict().json(response_body);
    }

    println!(
        "Received consultation reference feedback: consultation={}, request={}, resultType={}, referenceType={}, status={}",
        request.consultation_id, request.request_id, existing_result_type, resolved_reference_type, request.status
    );

    let recognizable_items = if request.status == "pending" {
        serde_json::to_value(&request.items).unwrap_or_else(|_| serde_json::json!([]))
    } else {
        serde_json::Value::Null
    };
    let feedback_payload = serde_json::json!({
        "consultationId": request.consultation_id.clone(),
        "requestId": request.request_id.clone(),
        "referenceType": resolved_reference_type.clone(),
        "action": resolved_reference_type.clone(),
        "status": request.status.clone(),
        "message": request.message.clone(),
        "items": request.items.clone(),
        "recognizableItems": recognizable_items,
        "timestamp": timestamp
    });

    let merged_result = {
        let mut record_map = base_record_map;

        record_map.insert(
            "resultType".to_string(),
            serde_json::Value::String("reference-feedback".to_string()),
        );
        record_map.insert(
            "requestId".to_string(),
            serde_json::Value::String(
                feedback_payload["requestId"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
            ),
        );
        record_map.insert(
            "referenceType".to_string(),
            serde_json::Value::String(
                feedback_payload["referenceType"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
            ),
        );
        record_map.insert(
            "action".to_string(),
            serde_json::Value::String(
                feedback_payload["action"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
            ),
        );
        record_map.insert(
            "referenceStatus".to_string(),
            serde_json::Value::String(
                feedback_payload["status"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string(),
            ),
        );
        if !feedback_payload["items"].is_null() {
            record_map.insert(
                "referenceItems".to_string(),
                feedback_payload["items"].clone(),
            );
        }
        if !feedback_payload["recognizableItems"].is_null() {
            record_map.insert(
                "recognizableItems".to_string(),
                feedback_payload["recognizableItems"].clone(),
            );
        } else {
            record_map.remove("recognizableItems");
        }
        if let Some(message) = feedback_payload["message"].as_str() {
            record_map.insert(
                "referenceMessage".to_string(),
                serde_json::Value::String(message.to_string()),
            );
        } else {
            record_map.remove("referenceMessage");
        }

        let result = ConsultationResult {
            status: Some(
                match feedback_payload["status"].as_str().unwrap_or_default() {
                    "pending" => "pending",
                    "cancelled" => "cancelled",
                    "failed" => "failed",
                    _ => "success",
                }
                .to_string(),
            ),
            consultation_id: feedback_payload["consultationId"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            timestamp,
            record: serde_json::Value::Object(record_map),
        };
        result
    };
    if let Err(error) = append_consultation_event(state.get_ref(), merged_result.clone()) {
        eprintln!("Failed to append reference feedback event: {}", error);
    }

    if let Some(window) = app_handle.get_webview_window("main") {
        if let Err(e) = window.emit("consultation-reference-feedback", &feedback_payload) {
            eprintln!("Failed to emit reference feedback event: {}", e);
        }
    }

    let response_body = serde_json::json!({
        "status": "success",
        "consultationId": merged_result.consultation_id,
        "requestId": feedback_payload["requestId"],
        "referenceType": feedback_payload["referenceType"],
        "timestamp": timestamp,
        "traceId": trace_id
    });
    record_bridge_log(
        &app_handle,
        response_body["traceId"].as_str().unwrap_or_default(),
        "consultation.referenceFeedback",
        "POST",
        "/api/consultation/reference-feedback",
        match request.status.as_str() {
            "success" => "success",
            "pending" => "pending",
            "cancelled" => "cancelled",
            _ => "business_error",
        },
        200,
        started_at,
        Some(request_summary),
        Some(response_body.clone()),
        None,
        Some(merged_result.consultation_id),
        feedback_payload["requestId"].as_str().map(str::to_string),
        None,
    );
    HttpResponse::Ok().json(response_body)
}

async fn show_patient_risks(
    data: web::Json<PatientRiskData>,
    app_handle: web::Data<tauri::AppHandle>,
    state: web::Data<SharedAppState>,
) -> impl Responder {
    let started_at = Instant::now();
    let trace_id = his_integration_log::new_trace_id();
    if let Err(response) = ensure_http_service_access(&state) {
        return response;
    }

    let risk_data = data.into_inner();
    let request_summary = summarize_for_his_log(&risk_data);
    let patient_label = if risk_data.na_pi.trim().is_empty() {
        risk_data.id_pi.as_str()
    } else {
        risk_data.na_pi.as_str()
    };
    println!(
        "Received patient risk analysis request for: {}",
        patient_label
    );

    // Emit event to Frontend
    if let Some(window) = app_handle.get_webview_window("main") {
        if let Err(e) = window.emit("show-patient-risks", &risk_data) {
            eprintln!("Failed to emit risk event: {}", e);
            let response_body = bridge_dispatch_error(&trace_id);
            record_bridge_log(
                &app_handle,
                response_body["traceId"].as_str().unwrap_or_default(),
                "patient.risks",
                "POST",
                "/api/patient/risks",
                "error",
                500,
                started_at,
                Some(request_summary),
                Some(response_body.clone()),
                Some(risk_data.id_pi.clone()),
                None,
                None,
                Some(e.to_string()),
            );
            return HttpResponse::InternalServerError().json(response_body);
        } else {
            println!("Event 'show-patient-risks' emitted successfully");
        }

        // Force window to front
        let _ = window.set_focus();
        let _ = window.unminimize();
        let _ = window.show();
    } else {
        println!("Error: Main window not found");
        let response_body = bridge_window_missing_error(&trace_id);
        record_bridge_log(
            &app_handle,
            response_body["traceId"].as_str().unwrap_or_default(),
            "patient.risks",
            "POST",
            "/api/patient/risks",
            "error",
            500,
            started_at,
            Some(request_summary),
            Some(response_body.clone()),
            Some(risk_data.id_pi.clone()),
            None,
            None,
            Some("Main window not found".to_string()),
        );
        return HttpResponse::InternalServerError().json(response_body);
    }

    let response_body = serde_json::json!({
        "status": "success",
        "idPi": risk_data.id_pi,
        "traceId": trace_id
    });
    record_bridge_log(
        &app_handle,
        response_body["traceId"].as_str().unwrap_or_default(),
        "patient.risks",
        "POST",
        "/api/patient/risks",
        "success",
        200,
        started_at,
        Some(request_summary),
        Some(response_body.clone()),
        Some(risk_data.id_pi.clone()),
        None,
        None,
        None,
    );
    HttpResponse::Ok().json(response_body)
}

async fn health_check() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "success",
        "version": env!("CARGO_PKG_VERSION"),
        "timestamp": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
    }))
}

async fn handshake(
    data: web::Json<BrowserContext>,
    app_handle: web::Data<tauri::AppHandle>,
    state: web::Data<SharedAppState>,
) -> impl Responder {
    let started_at = Instant::now();
    let trace_id = his_integration_log::new_trace_id();
    let ctx = data.into_inner();
    let request_summary = summarize_handshake_for_his_log(&ctx);

    if let Err(message) = validate_browser_context(&ctx) {
        {
            let mut browser_ctx = state.browser_context.lock().unwrap();
            *browser_ctx = None;
        }

        println!(
            "[Handshake] Rejected unauthorized SDK handshake: {}",
            message
        );
        let response_body = serde_json::json!({
            "status": "error",
            "message": message,
            "traceId": trace_id
        });
        record_bridge_log(
            &app_handle,
            response_body["traceId"].as_str().unwrap_or_default(),
            "handshake",
            "POST",
            "/api/handshake",
            "error",
            401,
            started_at,
            Some(request_summary),
            Some(response_body.clone()),
            None,
            None,
            None,
            response_body["message"].as_str().map(str::to_string),
        );
        return HttpResponse::Unauthorized().json(response_body);
    }

    println!("{}", handshake_console_message(&ctx));

    // Store browser context in shared state
    {
        let mut browser_ctx = state.browser_context.lock().unwrap();
        *browser_ctx = Some(ctx.clone());
    }

    // Emit event to frontend so it knows HIS SDK is connected
    if let Some(window) = app_handle.get_webview_window("main") {
        let _ = window.emit("sdk-handshake", &ctx);
    }

    let response_body = serde_json::json!({
        "status": "success",
        "version": env!("CARGO_PKG_VERSION"),
        "timestamp": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64,
        "traceId": trace_id
    });
    record_bridge_log(
        &app_handle,
        response_body["traceId"].as_str().unwrap_or_default(),
        "handshake",
        "POST",
        "/api/handshake",
        "success",
        200,
        started_at,
        Some(request_summary),
        Some(response_body.clone()),
        None,
        None,
        None,
        None,
    );
    HttpResponse::Ok().json(response_body)
}

// ==================== SDK Static File Serving ====================

/// 提供 med-hermes-sdk.js 静态文件，供第三方 HIS 通过 HTTP 获取 SDK
async fn serve_sdk_js() -> impl Responder {
    const SDK_JS: &str = include_str!("../../sdk/med-hermes-sdk.js");
    HttpResponse::Ok()
        .content_type("application/javascript; charset=utf-8")
        .insert_header((
            "Cache-Control",
            "no-store, no-cache, must-revalidate, max-age=0",
        ))
        .insert_header(("Pragma", "no-cache"))
        .insert_header(("Expires", "0"))
        .insert_header(("X-MedHermes-Version", env!("CARGO_PKG_VERSION")))
        .insert_header(("Access-Control-Allow-Origin", "*"))
        .body(SDK_JS)
}

/// 提供 med-hermes-loader.js 引导加载器
async fn serve_loader_js() -> impl Responder {
    const LOADER_JS: &str = include_str!("../../sdk/med-hermes-loader.js");
    HttpResponse::Ok()
        .content_type("application/javascript; charset=utf-8")
        .insert_header((
            "Cache-Control",
            "no-store, no-cache, must-revalidate, max-age=0",
        ))
        .insert_header(("Pragma", "no-cache"))
        .insert_header(("Expires", "0"))
        .insert_header(("X-MedHermes-Version", env!("CARGO_PKG_VERSION")))
        .insert_header(("Access-Control-Allow-Origin", "*"))
        .body(LOADER_JS)
}

pub fn run_server(app_handle: tauri::AppHandle, state: SharedAppState) {
    std::thread::spawn(move || {
        let sys = actix_web::rt::System::new();
        sys.block_on(async move {
            let app_handle = web::Data::new(app_handle);
            let state = web::Data::new(state);

            println!("Starting HTTP server on 127.0.0.1:8081");

            HttpServer::new(move || {
                let cors = Cors::permissive();

                App::new()
                    .wrap(cors)
                    .app_data(app_handle.clone())
                    .app_data(state.clone())
                    .configure(configure_debug_routes)
                    .configure(crate::public_health_http::configure)
                    .route("/api/health", web::get().to(health_check))
                    .route("/api/handshake", web::post().to(handshake))
                    .route("/api/consultation/receive", web::post().to(receive_patient))
                    .route(
                        "/api/consultation/start",
                        web::post().to(start_consultation),
                    )
                    .route(
                        "/api/consultation/assist",
                        web::post().to(start_consultation_assist),
                    )
                    .route(
                        "/api/report/interpret",
                        web::post().to(start_report_interpretation),
                    )
                    .route(
                        "/api/inpatient/emr/generate",
                        web::post().to(start_inpatient_emr_generation),
                    )
                    .route(
                        "/api/outpatient/emr/analyze",
                        web::post().to(start_outpatient_emr_analysis),
                    )
                    .route(
                        "/api/consultation/start-voice",
                        web::post().to(start_voice_consultation),
                    )
                    .route("/api/consultation/stop", web::post().to(stop_consultation))
                    .route(
                        "/api/consultation/reference-feedback",
                        web::post().to(reference_feedback),
                    )
                    .route(
                        "/api/consultation/events/ws",
                        web::get().to(consultation_events_ws),
                    )
                    .route("/api/patient/risks", web::post().to(show_patient_risks))
                    // SDK static files
                    .route("/sdk/med-hermes-sdk.js", web::get().to(serve_sdk_js))
                    .route("/sdk/med-hermes-loader.js", web::get().to(serve_loader_js))
            })
            .bind(("127.0.0.1", 8081))
            .expect("Failed to bind port 8081")
            .run()
            .await
            .unwrap_or_else(|e| eprintln!("HTTP server error: {}", e));
        });
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normal_websocket_disconnect_detects_payload_eof() {
        let error = actix_ws::ProtocolError::Io(io::Error::other(
            "payload reached EOF before completing: None",
        ));

        assert!(is_normal_websocket_disconnect(&error));
    }

    #[test]
    fn normal_websocket_disconnect_keeps_protocol_errors_visible() {
        let error = actix_ws::ProtocolError::Overflow;

        assert!(!is_normal_websocket_disconnect(&error));
    }

    #[test]
    fn handshake_logs_only_presence_flags_for_origin_and_href() {
        let ctx = BrowserContext {
            origin: "https://USER-SENTINEL:PASSWORD-SENTINEL@his.example/his-web".to_string(),
            href: "https://his.example/his-web/doctor?patient=PATIENT-SENTINEL".to_string(),
            cookie: "SESSION=COOKIE-SENTINEL".to_string(),
            user_agent: "USER-AGENT-SENTINEL".to_string(),
            timestamp: 1_704_355_200_000,
            sdk_version: "SDK-VERSION-SENTINEL".to_string(),
            extra: serde_json::json!({
                "emrAccessToken": "TOKEN-SENTINEL",
                "urt": { "personCd": "PERSON-SENTINEL" }
            }),
        };

        let console_message = handshake_console_message(&ctx);
        let log_summary = summarize_handshake_for_his_log(&ctx).to_string();
        let combined = format!("{} {}", console_message, log_summary);

        assert!(console_message.contains("has_origin=true"));
        assert!(log_summary.contains("\"hasOrigin\":true"));
        for secret in [
            "his.example",
            "USER-SENTINEL",
            "PASSWORD-SENTINEL",
            "PATIENT-SENTINEL",
            "COOKIE-SENTINEL",
            "USER-AGENT-SENTINEL",
            "SDK-VERSION-SENTINEL",
            "TOKEN-SENTINEL",
            "PERSON-SENTINEL",
        ] {
            assert!(!combined.contains(secret));
        }
    }

    #[test]
    fn start_voice_accepts_an_exact_dynamic_outpatient_template() {
        let patient: PatientInfo = serde_json::from_value(serde_json::json!({
            "idPi": "patient-1",
            "idVis": "visit-1",
            "outpatientEmr": {
                "templateId": "template-1",
                "templateName": "门诊模板",
                "templateHtml": "  <section data-id=\"chief\"></section>  ",
                "templateDefinition": "  [{\"ID\":\"chief\"}]  ",
                "targetFieldIds": ["chief"],
                "requestId": "request-1"
            }
        }))
        .expect("patient should deserialize");

        let template = validate_voice_outpatient_emr_request(Some(&patient))
            .expect("template should validate")
            .expect("template should exist");

        assert_eq!(template.template_id, "template-1");
        assert_eq!(
            template.template_html,
            "  <section data-id=\"chief\"></section>  "
        );
        assert_eq!(template.template_definition, "  [{\"ID\":\"chief\"}]  ");
        assert_eq!(template.target_field_ids, vec!["chief".to_string()]);
        assert_eq!(template.request_id, "request-1");
    }

    #[test]
    fn start_voice_rejects_invalid_dynamic_outpatient_template_contracts() {
        let missing_visit: PatientInfo = serde_json::from_value(serde_json::json!({
            "idPi": "patient-1",
            "outpatientEmr": {
                "templateId": "template-1",
                "templateName": "门诊模板",
                "templateHtml": "<section></section>",
                "templateDefinition": "[]",
                "targetFieldIds": ["chief"],
                "requestId": "request-1"
            }
        }))
        .expect("patient should deserialize");
        let unknown_field: PatientInfo = serde_json::from_value(serde_json::json!({
            "idPi": "patient-1",
            "idVis": "visit-1",
            "outpatientEmr": {
                "templateId": "template-1",
                "templateName": "门诊模板",
                "templateHtml": "<section></section>",
                "templateDefinition": "[]",
                "targetFieldIds": ["chief"],
                "requestId": "request-1",
                "unsupported": true
            }
        }))
        .expect("patient should deserialize");
        let duplicate_target: PatientInfo = serde_json::from_value(serde_json::json!({
            "idPi": "patient-1",
            "idVis": "visit-1",
            "outpatientEmr": {
                "templateId": "template-1",
                "templateName": "门诊模板",
                "templateHtml": "<section></section>",
                "templateDefinition": "[]",
                "targetFieldIds": ["chief", "chief"],
                "requestId": "request-1"
            }
        }))
        .expect("patient should deserialize");

        assert_eq!(
            validate_voice_outpatient_emr_request(Some(&missing_visit)).unwrap_err(),
            "动态门诊模板语音问诊必须提供 idVis"
        );
        assert_eq!(
            validate_voice_outpatient_emr_request(Some(&unknown_field)).unwrap_err(),
            "outpatientEmr 必须且只能包含六个文档化字段"
        );
        assert_eq!(
            validate_voice_outpatient_emr_request(Some(&duplicate_target)).unwrap_err(),
            "outpatientEmr.targetFieldIds 不能包含重复字段 ID"
        );
    }

    #[test]
    fn start_voice_log_summary_excludes_dynamic_template_sources() {
        let patient: PatientInfo = serde_json::from_value(serde_json::json!({
            "idPi": "PATIENT-SENTINEL",
            "idVis": "VISIT-SENTINEL",
            "outpatientEmr": {
                "templateId": "TEMPLATE-ID-SENTINEL",
                "templateName": "TEMPLATE-NAME-SENTINEL",
                "templateHtml": "TEMPLATE-HTML-SENTINEL",
                "templateDefinition": "TEMPLATE-DEFINITION-SENTINEL",
                "targetFieldIds": ["FIELD-SENTINEL"],
                "requestId": "REQUEST-SENTINEL"
            }
        }))
        .expect("patient should deserialize");

        let summary = summarize_start_voice_for_his_log(Some(&patient));
        let serialized = summary.to_string();

        for secret in [
            "PATIENT-SENTINEL",
            "VISIT-SENTINEL",
            "TEMPLATE-ID-SENTINEL",
            "TEMPLATE-NAME-SENTINEL",
            "TEMPLATE-HTML-SENTINEL",
            "TEMPLATE-DEFINITION-SENTINEL",
            "FIELD-SENTINEL",
            "REQUEST-SENTINEL",
        ] {
            assert!(!serialized.contains(secret));
        }
        assert_eq!(summary["hasOutpatientEmr"], true);
        assert_eq!(summary["targetFieldCount"], 1);
    }

    #[test]
    fn simulated_voice_transcript_requires_the_active_template_request() {
        let patient: PatientInfo = serde_json::from_value(serde_json::json!({
            "idPi": "patient-1",
            "idVis": "visit-1",
            "outpatientEmr": {
                "templateId": "template-1",
                "templateName": "门诊模板",
                "templateHtml": "<section></section>",
                "templateDefinition": "[]",
                "targetFieldIds": ["chief"],
                "requestId": "request-1"
            }
        }))
        .expect("patient should deserialize");
        let valid = SimulatedVoiceTranscriptRequest {
            request_id: "request-1".to_string(),
            transcript: "医生：哪里不舒服？患者：咳嗽三天。".to_string(),
        };
        let stale = SimulatedVoiceTranscriptRequest {
            request_id: "request-old".to_string(),
            transcript: "医生：哪里不舒服？患者：咳嗽三天。".to_string(),
        };

        assert!(validate_simulated_voice_transcript_request(&valid, Some(&patient)).is_ok());
        assert_eq!(
            validate_simulated_voice_transcript_request(&stale, Some(&patient)).unwrap_err(),
            "模拟语音转写 requestId 与当前模板会话不一致"
        );
    }

    #[test]
    fn simulated_voice_transcript_log_summary_excludes_dialogue_text() {
        let request = SimulatedVoiceTranscriptRequest {
            request_id: "request-1".to_string(),
            transcript: "DIALOGUE-CONTENT-SENTINEL".to_string(),
        };

        let summary = summarize_simulated_voice_transcript_for_his_log(&request);
        let serialized = summary.to_string();

        assert_eq!(summary["requestId"], "request-1");
        assert_eq!(summary["transcriptBytes"], 25);
        assert!(!serialized.contains("DIALOGUE-CONTENT-SENTINEL"));
    }

    fn debug_complete_patient() -> PatientInfo {
        serde_json::from_value(serde_json::json!({
            "idPi": "patient-1",
            "idVis": "visit-1",
            "outpatientEmr": {
                "templateId": "template-1",
                "templateName": "门诊模板",
                "templateHtml": "<section data-id=\"chief\"></section>",
                "templateDefinition": "[{\"ID\":\"chief\"}]",
                "targetFieldIds": ["chief"],
                "requestId": "request-1"
            }
        }))
        .expect("patient should deserialize")
    }

    fn debug_complete_result() -> ConsultationResult {
        ConsultationResult {
            status: None,
            consultation_id: "visit-1".to_string(),
            timestamp: 123,
            record: serde_json::json!({
                "visitId": "visit-1",
                "requestId": "request-1",
                "resultType": "record-confirmed",
                "referenceType": "batch",
                "action": "batch",
                "referenceStatus": "pending",
                "emrType": "outpatient-emr",
                "templateMetadata": {
                    "templateId": "template-1"
                },
                "fieldValues": {
                    "chief": "CLINICAL-CONTENT-SENTINEL"
                },
                "dictionarySelections": {},
                "diagList": [{
                    "naDiag": "DIAGNOSIS-CONTENT-SENTINEL"
                }],
                "orderList": [{
                    "naSrv": "ORDER-CONTENT-SENTINEL"
                }],
                "writebackScope": {
                    "recordFields": ["chiefComplaint"],
                    "includeDiagnosis": true,
                    "orderTypes": ["medicine"]
                }
            }),
        }
    }

    #[test]
    fn debug_complete_consultation_requires_the_active_combined_result_identity() {
        let patient = debug_complete_patient();
        let valid = debug_complete_result();
        assert!(validate_debug_complete_consultation(&valid, Some(&patient)).is_ok());

        let mut stale_request = valid.clone();
        stale_request.record["requestId"] = serde_json::json!("request-old");
        assert_eq!(
            validate_debug_complete_consultation(&stale_request, Some(&patient)).unwrap_err(),
            "联调完成结果 requestId 与当前模板会话不一致"
        );

        let mut foreign_field = valid;
        foreign_field.record["fieldValues"] = serde_json::json!({
            "outside": "不得写入"
        });
        assert_eq!(
            validate_debug_complete_consultation(&foreign_field, Some(&patient)).unwrap_err(),
            "联调完成结果 fieldValues 只能包含当前目标字段及非空字符串值"
        );
    }

    #[test]
    fn debug_complete_consultation_log_summary_excludes_clinical_content() {
        let result = debug_complete_result();
        let summary = summarize_debug_complete_consultation_for_his_log(&result);
        let serialized = summary.to_string();

        for secret in [
            "CLINICAL-CONTENT-SENTINEL",
            "DIAGNOSIS-CONTENT-SENTINEL",
            "ORDER-CONTENT-SENTINEL",
        ] {
            assert!(!serialized.contains(secret));
        }
        assert_eq!(summary["fieldValueCount"], 1);
        assert_eq!(summary["diagnosisCount"], 1);
        assert_eq!(summary["orderCount"], 1);
        assert_eq!(summary["recordFieldCount"], 1);
        assert_eq!(summary["includeDiagnosis"], true);
        assert_eq!(summary["orderTypeCount"], 1);
    }

    #[test]
    fn outpatient_emr_request_deserializes_camel_case_without_rewriting_values() {
        let request: OutpatientEmrAnalysisRequest = serde_json::from_value(serde_json::json!({
            "visitId": "visit-1",
            "templateId": "template-1",
            "templateName": "门诊模板",
            "templateHtml": "  <div data-id=\"history\"></div>  ",
            "templateDefinition": "  [{\"ID\":\"article-history\"}]  ",
            "targetFieldIds": ["history"],
            "recordContext": { "recordText": "咳嗽三天" },
            "requestId": "outpatient-emr-request-1"
        }))
        .expect("outpatient EMR request should deserialize");

        assert_eq!(request.visit_id, "visit-1");
        assert_eq!(request.template_id, "template-1");
        assert_eq!(request.template_name, "门诊模板");
        assert_eq!(request.template_html, "  <div data-id=\"history\"></div>  ");
        assert_eq!(
            request.template_definition,
            "  [{\"ID\":\"article-history\"}]  "
        );
        assert_eq!(request.target_field_ids, vec!["history".to_string()]);
        assert_eq!(request.request_id, "outpatient-emr-request-1");
        assert!(validate_outpatient_emr_request(&request).is_ok());
    }

    #[test]
    fn outpatient_emr_direct_request_requires_request_id() {
        let request = serde_json::from_value::<OutpatientEmrAnalysisRequest>(serde_json::json!({
            "visitId": "visit-1",
            "templateId": "template-1",
            "templateName": "门诊模板",
            "templateHtml": "<div data-id=\"history\"></div>",
            "templateDefinition": "[{\"ID\":\"article-history\"}]",
            "targetFieldIds": ["history"],
            "recordContext": { "recordText": "咳嗽三天" }
        }));

        assert!(request.is_err());
    }

    #[test]
    fn outpatient_emr_request_rejects_unknown_top_level_fields() {
        let request = serde_json::from_value::<OutpatientEmrAnalysisRequest>(serde_json::json!({
            "visitId": "visit-1",
            "templateId": "template-1",
            "templateName": "门诊模板",
            "templateHtml": "<div data-id=\"history\"></div>",
            "templateDefinition": "[{\"ID\":\"article-history\"}]",
            "unsupportedField": "unexpected",
            "targetFieldIds": ["history"],
            "recordContext": { "recordText": "咳嗽三天" },
            "requestId": "outpatient-emr-request-1"
        }));

        assert!(request.is_err());
    }

    #[test]
    fn outpatient_emr_patient_accepts_only_canonical_fields() {
        let canonical = serde_json::from_value::<OutpatientEmrAnalysisRequest>(serde_json::json!({
            "visitId": "visit-1",
            "templateId": "template-1",
            "templateName": "门诊模板",
            "templateHtml": "<div data-id=\"history\"></div>",
            "templateDefinition": "[{\"ID\":\"article-history\"}]",
            "targetFieldIds": ["history"],
            "recordContext": { "recordText": "咳嗽三天" },
            "patient": {
                "idPi": "patient-1",
                "name": "张三",
                "sdSexText": "男性",
                "ageText": "45岁"
            },
            "requestId": "outpatient-emr-request-1"
        }));
        let unsupported =
            serde_json::from_value::<OutpatientEmrAnalysisRequest>(serde_json::json!({
                "visitId": "visit-1",
                "templateId": "template-1",
                "templateName": "门诊模板",
                "templateHtml": "<div data-id=\"history\"></div>",
                "templateDefinition": "[{\"ID\":\"article-history\"}]",
                "targetFieldIds": ["history"],
                "recordContext": { "recordText": "咳嗽三天" },
                "patient": {
                    "unsupportedPatientField": "patient-1"
                },
                "requestId": "outpatient-emr-request-1"
            }));

        assert!(canonical.is_ok());
        assert!(unsupported.is_err());
    }

    #[test]
    fn outpatient_emr_patient_rejects_values_that_require_trimming() {
        let request: OutpatientEmrAnalysisRequest = serde_json::from_value(serde_json::json!({
            "visitId": "visit-1",
            "templateId": "template-1",
            "templateName": "门诊模板",
            "templateHtml": "<div data-id=\"history\"></div>",
            "templateDefinition": "[{\"ID\":\"article-history\"}]",
            "targetFieldIds": ["history"],
            "recordContext": { "recordText": "咳嗽三天" },
            "patient": { "name": " 张三" },
            "requestId": "outpatient-emr-request-1"
        }))
        .expect("request should deserialize before semantic validation");

        assert_eq!(
            validate_outpatient_emr_request(&request),
            Err("patient 字段不能包含首尾空白")
        );
    }

    #[test]
    fn outpatient_emr_request_rejects_blank_renderer_target_fields() {
        let request: OutpatientEmrAnalysisRequest = serde_json::from_value(serde_json::json!({
            "visitId": "visit-1",
            "templateId": "template-1",
            "templateName": "门诊模板",
            "templateHtml": "<div data-id=\"history\"></div>",
            "templateDefinition": "[{\"ID\":\"article-history\"}]",
            "targetFieldIds": ["   ", ""],
            "recordContext": { "recordText": "咳嗽三天" },
            "requestId": "outpatient-emr-request-1"
        }))
        .expect("request should deserialize before semantic validation");

        assert_eq!(
            validate_outpatient_emr_request(&request),
            Err("targetFieldIds 不能包含空字段 ID")
        );
    }

    #[test]
    fn outpatient_emr_request_requires_the_renderer_target_field_property() {
        let request = serde_json::from_value::<OutpatientEmrAnalysisRequest>(serde_json::json!({
            "visitId": "visit-1",
            "templateId": "template-1",
            "templateName": "门诊模板",
            "templateHtml": "<div data-id=\"history\"></div>",
            "templateDefinition": "[{\"ID\":\"article-history\"}]",
            "recordContext": { "recordText": "咳嗽三天" },
            "requestId": "outpatient-emr-request-1"
        }));

        assert!(request.is_err());
    }

    #[test]
    fn outpatient_emr_request_rejects_an_empty_renderer_target_list() {
        let request: OutpatientEmrAnalysisRequest = serde_json::from_value(serde_json::json!({
            "visitId": "visit-1",
            "templateId": "template-1",
            "templateName": "门诊模板",
            "templateHtml": "<div data-id=\"history\"></div>",
            "templateDefinition": "[{\"ID\":\"article-history\"}]",
            "targetFieldIds": [],
            "recordContext": { "recordText": "咳嗽三天" },
            "requestId": "outpatient-emr-request-1"
        }))
        .expect("request should deserialize before semantic validation");

        assert_eq!(
            validate_outpatient_emr_request(&request),
            Err("targetFieldIds 至少需要一个当前可写字段")
        );
    }

    #[test]
    fn outpatient_emr_request_rejects_target_ids_that_require_trimming() {
        let request: OutpatientEmrAnalysisRequest = serde_json::from_value(serde_json::json!({
            "visitId": "visit-1",
            "templateId": "template-1",
            "templateName": "门诊模板",
            "templateHtml": "<div data-id=\"history\"></div>",
            "templateDefinition": "[{\"ID\":\"article-history\"}]",
            "targetFieldIds": [" history"],
            "recordContext": { "recordText": "咳嗽三天" },
            "requestId": "outpatient-emr-request-1"
        }))
        .expect("request should deserialize before semantic validation");

        assert_eq!(
            validate_outpatient_emr_request(&request),
            Err("targetFieldIds 不能包含首尾空白")
        );
    }

    #[test]
    fn outpatient_emr_request_rejects_duplicate_renderer_target_fields() {
        let request: OutpatientEmrAnalysisRequest = serde_json::from_value(serde_json::json!({
            "visitId": "visit-1",
            "templateId": "template-1",
            "templateName": "门诊模板",
            "templateHtml": "<div data-id=\"history\"></div>",
            "templateDefinition": "[{\"ID\":\"article-history\"}]",
            "targetFieldIds": ["history", "history"],
            "recordContext": { "recordText": "咳嗽三天" },
            "requestId": "outpatient-emr-request-1"
        }))
        .expect("request should deserialize before semantic validation");

        assert_eq!(
            validate_outpatient_emr_request(&request),
            Err("targetFieldIds 不能包含重复字段 ID")
        );
    }

    #[test]
    fn outpatient_emr_request_rejects_identity_whitespace_without_trimming() {
        let request: OutpatientEmrAnalysisRequest = serde_json::from_value(serde_json::json!({
            "visitId": " visit-1",
            "templateId": "template-1",
            "templateName": "门诊模板",
            "templateHtml": "<div data-id=\"history\"></div>",
            "templateDefinition": "[{\"ID\":\"article-history\"}]",
            "targetFieldIds": ["history"],
            "recordContext": { "recordText": "咳嗽三天" },
            "requestId": "outpatient-emr-request-1"
        }))
        .expect("request should deserialize before semantic validation");

        assert_eq!(
            validate_outpatient_emr_request(&request),
            Err("visitId 不能包含首尾空白")
        );
    }

    #[test]
    fn outpatient_emr_request_rejects_empty_record_context() {
        let request: OutpatientEmrAnalysisRequest = serde_json::from_value(serde_json::json!({
            "visitId": "visit-1",
            "templateId": "template-1",
            "templateName": "门诊模板",
            "templateHtml": "<div data-id=\"history\"></div>",
            "templateDefinition": "[{\"ID\":\"article-history\"}]",
            "targetFieldIds": ["history"],
            "recordContext": {
                "recordText": " ",
                "sections": {},
                "structuredFacts": []
            },
            "requestId": "outpatient-emr-request-1"
        }))
        .expect("request should deserialize before semantic validation");

        assert_eq!(
            validate_outpatient_emr_request(&request),
            Err("recordContext 至少需要一项非空事实")
        );
    }

    #[test]
    fn outpatient_emr_log_summary_excludes_template_and_clinical_content() {
        let request: OutpatientEmrAnalysisRequest = serde_json::from_value(serde_json::json!({
            "visitId": "visit-1",
            "templateId": "template-1",
            "templateName": "门诊模板",
            "templateHtml": "<div>TEMPLATE-HTML-SENTINEL</div>",
            "templateDefinition": "[{\"NAME\":\"TEMPLATE-DEFINITION-SENTINEL\"}]",
            "targetFieldIds": ["personalHistory"],
            "recordContext": {
                "recordText": "RECORD-CONTEXT-SENTINEL"
            },
            "requestId": "outpatient-emr-request-1"
        }))
        .expect("outpatient EMR request should deserialize");

        let summary = summarize_outpatient_emr_for_his_log(&request);
        let serialized = summary.to_string();

        assert!(summary.get("templateHtml").is_none());
        assert!(summary.get("templateDefinition").is_none());
        assert!(summary.get("recordContext").is_none());
        assert!(!serialized.contains("TEMPLATE-HTML-SENTINEL"));
        assert!(!serialized.contains("TEMPLATE-DEFINITION-SENTINEL"));
        assert!(!serialized.contains("RECORD-CONTEXT-SENTINEL"));
        assert_eq!(summary["targetFieldCount"], 1);
        assert_eq!(summary["contextFieldCount"], 1);
    }

    #[test]
    fn outpatient_emr_event_payload_preserves_the_complete_formal_result() {
        let confirmed = ConsultationResult {
            status: None,
            consultation_id: "visit-1".to_string(),
            timestamp: 123,
            record: serde_json::json!({
                "visitId": "visit-1",
                "requestId": "request-1",
                "resultType": "record-confirmed",
                "emrType": "outpatient-emr"
            }),
        };
        let confirmed_event = build_consultation_event(&confirmed);
        assert_eq!(confirmed_event["payload"]["consultationId"], "visit-1");
        assert_eq!(confirmed_event["payload"]["timestamp"], 123);

        let cancelled = ConsultationResult {
            status: Some("cancelled".to_string()),
            consultation_id: "visit-1".to_string(),
            timestamp: 456,
            record: serde_json::json!({
                "visitId": "visit-1",
                "requestId": "request-1",
                "resultType": "cancelled",
                "emrType": "outpatient-emr"
            }),
        };
        let cancelled_event = build_consultation_event(&cancelled);
        assert_eq!(cancelled_event["payload"]["consultationId"], "visit-1");
        assert_eq!(cancelled_event["payload"]["timestamp"], 456);
        assert_eq!(cancelled_event["payload"]["status"], "cancelled");
    }

    #[test]
    fn reference_feedback_accepts_pending_recognizable_items_without_name_alias() {
        let request: ConsultationReferenceFeedbackRequest =
            serde_json::from_value(serde_json::json!({
                "consultationId": "visit-1",
                "requestId": "request-1",
                "status": "pending",
                "recognizableItems": [{
                    "idSrv": "LAB-1",
                    "idCli": "CLI-1",
                    "naSrv": "血常规",
                    "sdSrv": "41",
                    "mutualRecognitionCode": "B32R1WZZZ-00",
                    "priceSale": 20.0
                }]
            }))
            .expect("pending feedback should deserialize");

        assert_eq!(request.items.len(), 1);
        assert_eq!(request.items[0].id_srv.as_deref(), Some("LAB-1"));
        assert_eq!(request.items[0].na_srv.as_deref(), Some("血常规"));
        assert_eq!(
            request.items[0].mutual_recognition_code.as_deref(),
            Some("B32R1WZZZ-00")
        );
    }

    #[test]
    fn pending_reference_feedback_event_is_not_terminal() {
        let result = ConsultationResult {
            status: Some("pending".to_string()),
            consultation_id: "visit-1".to_string(),
            timestamp: 123,
            record: serde_json::json!({
                "resultType": "reference-feedback",
                "requestId": "request-1",
                "referenceStatus": "pending"
            }),
        };

        let event = build_consultation_event(&result);
        assert_eq!(event["terminal"], false);
        // `state=ready` means the event payload is available for SDK dispatch;
        // business pending is represented by referenceStatus + terminal=false.
        assert_eq!(
            derive_result_state(&result, result.record.as_object().unwrap()),
            "ready"
        );
    }
}
