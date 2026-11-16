// 재료 마스터 - Claude 레시피 등록이 정규화 전에 조회하고, 필요하면 별칭 추가·병합으로 정리한다
use rusqlite::Connection;
use serde_json::{Value, json};

use super::{body_for, or_null, trim_of};
use crate::auth::require_auth;
use crate::core::app::{AppError, HResult, Pre, Reply, Req, Routes};
use crate::core::db::{self, P};
use crate::core::js;
use crate::params;
use crate::recipe_input::find_ingredient;
use crate::vocab::{INGREDIENT_CATEGORIES, includes};

async fn list(_req: Req) -> HResult {
    let c = db::conn();
    let rows = db::all(
        &c,
        "SELECT i.id, i.name, i.category,
          (SELECT GROUP_CONCAT(alias, '|') FROM ingredient_aliases a WHERE a.ingredient_id = i.id) AS aliases,
          (SELECT COUNT(DISTINCT recipe_id) FROM recipe_ingredients ri WHERE ri.ingredient_id = i.id) AS recipe_count
         FROM ingredients i ORDER BY i.category, i.name",
        params![],
    )?;
    let out: Vec<Value> = rows
        .into_iter()
        .map(|mut r| {
            let aliases: Vec<Value> = match r.get("aliases") {
                Some(Value::String(s)) if !s.is_empty() => s.split('|').map(|x| json!(x)).collect(),
                _ => vec![],
            };
            r.insert("aliases".into(), Value::Array(aliases));
            Value::Object(r)
        })
        .collect();
    Ok(Reply::ok(Value::Array(out)))
}

// 이름(별칭 포함) → 표준 재료 해석
async fn resolve(req: Req) -> HResult {
    let found = match req.query("name") {
        Some(Value::String(s)) if !s.is_empty() => {
            let c = db::conn();
            find_ingredient(&c, s)?
        }
        // 같은 키가 여러 번이면 배열 → squash(name) 에서 TypeError
        Some(Value::Array(_)) => {
            return Err(AppError::type_error("s.replace is not a function"));
        }
        _ => None,
    };
    match found {
        None => Ok(Reply::error(404, "not_found")),
        Some(f) => Ok(Reply::ok(f.to_json())),
    }
}

/// for (const x of v) - 문자열은 코드 포인트 단위, 배열이 아니면 TypeError
fn iterate(
    v: Option<&Value>,
    not_iterable: impl Fn(&Value) -> String,
) -> Result<Vec<Value>, AppError> {
    match or_null(v) {
        None => Ok(vec![]),
        Some(Value::Array(a)) => Ok(a.clone()),
        Some(Value::String(s)) => Ok(s.chars().map(|c| json!(c.to_string())).collect()),
        Some(x) => Err(AppError::type_error(not_iterable(x))),
    }
}

fn add_aliases(c: &Connection, id: f64, aliases: Option<&Value>) -> Result<(), AppError> {
    for raw in iterate(aliases, |_| "aliases is not iterable".into())? {
        let alias = match &raw {
            Value::String(s) => js::trim(s).to_string(),
            Value::Null => {
                return Err(AppError::type_error(
                    "Cannot read properties of null (reading 'trim')",
                ));
            }
            _ => return Err(AppError::type_error("raw.trim is not a function")),
        };
        if alias.is_empty() {
            continue;
        }
        let owner = find_ingredient(c, &alias)?;
        if let Some(o) = &owner
            && o.id as f64 != id
        {
            return Err(AppError::internal(format!(
                "'{alias}'는 이미 '{}'의 이름·별칭",
                o.name
            )));
        }
        if owner.is_none() {
            db::run(
                c,
                "INSERT INTO ingredient_aliases (alias, ingredient_id) VALUES (?, ?)",
                params![alias, id],
            )?;
        }
    }
    Ok(())
}

fn conflict(e: AppError) -> Reply {
    Reply::json(409, json!({ "error": "conflict", "message": e.message }))
}

async fn create(req: Req) -> HResult {
    let b = body_for(&req, "name")?;
    let name = match or_null(b.get("name")) {
        None => None,
        v => Some(trim_of(v, "req.body.name?")?),
    };
    let category = or_null(b.get("category")).cloned().unwrap_or(json!("기타"));
    let Some(name) = name.filter(|n| !n.is_empty()) else {
        return Ok(Reply::error(400, "name_required"));
    };
    if !includes(INGREDIENT_CATEGORIES, Some(&category)) {
        return Ok(Reply::error(400, "invalid_category"));
    }
    let c = db::conn();
    if let Some(existing) = find_ingredient(&c, &name)? {
        return Ok(Reply::json(
            409,
            json!({ "error": "exists", "ingredient": existing.to_json() }),
        ));
    }
    let result = db::transaction(&c, |c| {
        let new_id = db::run(
            c,
            "INSERT INTO ingredients (name, category) VALUES (?, ?)",
            &[P::from(name.clone()), db::from_json(Some(&category))?],
        )?
        .last_insert_rowid;
        add_aliases(c, new_id as f64, b.get("aliases"))?;
        Ok::<_, AppError>(new_id)
    });
    match result {
        Ok(id) => Ok(Reply::json(201, json!({ "id": id }))),
        Err(e) => Ok(conflict(e)),
    }
}

/// better-sqlite3 stmt.run(...args) 의 인자 해석: 배열은 펼치고, 객체는 이름 붙은 파라미터(여기선 없음)
fn spread_args(args: &[&Value], expected: usize) -> Result<Vec<P>, AppError> {
    let mut out = vec![];
    for a in args {
        match a {
            Value::Array(items) => {
                for x in items {
                    out.push(db::from_json(Some(x))?);
                }
            }
            Value::Object(_) => {}
            x => out.push(db::from_json(Some(x))?),
        }
    }
    if out.len() != expected {
        return Err(AppError::internal(if out.len() > expected {
            "Too many parameter values were provided"
        } else {
            "Too few parameter values were provided"
        }));
    }
    Ok(out)
}

async fn update(req: Req) -> HResult {
    let id = js::string_to_number(req.param("id"));
    let c = db::conn();
    if db::get(&c, "SELECT 1 FROM ingredients WHERE id = ?", &[P::Num(id)])?.is_none() {
        return Ok(Reply::error(404, "not_found"));
    }
    let b = body_for(&req, "category")?;
    if b.contains_key("category") && !includes(INGREDIENT_CATEGORIES, b.get("category")) {
        return Ok(Reply::error(400, "invalid_category"));
    }
    let result = db::transaction(&c, |c| {
        if let Some(v) = or_null(b.get("name")) {
            let Value::String(s) = v else {
                return Err(AppError::type_error("b.name?.trim is not a function"));
            };
            let name = js::trim(s);
            if !name.is_empty() {
                db::run(
                    c,
                    "UPDATE ingredients SET name = ? WHERE id = ?",
                    &[P::from(name), P::Num(id)],
                )?;
            }
        }
        if js::truthy(b.get("category")) {
            db::run(
                c,
                "UPDATE ingredients SET category = ? WHERE id = ?",
                &[db::from_json(b.get("category"))?, P::Num(id)],
            )?;
        }
        add_aliases(c, id, b.get("add_aliases"))?;
        let remove = iterate(b.get("remove_aliases"), |x| match x {
            Value::Number(_) => format!(
                "number {} is not iterable (cannot read property Symbol(Symbol.iterator))",
                js::to_js_string(Some(x))
            ),
            Value::Bool(v) => format!(
                "boolean {v} is not iterable (cannot read property Symbol(Symbol.iterator))"
            ),
            _ => "object is not iterable (cannot read property Symbol(Symbol.iterator))".into(),
        })?;
        for alias in remove {
            let args = spread_args(&[&alias, &json!(id)], 2)?;
            db::run(
                c,
                "DELETE FROM ingredient_aliases WHERE alias = ? AND ingredient_id = ?",
                &args,
            )?;
        }
        Ok::<_, AppError>(())
    });
    if let Err(e) = result {
        return Ok(conflict(e));
    }
    Ok(Reply::ok(json!({ "ok": true })))
}

// 중복 재료 병합: 이 재료를 into_id로 합치고 이름·별칭은 into의 별칭이 된다
async fn merge(req: Req) -> HResult {
    let c = db::conn();
    let from = db::get(
        &c,
        "SELECT id, name FROM ingredients WHERE id = ?",
        params![req.param("id")],
    )?;
    let into_id = body_for(&req, "into_id")?.get("into_id").cloned();
    let into = db::get(
        &c,
        "SELECT id FROM ingredients WHERE id = ?",
        &[db::from_json(into_id.as_ref())?],
    )?;
    let (Some(from), Some(into)) = (from, into) else {
        return Ok(Reply::error(400, "invalid_target"));
    };
    let (from_id, into_id) = (db::int(&from, "id"), db::int(&into, "id"));
    if from_id == into_id {
        return Ok(Reply::error(400, "invalid_target"));
    }
    db::transaction(&c, |c| {
        db::run(
            c,
            "UPDATE recipe_ingredients SET ingredient_id = ? WHERE ingredient_id = ?",
            params![into_id, from_id],
        )?;
        db::run(
            c,
            "UPDATE ingredient_aliases SET ingredient_id = ? WHERE ingredient_id = ?",
            params![into_id, from_id],
        )?;
        db::run(c, "DELETE FROM ingredients WHERE id = ?", params![from_id])?;
        db::run(
            c,
            "INSERT OR REPLACE INTO ingredient_aliases (alias, ingredient_id) VALUES (?, ?)",
            params![db::text(&from, "name").map(String::from), into_id],
        )?;
        Ok::<_, AppError>(())
    })?;
    Ok(Reply::ok(json!({ "ok": true })))
}

// 사용 중이 아닌 재료만 삭제 가능
async fn delete(req: Req) -> HResult {
    let c = db::conn();
    if db::get(
        &c,
        "SELECT 1 FROM recipe_ingredients WHERE ingredient_id = ? LIMIT 1",
        params![req.param("id")],
    )?
    .is_some()
    {
        return Ok(Reply::error(409, "in_use"));
    }
    db::run(
        &c,
        "DELETE FROM ingredients WHERE id = ?",
        params![req.param("id")],
    )?;
    Ok(Reply::ok(json!({ "ok": true })))
}

pub fn register(r: &mut Routes) {
    let (p, a): (&str, Option<Pre>) = ("/api/ingredients", Some(require_auth));
    r.add("GET", p, "/", a, list);
    r.add("GET", p, "/resolve", a, resolve);
    r.add("POST", p, "/", a, create);
    r.add("PATCH", p, "/:id", a, update);
    r.add("POST", p, "/:id/merge", a, merge);
    r.add("DELETE", p, "/:id", a, delete);
}
