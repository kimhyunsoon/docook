import type { FastifyInstance } from 'fastify';
import { requireSession } from '../auth.js';
import { getApiToken, regenerateApiToken } from '../config.js';

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  // API 토큰은 로그인 세션에서만 조회·재발급 (토큰으로 토큰을 꺼낼 수 없게)
  app.addHook('preHandler', requireSession);

  app.get('/api-token', async () => ({ token: getApiToken() }));

  app.post('/api-token/regenerate', async () => ({ token: regenerateApiToken() }));
}
