// API 입력 검증 통합 테스트 - 임시 데이터 폴더로 앱을 올리고 core::app::handle 로 요청을 보낸다.
// DB·설정은 프로세스 전역이라 테스트끼리 공유한다 (테스트마다 이름이 겹치지 않는 데이터를 만든다)
use std::sync::{Arc, OnceLock};

use axum::body::Body;
use axum::http::Request;
use docook_backend::config::{CONFIG, get_api_token};
use docook_backend::core::app::{App, handle};
use docook_backend::core::{db, password, session};
use docook_backend::{params, routes};
use serde_json::{Value, json};

fn app() -> Arc<App> {
    static APP: OnceLock<Arc<App>> = OnceLock::new();
    APP.get_or_init(|| {
        let dir = std::env::temp_dir().join(format!("docook-api-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        // SAFETY: 다른 스레드가 환경 변수를 읽기 전(CONFIG 초기화 전) 한 번만 설정한다
        unsafe { std::env::set_var("DATA_DIR", &dir) };
        docook_backend::db::open().unwrap();
        docook_backend::db::migrate().unwrap();
        session::init_store().unwrap();
        Arc::new(App {
            routes: routes::build(),
            session: session::Config {
                secret: "test-secret".into(),
                secure: false,
            },
        })
    })
    .clone()
}

struct Res {
    status: u16,
    headers: axum::http::HeaderMap,
    body: Value,
}

enum B {
    None,
    Json(Value),
    Form(String, Vec<u8>),
}

async fn call_with(method: &str, path: &str, body: B, headers: &[(&str, String)]) -> Res {
    let app = app();
    let mut r = Request::builder().method(method).uri(path);
    for (k, v) in headers {
        r = r.header(*k, v);
    }
    let req = match body {
        B::None => r.body(Body::empty()),
        B::Json(v) => r
            .header("content-type", "application/json")
            .body(Body::from(v.to_string())),
        B::Form(ct, bytes) => r.header("content-type", ct).body(Body::from(bytes)),
    }
    .unwrap();
    let res = handle(app, req).await;
    let status = res.status().as_u16();
    let headers = res.headers().clone();
    let bytes = axum::body::to_bytes(res.into_body(), usize::MAX)
        .await
        .unwrap();
    let body = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into()))
    };
    Res {
        status,
        headers,
        body,
    }
}

/// API 토큰으로 요청
async fn call(method: &str, path: &str, body: B) -> Res {
    app();
    let auth = format!("Bearer {}", get_api_token());
    call_with(method, path, body, &[("authorization", auth)]).await
}

fn assert_err(r: &Res, status: u16, code: &str) {
    assert_eq!(
        (r.status, &r.body),
        (status, &json!({ "error": code })),
        "응답: {} {}",
        r.status,
        r.body
    );
}

async fn new_ingredient(name: &str) -> i64 {
    let r = call(
        "POST",
        "/api/ingredients",
        B::Json(json!({ "name": name, "category": "채소" })),
    )
    .await;
    assert_eq!(r.status, 201, "{}", r.body);
    r.body["id"].as_i64().unwrap()
}

async fn new_recipe(name: &str) -> i64 {
    let r = call("POST", "/api/recipes", B::Json(json!({ "name": name }))).await;
    assert_eq!(r.status, 201, "{}", r.body);
    r.body["id"].as_i64().unwrap()
}

// 1. resolve?name=a&name=b
#[tokio::test]
async fn resolve_repeated_name_is_400() {
    let r = call("GET", "/api/ingredients/resolve?name=a&name=b", B::None).await;
    assert_err(&r, 400, "invalid_name");
    let r = call("GET", "/api/ingredients/resolve?name=zzz-none", B::None).await;
    assert_err(&r, 404, "not_found");
}

// 2. 재료 name 이 문자열이 아님
#[tokio::test]
async fn ingredient_name_must_be_string() {
    for name in [json!(5), json!(["a"]), json!({}), json!(true)] {
        let r = call(
            "POST",
            "/api/ingredients",
            B::Json(json!({ "name": name, "category": "채소" })),
        )
        .await;
        assert_err(&r, 400, "invalid_name");
    }
    let r = call("POST", "/api/ingredients", B::Json(json!({ "name": null }))).await;
    assert_err(&r, 400, "name_required");

    let id = new_ingredient("검증이름재료").await;
    let r = call(
        "PATCH",
        &format!("/api/ingredients/{id}"),
        B::Json(json!({ "name": 5 })),
    )
    .await;
    assert_err(&r, 400, "invalid_name");
    // null 은 그대로 생략
    let r = call(
        "PATCH",
        &format!("/api/ingredients/{id}"),
        B::Json(json!({ "name": null })),
    )
    .await;
    assert_eq!((r.status, r.body), (200, json!({ "ok": true })));
}

// 3. aliases·add_aliases·remove_aliases 는 문자열 배열만
#[tokio::test]
async fn aliases_must_be_string_arrays() {
    for aliases in [
        json!("가나"),
        json!(5),
        json!({}),
        json!([null]),
        json!([1]),
        json!([["x"]]),
    ] {
        let r = call(
            "POST",
            "/api/ingredients",
            B::Json(json!({ "name": "별칭검증재료", "category": "채소", "aliases": aliases })),
        )
        .await;
        assert_err(&r, 400, "invalid_aliases");
    }
    // 거부된 요청은 아무것도 만들지 않는다
    let r = call(
        "GET",
        "/api/ingredients/resolve?name=%EB%B3%84%EC%B9%AD%EA%B2%80%EC%A6%9D%EC%9E%AC%EB%A3%8C",
        B::None,
    )
    .await;
    assert_err(&r, 404, "not_found");

    let r = call(
        "POST",
        "/api/ingredients",
        B::Json(
            json!({ "name": "별칭정상재료", "category": "채소", "aliases": ["별칭정상1", " "] }),
        ),
    )
    .await;
    assert_eq!(r.status, 201, "{}", r.body);
    let id = r.body["id"].as_i64().unwrap();

    for key in ["add_aliases", "remove_aliases"] {
        for v in [
            json!("가"),
            json!(true),
            json!({}),
            json!([["x"]]),
            json!([{}]),
            json!([[]]),
            json!([null]),
        ] {
            let r = call(
                "PATCH",
                &format!("/api/ingredients/{id}"),
                B::Json(json!({ key: v, "name": "바뀌면안됨" })),
            )
            .await;
            assert_err(&r, 400, "invalid_aliases");
        }
    }
    let r = call(
        "PATCH",
        &format!("/api/ingredients/{id}"),
        B::Json(json!({ "add_aliases": ["별칭정상2"], "remove_aliases": ["별칭정상1"] })),
    )
    .await;
    assert_eq!((r.status, r.body), (200, json!({ "ok": true })));
    let c = db::conn();
    let rows = db::all(
        &c,
        "SELECT alias FROM ingredient_aliases WHERE ingredient_id = ? ORDER BY alias",
        params![id],
    )
    .unwrap();
    let names: Vec<_> = rows.iter().map(|r| r["alias"].clone()).collect();
    assert_eq!(names, vec![json!("별칭정상2")]);
    let name = db::get(&c, "SELECT name FROM ingredients WHERE id = ?", params![id])
        .unwrap()
        .unwrap();
    assert_eq!(name["name"], json!("별칭정상재료"));
}

// 4. optional·alternative 는 boolean 만
#[tokio::test]
async fn optional_alternative_must_be_boolean() {
    let body = json!({
        "name": "불리언검증",
        "ingredients": [
            { "name": "불리언재료1", "category": "채소", "optional": 1 },
            { "name": "불리언재료2", "category": "채소", "alternative": "yes" },
            { "name": "불리언재료3", "category": "채소", "optional": null, "alternative": false },
        ],
    });
    let r = call("POST", "/api/recipes?dry_run=1", B::Json(body)).await;
    assert_eq!(
        (r.status, r.body),
        (
            400,
            json!({ "error": "validation", "details": [
                "ingredients[0].optional: true/false 또는 생략",
                "ingredients[1].alternative: true/false 또는 생략",
            ] })
        )
    );
    let body = json!({
        "name": "불리언정상",
        "ingredients": [
            { "name": "불리언재료1", "category": "채소", "optional": true },
            { "name": "불리언재료2", "category": "채소", "alternative": true },
        ],
    });
    let r = call("POST", "/api/recipes?dry_run=1", B::Json(body)).await;
    assert_eq!(r.status, 200, "{}", r.body);
    assert_eq!(r.body["recipe"]["ingredients"][0]["optional"], json!(true));
    assert_eq!(
        r.body["recipe"]["ingredients"][1]["alternative"],
        json!(true)
    );
}

fn recipe_exists(name: &str) -> bool {
    let c = db::conn();
    db::get(&c, "SELECT 1 FROM recipes WHERE name = ?", params![name])
        .unwrap()
        .is_some()
}

// 5. dry_run 은 없음·0·1 만
#[tokio::test]
async fn dry_run_only_accepts_0_or_1() {
    for q in [
        "dry_run=2",
        "dry_run=",
        "dry_run",
        "dry_run=true",
        "dry_run=1&dry_run=1",
    ] {
        let r = call(
            "POST",
            &format!("/api/recipes?{q}"),
            B::Json(json!({ "name": "드라이런검증" })),
        )
        .await;
        assert_err(&r, 400, "invalid_dry_run");
    }
    assert!(!recipe_exists("드라이런검증"));

    let r = call(
        "POST",
        "/api/recipes?dry_run=1",
        B::Json(json!({ "name": "드라이런검증" })),
    )
    .await;
    assert_eq!((r.status, &r.body["dry_run"]), (200, &json!(true)));
    assert!(!recipe_exists("드라이런검증"));

    let r = call(
        "POST",
        "/api/recipes?dry_run=0",
        B::Json(json!({ "name": "드라이런검증" })),
    )
    .await;
    assert_eq!(r.status, 201, "{}", r.body);
    let id = r.body["id"].as_i64().unwrap();

    let r = call(
        "PUT",
        &format!("/api/recipes/{id}?dry_run=2"),
        B::Json(json!({ "name": "드라이런수정" })),
    )
    .await;
    assert_err(&r, 400, "invalid_dry_run");
    assert!(!recipe_exists("드라이런수정"));
}

/// (필드 이름, 파일이면 (파일 이름, Content-Type), 내용)
type Part<'a> = (&'a str, Option<(&'a str, &'a str)>, &'a [u8]);

fn multipart(parts: &[Part]) -> B {
    let boundary = "XtestBoundaryX";
    let mut out = Vec::new();
    for (name, file, data) in parts {
        out.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        match file {
            Some((filename, ct)) => out.extend_from_slice(
                format!(
                    "Content-Disposition: form-data; name=\"{name}\"; filename=\"{filename}\"\r\nContent-Type: {ct}\r\n\r\n"
                )
                .as_bytes(),
            ),
            None => out.extend_from_slice(
                format!("Content-Disposition: form-data; name=\"{name}\"\r\n\r\n").as_bytes(),
            ),
        }
        out.extend_from_slice(data);
        out.extend_from_slice(b"\r\n");
    }
    out.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    B::Form(format!("multipart/form-data; boundary={boundary}"), out)
}

// 6. 사진 업로드: file·thumb 형식이 틀리면 400 (크기 검사보다 먼저)
#[tokio::test]
async fn upload_rejects_unsupported_type() {
    let id = new_recipe("사진형식검증").await;
    let path = format!("/api/recipes/{id}/photos");
    let png = Some(("a.png", "image/png"));
    let txt = Some(("a.txt", "text/plain"));
    let big = vec![0u8; 20 * 1024 * 1024 + 1];

    let r = call("POST", &path, multipart(&[("file", txt, b"x")])).await;
    assert_err(&r, 400, "unsupported_type");
    let r = call(
        "POST",
        &path,
        multipart(&[("file", png, b"x"), ("thumb", txt, b"x")]),
    )
    .await;
    assert_err(&r, 400, "unsupported_type");
    // 형식이 틀린 20MB 초과 파일도 형식 오류
    let r = call("POST", &path, multipart(&[("file", txt, &big)])).await;
    assert_err(&r, 400, "unsupported_type");
    // 형식이 맞으면 크기 초과는 그대로 413
    let r = call("POST", &path, multipart(&[("file", png, &big)])).await;
    assert_eq!(r.status, 413);
    // 사진이 아닌 다른 이름의 파트는 지금처럼 무시
    let r = call(
        "POST",
        &path,
        multipart(&[
            ("taken_on", None, b"2026-11-01"),
            ("x", txt, b"x"),
            ("file", png, b"x"),
        ]),
    )
    .await;
    assert_eq!(r.status, 201, "{}", r.body);
    let photo = r.body["path"].as_str().unwrap().to_string();
    assert!(photo.ends_with(".png"));
    assert!(r.body["thumb_path"].is_null());
    // 거부된 요청은 사진을 남기지 않는다
    let c = db::conn();
    let n = db::get(
        &c,
        "SELECT COUNT(*) AS n FROM photos WHERE recipe_id = ?",
        params![id],
    )
    .unwrap()
    .unwrap();
    assert_eq!(n["n"], json!(1));
}

// 7. :id 는 양의 정수 문자열만, into_id 는 정수만
#[tokio::test]
async fn id_params_must_be_positive_integers() {
    let rid = new_recipe("아이디검증").await;
    let iid = new_ingredient("아이디검증재료").await;
    let body = || B::Json(json!({ "name": "아이디검증" }));
    for bad in [
        "22.0",
        "abc",
        "0",
        "-1",
        "1e1",
        "01",
        "%201",
        "99999999999999999999",
    ] {
        let bad_r = if bad == "22.0" {
            format!("{rid}.0")
        } else {
            bad.to_string()
        };
        let cases = [
            ("GET", format!("/api/recipes/{bad_r}")),
            ("PUT", format!("/api/recipes/{bad_r}")),
            ("DELETE", format!("/api/recipes/{bad_r}")),
            ("POST", format!("/api/recipes/{bad_r}/meals")),
            ("DELETE", format!("/api/recipes/{bad_r}/meals/today")),
            ("POST", format!("/api/recipes/{bad_r}/photos")),
            ("DELETE", format!("/api/meals/{bad}")),
            ("POST", format!("/api/photos/{bad}/primary")),
            ("DELETE", format!("/api/photos/{bad}/primary")),
            ("PATCH", format!("/api/photos/{bad}")),
            ("DELETE", format!("/api/photos/{bad}")),
            ("PATCH", format!("/api/ingredients/{bad}")),
            ("POST", format!("/api/ingredients/{bad}/merge")),
            ("DELETE", format!("/api/ingredients/{bad}")),
        ];
        for (m, p) in cases {
            let r = call(m, &p, body()).await;
            assert_err(&r, 404, "not_found");
        }
    }
    // 정상 id 는 그대로
    let r = call("GET", &format!("/api/recipes/{rid}"), B::None).await;
    assert_eq!(r.status, 200);
    let r = call(
        "PUT",
        &format!("/api/recipes/{rid}"),
        B::Json(json!({ "name": "아이디검증2" })),
    )
    .await;
    assert_eq!(r.status, 200, "{}", r.body);
    // 없는 대상 멱등 삭제는 그대로 ok
    let r = call("DELETE", "/api/meals/99999999", B::None).await;
    assert_eq!((r.status, r.body), (200, json!({ "ok": true })));

    // merge into_id
    let from = new_ingredient("병합원본재료").await;
    for into in [
        json!("x"),
        json!(1.5),
        json!(format!("{iid}.0")),
        json!(null),
        json!(true),
        json!([iid]),
        json!(""),
    ] {
        let r = call(
            "POST",
            &format!("/api/ingredients/{from}/merge"),
            B::Json(json!({ "into_id": into })),
        )
        .await;
        assert_err(&r, 400, "invalid_target");
    }
    let r = call(
        "POST",
        &format!("/api/ingredients/{from}/merge"),
        B::Json(json!({ "into_id": iid.to_string() })),
    )
    .await;
    assert_eq!((r.status, r.body), (200, json!({ "ok": true })));
}

// 8. 지워진 사용자의 세션으로 me → 401
#[tokio::test]
async fn me_with_deleted_user_is_401() {
    app();
    {
        let c = db::conn();
        db::run(
            &c,
            "INSERT INTO users (username, password_hash) VALUES (?, ?)",
            params!["지울사용자", password::hash_sync("pw-1234")],
        )
        .unwrap();
    }
    let r = call_with(
        "POST",
        "/api/auth/login",
        B::Json(json!({ "username": "지울사용자", "password": "pw-1234" })),
        &[],
    )
    .await;
    assert_eq!(r.status, 200, "{}", r.body);
    let cookie = r.headers["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_string();
    let hdr = [("cookie", cookie)];
    let me = || call_with("GET", "/api/auth/me", B::None, &hdr);
    assert_eq!(me().await.status, 200);
    {
        let c = db::conn();
        db::run(
            &c,
            "DELETE FROM users WHERE username = ?",
            params!["지울사용자"],
        )
        .unwrap();
    }
    assert_err(&me().await, 401, "unauthorized");
}

// 9. 점파일은 Fastify 404
#[tokio::test]
async fn files_hide_dotfiles() {
    app();
    let photos = std::path::Path::new(&CONFIG.data_dir).join("photos");
    std::fs::write(photos.join(".hidden"), "secret").unwrap();
    std::fs::create_dir_all(photos.join("sub")).unwrap();
    std::fs::write(photos.join("sub/.x"), "secret").unwrap();
    std::fs::write(photos.join("seen.png"), "png").unwrap();
    for p in ["/api/files/photos/.hidden", "/api/files/photos/sub/.x"] {
        let r = call("GET", p, B::None).await;
        assert_eq!(
            (r.status, r.body),
            (
                404,
                json!({ "message": format!("Route GET:{p} not found"), "error": "Not Found", "statusCode": 404 })
            )
        );
    }
    let r = call("GET", "/api/files/photos/seen.png", B::None).await;
    assert_eq!(r.status, 200);
    // '..' 는 그대로 403
    let r = call("GET", "/api/files/photos/..%2F.session-secret", B::None).await;
    assert_eq!(r.status, 403);
}
