import type { FastifyInstance, FastifyReply } from 'fastify';
import { unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../db.js';
import { config } from '../config.js';
import { requireAuth } from '../auth.js';
import { addDays, todayStr } from '../dates.js';
import { resolveRecipe, saveRecipe } from '../recipe-input.js';

// 목록용 - 대표 사진은 지정(is_primary) 우선, 없으면 최근 사진 (상세와 같은 정렬)
// recent_meals: 목록의 미니 그래프용 최근 12주 먹은 날짜
// main_ingredients: 목록 표시용 (양념·향신료·대체 재료 제외), ingredient_names: 검색용 전체
const LIST_SQL = `
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
FROM recipes r`;

interface ListRow {
  id: number;
  recent_meals: string | null;
  ingredient_names: string | null;
  main_ingredients: string | null;
}

const split = (v: string | null, sep: string): string[] => (v ? v.split(sep) : []);

function listRecipes(): unknown[] {
  const since = addDays(todayStr(config.tz), -7 * 12);
  const rows = db.prepare(LIST_SQL + ' ORDER BY r.name').all({ since }) as ListRow[];
  return rows.map((r) => ({
    ...r,
    recent_meals: split(r.recent_meals, ',').sort(),
    ingredient_names: split(r.ingredient_names, '|'),
    main_ingredients: split(r.main_ingredients, '|'),
  }));
}

function getRecipe(id: string | number): unknown {
  const recipe = db.prepare('SELECT * FROM recipes WHERE id = ?').get(id);
  if (!recipe) return null;
  const ingredients = db
    .prepare(
      `SELECT ri.id, ri.ingredient_id, i.name, i.category, ri.section, ri.amount, ri.unit, ri.note, ri.optional, ri.alternative
       FROM recipe_ingredients ri JOIN ingredients i ON i.id = ri.ingredient_id
       WHERE ri.recipe_id = ? ORDER BY ri.sort`,
    )
    .all(id);
  const steps = db
    .prepare('SELECT step_no, method, text, minutes FROM recipe_steps WHERE recipe_id = ? ORDER BY step_no')
    .all(id);
  const meals = db
    .prepare('SELECT id, eaten_on FROM meals WHERE recipe_id = ? ORDER BY eaten_on DESC')
    .all(id);
  const photos = db
    .prepare('SELECT * FROM photos WHERE recipe_id = ? ORDER BY taken_on DESC, id DESC')
    .all(id) as { id: number; is_primary: number }[];
  // 대표 사진: 지정 우선, 없으면 최근 사진
  const primary = photos.find((p) => p.is_primary === 1) ?? photos[0] ?? null;
  return { ...recipe, ingredients, steps, meals, photos, primary_photo_id: primary?.id ?? null };
}

function sendValidation(reply: FastifyReply, errors: string[]): FastifyReply {
  return reply.code(400).send({ error: 'validation', details: errors });
}

function isUniqueNameError(err: unknown): boolean {
  return String((err as Error).message).includes('UNIQUE constraint failed: recipes.name');
}

export async function recipeRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/', async () => listRecipes());

  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const recipe = getRecipe(req.params.id);
    if (!recipe) return reply.code(404).send({ error: 'not_found' });
    return recipe;
  });

  // 등록 (앱 UI 없음 - Claude 레시피 등록 전용). ?dry_run=1 이면 해석 결과만 돌려준다
  app.post<{ Querystring: { dry_run?: string } }>('/', async (req, reply) => {
    const { recipe, errors } = resolveRecipe(req.body);
    if (!recipe) return sendValidation(reply, errors);
    const existing = db.prepare('SELECT id FROM recipes WHERE name = ?').get(recipe.name) as
      | { id: number }
      | undefined;
    if (existing) {
      return reply.code(409).send({ error: 'duplicate_name', id: existing.id, hint: 'PUT /api/recipes/:id 로 수정' });
    }
    if (req.query.dry_run === '1') return { dry_run: true, recipe };
    const result = db.transaction(() => saveRecipe(recipe))();
    return reply.code(201).send({ ...result, recipe: getRecipe(result.id) });
  });

  // 전체 교체 수정
  app.put<{ Params: { id: string }; Querystring: { dry_run?: string } }>('/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM recipes WHERE id = ?').get(id)) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const { recipe, errors } = resolveRecipe(req.body);
    if (!recipe) return sendValidation(reply, errors);
    if (req.query.dry_run === '1') return { dry_run: true, recipe };
    try {
      const result = db.transaction(() => saveRecipe(recipe, id))();
      return { ...result, recipe: getRecipe(id) };
    } catch (err) {
      if (isUniqueNameError(err)) return reply.code(409).send({ error: 'duplicate_name' });
      throw err;
    }
  });

  // 삭제 - 먹은 기록·사진 파일까지 함께 정리
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const photos = db
      .prepare('SELECT path, thumb_path FROM photos WHERE recipe_id = ?')
      .all(req.params.id) as { path: string; thumb_path: string | null }[];
    const result = db.prepare('DELETE FROM recipes WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return reply.code(404).send({ error: 'not_found' });
    for (const p of photos) {
      for (const file of [p.path, p.thumb_path]) {
        if (!file) continue;
        try {
          unlinkSync(join(config.dataDir, file));
        } catch {
          // 파일이 이미 없어도 무시
        }
      }
    }
    return { ok: true };
  });
}
