import { db } from './db.js';
import { INGREDIENT_CATEGORIES, METHODS, RECIPE_CATEGORIES, UNITS } from './vocab.js';

// 레시피 등록·수정 입력 검증 + 재료 표준명 해석
// Claude 레시피 등록이 오류를 보고 스스로 고칠 수 있게 오류는 항목별 문자열로 모은다

export interface IngredientInput {
  name: string;
  amount?: number | null;
  unit?: string | null;
  note?: string | null;
  section?: string | null;
  optional?: boolean;
  alternative?: boolean; // 바로 앞 재료 대신 (같은 묶음 안에서만)
  category?: string; // 마스터에 없는 새 재료를 만들 때만 (명시해야 생성됨)
}

export interface StepInput {
  text: string;
  method?: string | null;
  minutes?: number | null;
}

export interface RecipeInput {
  name: string;
  category?: string;
  summary?: string | null;
  servings?: number | null;
  ingredients?: IngredientInput[];
  steps?: StepInput[];
}

export interface ResolvedIngredient {
  ingredient_id: number | null; // null = 새로 생성 예정
  name: string; // 표준명
  input_name: string;
  matched: 'name' | 'alias' | 'new';
  category: string;
  amount: number | null;
  unit: string | null;
  note: string | null;
  section: string | null;
  optional: boolean;
  alternative: boolean;
}

export interface ResolvedRecipe {
  name: string;
  category: string;
  summary: string | null;
  servings: number | null;
  ingredients: ResolvedIngredient[];
  steps: { step_no: number; method: string | null; text: string; minutes: number | null }[];
}

const includes = (list: readonly string[], v: unknown): boolean => typeof v === 'string' && list.includes(v);

function textOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

// 공백 차이는 같은 재료로 본다 (다진마늘 = 다진 마늘)
const squash = (s: string): string => s.replace(/\s+/g, '');

export function findIngredient(
  name: string,
): { id: number; name: string; category: string; matched: 'name' | 'alias' } | null {
  const key = squash(name);
  const byName = db
    .prepare(`SELECT id, name, category FROM ingredients WHERE REPLACE(name, ' ', '') = ?`)
    .get(key) as { id: number; name: string; category: string } | undefined;
  if (byName) return { ...byName, matched: 'name' };
  const byAlias = db
    .prepare(
      `SELECT i.id, i.name, i.category FROM ingredient_aliases a JOIN ingredients i ON i.id = a.ingredient_id
       WHERE REPLACE(a.alias, ' ', '') = ?`,
    )
    .get(key) as { id: number; name: string; category: string } | undefined;
  return byAlias ? { ...byAlias, matched: 'alias' } : null;
}

export function resolveRecipe(body: unknown): { recipe: ResolvedRecipe | null; errors: string[] } {
  const errors: string[] = [];
  const b = (body ?? {}) as Partial<RecipeInput>;
  const name = textOrNull(b.name);
  if (!name) errors.push('name: 필수');
  const category = b.category ?? '퓨전';
  if (!includes(RECIPE_CATEGORIES, category)) {
    errors.push(`category: '${String(category)}'는 허용되지 않음 (GET /api/vocab recipe_categories)`);
  }
  const servings = b.servings ?? null;
  if (servings !== null && (!Number.isInteger(servings) || servings <= 0)) {
    errors.push('servings: 양의 정수 또는 생략');
  }

  const ingredients: ResolvedIngredient[] = [];
  const seen = new Set<string>();
  (Array.isArray(b.ingredients) ? b.ingredients : []).forEach((ing, i) => {
    const at = `ingredients[${i}]`;
    const inputName = textOrNull(ing?.name);
    if (!inputName) {
      errors.push(`${at}.name: 필수`);
      return;
    }
    const amount = ing.amount ?? null;
    const unit = textOrNull(ing.unit);
    if (amount !== null && (typeof amount !== 'number' || !(amount > 0))) {
      errors.push(`${at}.amount: 양수 숫자 또는 null (비정량이면 생략)`);
    }
    if (unit !== null && !includes(UNITS, unit)) {
      errors.push(`${at}.unit: '${unit}'는 허용되지 않음 (GET /api/vocab units)`);
    }
    if ((amount === null) !== (unit === null)) {
      errors.push(`${at}: amount와 unit은 함께 쓰거나 함께 생략`);
    }
    const found = findIngredient(inputName);
    let resolvedName = inputName;
    let ingCategory = '기타';
    if (found) {
      resolvedName = found.name;
      ingCategory = found.category;
    } else if (ing.category === undefined) {
      errors.push(
        `${at}.name: '${inputName}'는 재료 마스터에 없음 - 기존 재료(별칭 포함)로 바꾸거나, 새 재료면 category를 지정`,
      );
    } else if (!includes(INGREDIENT_CATEGORIES, ing.category)) {
      errors.push(`${at}.category: '${String(ing.category)}'는 허용되지 않음 (GET /api/vocab ingredient_categories)`);
    } else {
      ingCategory = ing.category;
    }
    const section = textOrNull(ing.section);
    const dupKey = `${section ?? ''}|${resolvedName}`;
    if (seen.has(dupKey)) errors.push(`${at}: '${resolvedName}'가 같은 묶음에 중복`);
    seen.add(dupKey);
    const alternative = ing.alternative === true;
    const prev = ingredients[ingredients.length - 1];
    if (alternative && (!prev || prev.section !== section)) {
      errors.push(`${at}.alternative: 같은 묶음의 바로 앞 재료가 있어야 함`);
    }
    ingredients.push({
      ingredient_id: found?.id ?? null,
      name: resolvedName,
      input_name: inputName,
      matched: found?.matched ?? 'new',
      category: ingCategory,
      amount: typeof amount === 'number' ? amount : null,
      unit,
      note: textOrNull(ing.note),
      section,
      optional: ing.optional === true,
      alternative,
    });
  });

  const steps: ResolvedRecipe['steps'] = [];
  (Array.isArray(b.steps) ? b.steps : []).forEach((st, i) => {
    const at = `steps[${i}]`;
    const text = textOrNull(st?.text);
    if (!text) {
      errors.push(`${at}.text: 필수`);
      return;
    }
    const method = textOrNull(st.method);
    if (method !== null && !includes(METHODS, method)) {
      errors.push(`${at}.method: '${method}'는 허용되지 않음 (GET /api/vocab methods, 애매하면 생략)`);
    }
    const minutes = st.minutes ?? null;
    if (minutes !== null && (!Number.isInteger(minutes) || minutes <= 0)) {
      errors.push(`${at}.minutes: 양의 정수 또는 생략`);
    }
    steps.push({ step_no: steps.length + 1, method, text, minutes });
  });

  if (errors.length > 0 || !name) return { recipe: null, errors };
  return {
    recipe: {
      name,
      category,
      summary: textOrNull(b.summary),
      servings,
      ingredients,
      steps,
    },
    errors,
  };
}

// 검증된 레시피 저장 (recipeId가 있으면 전체 교체). 트랜잭션 안에서 호출할 것
export function saveRecipe(
  r: ResolvedRecipe,
  recipeId?: number,
): { id: number; created_ingredients: string[] } {
  const created: string[] = [];
  const insertIngredient = db.prepare('INSERT INTO ingredients (name, category) VALUES (?, ?)');
  for (const ing of r.ingredients) {
    if (ing.ingredient_id !== null) continue;
    // 같은 요청 안에서 이미 만든 새 재료면 재사용
    const again = findIngredient(ing.name);
    if (again) {
      ing.ingredient_id = again.id;
      continue;
    }
    ing.ingredient_id = Number(insertIngredient.run(ing.name, ing.category).lastInsertRowid);
    created.push(ing.name);
  }

  let id = recipeId;
  if (id === undefined) {
    id = Number(
      db
        .prepare('INSERT INTO recipes (name, category, summary, servings) VALUES (?, ?, ?, ?)')
        .run(r.name, r.category, r.summary, r.servings).lastInsertRowid,
    );
  } else {
    db.prepare(
      `UPDATE recipes SET name = ?, category = ?, summary = ?, servings = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(r.name, r.category, r.summary, r.servings, id);
    db.prepare('DELETE FROM recipe_ingredients WHERE recipe_id = ?').run(id);
    db.prepare('DELETE FROM recipe_steps WHERE recipe_id = ?').run(id);
  }

  const insertRi = db.prepare(
    `INSERT INTO recipe_ingredients (recipe_id, ingredient_id, section, amount, unit, note, optional, alternative, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  r.ingredients.forEach((ing, i) => {
    insertRi.run(id, ing.ingredient_id, ing.section, ing.amount, ing.unit, ing.note, ing.optional ? 1 : 0, ing.alternative ? 1 : 0, i);
  });
  const insertStep = db.prepare(
    'INSERT INTO recipe_steps (recipe_id, step_no, method, text, minutes) VALUES (?, ?, ?, ?, ?)',
  );
  for (const st of r.steps) insertStep.run(id, st.step_no, st.method, st.text, st.minutes);
  return { id, created_ingredients: created };
}
