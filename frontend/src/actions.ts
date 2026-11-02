import { api, uploadPhoto } from './api.js';
import { progressToast, toast } from './ui.js';
import { refreshRecipes } from './store.js';
import type { MealInput } from './sheets/meal-sheet.js';
import type { MenuInput } from './sheets/menu-sheet.js';

// 먹은 기록 공용 동작 (목록·상세·달력 공유)

/** 먹은 기록 + 사진 업로드. 사진이 있으면 사진 업로드가 그날 기록도 함께 만든다 */
export async function saveMeal(recipeId: number, input: MealInput): Promise<void> {
  if (input.files.length === 0) {
    await api(`/api/recipes/${recipeId}/meals`, { method: 'POST', body: JSON.stringify({ eaten_on: input.date }) });
  } else {
    await uploadPhotos(recipeId, input.files, input.date);
  }
  toast(input.files.length > 0 ? `사진 ${input.files.length}장과 기록했어요` : '먹은 기록을 남겼어요', {
    duration: 1800,
  });
  void refreshRecipes();
}

/**
 * 사진 여러 장을 순서대로 올리며 진행 토스트를 갱신한다.
 * 전체 진행률 = (끝난 장 + 지금 장의 전송률) / 전체 장. 실패하면 실패 토스트 후 예외를 다시 던진다
 */
async function uploadPhotos(recipeId: number, files: File[], date: string): Promise<void> {
  const total = files.length;
  const label = (i: number): string => (total > 1 ? `사진 ${i + 1}/${total}` : '사진');
  const progress = progressToast(`${label(0)} 준비 중…`);
  try {
    for (const [i, file] of files.entries()) {
      progress.update(`${label(i)} 준비 중…`, i / total);
      await uploadPhoto(recipeId, file, date, (ratio) => {
        // 전송이 끝나도 서버 저장 응답까지는 기다리므로 그 사이는 '저장 중'
        progress.update(ratio < 1 ? `${label(i)} 올리는 중…` : `${label(i)} 저장 중…`, (i + ratio * 0.95) / total);
      });
    }
  } catch (err) {
    toast('사진을 올리지 못했어요 · 다시 시도해 주세요', { duration: 4000 });
    throw err;
  }
}

/**
 * 메뉴 추가 (레시피·재료 없이 이름·국가만) + 먹은 날이 있으면 그날 기록·사진까지.
 * @returns 새 메뉴 id, 같은 이름이 이미 있으면 null
 */
export async function addMenu(input: MenuInput): Promise<number | null> {
  let id: number;
  try {
    ({ id } = await api<{ id: number }>('/api/recipes', {
      method: 'POST',
      body: JSON.stringify({ name: input.name, category: input.category }),
    }));
  } catch (err) {
    if ((err as Error).message !== 'api_error_409') throw err;
    toast('같은 이름의 메뉴가 이미 있어요', { duration: 2500 });
    return null;
  }
  if (input.date) {
    await saveMeal(id, { date: input.date, files: input.files });
  } else {
    toast(`'${input.name}' 메뉴를 추가했어요`, { duration: 1800 });
    void refreshRecipes();
  }
  return id;
}

export async function undoToday(recipeId: number): Promise<void> {
  await api(`/api/recipes/${recipeId}/meals/today`, { method: 'DELETE' });
  toast('오늘 기록을 취소했어요', { duration: 1800 });
}
