use serde_json::json;

use crate::auth::require_session;
use crate::config::{get_api_token, regenerate_api_token};
use crate::core::app::{AppError, HResult, Pre, Reply, Req, Routes};

// API 토큰은 로그인 세션에서만 조회·재발급 (토큰으로 토큰을 꺼낼 수 없게)
async fn get_token(_req: Req) -> HResult {
    Ok(Reply::ok(json!({ "token": get_api_token() })))
}

async fn regenerate(_req: Req) -> HResult {
    let token = regenerate_api_token().map_err(|e| AppError::internal(e.to_string()))?;
    Ok(Reply::ok(json!({ "token": token })))
}

pub fn register(r: &mut Routes) {
    let (p, a): (&str, Option<Pre>) = ("/api/settings", Some(require_session));
    r.add("GET", p, "/api-token", a, get_token);
    r.add("POST", p, "/api-token/regenerate", a, regenerate);
}
