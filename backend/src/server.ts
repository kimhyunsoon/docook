import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import session from '@fastify/session';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { resolve } from 'node:path';
import { config } from './config.js';
import { db, migrate } from './db.js';
import { SqliteSessionStore } from './session-store.js';
import { hashPassword, requireAuth } from './auth.js';
import { vocab } from './vocab.js';
import { authRoutes } from './routes/auth.js';
import { recipeRoutes } from './routes/recipes.js';
import { ingredientRoutes } from './routes/ingredients.js';
import { mealRoutes } from './routes/meals.js';
import { photoRoutes } from './routes/photos.js';
import { settingsRoutes } from './routes/settings.js';

// users 테이블이 비어있으면 env의 초기 계정 생성
async function bootstrapInitialUser(): Promise<void> {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
  if (count.c > 0) return;
  if (!config.initialUsername || !config.initialPassword) return;
  const hash = await hashPassword(config.initialPassword);
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(
    config.initialUsername,
    hash,
  );
}

async function buildServer(): Promise<FastifyInstance> {
  // trustProxy: Caddy 뒤에서 X-Forwarded-Proto를 신뢰해야 secure 세션 쿠키가 발급된다
  const app = Fastify({ logger: true, trustProxy: true });

  await app.register(cookie);
  await app.register(session, {
    secret: config.sessionSecret,
    store: new SqliteSessionStore(),
    saveUninitialized: false, // 로그인 전 요청은 세션을 만들지 않음
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 90, // 로그인 유지 90일
    },
  });
  // 사진 + 축소본 2개 파트
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 2 } });

  app.get('/api/health', async (): Promise<{ ok: boolean }> => ({ ok: true }));
  app.get('/api/vocab', { preHandler: requireAuth }, async () => vocab());

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(recipeRoutes, { prefix: '/api/recipes' });
  await app.register(ingredientRoutes, { prefix: '/api/ingredients' });
  await app.register(mealRoutes, { prefix: '/api' });
  await app.register(photoRoutes, { prefix: '/api' });
  await app.register(settingsRoutes, { prefix: '/api/settings' });

  // 사진 파일 서빙 (/api/files/photos/... → DATA_DIR/photos/...) - 로그인 필수
  await app.register(
    async (scope) => {
      scope.addHook('preHandler', requireAuth);
      await scope.register(fastifyStatic, {
        root: resolve(config.dataDir, 'photos'),
        prefix: '/files/photos/',
        decorateReply: false,
        maxAge: '30d', // 파일명이 업로드마다 고유하므로 길게 캐시
        immutable: true,
      });
    },
    { prefix: '/api' },
  );

  return app;
}

async function main(): Promise<void> {
  migrate();
  await bootstrapInitialUser();
  const app = await buildServer();
  await app.listen({ port: config.port, host: config.host });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
