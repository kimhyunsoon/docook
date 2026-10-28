import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { config } from '../config.js';
import { requireAuth } from '../auth.js';
import { isValidDate, todayStr } from '../dates.js';

// 먹은 날짜로 허용: 유효한 날짜 + 미래 아님 (소급 기록은 제한 없음)
export function checkEatenOn(date: unknown): string | null {
  const at = date ?? todayStr(config.tz);
  if (!isValidDate(at) || at > todayStr(config.tz)) return null;
  return at;
}

// 같은 날 두 번 기록해도 1건 (UNIQUE recipe_id, eaten_on)
export function recordMeal(recipeId: number | string, eatenOn: string): void {
  db.prepare('INSERT OR IGNORE INTO meals (recipe_id, eaten_on) VALUES (?, ?)').run(recipeId, eatenOn);
}

export async function mealRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  app.post<{ Params: { id: string }; Body: { eaten_on?: string } | null }>(
    '/recipes/:id/meals',
    async (req, reply) => {
      const at = checkEatenOn(req.body?.eaten_on);
      if (!at) return reply.code(400).send({ error: 'invalid_date' });
      if (!db.prepare('SELECT 1 FROM recipes WHERE id = ?').get(req.params.id)) {
        return reply.code(404).send({ error: 'not_found' });
      }
      recordMeal(req.params.id, at);
      return reply.code(201).send({ eaten_on: at });
    },
  );

  // 날짜로 취소 ('today' = 오늘) - 목록의 체크 버튼 재탭. 그날 사진은 남는다
  app.delete<{ Params: { id: string; date: string } }>('/recipes/:id/meals/:date', async (req) => {
    const date = req.params.date === 'today' ? todayStr(config.tz) : req.params.date;
    db.prepare('DELETE FROM meals WHERE recipe_id = ? AND eaten_on = ?').run(req.params.id, date);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/meals/:id', async (req) => {
    db.prepare('DELETE FROM meals WHERE id = ?').run(req.params.id);
    return { ok: true };
  });

  // 달력용 기간 조회 - 썸네일은 그날 찍은 사진 우선, 없으면 요리 대표 사진
  app.get<{ Querystring: { from?: string; to?: string } }>('/meals', async (req, reply) => {
    const { from, to } = req.query;
    if (!isValidDate(from) || !isValidDate(to)) return reply.code(400).send({ error: 'invalid_range' });
    return db
      .prepare(
        `SELECT m.id, m.recipe_id, m.eaten_on, r.name, r.category,
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
         ORDER BY m.eaten_on, m.created_at`,
      )
      .all(from, to);
  });
}
