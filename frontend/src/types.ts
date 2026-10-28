export interface RecipeSummary {
  id: number;
  name: string;
  category: string;
  summary: string | null;
  created_at: string;
  last_eaten_on: string | null;
  meal_count: number;
  recent_meals: string[]; // 최근 12주 먹은 날짜 (오름차순)
  photo: string | null; // 대표 사진 (축소본 우선)
  ingredient_names: string[];
  main_ingredients: string[]; // 양념·향신료·대체 재료 제외
}

export interface RecipeIngredient {
  id: number;
  ingredient_id: number;
  name: string;
  category: string;
  section: string | null;
  amount: number | null;
  unit: string | null;
  note: string | null;
  optional: number;
  alternative: number; // 1 = 바로 앞 재료 대신
}

export interface RecipeStep {
  step_no: number;
  method: string | null;
  text: string;
  minutes: number | null;
}

export interface Meal {
  id: number;
  eaten_on: string;
}

export interface Photo {
  id: number;
  recipe_id: number;
  path: string;
  thumb_path: string | null;
  taken_on: string;
  is_primary: number;
}

export interface RecipeDetail {
  id: number;
  name: string;
  category: string;
  summary: string | null;
  servings: number | null;
  created_at: string;
  updated_at: string;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  meals: Meal[]; // 최근순
  photos: Photo[]; // 최근순
  primary_photo_id: number | null;
}

export interface CalendarMeal {
  id: number;
  recipe_id: number;
  eaten_on: string;
  name: string;
  category: string;
  photo: string | null;
  has_day_photo: number;
}
