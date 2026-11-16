use rusqlite::Connection;
use serde_json::{Value, json};

use crate::auth::require_auth;
use crate::core::app::{HResult, Pre, Reply, Req, Routes};
use crate::core::dates::{self, today_str};
use crate::core::db::{self, P};
use crate::params;

// 실제 존재하는 YYYY-MM-DD 인지 (2026-02-30 같은 값 거부)
pub fn is_valid_date(v: Option<&Value>) -> bool {
    match v {
        Some(Value::String(s)) => dates::add_days(s, 0.0).is_some_and(|d| &d == s),
        _ => false,
    }
}

// 먹은 날짜로 허용: 유효한 날짜 + 미래 아님 (소급 기록은 제한 없음)
pub fn check_eaten_on(date: Option<&Value>) -> Option<String> {
    let at = match date {
        None | Some(Value::Null) => Value::String(today_str()),
        Some(v) => v.clone(),
    };
    if !is_valid_date(Some(&at)) {
        return None;
    }
    let at = at.as_str().unwrap_or("").to_string();
    if at > today_str() {
        return None;
    }
    Some(at)
}

// 같은 날 두 번 기록해도 1건 (UNIQUE recipe_id, eaten_on)
pub fn record_meal(c: &Connection, recipe_id: P, eaten_on: &str) -> db::Result<()> {
    db::run(
        c,
        "INSERT OR IGNORE INTO meals (recipe_id, eaten_on) VALUES (?, ?)",
        &[recipe_id, P::from(eaten_on)],
    )?;
    Ok(())
}

async fn create(req: Req) -> HResult {
    let Some(at) = check_eaten_on(req.field_opt("eaten_on").as_ref()) else {
        return Ok(Reply::error(400, "invalid_date"));
    };
    let c = db::conn();
    if db::get(
        &c,
        "SELECT 1 FROM recipes WHERE id = ?",
        params![req.param("id")],
    )?
    .is_none()
    {
        return Ok(Reply::error(404, "not_found"));
    }
    record_meal(&c, P::from(req.param("id")), &at)?;
    Ok(Reply::json(201, json!({ "eaten_on": at })))
}

// 날짜로 취소 ('today' = 오늘) - 목록의 체크 버튼 재탭. 그날 사진은 남는다
async fn delete_by_date(req: Req) -> HResult {
    let date = match req.param("date") {
        "today" => today_str(),
        d => d.to_string(),
    };
    let c = db::conn();
    db::run(
        &c,
        "DELETE FROM meals WHERE recipe_id = ? AND eaten_on = ?",
        params![req.param("id"), date],
    )?;
    Ok(Reply::ok(json!({ "ok": true })))
}

async fn delete(req: Req) -> HResult {
    let c = db::conn();
    db::run(
        &c,
        "DELETE FROM meals WHERE id = ?",
        params![req.param("id")],
    )?;
    Ok(Reply::ok(json!({ "ok": true })))
}

// 달력용 기간 조회 - 썸네일은 그날 찍은 사진 우선, 없으면 요리 대표 사진
async fn range(req: Req) -> HResult {
    let (from, to) = (req.query("from"), req.query("to"));
    if !is_valid_date(from) || !is_valid_date(to) {
        return Ok(Reply::error(400, "invalid_range"));
    }
    let c = db::conn();
    let rows = db::all(
        &c,
        "SELECT m.id, m.recipe_id, m.eaten_on, r.name, r.category,
          COALESCE(
            (SELECT COALESCE(thumb_path, path) FROM photos ph
              WHERE ph.recipe_id = m.recipe_id AND ph.taken_on = m.eaten_on
              ORDER BY ph.is_primary DESC, ph.id DESC LIMIT 1),
            (SELECT COALESCE(thumb_path, path) FROM photos ph WHERE ph.recipe_id = m.recipe_id
              ORDER BY ph.is_primary DESC, ph.taken_on DESC, ph.id DESC LIMIT 1)
          ) AS photo,
          EXISTS (SELECT 1 FROM photos ph WHERE ph.recipe_id = m.recipe_id AND ph.taken_on = m.eaten_on) AS has_day_photo
         FROM meals m JOIN recipes r ON r.id = m.recipe_id
         WHERE m.eaten_on BETWEEN ? AND ?
         ORDER BY m.eaten_on, m.created_at",
        &[db::from_json(from)?, db::from_json(to)?],
    )?;
    Ok(Reply::ok(Value::Array(
        rows.into_iter().map(Value::Object).collect(),
    )))
}

pub fn register(r: &mut Routes) {
    let (p, a): (&str, Option<Pre>) = ("/api", Some(require_auth));
    r.add("POST", p, "/recipes/:id/meals", a, create);
    r.add("DELETE", p, "/recipes/:id/meals/:date", a, delete_by_date);
    r.add("DELETE", p, "/meals/:id", a, delete);
    r.add("GET", p, "/meals", a, range);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_date_like_js() {
        assert!(is_valid_date(Some(&json!("2026-02-28"))));
        assert!(is_valid_date(Some(&json!("2024-02-29"))));
        assert!(!is_valid_date(Some(&json!("2026-02-30"))));
        assert!(!is_valid_date(Some(&json!("2026-13-01"))));
        assert!(!is_valid_date(Some(&json!("2026-1-01"))));
        assert!(!is_valid_date(Some(&json!(20260101))));
        assert!(!is_valid_date(None));
    }
}
