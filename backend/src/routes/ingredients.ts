import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { requireAuth } from '../auth.js';
import { INGREDIENT_CATEGORIES } from '../vocab.js';
import { findIngredient } from '../recipe-input.js';

interface IngredientBody {
  name?: string;
  category?: string;
  aliases?: string[]; // 생성 시 별칭
  add_aliases?: string[];
  remove_aliases?: string[];
}

interface Row {
  id: number;
  name: string;
  category: string;
  aliases: string | null;
  recipe_count: number;
}

// 재료 마스터 - Claude 레시피 등록이 정규화 전에 조회하고, 필요하면 별칭 추가·병합으로 정리한다
export async function ingredientRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.get('/', async () => {
    const rows = db
      .prepare(
        `SELECT i.id, i.name, i.category,
          (SELECT GROUP_CONCAT(alias, '|') FROM ingredient_aliases a WHERE a.ingredient_id = i.id) AS aliases,
          (SELECT COUNT(DISTINCT recipe_id) FROM recipe_ingredients ri WHERE ri.ingredient_id = i.id) AS recipe_count
         FROM ingredients i ORDER BY i.category, i.name`,
      )
      .all() as Row[];
    return rows.map((r) => ({ ...r, aliases: r.aliases ? r.aliases.split('|') : [] }));
  });

  // 이름(별칭 포함) → 표준 재료 해석
  app.get<{ Querystring: { name?: string } }>('/resolve', async (req, reply) => {
    const found = req.query.name ? findIngredient(req.query.name) : null;
    if (!found) return reply.code(404).send({ error: 'not_found' });
    return found;
  });

  app.post<{ Body: IngredientBody }>('/', async (req, reply) => {
    const name = req.body.name?.trim();
    const category = req.body.category ?? '기타';
    if (!name) return reply.code(400).send({ error: 'name_required' });
    if (!INGREDIENT_CATEGORIES.includes(category as never)) {
      return reply.code(400).send({ error: 'invalid_category' });
    }
    const existing = findIngredient(name);
    if (existing) return reply.code(409).send({ error: 'exists', ingredient: existing });
    try {
      const id = db.transaction(() => {
        const newId = Number(
          db.prepare('INSERT INTO ingredients (name, category) VALUES (?, ?)').run(name, category).lastInsertRowid,
        );
        addAliases(newId, req.body.aliases ?? []);
        return newId;
      })();
      return await reply.code(201).send({ id });
    } catch (err) {
      return reply.code(409).send({ error: 'conflict', message: String((err as Error).message) });
    }
  });

  app.patch<{ Params: { id: string }; Body: IngredientBody }>('/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM ingredients WHERE id = ?').get(id)) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const b = req.body;
    if (b.category !== undefined && !INGREDIENT_CATEGORIES.includes(b.category as never)) {
      return reply.code(400).send({ error: 'invalid_category' });
    }
    try {
      db.transaction(() => {
        if (b.name?.trim()) db.prepare('UPDATE ingredients SET name = ? WHERE id = ?').run(b.name.trim(), id);
        if (b.category) db.prepare('UPDATE ingredients SET category = ? WHERE id = ?').run(b.category, id);
        addAliases(id, b.add_aliases ?? []);
        const remove = db.prepare('DELETE FROM ingredient_aliases WHERE alias = ? AND ingredient_id = ?');
        for (const alias of b.remove_aliases ?? []) remove.run(alias, id);
      })();
    } catch (err) {
      return reply.code(409).send({ error: 'conflict', message: String((err as Error).message) });
    }
    return { ok: true };
  });

  // 중복 재료 병합: 이 재료를 into_id로 합치고 이름·별칭은 into의 별칭이 된다
  app.post<{ Params: { id: string }; Body: { into_id: number } }>('/:id/merge', async (req, reply) => {
    const from = db.prepare('SELECT id, name FROM ingredients WHERE id = ?').get(req.params.id) as
      | { id: number; name: string }
      | undefined;
    const into = db.prepare('SELECT id FROM ingredients WHERE id = ?').get(req.body.into_id) as
      | { id: number }
      | undefined;
    if (!from || !into || from.id === into.id) return reply.code(400).send({ error: 'invalid_target' });
    db.transaction(() => {
      db.prepare('UPDATE recipe_ingredients SET ingredient_id = ? WHERE ingredient_id = ?').run(into.id, from.id);
      db.prepare('UPDATE ingredient_aliases SET ingredient_id = ? WHERE ingredient_id = ?').run(into.id, from.id);
      db.prepare('DELETE FROM ingredients WHERE id = ?').run(from.id);
      db.prepare('INSERT OR REPLACE INTO ingredient_aliases (alias, ingredient_id) VALUES (?, ?)').run(
        from.name,
        into.id,
      );
    })();
    return { ok: true };
  });

  // 사용 중이 아닌 재료만 삭제 가능
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const used = db.prepare('SELECT 1 FROM recipe_ingredients WHERE ingredient_id = ? LIMIT 1').get(req.params.id);
    if (used) return reply.code(409).send({ error: 'in_use' });
    db.prepare('DELETE FROM ingredients WHERE id = ?').run(req.params.id);
    return { ok: true };
  });
}

function addAliases(id: number, aliases: string[]): void {
  const insert = db.prepare('INSERT INTO ingredient_aliases (alias, ingredient_id) VALUES (?, ?)');
  for (const raw of aliases) {
    const alias = raw.trim();
    if (!alias) continue;
    const owner = findIngredient(alias);
    if (owner && owner.id !== id) throw new Error(`'${alias}'는 이미 '${owner.name}'의 이름·별칭`);
    if (!owner) insert.run(alias, id);
  }
}
