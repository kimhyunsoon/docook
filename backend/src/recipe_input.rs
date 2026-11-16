// 레시피 등록·수정 입력 검증 + 재료 표준명 해석
// Claude 레시피 등록이 오류를 보고 스스로 고칠 수 있게 오류는 항목별 문자열로 모은다
// (오류 문구는 TS recipe-input.ts 와 글자까지 같다)
use std::collections::HashSet;

use rusqlite::Connection;
use serde_json::{Map, Value, json};

use crate::core::db::{self, P, Result};
use crate::core::js;
use crate::params;
use crate::vocab::{INGREDIENT_CATEGORIES, METHODS, RECIPE_CATEGORIES, UNITS, includes};

pub struct ResolvedIngredient {
    pub ingredient_id: Option<i64>, // None = 새로 생성 예정
    pub name: String,               // 표준명
    pub input_name: String,
    pub matched: &'static str, // 'name' | 'alias' | 'new'
    pub category: String,
    pub amount: Option<f64>,
    pub unit: Option<String>,
    pub note: Option<String>,
    pub section: Option<String>,
    pub optional: bool,
    pub alternative: bool,
}

pub struct ResolvedStep {
    pub step_no: usize,
    pub method: Option<String>,
    pub text: String,
    pub minutes: Option<f64>,
}

pub struct ResolvedRecipe {
    pub name: String,
    pub category: String,
    pub summary: Option<String>,
    pub servings: Option<f64>,
    pub ingredients: Vec<ResolvedIngredient>,
    pub steps: Vec<ResolvedStep>,
}

fn opt_str(v: &Option<String>) -> Value {
    v.as_ref().map(|s| json!(s)).unwrap_or(Value::Null)
}

fn opt_num(v: Option<f64>) -> Value {
    v.map(js::num).unwrap_or(Value::Null)
}

impl ResolvedRecipe {
    pub fn to_json(&self) -> Value {
        let ingredients: Vec<Value> = self
            .ingredients
            .iter()
            .map(|i| {
                json!({
                    "ingredient_id": i.ingredient_id,
                    "name": i.name,
                    "input_name": i.input_name,
                    "matched": i.matched,
                    "category": i.category,
                    "amount": opt_num(i.amount),
                    "unit": opt_str(&i.unit),
                    "note": opt_str(&i.note),
                    "section": opt_str(&i.section),
                    "optional": i.optional,
                    "alternative": i.alternative,
                })
            })
            .collect();
        let steps: Vec<Value> = self
            .steps
            .iter()
            .map(|s| {
                json!({
                    "step_no": s.step_no,
                    "method": opt_str(&s.method),
                    "text": s.text,
                    "minutes": opt_num(s.minutes),
                })
            })
            .collect();
        json!({
            "name": self.name,
            "category": self.category,
            "summary": opt_str(&self.summary),
            "servings": opt_num(self.servings),
            "ingredients": ingredients,
            "steps": steps,
        })
    }
}

fn text_or_null(v: Option<&Value>) -> Option<String> {
    match v {
        Some(Value::String(s)) if !js::trim(s).is_empty() => Some(js::trim(s).to_string()),
        _ => None,
    }
}

/// `v ?? null` (undefined·null → None)
fn nullish(v: Option<&Value>) -> Option<&Value> {
    match v {
        None | Some(Value::Null) => None,
        x => x,
    }
}

/// 양의 정수 (Number.isInteger(v) && v > 0)
fn positive_int(v: &Value) -> bool {
    js::is_integer(Some(v)) && v.as_f64().is_some_and(|f| f > 0.0)
}

/// 공백 차이는 같은 재료로 본다 (다진마늘 = 다진 마늘) - JS /\s+/g
pub fn squash(s: &str) -> String {
    s.chars().filter(|c| !js::is_js_space(*c)).collect()
}

pub struct Found {
    pub id: i64,
    pub name: String,
    pub category: String,
    pub matched: &'static str,
}

impl Found {
    pub fn to_json(&self) -> Value {
        json!({ "id": self.id, "name": self.name, "category": self.category, "matched": self.matched })
    }
}

pub fn find_ingredient(c: &Connection, name: &str) -> Result<Option<Found>> {
    let key = squash(name);
    let to_found = |r: Map<String, Value>, matched| Found {
        id: db::int(&r, "id").unwrap_or(0),
        name: db::text(&r, "name").unwrap_or("").to_string(),
        category: db::text(&r, "category").unwrap_or("").to_string(),
        matched,
    };
    if let Some(r) = db::get(
        c,
        "SELECT id, name, category FROM ingredients WHERE REPLACE(name, ' ', '') = ?",
        params![key.clone()],
    )? {
        return Ok(Some(to_found(r, "name")));
    }
    Ok(db::get(
        c,
        "SELECT i.id, i.name, i.category FROM ingredient_aliases a JOIN ingredients i ON i.id = a.ingredient_id
       WHERE REPLACE(a.alias, ' ', '') = ?",
        params![key],
    )?
    .map(|r| to_found(r, "alias")))
}

pub fn resolve_recipe(
    c: &Connection,
    body: Option<&Value>,
) -> Result<(Option<ResolvedRecipe>, Vec<String>)> {
    let mut errors: Vec<String> = vec![];
    let empty = Map::new();
    let b = match body {
        Some(Value::Object(m)) => m,
        _ => &empty,
    };
    let name = text_or_null(b.get("name"));
    if name.is_none() {
        errors.push("name: 필수".into());
    }
    let category = nullish(b.get("category")).cloned().unwrap_or(json!("퓨전"));
    if !includes(RECIPE_CATEGORIES, Some(&category)) {
        errors.push(format!(
            "category: '{}'는 허용되지 않음 (GET /api/vocab recipe_categories)",
            js::to_js_string(Some(&category))
        ));
    }
    let servings = nullish(b.get("servings"));
    if let Some(s) = servings
        && !positive_int(s)
    {
        errors.push("servings: 양의 정수 또는 생략".into());
    }

    let mut ingredients: Vec<ResolvedIngredient> = vec![];
    let mut seen: HashSet<String> = HashSet::new();
    let list = match b.get("ingredients") {
        Some(Value::Array(a)) => a.as_slice(),
        _ => &[],
    };
    for (i, ing) in list.iter().enumerate() {
        let at = format!("ingredients[{i}]");
        let ing = match ing {
            Value::Object(m) => m,
            _ => &empty,
        };
        let Some(input_name) = text_or_null(ing.get("name")) else {
            errors.push(format!("{at}.name: 필수"));
            continue;
        };
        let amount = nullish(ing.get("amount"));
        let unit = text_or_null(ing.get("unit"));
        if let Some(a) = amount
            && !a.as_f64().is_some_and(|f| f > 0.0)
        {
            errors.push(format!(
                "{at}.amount: 양수 숫자 또는 null (비정량이면 생략)"
            ));
        }
        if let Some(u) = &unit
            && !UNITS.contains(&u.as_str())
        {
            errors.push(format!(
                "{at}.unit: '{u}'는 허용되지 않음 (GET /api/vocab units)"
            ));
        }
        if amount.is_none() != unit.is_none() {
            errors.push(format!("{at}: amount와 unit은 함께 쓰거나 함께 생략"));
        }
        let found = find_ingredient(c, &input_name)?;
        let mut resolved_name = input_name.clone();
        let mut ing_category = "기타".to_string();
        if let Some(f) = &found {
            resolved_name = f.name.clone();
            ing_category = f.category.clone();
        } else if !ing.contains_key("category") {
            errors.push(format!(
                "{at}.name: '{input_name}'는 재료 마스터에 없음 - 기존 재료(별칭 포함)로 바꾸거나, 새 재료면 category를 지정"
            ));
        } else if !includes(INGREDIENT_CATEGORIES, ing.get("category")) {
            errors.push(format!(
                "{at}.category: '{}'는 허용되지 않음 (GET /api/vocab ingredient_categories)",
                js::to_js_string(ing.get("category"))
            ));
        } else {
            ing_category = ing["category"].as_str().unwrap_or("").to_string();
        }
        let section = text_or_null(ing.get("section"));
        let dup_key = format!("{}|{resolved_name}", section.as_deref().unwrap_or(""));
        if seen.contains(&dup_key) {
            errors.push(format!("{at}: '{resolved_name}'가 같은 묶음에 중복"));
        }
        seen.insert(dup_key);
        let mut flag = |k: &str| match nullish(ing.get(k)) {
            None => false,
            Some(Value::Bool(v)) => *v,
            Some(_) => {
                errors.push(format!("{at}.{k}: true/false 또는 생략"));
                false
            }
        };
        let optional = flag("optional");
        let alternative = flag("alternative");
        let prev = ingredients.last();
        if alternative && prev.is_none_or(|p| p.section != section) {
            errors.push(format!(
                "{at}.alternative: 같은 묶음의 바로 앞 재료가 있어야 함"
            ));
        }
        ingredients.push(ResolvedIngredient {
            ingredient_id: found.as_ref().map(|f| f.id),
            name: resolved_name,
            input_name,
            matched: found.as_ref().map(|f| f.matched).unwrap_or("new"),
            category: ing_category,
            amount: amount.and_then(|a| a.as_f64()),
            unit,
            note: text_or_null(ing.get("note")),
            section,
            optional,
            alternative,
        });
    }

    let mut steps: Vec<ResolvedStep> = vec![];
    let list = match b.get("steps") {
        Some(Value::Array(a)) => a.as_slice(),
        _ => &[],
    };
    for (i, st) in list.iter().enumerate() {
        let at = format!("steps[{i}]");
        let st = match st {
            Value::Object(m) => m,
            _ => &empty,
        };
        let Some(text) = text_or_null(st.get("text")) else {
            errors.push(format!("{at}.text: 필수"));
            continue;
        };
        let method = text_or_null(st.get("method"));
        if let Some(m) = &method
            && !METHODS.contains(&m.as_str())
        {
            errors.push(format!(
                "{at}.method: '{m}'는 허용되지 않음 (GET /api/vocab methods, 애매하면 생략)"
            ));
        }
        let minutes = nullish(st.get("minutes"));
        if let Some(m) = minutes
            && !positive_int(m)
        {
            errors.push(format!("{at}.minutes: 양의 정수 또는 생략"));
        }
        steps.push(ResolvedStep {
            step_no: steps.len() + 1,
            method,
            text,
            minutes: minutes.and_then(|m| m.as_f64()),
        });
    }

    let Some(name) = name.filter(|_| errors.is_empty()) else {
        return Ok((None, errors));
    };
    Ok((
        Some(ResolvedRecipe {
            name,
            category: category.as_str().unwrap_or("").to_string(),
            summary: text_or_null(b.get("summary")),
            servings: servings.and_then(|s| s.as_f64()),
            ingredients,
            steps,
        }),
        errors,
    ))
}

pub struct Saved {
    pub id: f64,
    pub created_ingredients: Vec<String>,
}

// 검증된 레시피 저장 (recipe_id가 있으면 전체 교체). 트랜잭션 안에서 호출할 것
pub fn save_recipe(
    c: &Connection,
    r: &mut ResolvedRecipe,
    recipe_id: Option<f64>,
) -> Result<Saved> {
    let mut created: Vec<String> = vec![];
    for ing in r.ingredients.iter_mut() {
        if ing.ingredient_id.is_some() {
            continue;
        }
        // 같은 요청 안에서 이미 만든 새 재료면 재사용
        if let Some(again) = find_ingredient(c, &ing.name)? {
            ing.ingredient_id = Some(again.id);
            continue;
        }
        ing.ingredient_id = Some(
            db::run(
                c,
                "INSERT INTO ingredients (name, category) VALUES (?, ?)",
                params![ing.name.clone(), ing.category.clone()],
            )?
            .last_insert_rowid,
        );
        created.push(ing.name.clone());
    }

    let id = match recipe_id {
        None => {
            db::run(
                c,
                "INSERT INTO recipes (name, category, summary, servings) VALUES (?, ?, ?, ?)",
                params![
                    r.name.clone(),
                    r.category.clone(),
                    r.summary.clone(),
                    r.servings
                ],
            )?
            .last_insert_rowid as f64
        }
        Some(id) => {
            db::run(
                c,
                "UPDATE recipes SET name = ?, category = ?, summary = ?, servings = ?, updated_at = datetime('now') WHERE id = ?",
                params![
                    r.name.clone(),
                    r.category.clone(),
                    r.summary.clone(),
                    r.servings,
                    id
                ],
            )?;
            db::run(
                c,
                "DELETE FROM recipe_ingredients WHERE recipe_id = ?",
                params![id],
            )?;
            db::run(
                c,
                "DELETE FROM recipe_steps WHERE recipe_id = ?",
                params![id],
            )?;
            id
        }
    };

    for (i, ing) in r.ingredients.iter().enumerate() {
        db::run(
            c,
            "INSERT INTO recipe_ingredients (recipe_id, ingredient_id, section, amount, unit, note, optional, alternative, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            &[
                P::Num(id),
                P::from(ing.ingredient_id),
                P::from(ing.section.clone()),
                P::from(ing.amount),
                P::from(ing.unit.clone()),
                P::from(ing.note.clone()),
                P::Num(if ing.optional { 1.0 } else { 0.0 }),
                P::Num(if ing.alternative { 1.0 } else { 0.0 }),
                P::Num(i as f64),
            ],
        )?;
    }
    for st in &r.steps {
        db::run(
            c,
            "INSERT INTO recipe_steps (recipe_id, step_no, method, text, minutes) VALUES (?, ?, ?, ?, ?)",
            &[
                P::Num(id),
                P::Num(st.step_no as f64),
                P::from(st.method.clone()),
                P::from(st.text.clone()),
                P::from(st.minutes),
            ],
        )?;
    }
    Ok(Saved {
        id,
        created_ingredients: created,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn squash_like_js_whitespace() {
        assert_eq!(squash(" 다진 \t마늘\u{3000}\u{feff}\n"), "다진마늘");
    }
}
