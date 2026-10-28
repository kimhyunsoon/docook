import { api } from './api.js';
import type { RecipeSummary } from './types.js';

// 요리 목록 캐시 (stale-while-revalidate)
// 캐시가 있으면 즉시 렌더하고 백그라운드로 갱신 → 탭 전환 시 스켈레톤은 첫 로드만
let recipesCache: RecipeSummary[] | null = null;

export function cachedRecipes(): RecipeSummary[] | null {
  return recipesCache;
}

export async function loadRecipes(): Promise<RecipeSummary[]> {
  recipesCache = await api<RecipeSummary[]>('/api/recipes');
  return recipesCache;
}

// 뮤테이션(먹은 기록·사진) 후 다른 화면이 최신 목록을 보도록 재조회
export async function refreshRecipes(): Promise<void> {
  if (recipesCache) await loadRecipes();
}

// 탭별 스크롤 위치 (뷰 재생성 시 복원용)
const scrollPositions = new Map<string, number>();

export const scrollStore = {
  save(path: string, y: number): void {
    scrollPositions.set(path, y);
  },
  get(path: string): number {
    return scrollPositions.get(path) ?? 0;
  },
};
