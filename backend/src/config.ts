import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// 개인용 단일 서버 전제 - 바뀔 일 없는 값은 상수로 고정
// 포트는 dogroo(4746)·donoti(4646)와 안 겹치게 docook의 D(4)·C(3)를 딴 4346/4347 사용
const PORT = 4346;
const HOST = '0.0.0.0';
const TZ = 'Asia/Seoul';

// 데이터 디렉토리 (SQLite + photos/) - 도커에서만 /data로 주입
const dataDir = process.env.DATA_DIR ?? './data';
mkdirSync(join(dataDir, 'photos'), { recursive: true });

function newSecret(): string {
  return randomBytes(32).toString('hex');
}

// 세션 시크릿은 최초 기동 시 자동 생성해 데이터 디렉토리에 보관 (env 불필요)
function loadSecretFile(name: string): string {
  const file = join(dataDir, name);
  if (existsSync(file)) return readFileSync(file, 'utf-8').trim();
  const secret = newSecret();
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

// API 토큰 - Claude(레시피 등록)가 Authorization: Bearer 로 사용.
// 설정 화면에서 확인·재발급한다
let apiToken = loadSecretFile('.api-token');

export function getApiToken(): string {
  return apiToken;
}

export function regenerateApiToken(): string {
  apiToken = newSecret();
  writeFileSync(join(dataDir, '.api-token'), apiToken, { mode: 0o600 });
  return apiToken;
}

export const config = {
  port: PORT,
  host: HOST,
  tz: TZ,
  dataDir,
  sessionSecret: loadSecretFile('.session-secret'),
  initialUsername: process.env.INITIAL_USERNAME,
  initialPassword: process.env.INITIAL_PASSWORD,
} as const;
