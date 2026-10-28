import argon2 from 'argon2';
import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getApiToken } from './config.js';

declare module 'fastify' {
  interface Session {
    userId?: number;
  }
}

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return argon2.verify(hash, plain);
}

// Authorization: Bearer <API 토큰> (Claude 레시피 등록용)
function hasValidToken(req: FastifyRequest): boolean {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice(7).trim());
  const expected = Buffer.from(getApiToken());
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// 로그인 필수 라우트용 preHandler - 세션 쿠키 또는 API 토큰
export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (req.session.userId || hasValidToken(req)) return;
  await reply.code(401).send({ error: 'unauthorized' });
}

// 세션 전용 (API 토큰 확인·재발급처럼 토큰 자체를 다루는 라우트)
export async function requireSession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!req.session.userId) {
    await reply.code(401).send({ error: 'unauthorized' });
  }
}
