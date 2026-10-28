-- docook 데이터 모델 (IF NOT EXISTS 기반 - 기동 시마다 적용)

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,            -- argon2id
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 재료 마스터 (표준명). 표기가 다른 같은 재료는 ingredient_aliases로 흡수
CREATE TABLE IF NOT EXISTS ingredients (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,         -- 표준명 (예: 대파)
  category   TEXT NOT NULL DEFAULT '기타', -- vocab.ts INGREDIENT_CATEGORIES
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ingredient_aliases (
  alias         TEXT PRIMARY KEY,          -- 별칭 (예: 파) → 표준 재료
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS recipes (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  category      TEXT NOT NULL DEFAULT '퓨전', -- vocab.ts RECIPE_CATEGORIES
  summary       TEXT,                      -- 한 줄 소개
  servings      INTEGER,                   -- 몇 인분 기준 (원문에 있을 때만)
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recipe_ingredients (
  id            INTEGER PRIMARY KEY,
  recipe_id     INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  section       TEXT,                      -- 묶음 (예: 양념장) - 없으면 주재료
  amount        REAL,                      -- 정량일 때만 (비정량은 NULL)
  unit          TEXT,                      -- vocab.ts UNITS, amount와 짝
  note          TEXT,                      -- 손질 상태 등 (예: 송송 썬)
  optional      INTEGER NOT NULL DEFAULT 0,
  alternative   INTEGER NOT NULL DEFAULT 0, -- 1 = 바로 앞 재료 대신 쓸 수 있음 ("피망 2개 혹은 오이고추 5개")
  sort          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS recipe_steps (
  id        INTEGER PRIMARY KEY,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  step_no   INTEGER NOT NULL,
  method    TEXT,                          -- vocab.ts METHODS (대표 동작 1개)
  text      TEXT NOT NULL,
  minutes   INTEGER                        -- 소요 시간이 명시된 경우만
);

-- 먹은 기록 (요리 × 날짜 1건)
CREATE TABLE IF NOT EXISTS meals (
  id         INTEGER PRIMARY KEY,
  recipe_id  INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  eaten_on   TEXT NOT NULL,                -- YYYY-MM-DD (KST)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (recipe_id, eaten_on)
);

-- 사진은 날짜를 가진다. 사진을 올리면 그 날짜의 먹은 기록도 함께 생긴다
CREATE TABLE IF NOT EXISTS photos (
  id         INTEGER PRIMARY KEY,
  recipe_id  INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  path       TEXT NOT NULL,
  thumb_path TEXT,                         -- 목록·달력용 축소본 (클라이언트 생성)
  taken_on   TEXT NOT NULL,                -- YYYY-MM-DD
  is_primary INTEGER NOT NULL DEFAULT 0,   -- 대표 지정 (없으면 최근 사진이 대표)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe ON recipe_ingredients(recipe_id, sort);
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_ingredient ON recipe_ingredients(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_recipe_steps_recipe ON recipe_steps(recipe_id, step_no);
CREATE INDEX IF NOT EXISTS idx_meals_recipe ON meals(recipe_id, eaten_on DESC);
CREATE INDEX IF NOT EXISTS idx_meals_date ON meals(eaten_on);
CREATE INDEX IF NOT EXISTS idx_photos_recipe ON photos(recipe_id, taken_on DESC);
