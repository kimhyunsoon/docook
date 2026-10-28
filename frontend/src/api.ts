// fetch 래퍼 - 세션 쿠키 포함, 401이면 로그인 화면으로
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  // Content-Type은 JSON 문자열 body가 있을 때만 지정 -
  // body 없는 POST/DELETE에 붙이면 Fastify가 400(빈 JSON body)을 반환하고,
  // FormData는 브라우저가 boundary 포함 헤더를 직접 설정해야 한다
  const jsonBody = typeof init?.body === 'string';
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: jsonBody ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (res.status === 401 && !path.startsWith('/api/auth/login')) {
    // 로그인 화면으로 전환 - 뷰가 교체되므로 이 호출은 조용히 중단 (unhandled rejection 방지)
    location.hash = '#/login';
    return new Promise<never>(() => {});
  }
  if (!res.ok) throw new Error(`api_error_${res.status}`);
  return res.json() as Promise<T>;
}

// 오늘 날짜 (기기 로컬 기준 YYYY-MM-DD)
export function today(): string {
  return new Date().toLocaleDateString('en-CA');
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA');
}

export function fileUrl(path: string): string {
  return `/api/files/${path}`;
}

// 긴 변을 maxSide로 줄인 JPEG (디코딩 불가 포맷이면 null → 원본 업로드)
async function resizeImage(file: File, maxSide: number, quality: number): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  } catch {
    return null;
  }
}

/**
 * 요리 사진 업로드 - 원본은 긴 변 2048px, 목록·달력용 축소본은 480px로 줄여 함께 보낸다.
 * 사진 날짜(takenOn)의 먹은 기록도 서버가 함께 만든다.
 */
export async function uploadPhoto(recipeId: number, file: File, takenOn: string): Promise<void> {
  const [full, thumb] = await Promise.all([resizeImage(file, 2048, 0.86), resizeImage(file, 480, 0.8)]);
  const form = new FormData();
  // 텍스트 필드는 파일보다 먼저 (multipart 스트림 순서)
  form.append('taken_on', takenOn);
  form.append('file', full ?? file, 'photo.jpg');
  if (thumb) form.append('thumb', thumb, 'thumb.jpg');
  await api(`/api/recipes/${recipeId}/photos`, { method: 'POST', body: form });
}

// 숨겨진 file input으로 사진 고르기 (사용자 제스처 안에서 호출해야 iOS에서 열린다)
export function pickImages(multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = multiple;
    input.onchange = (): void => resolve([...(input.files ?? [])]);
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}
