use subtle::ConstantTimeEq;

use crate::config::get_api_token;
use crate::core::app::{Reply, Req};
use crate::core::js;

// Authorization: Bearer <API 토큰> (Claude 레시피 등록용)
fn has_valid_token(req: &Req) -> bool {
    // Node 는 헤더 바이트를 latin1 로 읽는다
    let Some(header) = req.headers.get("authorization") else {
        return false;
    };
    let header: String = header.as_bytes().iter().map(|&b| b as char).collect();
    let Some(rest) = header.strip_prefix("Bearer ") else {
        return false;
    };
    // Buffer.from(header.slice(7).trim()) - UTF-8 바이트
    let given = js::trim(rest).as_bytes();
    let expected = get_api_token();
    let expected = expected.as_bytes();
    given.len() == expected.len() && bool::from(given.ct_eq(expected))
}

// 로그인 필수 라우트용 preHandler - 세션 쿠키 또는 API 토큰
pub fn require_auth(req: &Req) -> Option<Reply> {
    if req.user_id().is_some() || has_valid_token(req) {
        return None;
    }
    Some(Reply::error(401, "unauthorized"))
}

// 세션 전용 (API 토큰 확인·재발급처럼 토큰 자체를 다루는 라우트)
pub fn require_session(req: &Req) -> Option<Reply> {
    if req.user_id().is_none() {
        return Some(Reply::error(401, "unauthorized"));
    }
    None
}
