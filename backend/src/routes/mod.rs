pub mod auth;
pub mod files;
pub mod ingredients;
pub mod meals;
pub mod photos;
pub mod recipes;
pub mod settings;

use serde_json::Value;

use crate::auth::require_auth;
use crate::core::app::{AppError, Reply, Req, Routes};
use crate::vocab;

/// 전체 라우트 (main 과 통합 테스트가 같이 쓴다)
pub fn build() -> Routes {
    let mut r = Routes::new();
    // 사진 + 축소본 2개 파트
    r.enable_multipart();
    r.add("GET", "", "/api/health", None, |_req| async {
        Ok(Reply::ok(serde_json::json!({ "ok": true })))
    });
    r.add("GET", "", "/api/vocab", Some(require_auth), |_req| async {
        Ok(Reply::ok(vocab::vocab()))
    });
    auth::register(&mut r);
    recipes::register(&mut r);
    ingredients::register(&mut r);
    meals::register(&mut r);
    photos::register(&mut r);
    settings::register(&mut r);
    // 사진 파일 서빙 (/api/files/photos/... → DATA_DIR/photos/...) - 로그인 필수
    files::register(&mut r);
    r
}

/// 경로의 :id - 양의 정수 문자열('22')만 받는다 ('22.0', 'abc', '0', '022' 는 None)
pub fn id_param(req: &Req, k: &str) -> Option<i64> {
    let s = req.param(k);
    if s.is_empty() || s.starts_with('0') || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse().ok()
}

/// :id 가 양의 정수가 아니면 404 { error: 'not_found' }
macro_rules! id_or_404 {
    ($req:expr) => {
        match $crate::routes::id_param(&$req, "id") {
            Some(id) => id,
            None => return Ok($crate::core::app::Reply::error(404, "not_found")),
        }
    };
}
pub(crate) use id_or_404;

/// 문자열 배열 (undefined·null → 빈 목록). 배열이 아니거나 문자열이 아닌 요소가 있으면 None
pub fn string_list(v: Option<&Value>) -> Option<Vec<String>> {
    match v {
        None | Some(Value::Null) => Some(vec![]),
        Some(Value::Array(a)) => a.iter().map(|x| x.as_str().map(String::from)).collect(),
        Some(_) => None,
    }
}

/// `req.body` (undefined/null 이면 `b.x` 에서 TypeError)
pub fn body_obj(req: &Req) -> Result<serde_json::Map<String, Value>, AppError> {
    match req.body() {
        None => Err(AppError::type_error(
            "Cannot read properties of undefined (reading '{k}')",
        )),
        Some(Value::Null) => Err(AppError::type_error(
            "Cannot read properties of null (reading '{k}')",
        )),
        Some(Value::Object(m)) => Ok(m),
        Some(_) => Ok(Default::default()),
    }
}

/// 첫 속성 이름을 넣은 TypeError 문구로 body 를 꺼낸다
pub fn body_for(req: &Req, first: &str) -> Result<serde_json::Map<String, Value>, AppError> {
    body_obj(req).map_err(|e| AppError::type_error(e.message.replace("{k}", first)))
}

/// `v ?? null`
pub fn or_null(v: Option<&Value>) -> Option<&Value> {
    match v {
        None | Some(Value::Null) => None,
        x => x,
    }
}
