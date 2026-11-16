use std::path::Path;
use std::sync::{LazyLock, RwLock};

use crate::core::config as c;

// 개인용 단일 서버 전제 - 바뀔 일 없는 값은 상수로 고정
// 포트는 dogroo(4746)·donoti(4646)와 안 겹치게 docook의 D(4)·C(3)를 딴 4346/4347 사용
const PORT: u16 = 4346;
pub const HOST: &str = "0.0.0.0";

pub struct Config {
    pub port: u16,
    pub data_dir: String,
    pub session_secret: String,
    pub initial_username: Option<String>,
    pub initial_password: Option<String>,
}

// API 토큰 - Claude(레시피 등록)가 Authorization: Bearer 로 사용.
// 설정 화면에서 확인·재발급한다
static API_TOKEN: RwLock<String> = RwLock::new(String::new());

pub static CONFIG: LazyLock<Config> = LazyLock::new(|| {
    // 데이터 디렉토리 (SQLite + photos/) - 도커에서만 /data로 주입
    let data_dir = c::data_dir();
    std::fs::create_dir_all(format!("{data_dir}/photos")).expect("data dir");
    *API_TOKEN.write().unwrap() = c::load_secret_file(&data_dir, ".api-token", 32);
    Config {
        port: c::port(PORT),
        // 세션 시크릿은 최초 기동 시 자동 생성해 데이터 디렉토리에 보관 (env 불필요)
        session_secret: c::load_secret_file(&data_dir, ".session-secret", 32),
        initial_username: c::env_nonempty("INITIAL_USERNAME"),
        initial_password: c::env_nonempty("INITIAL_PASSWORD"),
        data_dir,
    }
});

pub fn get_api_token() -> String {
    LazyLock::force(&CONFIG);
    API_TOKEN.read().unwrap().clone()
}

pub fn regenerate_api_token() -> std::io::Result<String> {
    let token = c::random_hex(32);
    // TS: apiToken 을 먼저 바꾸고 파일에 쓴다
    *API_TOKEN.write().unwrap() = token.clone();
    c::write_secret(&Path::new(&CONFIG.data_dir).join(".api-token"), &token)?;
    Ok(token)
}
