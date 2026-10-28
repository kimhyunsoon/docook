// YYYY-MM-DD 문자열 기반 날짜 유틸 - 타임존 이슈를 피하기 위해 문자열로만 다룬다

export function todayStr(tz: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: tz });
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// 실제 존재하는 YYYY-MM-DD 인지 (2026-02-30 같은 값 거부)
export function isValidDate(date: unknown): date is string {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}
