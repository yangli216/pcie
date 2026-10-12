use crate::{
    public_health::{error, now_ms, BridgeResult, TaskSnapshot},
    SharedAppState,
};
use serde_json::Value;
use tauri::{Emitter, Manager, WebviewWindow};

fn main_only(window: &WebviewWindow) -> BridgeResult<()> {
    if window.label() != "main" {
        return Err(error("BRIDGE_OWNER_MISMATCH", "公卫操作仅允许主窗口调用"));
    }
    Ok(())
}
#[tauri::command]
pub fn get_active_public_health_task(window: WebviewWindow) -> BridgeResult<Option<TaskSnapshot>> {
    main_only(&window)?;
    let state = window.state::<SharedAppState>();
    let mut registry = state
        .public_health
        .lock()
        .map_err(|_| error("BRIDGE_NOT_CONFIGURED", "公卫服务暂不可用"))?;
    registry.purge_expired(now_ms());
    Ok(registry.active_task())
}
#[tauri::command]
pub fn prepare_public_health_generation(
    window: WebviewWindow,
    bridge_session_id: String,
    request: Value,
) -> BridgeResult<Value> {
    main_only(&window)?;
    let state = window.state::<SharedAppState>();
    let mut registry = state
        .public_health
        .lock()
        .map_err(|_| error("BRIDGE_NOT_CONFIGURED", "公卫服务暂不可用"))?;
    registry.prepare(&bridge_session_id, request, now_ms())
}
#[tauri::command]
pub fn confirm_public_health_result(
    window: WebviewWindow,
    bridge_session_id: String,
    payload: Value,
) -> BridgeResult<Value> {
    main_only(&window)?;
    let state = window.state::<SharedAppState>();
    let mut registry = state
        .public_health
        .lock()
        .map_err(|_| error("BRIDGE_NOT_CONFIGURED", "公卫服务暂不可用"))?;
    let accepted = registry.confirm(&bridge_session_id, payload.clone(), now_ms())?;
    let feedback = registry.confirmation_feedback(&bridge_session_id, &payload);
    drop(registry);
    if let Some(feedback) = feedback {
        window
            .emit(
                "public-health-writeback-feedback",
                serde_json::json!({"bridgeSessionId":bridge_session_id,"feedback":feedback}),
            )
            .map_err(|_| error("TASK_CONTEXT_MISMATCH", "回执通知暂不可用，请重传原确认"))?;
    }
    Ok(accepted)
}
#[tauri::command]
pub fn close_public_health_task(
    window: WebviewWindow,
    origin_request_id: String,
) -> BridgeResult<Value> {
    main_only(&window)?;
    let state = window.state::<SharedAppState>();
    let mut registry = state
        .public_health
        .lock()
        .map_err(|_| error("BRIDGE_NOT_CONFIGURED", "公卫服务暂不可用"))?;
    registry.close(&origin_request_id)
}
