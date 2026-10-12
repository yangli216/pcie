//! Public-health HTTP and authenticated, per-session WebSocket transport.
use crate::{
    public_health::{self, error, BridgeError, BridgeResult, HandshakeRequest, SCHEMA},
    SharedAppState,
};
use actix_web::{web, HttpRequest, HttpResponse};
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

fn header(req: &HttpRequest, name: &str) -> String {
    req.headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default()
        .to_owned()
}
fn response(result: BridgeResult<Value>, success: u16) -> HttpResponse {
    match result {
        Ok(value) => HttpResponse::build(actix_web::http::StatusCode::from_u16(success).unwrap())
            .insert_header(("Cache-Control", "no-store"))
            .json(value),
        Err(err) => {
            HttpResponse::build(actix_web::http::StatusCode::from_u16(err.status()).unwrap())
                .insert_header(("Cache-Control", "no-store"))
                .json(err)
        }
    }
}
fn log(
    app: &web::Data<tauri::AppHandle>,
    operation: &str,
    path: &str,
    result: &BridgeResult<Value>,
    success: u16,
    start: Instant,
) {
    let status = result
        .as_ref()
        .map(|_| success)
        .unwrap_or_else(|e| e.status());
    crate::http_server::record_bridge_log(
        app,
        &uuid::Uuid::new_v4().to_string(),
        operation,
        "POST",
        path,
        if result.is_ok() { "success" } else { "error" },
        status,
        start,
        None,
        Some(json!({"accepted":result.is_ok()})),
        None,
        None,
        None,
        result.as_ref().err().map(|e| e.error_code.clone()),
    );
}
pub fn configure(config: &mut web::ServiceConfig) {
    config.service(
        web::scope("/api/public-health")
            .app_data(
                web::JsonConfig::default()
                    .limit(524_288)
                    .error_handler(|err, _| {
                        let status = if matches!(
                            err,
                            actix_web::error::JsonPayloadError::Overflow { .. }
                                | actix_web::error::JsonPayloadError::OverflowKnownLength { .. }
                        ) {
                            actix_web::http::StatusCode::PAYLOAD_TOO_LARGE
                        } else {
                            actix_web::http::StatusCode::BAD_REQUEST
                        };
                        actix_web::error::InternalError::from_response(
                            "invalid public-health JSON",
                            HttpResponse::build(status).json(error(
                                "INVALID_REQUEST",
                                "公卫请求JSON格式错误或超过大小限制",
                            )),
                        )
                        .into()
                    }),
            )
            .route("/handshake", web::post().to(handshake))
            .route("/assist", web::post().to(assist))
            .route("/writeback-feedback", web::post().to(feedback)),
    );
}
async fn handshake(
    req: HttpRequest,
    body: web::Json<HandshakeRequest>,
    state: web::Data<SharedAppState>,
    app: web::Data<tauri::AppHandle>,
) -> HttpResponse {
    let start = Instant::now();
    let result = state
        .public_health
        .lock()
        .map_err(|_| error("BRIDGE_NOT_CONFIGURED", "公卫服务暂不可用"))
        .and_then(|mut registry| {
            registry.handshake(
                &header(&req, "Origin"),
                &header(&req, "X-PCIE-Pairing-Key"),
                &header(&req, "X-PCIE-Bridge-Token"),
                body.into_inner(),
                public_health::now_ms(),
            )
        });
    log(
        &app,
        "public-health.handshake",
        "/api/public-health/handshake",
        &result,
        200,
        start,
    );
    response(result, 200)
}
async fn assist(
    req: HttpRequest,
    body: web::Json<Value>,
    state: web::Data<SharedAppState>,
    app: web::Data<tauri::AppHandle>,
) -> HttpResponse {
    let start = Instant::now();
    let request = body.into_inner();
    let result = (|| {
        let mut registry = state
            .public_health
            .lock()
            .map_err(|_| error("BRIDGE_NOT_CONFIGURED", "公卫服务暂不可用"))?;
        let id = registry.authenticate(
            &header(&req, "Origin"),
            &header(&req, "X-PCIE-Bridge-Token"),
            public_health::now_ms(),
        )?;
        let accepted = registry.assist(&id, request, public_health::now_ms())?;
        let snapshot = registry
            .active_task()
            .ok_or_else(|| error("TASK_CONTEXT_MISMATCH", "公卫任务受理失败"))?;
        drop(registry);
        if let Some(main) = app.get_webview_window("main") {
            main.emit(
                "start-public-health-assist",
                json!({"bridgeSessionId":id,"request":snapshot.request}),
            )
            .map_err(|_| {
                error(
                    "TASK_CONTEXT_MISMATCH",
                    "公卫页面暂不可用，请使用相同请求重试",
                )
            })?;
            let _ = main.show();
            let _ = main.set_focus();
        } else {
            return Err(error("TASK_CONTEXT_MISMATCH", "公卫主窗口暂不可用"));
        }
        Ok(accepted)
    })();
    log(
        &app,
        "public-health.assist",
        "/api/public-health/assist",
        &result,
        202,
        start,
    );
    response(result, 202)
}
async fn feedback(
    req: HttpRequest,
    body: web::Json<Value>,
    state: web::Data<SharedAppState>,
    app: web::Data<tauri::AppHandle>,
) -> HttpResponse {
    let start = Instant::now();
    let feedback = body.into_inner();
    let result = (|| {
        let mut registry = state
            .public_health
            .lock()
            .map_err(|_| error("BRIDGE_NOT_CONFIGURED", "公卫服务暂不可用"))?;
        let id = registry.authenticate(
            &header(&req, "Origin"),
            &header(&req, "X-PCIE-Bridge-Token"),
            public_health::now_ms(),
        )?;
        let (ack, current) = registry.feedback(&id, feedback.clone(), public_health::now_ms())?;
        drop(registry);
        if current {
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.emit(
                    "public-health-writeback-feedback",
                    json!({"bridgeSessionId":id,"feedback":feedback}),
                );
            }
        }
        Ok(ack)
    })();
    log(
        &app,
        "public-health.feedback",
        "/api/public-health/writeback-feedback",
        &result,
        200,
        start,
    );
    response(result, 200)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Subscription {
    #[serde(rename = "type")]
    kind: String,
    schema_version: String,
    bridge_session_id: String,
    public_health_bridge_token: String,
    after: Option<String>,
}
async fn ws_error(session: &mut actix_ws::Session, err: BridgeError) {
    let _ = session
        .text(
            json!({"type":"public-health-error","errorCode":err.error_code,"message":err.message})
                .to_string(),
        )
        .await;
}
pub async fn events_ws(
    req: HttpRequest,
    stream: web::Payload,
    state: web::Data<SharedAppState>,
) -> Result<HttpResponse, actix_web::Error> {
    let origin = header(&req, "Origin");
    let allowed = state
        .public_health
        .lock()
        .map_err(|_| error("BRIDGE_NOT_CONFIGURED", "公卫服务暂不可用"))
        .and_then(|r| r.config.origin(&origin));
    if let Err(err) = allowed {
        return Ok(response(Err(err), 200));
    }
    let (response, mut session, mut messages) = actix_ws::handle(&req, stream)?;
    let state = state.get_ref().clone();
    actix_web::rt::spawn(async move {
        // No clinical frames are sent before the first authenticated control frame.
        let subscription =
            match tokio::time::timeout(Duration::from_secs(10), messages.next()).await {
                Ok(Some(Ok(actix_ws::Message::Text(text)))) if text.len() <= 4096 => {
                    serde_json::from_str::<Subscription>(&text).ok()
                }
                _ => None,
            };
        let Some(sub) = subscription
            .filter(|s| s.kind == "public-health-subscribe" && s.schema_version == SCHEMA)
        else {
            ws_error(
                &mut session,
                error("BRIDGE_AUTH_FAILED", "公卫订阅认证失败"),
            )
            .await;
            let _ = session.close(None).await;
            return;
        };
        let authenticated = (|| {
            let mut registry = state
                .public_health
                .lock()
                .map_err(|_| error("BRIDGE_NOT_CONFIGURED", "公卫服务暂不可用"))?;
            let id = registry.authenticate(
                &origin,
                &sub.public_health_bridge_token,
                public_health::now_ms(),
            )?;
            if id != sub.bridge_session_id {
                return Err(error("BRIDGE_OWNER_MISMATCH", "订阅不属于当前公卫会话"));
            }
            registry.subscribe(&id, sub.after.as_deref())
        })();
        let (mut notice, events, expires) = match authenticated {
            Ok(value) => value,
            Err(err) => {
                ws_error(&mut session, err).await;
                let _ = session.close(None).await;
                return;
            }
        };
        let interrupted = {
            // Guard the whole forwarding future, including blocked replay sends.
            // Renewal revocation cannot be delayed by a slow reader's backpressure.
            let mut credential_notice = notice.clone();
            let expiry = tokio::time::sleep(Duration::from_millis(
                expires.saturating_sub(public_health::now_ms()),
            ));
            tokio::pin!(expiry);
            let forwarding = async {
                if session.text(json!({"type":"public-health-subscribed","schemaVersion":SCHEMA,"bridgeSessionId":sub.bridge_session_id,"expiresAt":public_health::iso(expires)}).to_string()).await.is_err() { return; }
                let mut cursor = sub.after.clone();
                for event in events {
                    cursor = event["event"]["id"].as_str().map(str::to_owned);
                    if session.text(event.to_string()).await.is_err() {
                        return;
                    }
                }
                let mut heartbeat = tokio::time::interval(Duration::from_secs(15));
                loop {
                    tokio::select! {
                        _ = heartbeat.tick() => { if session.ping(b"heartbeat").await.is_err() { break; } },
                        message = messages.next() => match message {
                            Some(Ok(actix_ws::Message::Ping(bytes))) => { if session.pong(&bytes).await.is_err() { break; } },
                            Some(Ok(actix_ws::Message::Pong(_))) => {},
                            Some(Ok(actix_ws::Message::Text(text))) if text == "ping" => { if session.text("pong").await.is_err() { break; } },
                            Some(Ok(actix_ws::Message::Close(_))) | None | Some(Err(_)) => break,
                            _ => { ws_error(&mut session, error("INVALID_REQUEST", "不支持的公卫控制帧")).await; break; },
                        },
                        changed = notice.changed() => {
                            if changed.is_err() { break; }
                            let result = (|| {
                                let mut registry = state.public_health.lock().map_err(|_| error("BRIDGE_NOT_CONFIGURED", "公卫服务暂不可用"))?;
                                let id = registry.authenticate(&origin, &sub.public_health_bridge_token, public_health::now_ms())?;
                                registry.events_after(&id, cursor.as_deref())
                            })();
                            match result {
                                Err(err) => { ws_error(&mut session, err).await; break; },
                                Ok(events) => for event in events {
                                    cursor = event["event"]["id"].as_str().map(str::to_owned);
                                    if session.text(event.to_string()).await.is_err() { return; }
                                },
                            }
                        },
                    }
                }
            };
            tokio::pin!(forwarding);
            loop {
                tokio::select! {
                    _ = &mut forwarding => break None,
                    _ = &mut expiry => break Some(error("BRIDGE_SESSION_EXPIRED", "公卫会话已过期，请重新认证")),
                    changed = credential_notice.changed() => {
                        if changed.is_err() { break Some(error("BRIDGE_SESSION_EXPIRED", "公卫会话已失效")); }
                        let valid = state.public_health.lock().map_err(|_| error("BRIDGE_NOT_CONFIGURED", "公卫服务暂不可用"))
                            .and_then(|mut registry| registry.authenticate(&origin, &sub.public_health_bridge_token, public_health::now_ms()));
                        if let Err(err) = valid { break Some(err); }
                    },
                }
            }
        };
        if let Some(err) = interrupted {
            let _ =
                tokio::time::timeout(Duration::from_millis(250), ws_error(&mut session, err)).await;
        }
        let _ = tokio::time::timeout(Duration::from_millis(250), session.close(None)).await;
    });
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        public_health::{
            tests::{payload, request},
            BridgeConfig, PublicHealthRegistry,
        },
        AppState,
    };
    use actix_web::{test, App};
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::{
        collections::VecDeque,
        sync::{Arc, Mutex},
    };
    const ORIGIN: &str = "https://phis.example.invalid";
    fn state() -> (SharedAppState, String, String) {
        let pairing = STANDARD.encode([42u8; 32]);
        let mut registry = PublicHealthRegistry::new(BridgeConfig::new(ORIGIN, &pairing));
        let now = public_health::now_ms();
        let auth = registry
            .handshake(
                ORIGIN,
                &pairing,
                "",
                HandshakeRequest {
                    schema_version: SCHEMA.into(),
                    sdk_instance_id: uuid::Uuid::new_v4().to_string(),
                    resume_session_id: None,
                },
                now,
            )
            .unwrap();
        let session = auth["bridgeSessionId"].as_str().unwrap().to_owned();
        let token = auth["publicHealthBridgeToken"].as_str().unwrap().to_owned();
        let req = request();
        registry.assist(&session, req.clone(), now).unwrap();
        registry.prepare(&session, req.clone(), now).unwrap();
        registry.confirm(&session, payload(&req), now).unwrap();
        let (result_tx, _) = tokio::sync::broadcast::channel(1);
        let state = Arc::new(AppState {
            public_health: Mutex::new(registry),
            current_consultation: Mutex::new(None),
            last_result: Mutex::new(None),
            event_queue: Mutex::new(VecDeque::new()),
            browser_context: Mutex::new(None),
            result_tx,
        });
        (state, session, token)
    }
    fn frame(opcode: u8, text: &[u8]) -> Vec<u8> {
        let mut result = vec![0x80 | opcode];
        if text.len() < 126 {
            result.push(0x80 | text.len() as u8);
        } else {
            result.push(0x80 | 126);
            result.extend_from_slice(&(text.len() as u16).to_be_bytes());
        }
        let mask = [1, 2, 3, 4];
        result.extend_from_slice(&mask);
        result.extend(text.iter().enumerate().map(|(i, b)| b ^ mask[i % 4]));
        result
    }
    fn text_frames(bytes: &[u8]) -> Vec<Value> {
        let mut offset = 0;
        let mut values = Vec::new();
        while offset + 2 <= bytes.len() {
            let opcode = bytes[offset] & 15;
            let mut len = (bytes[offset + 1] & 127) as usize;
            offset += 2;
            if len == 126 {
                len = u16::from_be_bytes([bytes[offset], bytes[offset + 1]]) as usize;
                offset += 2;
            }
            if opcode == 1 {
                values.push(serde_json::from_slice(&bytes[offset..offset + len]).unwrap());
            }
            offset += len;
        }
        values
    }
    #[actix_web::test]
    async fn websocket_requires_auth_before_replaying_only_bound_session_events() {
        let (state, session, token) = state();
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/ws", web::get().to(events_ws)),
        )
        .await;
        let control = json!({"type":"public-health-subscribe","schemaVersion":SCHEMA,"bridgeSessionId":session,"publicHealthBridgeToken":token}).to_string();
        let mut bytes = frame(1, control.as_bytes());
        bytes.extend(frame(8, &[]));
        let request = test::TestRequest::get()
            .uri("/ws")
            .insert_header(("Origin", ORIGIN))
            .insert_header(("Connection", "upgrade"))
            .insert_header(("Upgrade", "websocket"))
            .insert_header(("Sec-WebSocket-Version", "13"))
            .insert_header(("Sec-WebSocket-Key", "c3ludGhldGljLXdzLWtleQ=="))
            .set_payload(bytes)
            .to_request();
        let response = test::call_service(&app, request).await;
        assert_eq!(response.status(), 101);
        let messages = text_frames(&test::read_body(response).await);
        assert_eq!(messages[0]["type"], "public-health-subscribed");
        assert_eq!(messages[1]["event"]["bridgeSessionId"], session);
        assert_eq!(
            messages[1]["event"]["type"],
            "public-health-result-confirmed"
        );
        assert!(messages[1]["event"].get("consultationId").is_none());
    }
    #[actix_web::test]
    async fn websocket_wrong_token_never_receives_replay_and_wrong_origin_rejects_upgrade() {
        let (state, session, _) = state();
        let app = test::init_service(
            App::new()
                .app_data(web::Data::new(state))
                .route("/ws", web::get().to(events_ws)),
        )
        .await;
        let forbidden = test::TestRequest::get()
            .uri("/ws")
            .insert_header(("Origin", "https://other.invalid"))
            .to_request();
        assert_eq!(test::call_service(&app, forbidden).await.status(), 403);
        let control = json!({"type":"public-health-subscribe","schemaVersion":SCHEMA,"bridgeSessionId":session,"publicHealthBridgeToken":"wrong"}).to_string();
        let request = test::TestRequest::get()
            .uri("/ws")
            .insert_header(("Origin", ORIGIN))
            .insert_header(("Connection", "upgrade"))
            .insert_header(("Upgrade", "websocket"))
            .insert_header(("Sec-WebSocket-Version", "13"))
            .insert_header(("Sec-WebSocket-Key", "c3ludGhldGljLXdzLWtleQ=="))
            .set_payload(frame(1, control.as_bytes()))
            .to_request();
        let response = test::call_service(&app, request).await;
        let messages = text_frames(&test::read_body(response).await);
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0]["type"], "public-health-error");
        assert_eq!(messages[0]["errorCode"], "BRIDGE_AUTH_FAILED");
        assert!(messages[0].get("event").is_none());
    }
    #[actix_web::test]
    async fn websocket_delivers_explicit_pending_redelivery_with_frozen_save_payload() {
        use actix_web::{body::MessageBody, FromRequest};
        use std::pin::Pin;
        let (state, session, token) = state();
        let frozen = state
            .public_health
            .lock()
            .unwrap()
            .active_task()
            .unwrap()
            .pending_writeback
            .unwrap();
        let (input, receiver) = tokio::sync::mpsc::unbounded_channel::<
            Result<web::Bytes, actix_web::error::PayloadError>,
        >();
        let stream = futures_util::stream::unfold(receiver, |mut receiver| async move {
            receiver.recv().await.map(|value| (value, receiver))
        });
        let stream: Pin<
            Box<
                dyn futures_util::Stream<Item = Result<web::Bytes, actix_web::error::PayloadError>>,
            >,
        > = Box::pin(stream);
        let mut inbound = actix_web::dev::Payload::from(stream);
        let request = test::TestRequest::get()
            .uri("/ws")
            .insert_header(("Origin", ORIGIN))
            .insert_header(("Connection", "upgrade"))
            .insert_header(("Upgrade", "websocket"))
            .insert_header(("Sec-WebSocket-Version", "13"))
            .insert_header(("Sec-WebSocket-Key", "c3ludGhldGljLXdzLWtleQ=="))
            .to_http_request();
        let payload = web::Payload::from_request(&request, &mut inbound)
            .await
            .unwrap();
        let control = json!({"type":"public-health-subscribe","schemaVersion":SCHEMA,"bridgeSessionId":session,"publicHealthBridgeToken":token}).to_string();
        input
            .send(Ok(web::Bytes::from(frame(1, control.as_bytes()))))
            .unwrap();
        let response = events_ws(request, payload, web::Data::new(state.clone()))
            .await
            .unwrap();
        assert_eq!(response.status(), 101);
        let mut body = Box::pin(response.into_body());
        let mut received = Vec::new();
        while received
            .iter()
            .filter(|value: &&Value| value.get("event").is_some())
            .count()
            < 1
        {
            let chunk = tokio::time::timeout(
                Duration::from_secs(2),
                futures_util::future::poll_fn(|cx| body.as_mut().poll_next(cx)),
            )
            .await
            .unwrap()
            .unwrap()
            .unwrap();
            received.extend(text_frames(&chunk));
        }
        assert_eq!(received[0]["type"], "public-health-subscribed");
        let first = received
            .iter()
            .find(|value| value.get("event").is_some())
            .unwrap()
            .clone();
        // Confirm again only after this live connection has already consumed the first delivery.
        let acknowledgement = state
            .public_health
            .lock()
            .unwrap()
            .confirm(&session, frozen.clone(), public_health::now_ms())
            .unwrap();
        assert_eq!(acknowledgement["duplicate"], true);
        while received
            .iter()
            .filter(|value| value.get("event").is_some())
            .count()
            < 2
        {
            let chunk = tokio::time::timeout(
                Duration::from_secs(2),
                futures_util::future::poll_fn(|cx| body.as_mut().poll_next(cx)),
            )
            .await
            .unwrap()
            .unwrap()
            .unwrap();
            received.extend(text_frames(&chunk));
        }
        let deliveries: Vec<_> = received
            .iter()
            .filter(|value| value.get("event").is_some())
            .collect();
        assert_ne!(first["event"]["id"], deliveries[1]["event"]["id"]);
        assert_eq!(acknowledgement["eventId"], deliveries[1]["event"]["id"]);
        assert_eq!(first["event"]["payload"], deliveries[1]["event"]["payload"]);
        assert_eq!(deliveries[1]["event"]["payload"], frozen);
        input.send(Ok(web::Bytes::from(frame(8, &[])))).unwrap();
    }
}
