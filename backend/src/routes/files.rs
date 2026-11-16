// 사진 파일 서빙 (/api/files/photos/... → DATA_DIR/photos/...) - 로그인 필수
// @fastify/static root=DATA_DIR/photos, maxAge '30d' + immutable (파일명이 업로드마다 고유하므로 길게 캐시)
use std::path::Path;

use crate::auth::require_auth;
use crate::config::CONFIG;
use crate::core::app::{HResult, Req, Routes};
use crate::core::static_files::{self, Served};

const CACHE_CONTROL: &str = "public, max-age=2592000, immutable";

async fn file(req: Req) -> HResult {
    let rel = req.param("wildcard").to_string();
    // 점으로 시작하는 이름(.hidden 등)은 404. '..' 는 static_files 가 403 으로 거부하므로 그쪽에 맡긴다
    let segs = || rel.split('/');
    if !segs().any(|s| s == "..") && segs().any(|s| s.starts_with('.')) {
        return Ok(req.not_found());
    }
    let root = Path::new(&CONFIG.data_dir).join("photos");
    Ok(
        match static_files::serve(&req, &root, &rel, CACHE_CONTROL).await {
            Served::File(r) => r,
            Served::NotFound => req.not_found(),
        },
    )
}

pub fn register(r: &mut Routes) {
    // Fastify 와일드카드는 빈 조각('/api/files/photos/')도 받는다
    r.add("GET", "/api/files/photos/", "", Some(require_auth), file);
    r.add("GET", "/api/files/photos", "/*", Some(require_auth), file);
}
