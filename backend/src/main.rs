use docook_backend::auth::require_auth;
use docook_backend::config::{CONFIG, HOST};
use docook_backend::core::app::{App, Reply, Routes};
use docook_backend::core::{config, db, password, session};
use docook_backend::{params, routes, vocab};

// users 테이블이 비어있으면 env의 초기 계정 생성
async fn bootstrap_initial_user() -> db::Result<()> {
    let count = {
        let c = db::conn();
        db::get(&c, "SELECT COUNT(*) AS c FROM users", params![])?
            .and_then(|r| db::int(&r, "c"))
            .unwrap_or(0)
    };
    if count > 0 {
        return Ok(());
    }
    let (Some(u), Some(p)) = (&CONFIG.initial_username, &CONFIG.initial_password) else {
        return Ok(());
    };
    let hash = password::hash(p.clone()).await;
    let c = db::conn();
    db::run(
        &c,
        "INSERT INTO users (username, password_hash) VALUES (?, ?)",
        params![u.clone(), hash],
    )?;
    Ok(())
}

fn build_routes() -> Routes {
    let mut r = Routes::new();
    // 사진 + 축소본 2개 파트
    r.enable_multipart();
    r.add("GET", "", "/api/health", None, |_req| async {
        Ok(Reply::ok(serde_json::json!({ "ok": true })))
    });
    r.add("GET", "", "/api/vocab", Some(require_auth), |_req| async {
        Ok(Reply::ok(vocab::vocab()))
    });
    routes::auth::register(&mut r);
    routes::recipes::register(&mut r);
    routes::ingredients::register(&mut r);
    routes::meals::register(&mut r);
    routes::photos::register(&mut r);
    routes::settings::register(&mut r);
    // 사진 파일 서빙 (/api/files/photos/... → DATA_DIR/photos/...) - 로그인 필수
    routes::files::register(&mut r);
    r
}

#[tokio::main]
async fn main() {
    config::init_log();
    if let Err(e) = run().await {
        eprintln!("{e}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    docook_backend::db::open()?;
    docook_backend::db::migrate()?;
    bootstrap_initial_user().await?;
    session::init_store()?;
    let app = App {
        routes: build_routes(),
        session: session::Config {
            secret: CONFIG.session_secret.clone(),
            secure: config::production(),
        },
    };
    docook_backend::core::app::serve(app, HOST, CONFIG.port).await?;
    Ok(())
}
