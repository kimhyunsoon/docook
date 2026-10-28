# docook 아키텍처

## 스택

dogroo·donoti와 같은 구조다.

- **backend**: TypeScript ESM + Fastify 5 + better-sqlite3(WAL). 포트 4346 (상수). 세션 쿠키 인증(argon2id + SQLite 세션 스토어) **또는 API 토큰**(`Authorization: Bearer`, Claude 레시피 등록용).
- **frontend**: Lit 3 + Vite 6. dev 포트 4347, `/api` 프록시로 로컬·프로덕션 모두 동일 오리진.
- **DB**: 단일 SQLite 파일 (`{DATA_DIR}/docook.db`). 마이그레이션 도구 없음 - `schema.sql`(IF NOT EXISTS) + `ingredient-pool.sql`(기본 재료·별칭, ON CONFLICT 무시)을 기동 시마다 적용. 기존 DB 컬럼 추가는 `db.ts`의 `migrate()`에 `PRAGMA table_info` 분기로.
- **시크릿**: 세션 시크릿·API 토큰은 최초 기동 시 자동 생성해 데이터 디렉토리에 보관 (`.session-secret`, `.api-token`). API 토큰은 설정 화면에서 확인·재발급(세션 전용 라우트). env로 관리할 시크릿은 초기 계정뿐.

## 리포 구조

```
docook/
├── assets/                  # 로고 SVG 원본 + webp + 생성기(generate-logo.mjs)
├── backend/src/
│   ├── server.ts            # 부트스트랩 (라우트 등록, 최초 계정, /api/vocab, 사진 파일 서빙)
│   ├── config.ts            # 상수 + 시크릿·API 토큰 자동 생성
│   ├── auth.ts              # requireAuth(세션|토큰) / requireSession
│   ├── vocab.ts             # 정규화 고정 어휘 (요리 분류·재료 분류·단위·조리 동작)
│   ├── recipe-input.ts      # 등록 입력 검증 + 재료 표준명 해석 + 저장
│   ├── schema.sql / ingredient-pool.sql
│   └── routes/              # auth · recipes · ingredients · meals · photos · settings
├── frontend/src/
│   ├── app-root.ts          # 해시 라우터 (#/recipes #/recipes/:id #/calendar #/settings #/login)
│   ├── actions.ts           # 먹은 기록·사진 업로드 공용 동작
│   ├── components/          # tab-bar · recipe-item(목록 행 + 12주 미니 그래프)
│   ├── sheets/              # sheet-base · meal-sheet(날짜+사진) · date-sheet(월 달력) · photo-lightbox
│   └── views/               # login · recipes · recipe-detail · calendar · settings
├── deploy/                  # docker-compose.yml + deploy.sh (donoti와 동일)
├── docs/                    # architecture · recipe-registration(Claude 등록 절차) · recipe-normalization(정규화 규칙) · server-setup.sh
└── CLAUDE.md                # Claude Code 진입점 - 등록 요청 시 docs 절차로 안내 (.claude/는 전역 gitignore라 쓰지 않음)
```

## 테이블

| 테이블 | 요점 |
|---|---|
| `users` | 초기 계정 1개 (env로 부트스트랩, 회원가입 없음) |
| `sessions` | session-store.ts가 자체 생성. 재배포에도 로그인 유지 |
| `ingredients` | 재료 마스터 - 표준명(UNIQUE) + 재료 분류 |
| `ingredient_aliases` | 별칭 → 표준 재료. 해석은 공백 무시 비교 (`다진마늘` = `다진 마늘`) |
| `recipes` | 요리 - 이름(UNIQUE, 대소문자 무시)·분류·한 줄 소개·팁 |
| `recipe_ingredients` | 요리별 재료 - section(묶음)·amount+unit(정량일 때만)·note(손질 상태)·optional·alternative(바로 앞 재료 대신, "A 혹은 B")·sort |
| `recipe_steps` | 조리 순서 - step_no·method(고정 어휘, 선택)·text·minutes(선택) |
| `meals` | 먹은 기록 - (recipe_id, eaten_on) UNIQUE라 같은 날 중복 체크는 1건. 날짜는 KST `YYYY-MM-DD`, 미래 불가·소급 제한 없음 |
| `photos` | 요리 사진 - taken_on(날짜)·is_primary(명시 대표)·thumb_path(클라이언트 축소본) |

## 핵심 규칙

- **레시피 등록·수정·삭제는 API 전용** (앱 UI 없음). `POST /api/recipes`(`?dry_run=1`로 검증만), `PUT /api/recipes/:id`(전체 교체), `DELETE`. 검증 오류는 `400 {error:'validation', details:[항목별 사유]}`로 모아 돌려준다 - Claude가 스스로 고치게. 마스터에 없는 재료는 `category`를 명시해야만 생성되고 응답 `created_ingredients`로 보고된다.
- **사진 = 먹은 기록**: 사진을 올리면(또는 날짜를 바꾸면) 그 날짜의 먹은 기록이 함께 생긴다. 먹은 기록을 지워도 사진은 남는다.
- **대표 사진**: `is_primary` 지정 사진, 없으면 최근 사진(`ORDER BY is_primary DESC, taken_on DESC, id DESC`). 목록·상세·달력이 같은 정렬을 쓴다. 대표 해제 = 최근 사진으로 복귀.
- **사진 업로드**: 클라이언트가 원본을 긴 변 2048px JPEG로, 축소본을 480px로 줄여 multipart(`taken_on` 필드 → `file` → `thumb`)로 보낸다. 디코딩 못 하는 포맷은 원본 그대로. 파일은 `{DATA_DIR}/photos/`, `/api/files/photos/*`로 로그인 필수 서빙(파일명 고유 → 30일 immutable 캐시).
- **목록**: 분류별 그룹 / 정렬 목록(최근 먹은·오래 안 먹은·많이 먹은·이름), 'n일 전 먹음' + 최근 12주 미니 그래프(한 칸 = 한 주). 먹음 버튼 탭 = 날짜·사진 시트(상세의 '먹었어요' 버튼도 동일), 오늘 이미 먹었으면 흐린 버튼(재탭 = 취소).
- **상세**: 대표 사진(없으면 영역 없음), 재료의 대체 재료는 `A / 혹은 B`로 한 줄 묶음, 마지막·횟수·평균 간격, 재료(묶음별)·조리 순서·팁, 먹은 기록 히트맵(26주, 사진 있는 날 진하게)/목록, 날짜별 사진(라이트박스에서 대표 지정·삭제).
- **화면 폭**: PC에서도 모바일 폭(`--app-w` 480px, index.html)으로 가운데 표시. 탭바·바텀시트·라이트박스도 같은 폭.
- **달력**: 월 달력에 날짜별 썸네일(그날 사진 우선), 날짜 탭 → 그날 먹은 요리 목록. `GET /api/meals?from&to`.

## 배포 토폴로지

리버스 프록시(80/443·TLS·웹훅 라우팅)는 **dogroo 리포의 `gateway/`** 공용 caddy가 담당한다. 이 리포의 compose는 backend/frontend 컨테이너만 정의하고 external 네트워크 `gateway`에 참여한다.

```
인터넷 ─ docook.sudosoon.org (Cloudflare DNS, gateway의 cf-ddns가 갱신)
  [gateway-caddy]  ─ HTTPS 자동 인증서
    ├ /api/*       → docook-backend:4346
    ├ /deploy/hook → host:9099 (gateway 소속 systemd webhook → deploy/deploy.sh)
    └ /*           → docook-frontend:80 (컨테이너 내부 caddy가 SPA fallback)
  [docook-backend] ─ /root/workspace/docook-data ↔ /data (docook.db, photos/, .session-secret, .api-token)
```

- `container_name`(docook-backend/docook-frontend)은 gateway Caddyfile이 참조하므로 변경 금지.
- gateway Caddyfile의 docook 블록은 `{$DOCOOK_DOMAIN:docook.sudosoon.org}` 기본값 문법 - caddy.env에 도메인을 넣기 전에 dogroo가 먼저 배포돼도 다른 사이트가 깨지지 않는다.
- 서버 env: `/etc/docook/backend.env` (`INITIAL_USERNAME`, `INITIAL_PASSWORD`), chmod 600.
- 백업 = `/root/workspace/docook-data` 디렉토리 복사.

## CI/CD

push to main → GitHub Actions가 backend/frontend 빌드 검증 → 성공 시 `https://docook.sudosoon.org/deploy/hook` 웹훅 호출 (Secrets: `DEPLOY_URL`, `DEPLOY_KEY`) → 서버 webhook이 `deploy/deploy.sh` 실행 (`git reset --hard FETCH_HEAD` + `docker compose up -d --build --remove-orphans`). 로그: `/var/log/docook-deploy.log`.

## 서버 셋업

순서가 중요하다:

1. **dogroo push** - gateway 변경(Caddyfile 사이트 블록·hooks.json 훅·cf-ddns 레코드)이 dogroo 배포로 서버에 반영된다.
2. **docook push** (첫 push는 Secrets가 없어 웹훅 단계만 실패 - 정상).
3. 서버(root)에서 `bash docs/server-setup.sh` - 클론이 없으면 `git clone git@github.com:kimhyunsoon/docook.git /root/workspace/docook` 후 실행하거나 스크립트를 직접 받아 실행. 클론·env·DEPLOY_KEY_DOCOOK 생성·DNS·빌드·기동·caddy 반영·webhook 재시작을 한다 (재실행 안전).
4. GitHub Secrets 등록 (`DEPLOY_URL`, `DEPLOY_KEY` - 스크립트 출력) → 이후 push부터 자동 배포.
