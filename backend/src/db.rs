use crate::config::CONFIG;
use crate::core::db::{self, P, Result};
use crate::vocab::RECIPE_CATEGORIES;

const SCHEMA: &str = include_str!("schema.sql");
const POOL: &str = include_str!("ingredient-pool.sql");

pub fn open() -> Result<()> {
    db::open(&format!("{}/docook.db", CONFIG.data_dir))
}

// 스키마 + 기본 재료 풀 적용 (IF NOT EXISTS / ON CONFLICT 기반이라 기동 시마다 실행해도 안전)
// 기존 DB 컬럼 추가가 필요해지면 여기에 PRAGMA table_info 분기로 추가한다
pub fn migrate() -> Result<()> {
    let c = db::conn();
    db::exec(&c, SCHEMA)?;
    let has = |table: &str, col: &str| -> Result<bool> {
        Ok(db::columns(&c, table)?.iter().any(|x| x == col))
    };
    if !has("recipe_ingredients", "alternative")? {
        db::exec(
            &c,
            "ALTER TABLE recipe_ingredients ADD COLUMN alternative INTEGER NOT NULL DEFAULT 0",
        )?;
    }
    // 원문 보존은 폐기 (2026-10-27)
    if has("recipes", "original_text")? {
        db::exec(&c, "ALTER TABLE recipes DROP COLUMN original_text")?;
    }
    // 팁도 폐기 (2026-10-27)
    if has("recipes", "tips")? {
        db::exec(&c, "ALTER TABLE recipes DROP COLUMN tips")?;
    }
    if !has("recipes", "servings")? {
        db::exec(&c, "ALTER TABLE recipes ADD COLUMN servings INTEGER")?;
    }
    // 요리 분류를 나라 기준으로 변경 (2026-10-28) - 옛 분류는 퓨전으로 옮긴 뒤 다시 분류
    let marks = vec!["?"; RECIPE_CATEGORIES.len()].join(", ");
    let params: Vec<P> = RECIPE_CATEGORIES.iter().map(|s| P::from(*s)).collect();
    db::run(
        &c,
        &format!("UPDATE recipes SET category = '퓨전' WHERE category NOT IN ({marks})"),
        &params,
    )?;
    db::exec(&c, POOL)?;
    Ok(())
}
