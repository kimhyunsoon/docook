// 정규화 고정 어휘 - GET /api/vocab 으로 그대로 공개된다 (Claude 레시피 등록이 매번 조회)
// 어휘를 바꾸면 docs/recipe-normalization.md 도 함께 갱신할 것

// 요리 분류 (목록 그룹 단위) - 음식의 나라, 애매하면 퓨전
export const RECIPE_CATEGORIES = [
  '한국',
  '일본',
  '중국',
  '대만',
  '미국',
  '프랑스',
  '이탈리아',
  '인도네시아',
  '태국',
  '베트남',
  '인도',
  '멕시코',
  '퓨전',
] as const;

// 재료 분류
export const INGREDIENT_CATEGORIES = [
  '채소',
  '버섯',
  '과일',
  '육류',
  '해산물',
  '달걀·유제품',
  '두부·콩',
  '곡물·면·떡',
  '양념·소스',
  '향신료·허브',
  '가공식품',
  '기타',
] as const;

// 단위 - 정량 표기일 때만 사용. 약간·적당량 같은 비정량 표현은 단위가 아니다 (양 자체를 생략)
export const UNITS = [
  'g',
  'kg',
  'ml',
  'L',
  '큰술',
  '작은술',
  '컵',
  '개',
  '공기',
  '알',
  '쪽',
  '대',
  '줄기',
  '줄',
  '장',
  '모',
  '포기',
  '줌',
  '봉지',
  '캔',
  '마리',
  'cm',
] as const;

// 조리 단계의 대표 동작 (단계당 1개, 애매하면 생략)
export const METHODS = [
  '손질',
  '썰기',
  '다지기',
  '불리기',
  '절이기',
  '재우기',
  '섞기',
  '데치기',
  '삶기',
  '찌기',
  '끓이기',
  '졸이기',
  '볶기',
  '굽기',
  '부치기',
  '튀기기',
  '무치기',
  '비비기',
  '갈기',
  '식히기',
  '담기',
] as const;

export function vocab(): Record<string, readonly string[]> {
  return {
    recipe_categories: RECIPE_CATEGORIES,
    ingredient_categories: INGREDIENT_CATEGORIES,
    units: UNITS,
    methods: METHODS,
  };
}
