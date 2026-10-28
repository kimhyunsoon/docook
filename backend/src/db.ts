import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';
import { RECIPE_CATEGORIES } from './vocab.js';

export const db: Database.Database = new Database(join(config.dataDir, 'docook.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 스키마 + 기본 재료 풀 적용 (IF NOT EXISTS / ON CONFLICT 기반이라 기동 시마다 실행해도 안전)
// 기존 DB 컬럼 추가가 필요해지면 여기에 PRAGMA table_info 분기로 추가한다
export function migrate(): void {
  const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf-8');
  db.exec(schema);
  const cols = (table: string): string[] =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  if (!cols('recipe_ingredients').includes('alternative')) {
    db.exec('ALTER TABLE recipe_ingredients ADD COLUMN alternative INTEGER NOT NULL DEFAULT 0');
  }
  // 원문 보존은 폐기 (2026-10-27)
  if (cols('recipes').includes('original_text')) db.exec('ALTER TABLE recipes DROP COLUMN original_text');
  // 팁도 폐기 (2026-10-27)
  if (cols('recipes').includes('tips')) db.exec('ALTER TABLE recipes DROP COLUMN tips');
  if (!cols('recipes').includes('servings')) db.exec('ALTER TABLE recipes ADD COLUMN servings INTEGER');
  // 요리 분류를 나라 기준으로 변경 (2026-10-28) - 옛 분류는 퓨전으로 옮긴 뒤 다시 분류
  db.prepare(
    `UPDATE recipes SET category = '퓨전' WHERE category NOT IN (${RECIPE_CATEGORIES.map(() => '?').join(', ')})`,
  ).run(...RECIPE_CATEGORIES);
  const pool = readFileSync(new URL('./ingredient-pool.sql', import.meta.url), 'utf-8');
  db.exec(pool);
}
