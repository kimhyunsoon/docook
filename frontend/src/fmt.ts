// '2026-06-28' → '6/28'
export function fmtDate(date: string | null): string {
  if (!date) return '-';
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
}

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

// '2026-06-28' → '2026년 6월 28일 (일)' (올해면 연도 생략)
export function fmtDateLong(date: string, base: string): string {
  const d = new Date(`${date}T00:00:00`);
  const year = date.slice(0, 4) === base.slice(0, 4) ? '' : `${date.slice(0, 4)}년 `;
  return `${year}${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW[d.getDay()]})`;
}

export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00`) - Date.parse(`${b}T00:00:00`)) / 86400000);
}

// 오늘 기준 상대 시간: 오늘/어제/n일 전(1개월 미만) → n개월 전 → n년 n개월 전
export function fmtRel(date: string | null, base: string): string | null {
  if (!date) return null;
  const d = date.slice(0, 10);
  const days = diffDays(base, d);
  if (days <= 0) return '오늘';
  if (days === 1) return '어제';
  const s = new Date(`${d}T00:00:00`);
  const b = new Date(`${base}T00:00:00`);
  let months = (b.getFullYear() - s.getFullYear()) * 12 + (b.getMonth() - s.getMonth());
  if (b.getDate() < s.getDate()) months--;
  if (months < 1) return `${days}일 전`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (years === 0) return `${months}개월 전`;
  return rem === 0 ? `${years}년 전` : `${years}년 ${rem}개월 전`;
}

// 분수 대신 소수: 0.5 → '0.5', 2.5 → '2.5', 200 → '200'
export function fmtAmount(amount: number | null, unit: string | null): string {
  if (amount === null) return '';
  const num = String(Math.round(amount * 100) / 100);
  return `${num}${unit && /^[a-zA-Z]/.test(unit) ? '' : ' '}${unit ?? ''}`.trim();
}

// 먹은 간격 평균 (일) - 2회 이상일 때만
export function avgGap(dates: string[]): number | null {
  const sorted = [...dates].sort();
  if (sorted.length < 2) return null;
  const span = diffDays(sorted[sorted.length - 1]!, sorted[0]!);
  return Math.round(span / (sorted.length - 1));
}

// 요리 분류(나라) 국기 이모지 (사진이 없을 때 썸네일, 퓨전은 기본값)
const CATEGORY_EMOJI: Record<string, string> = {
  한국: '🇰🇷',
  일본: '🇯🇵',
  중국: '🇨🇳',
  대만: '🇹🇼',
  미국: '🇺🇸',
  프랑스: '🇫🇷',
  이탈리아: '🇮🇹',
  인도네시아: '🇮🇩',
  태국: '🇹🇭',
  베트남: '🇻🇳',
  인도: '🇮🇳',
  멕시코: '🇲🇽',
};

export function categoryEmoji(category: string): string {
  return CATEGORY_EMOJI[category] ?? '🍳';
}
