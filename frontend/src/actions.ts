import { api, uploadPhoto } from './api.js';
import { toast } from './ui.js';
import { refreshRecipes } from './store.js';
import type { MealInput } from './sheets/meal-sheet.js';

// 먹은 기록 공용 동작 (목록·상세·달력 공유)

/** 먹은 기록 + 사진 업로드. 사진이 있으면 사진 업로드가 그날 기록도 함께 만든다 */
export async function saveMeal(recipeId: number, input: MealInput): Promise<void> {
  if (input.files.length === 0) {
    await api(`/api/recipes/${recipeId}/meals`, { method: 'POST', body: JSON.stringify({ eaten_on: input.date }) });
  } else {
    toast(`사진 ${input.files.length}장 올리는 중…`, { duration: 60_000 });
    for (const file of input.files) await uploadPhoto(recipeId, file, input.date);
  }
  toast(input.files.length > 0 ? `사진 ${input.files.length}장과 기록했어요` : '먹은 기록을 남겼어요', {
    duration: 1800,
  });
  void refreshRecipes();
}

export async function undoToday(recipeId: number): Promise<void> {
  await api(`/api/recipes/${recipeId}/meals/today`, { method: 'DELETE' });
  toast('오늘 기록을 취소했어요', { duration: 1800 });
}
