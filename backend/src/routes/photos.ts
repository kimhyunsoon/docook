import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../db.js';
import { config } from '../config.js';
import { requireAuth } from '../auth.js';
import { checkEatenOn, recordMeal } from './meals.js';

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

interface PhotoRow {
  id: number;
  recipe_id: number;
  path: string;
  thumb_path: string | null;
  is_primary: number;
}

function removeFile(rel: string | null): void {
  if (!rel) return;
  try {
    unlinkSync(join(config.dataDir, rel));
  } catch {
    // 파일이 이미 없어도 무시
  }
}

export async function photoRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // 사진 업로드 (multipart: taken_on 필드 + file + thumb(선택, 클라이언트 축소본))
  // 사진 날짜 = 먹은 날짜 - 그날 먹은 기록도 함께 생성한다
  app.post<{ Params: { id: string } }>('/recipes/:id/photos', async (req, reply) => {
    if (!db.prepare('SELECT 1 FROM recipes WHERE id = ?').get(req.params.id)) {
      return reply.code(404).send({ error: 'not_found' });
    }
    let takenOn: unknown;
    const files: Record<string, { buffer: Buffer; ext: string }> = {};
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const ext = EXT_BY_MIME[part.mimetype];
        const buffer = await part.toBuffer();
        if (ext) files[part.fieldname] = { buffer, ext };
      } else if (part.fieldname === 'taken_on') {
        takenOn = part.value;
      }
    }
    const file = files.file;
    if (!file) return reply.code(400).send({ error: 'file_required' });
    const at = checkEatenOn(takenOn || undefined);
    if (!at) return reply.code(400).send({ error: 'invalid_date' });

    const base = `r${req.params.id}-${Date.now()}-${randomBytes(3).toString('hex')}`;
    const path = join('photos', `${base}.${file.ext}`);
    writeFileSync(join(config.dataDir, path), file.buffer);
    let thumbPath: string | null = null;
    if (files.thumb) {
      thumbPath = join('photos', `${base}-t.${files.thumb.ext}`);
      writeFileSync(join(config.dataDir, thumbPath), files.thumb.buffer);
    }
    const id = db.transaction(() => {
      recordMeal(req.params.id, at);
      return Number(
        db
          .prepare('INSERT INTO photos (recipe_id, path, thumb_path, taken_on) VALUES (?, ?, ?, ?)')
          .run(req.params.id, path, thumbPath, at).lastInsertRowid,
      );
    })();
    return reply.code(201).send({ id, path, thumb_path: thumbPath, taken_on: at });
  });

  // 대표 사진 지정 / 해제(해제하면 최근 사진이 대표)
  app.post<{ Params: { id: string } }>('/photos/:id/primary', async (req, reply) => {
    const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(req.params.id) as PhotoRow | undefined;
    if (!photo) return reply.code(404).send({ error: 'not_found' });
    db.transaction(() => {
      db.prepare('UPDATE photos SET is_primary = 0 WHERE recipe_id = ?').run(photo.recipe_id);
      db.prepare('UPDATE photos SET is_primary = 1 WHERE id = ?').run(photo.id);
    })();
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/photos/:id/primary', async (req) => {
    db.prepare('UPDATE photos SET is_primary = 0 WHERE id = ?').run(req.params.id);
    return { ok: true };
  });

  // 사진 날짜 변경 (그날 먹은 기록도 생성)
  app.patch<{ Params: { id: string }; Body: { taken_on?: string } }>('/photos/:id', async (req, reply) => {
    const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(req.params.id) as PhotoRow | undefined;
    if (!photo) return reply.code(404).send({ error: 'not_found' });
    const at = checkEatenOn(req.body.taken_on);
    if (!at || !req.body.taken_on) return reply.code(400).send({ error: 'invalid_date' });
    db.transaction(() => {
      db.prepare('UPDATE photos SET taken_on = ? WHERE id = ?').run(at, photo.id);
      recordMeal(photo.recipe_id, at);
    })();
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/photos/:id', async (req, reply) => {
    const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(req.params.id) as PhotoRow | undefined;
    if (!photo) return reply.code(404).send({ error: 'not_found' });
    db.prepare('DELETE FROM photos WHERE id = ?').run(photo.id);
    removeFile(photo.path);
    removeFile(photo.thumb_path);
    return { ok: true };
  });
}
