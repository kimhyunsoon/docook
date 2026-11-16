use rusqlite::Connection;
use serde_json::{Value, json};

use crate::auth::require_auth;
use crate::config::CONFIG;
use crate::core::app::{AppError, HResult, Pre, Reply, Req, Routes};
use crate::core::dates::{add_days, today_str};
use crate::core::db::{self, P};
use crate::core::js;
use crate::params;
use crate::recipe_input::{Saved, resolve_recipe, save_recipe};
use crate::routes::id_or_404;

// 목록용 - 대표 사진은 지정(is_primary) 우선, 없으면 최근 사진 (상세와 같은 정렬)
// recent_meals: 목록의 미니 그래프용 최근 12주 먹은 날짜
// main_ingredients: 목록 표시용 (양념·향신료·대체 재료 제외), ingredient_names: 검색용 전체
const LIST_SQL: &str = "
SELECT r.id, r.name, r.category, r.summary, r.created_at,
  (SELECT MAX(eaten_on) FROM meals m WHERE m.recipe_id = r.id) AS last_eaten_on,
  (SELECT COUNT(*) FROM meals m WHERE m.recipe_id = r.id) AS meal_count,
  (SELECT GROUP_CONCAT(eaten_on) FROM meals m WHERE m.recipe_id = r.id AND m.eaten_on >= @since) AS recent_meals,
  (SELECT COALESCE(thumb_path, path) FROM photos ph WHERE ph.recipe_id = r.id
    ORDER BY ph.is_primary DESC, ph.taken_on DESC, ph.id DESC LIMIT 1) AS photo,
  (SELECT GROUP_CONCAT(name, '|') FROM (
    SELECT i.name, i.category FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id
    WHERE ri.recipe_id = r.id ORDER BY ri.sort)) AS ingredient_names,
  (SELECT GROUP_CONCAT(name, '|') FROM (
    SELECT i.name FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id
    WHERE ri.recipe_id = r.id AND ri.alternative = 0 AND i.category NOT IN ('양념·소스', '향신료·허브')
    ORDER BY ri.sort)) AS main_ingredients
FROM recipes r";

fn split(v: Option<&Value>, sep: char) -> Vec<String> {
    match v {
        Some(Value::String(s)) if !s.is_empty() => s.split(sep).map(String::from).collect(),
        _ => vec![],
    }
}

fn list_recipes() -> db::Result<Value> {
    let since = add_days(&today_str(), -7.0 * 12.0).unwrap_or_default();
    let c = db::conn();
    let rows = db::all_named(
        &c,
        &format!("{LIST_SQL} ORDER BY r.name"),
        &[("@since", P::from(since))],
    )?;
    Ok(Value::Array(
        rows.into_iter()
            .map(|mut r| {
                let mut recent = split(r.get("recent_meals"), ',');
                recent.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
                let names = split(r.get("ingredient_names"), '|');
                let main = split(r.get("main_ingredients"), '|');
                r.insert("recent_meals".into(), json!(recent));
                r.insert("ingredient_names".into(), json!(names));
                r.insert("main_ingredients".into(), json!(main));
                Value::Object(r)
            })
            .collect(),
    ))
}

fn get_recipe(c: &Connection, id: P) -> db::Result<Option<Value>> {
    let ps = std::slice::from_ref(&id);
    let Some(mut recipe) = db::get(c, "SELECT * FROM recipes WHERE id = ?", ps)? else {
        return Ok(None);
    };
    let rows = |sql: &str| -> db::Result<Value> {
        Ok(Value::Array(
            db::all(c, sql, ps)?
                .into_iter()
                .map(Value::Object)
                .collect(),
        ))
    };
    let ingredients = rows(
        "SELECT ri.id, ri.ingredient_id, i.name, i.category, ri.section, ri.amount, ri.unit, ri.note, ri.optional, ri.alternative
       FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id
       WHERE ri.recipe_id = ? ORDER BY ri.sort",
    )?;
    let steps = rows(
        "SELECT step_no, method, text, minutes FROM recipe_steps WHERE recipe_id = ? ORDER BY step_no",
    )?;
    let meals = rows("SELECT id, eaten_on FROM meals WHERE recipe_id = ? ORDER BY eaten_on DESC")?;
    let photos = rows("SELECT * FROM photos WHERE recipe_id = ? ORDER BY taken_on DESC, id DESC")?;
    // 대표 사진: 지정 우선, 없으면 최근 사진
    let list = photos.as_array().cloned().unwrap_or_default();
    let primary = list
        .iter()
        .find(|p| p.get("is_primary") == Some(&json!(1)))
        .or(list.first());
    let primary_id = primary
        .and_then(|p| p.get("id").cloned())
        .unwrap_or(Value::Null);
    recipe.insert("ingredients".into(), ingredients);
    recipe.insert("steps".into(), steps);
    recipe.insert("meals".into(), meals);
    recipe.insert("photos".into(), photos);
    recipe.insert("primary_photo_id".into(), primary_id);
    Ok(Some(Value::Object(recipe)))
}

/// ?dry_run= 은 없음·'0'(저장)·'1'(검증만)만 받는다. 그 밖의 값은 실수로 저장되지 않게 400
fn dry_run(req: &Req) -> Result<bool, Reply> {
    match req.query("dry_run") {
        None => Ok(false),
        Some(Value::String(s)) if s == "0" => Ok(false),
        Some(Value::String(s)) if s == "1" => Ok(true),
        Some(_) => Err(Reply::error(400, "invalid_dry_run")),
    }
}

fn send_validation(errors: Vec<String>) -> Reply {
    Reply::json(400, json!({ "error": "validation", "details": errors }))
}

fn is_unique_name_error(e: &AppError) -> bool {
    e.message.contains("UNIQUE constraint failed: recipes.name")
}

fn saved_json(s: &Saved, recipe: Option<Value>) -> Value {
    json!({
        "id": js::num(s.id),
        "created_ingredients": s.created_ingredients,
        "recipe": recipe.unwrap_or(Value::Null),
    })
}

async fn list(_req: Req) -> HResult {
    Ok(Reply::ok(list_recipes()?))
}

async fn detail(req: Req) -> HResult {
    id_or_404!(req);
    let c = db::conn();
    match get_recipe(&c, P::from(req.param("id")))? {
        None => Ok(Reply::error(404, "not_found")),
        Some(r) => Ok(Reply::ok(r)),
    }
}

// 등록 - Claude 레시피 등록, 앱의 메뉴 추가(이름·분류만)가 함께 쓴다. ?dry_run=1 이면 해석 결과만 돌려준다
async fn create(req: Req) -> HResult {
    let dry_run = match dry_run(&req) {
        Ok(d) => d,
        Err(r) => return Ok(r),
    };
    let body = req.body();
    let c = db::conn();
    let (recipe, errors) = resolve_recipe(&c, body.as_ref())?;
    let Some(mut recipe) = recipe else {
        return Ok(send_validation(errors));
    };
    if let Some(existing) = db::get(
        &c,
        "SELECT id FROM recipes WHERE name = ?",
        params![recipe.name.clone()],
    )? {
        return Ok(Reply::json(
            409,
            json!({ "error": "duplicate_name", "id": existing["id"], "hint": "PUT /api/recipes/:id 로 수정" }),
        ));
    }
    if dry_run {
        return Ok(Reply::ok(
            json!({ "dry_run": true, "recipe": recipe.to_json() }),
        ));
    }
    let result = db::transaction(&c, |c| save_recipe(c, &mut recipe, None))?;
    let detail = get_recipe(&c, P::Num(result.id))?;
    Ok(Reply::json(201, saved_json(&result, detail)))
}

// 전체 교체 수정
async fn update(req: Req) -> HResult {
    let id = id_or_404!(req) as f64;
    let dry_run = match dry_run(&req) {
        Ok(d) => d,
        Err(r) => return Ok(r),
    };
    let body = req.body();
    let c = db::conn();
    if db::get(&c, "SELECT 1 FROM recipes WHERE id = ?", &[P::Num(id)])?.is_none() {
        return Ok(Reply::error(404, "not_found"));
    }
    let (recipe, errors) = resolve_recipe(&c, body.as_ref())?;
    let Some(mut recipe) = recipe else {
        return Ok(send_validation(errors));
    };
    if dry_run {
        return Ok(Reply::ok(
            json!({ "dry_run": true, "recipe": recipe.to_json() }),
        ));
    }
    let saved = db::transaction(&c, |c| {
        save_recipe(c, &mut recipe, Some(id)).map_err(AppError::from)
    })
    .and_then(|result| {
        let detail = get_recipe(&c, P::Num(id))?;
        Ok(saved_json(&result, detail))
    });
    match saved {
        Ok(v) => Ok(Reply::ok(v)),
        Err(e) if is_unique_name_error(&e) => Ok(Reply::error(409, "duplicate_name")),
        Err(e) => Err(e),
    }
}

// 삭제 - 먹은 기록·사진 파일까지 함께 정리
async fn delete(req: Req) -> HResult {
    id_or_404!(req);
    let c = db::conn();
    let photos = db::all(
        &c,
        "SELECT path, thumb_path FROM photos WHERE recipe_id = ?",
        params![req.param("id")],
    )?;
    let result = db::run(
        &c,
        "DELETE FROM recipes WHERE id = ?",
        params![req.param("id")],
    )?;
    if result.changes == 0 {
        return Ok(Reply::error(404, "not_found"));
    }
    for p in &photos {
        for file in [db::text(p, "path"), db::text(p, "thumb_path")] {
            let Some(file) = file.filter(|f| !f.is_empty()) else {
                continue;
            };
            // 파일이 이미 없어도 무시
            let _ = std::fs::remove_file(format!("{}/{file}", CONFIG.data_dir));
        }
    }
    Ok(Reply::ok(json!({ "ok": true })))
}

pub fn register(r: &mut Routes) {
    let (p, a): (&str, Option<Pre>) = ("/api/recipes", Some(require_auth));
    r.add("GET", p, "/", a, list);
    r.add("GET", p, "/:id", a, detail);
    r.add("POST", p, "/", a, create);
    r.add("PUT", p, "/:id", a, update);
    r.add("DELETE", p, "/:id", a, delete);
}
