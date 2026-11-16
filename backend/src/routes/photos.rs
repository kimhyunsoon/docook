use std::collections::HashMap;

use bytes::Bytes;
use serde_json::{Value, json};

use super::meals::{check_eaten_on, record_meal};
use crate::auth::require_auth;
use crate::config::CONFIG;
use crate::core::app::{AppError, HResult, Pre, Reply, Req, Routes};
use crate::core::config::random_hex;
use crate::core::db::{self, P};
use crate::core::js;
use crate::core::multipart::{self, Limits};
use crate::core::session;
use crate::params;
use crate::routes::id_or_404;

// 사진 + 축소본 2개 파트
const LIMITS: Limits = Limits {
    file_size: 20 * 1024 * 1024,
    files: Some(2),
};

fn ext_by_mime(m: &str) -> Option<&'static str> {
    match m {
        "image/jpeg" => Some("jpg"),
        "image/png" => Some("png"),
        "image/webp" => Some("webp"),
        "image/heic" => Some("heic"),
        _ => None,
    }
}

fn remove_file(rel: Option<&str>) {
    let Some(rel) = rel.filter(|r| !r.is_empty()) else {
        return;
    };
    // 파일이 이미 없어도 무시
    let _ = std::fs::remove_file(format!("{}/{rel}", CONFIG.data_dir));
}

fn not_found() -> Reply {
    Reply::error(404, "not_found")
}

// 사진 업로드 (multipart: taken_on 필드 + file + thumb(선택, 클라이언트 축소본))
// 사진 날짜 = 먹은 날짜 - 그날 먹은 기록도 함께 생성한다
async fn upload(req: Req) -> HResult {
    id_or_404!(req);
    let id = req.param("id").to_string();
    {
        let c = db::conn();
        if db::get(
            &c,
            "SELECT 1 FROM recipes WHERE id = ?",
            params![id.clone()],
        )?
        .is_none()
        {
            return Ok(not_found());
        }
    }
    let mut taken_on: Option<String> = None;
    let mut files: HashMap<String, (Bytes, &'static str)> = HashMap::new();
    for part in multipart::parts(&req, &LIMITS, false).await? {
        if part.is_file() {
            let ext = ext_by_mime(&part.mimetype);
            // 사진·축소본 파트의 형식이 틀리면 조용히 버리지 않고 거부 (크기 검사보다 먼저)
            let photo_part = part.fieldname == "file" || part.fieldname == "thumb";
            if photo_part && ext.is_none() {
                return Ok(Reply::error(400, "unsupported_type"));
            }
            // part.toBuffer() - 크기 한도 초과면 413
            if part.too_large {
                return Err(AppError {
                    status: 413,
                    code: Some("FST_REQ_FILE_TOO_LARGE".into()),
                    message: "request file too large".into(),
                });
            }
            if let Some(ext) = ext {
                files.insert(part.fieldname.clone(), (part.data.clone(), ext));
            }
        } else if part.fieldname == "taken_on" {
            taken_on = Some(part.value());
        }
    }
    let Some(file) = files.get("file") else {
        return Ok(Reply::error(400, "file_required"));
    };
    // checkEatenOn(takenOn || undefined)
    let taken_on = taken_on.filter(|t| !t.is_empty()).map(Value::String);
    let Some(at) = check_eaten_on(taken_on.as_ref()) else {
        return Ok(Reply::error(400, "invalid_date"));
    };

    let base = format!("r{id}-{}-{}", session::now_ms() as i64, random_hex(3));
    let path = format!("photos/{base}.{}", file.1);
    let write = |rel: &str, data: &Bytes| {
        std::fs::write(format!("{}/{rel}", CONFIG.data_dir), data)
            .map_err(|e| AppError::internal(e.to_string()))
    };
    write(&path, &file.0)?;
    let mut thumb_path: Option<String> = None;
    if let Some(thumb) = files.get("thumb") {
        let t = format!("photos/{base}-t.{}", thumb.1);
        write(&t, &thumb.0)?;
        thumb_path = Some(t);
    }
    let c = db::conn();
    let photo_id = db::transaction(&c, |c| {
        record_meal(c, P::from(id.clone()), &at)?;
        Ok::<_, AppError>(
            db::run(
                c,
                "INSERT INTO photos (recipe_id, path, thumb_path, taken_on) VALUES (?, ?, ?, ?)",
                params![id.clone(), path.clone(), thumb_path.clone(), at.clone()],
            )?
            .last_insert_rowid,
        )
    })?;
    Ok(Reply::json(
        201,
        json!({ "id": photo_id, "path": path, "thumb_path": thumb_path, "taken_on": at }),
    ))
}

fn find_photo(c: &rusqlite::Connection, id: &str) -> db::Result<Option<db::Row>> {
    db::get(c, "SELECT * FROM photos WHERE id = ?", params![id])
}

// 대표 사진 지정 / 해제(해제하면 최근 사진이 대표)
async fn set_primary(req: Req) -> HResult {
    id_or_404!(req);
    let c = db::conn();
    let Some(photo) = find_photo(&c, req.param("id"))? else {
        return Ok(not_found());
    };
    db::transaction(&c, |c| {
        db::run(
            c,
            "UPDATE photos SET is_primary = 0 WHERE recipe_id = ?",
            params![db::int(&photo, "recipe_id")],
        )?;
        db::run(
            c,
            "UPDATE photos SET is_primary = 1 WHERE id = ?",
            params![db::int(&photo, "id")],
        )?;
        Ok::<_, AppError>(())
    })?;
    Ok(Reply::ok(json!({ "ok": true })))
}

async fn unset_primary(req: Req) -> HResult {
    id_or_404!(req);
    let c = db::conn();
    db::run(
        &c,
        "UPDATE photos SET is_primary = 0 WHERE id = ?",
        params![req.param("id")],
    )?;
    Ok(Reply::ok(json!({ "ok": true })))
}

// 사진 날짜 변경 (그날 먹은 기록도 생성)
async fn update(req: Req) -> HResult {
    id_or_404!(req);
    let c = db::conn();
    let Some(photo) = find_photo(&c, req.param("id"))? else {
        return Ok(not_found());
    };
    let taken_on = req.field("taken_on")?;
    let at = check_eaten_on(taken_on.as_ref());
    let Some(at) = at.filter(|_| js::truthy(taken_on.as_ref())) else {
        return Ok(Reply::error(400, "invalid_date"));
    };
    db::transaction(&c, |c| {
        db::run(
            c,
            "UPDATE photos SET taken_on = ? WHERE id = ?",
            params![at.clone(), db::int(&photo, "id")],
        )?;
        record_meal(c, P::from(db::int(&photo, "recipe_id")), &at)?;
        Ok::<_, AppError>(())
    })?;
    Ok(Reply::ok(json!({ "ok": true })))
}

async fn delete(req: Req) -> HResult {
    id_or_404!(req);
    let c = db::conn();
    let Some(photo) = find_photo(&c, req.param("id"))? else {
        return Ok(not_found());
    };
    db::run(
        &c,
        "DELETE FROM photos WHERE id = ?",
        params![db::int(&photo, "id")],
    )?;
    remove_file(db::text(&photo, "path"));
    remove_file(db::text(&photo, "thumb_path"));
    Ok(Reply::ok(json!({ "ok": true })))
}

pub fn register(r: &mut Routes) {
    let (p, a): (&str, Option<Pre>) = ("/api", Some(require_auth));
    r.add("POST", p, "/recipes/:id/photos", a, upload);
    r.add("POST", p, "/photos/:id/primary", a, set_primary);
    r.add("DELETE", p, "/photos/:id/primary", a, unset_primary);
    r.add("PATCH", p, "/photos/:id", a, update);
    r.add("DELETE", p, "/photos/:id", a, delete);
}
