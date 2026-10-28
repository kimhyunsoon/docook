# 레시피 등록 절차 (Claude용)

사용자가 글로 쓴 레시피를 docook API 형식으로 정규화해 등록·수정한다. 앱에는 등록 UI가 없고 이 절차가 유일한 등록 경로다.
"레시피 등록해줘", "이거 올려줘", 요리명·재료·조리법이 담긴 글과 함께 docook에 넣어달라는 요청이면 이 문서를 따른다.
(이 문서는 리포에 포함되어 어느 PC에서든 동일하게 쓴다. 루트 `CLAUDE.md`가 여기를 가리킨다.)

## 0. 규칙 문서 먼저

`docs/recipe-normalization.md`를 **처음부터 끝까지 읽는다** (특히 맨 아래 결정 기록). 이 문서가 정규화의 기준이며, 아래 절차보다 우선한다.

## 1. 접속 정보

Bash 도구는 호출마다 새 셸이라 환경변수가 이어지지 않는다. **API를 부르는 모든 Bash 호출의 첫 줄에** 아래를 붙인다 (빠뜨리면 토큰이 비어 401):

```bash
cd "$(git rev-parse --show-toplevel)" && set -a && source backend/.env && set +a   # DOCOOK_URL, DOCOOK_TOKEN
```

`backend/.env`는 git에 없으므로 새 PC에서는 없을 수 있다. 파일이나 `DOCOOK_URL`·`DOCOOK_TOKEN`이 없으면 멈추고 사용자에게 토큰을 받아 `backend/.env.example` 형식으로 채운다(파일이 있으면 두 줄만 추가·수정). 토큰은 앱 **설정 > 레시피 등록 API 토큰 > 복사**. 로컬 개발 서버면 `DOCOOK_URL=http://localhost:4346`, 토큰은 `backend/data/.api-token`. 어느 서버에 등록하는지(로컬/운영) 사용자에게 한 번 확인한다.

모든 요청은 `-H "Authorization: Bearer $DOCOOK_TOKEN"`. 한글 JSON은 셸 인용 문제를 피하려고 스크래치 파일에 쓰고 `--data-binary @파일`로 보낸다.

## 2. 현재 어휘·재료·요리 조회

(이하 모든 예시는 위 접속 줄을 앞에 붙여 실행한다)

```bash
curl -fsS "$DOCOOK_URL/api/vocab" -H "Authorization: Bearer $DOCOOK_TOKEN"
curl -fsS "$DOCOOK_URL/api/ingredients" -H "Authorization: Bearer $DOCOOK_TOKEN"   # 표준명·별칭·분류
curl -fsS "$DOCOOK_URL/api/recipes" -H "Authorization: Bearer $DOCOOK_TOKEN"       # 이름 중복 확인용
```

## 3. 정규화

규칙 문서대로 원문을 아래 형태로 옮긴다. 원문에 없는 것은 넣지 않는다.

```json
{
  "name": "대파 계란볶음밥",
  "category": "한국",
  "summary": null,
  "servings": 2,
  "ingredients": [
    { "name": "밥", "amount": 1, "unit": "공기" },
    { "name": "대파", "note": "송송 썬" },
    { "name": "쪽파", "alternative": true },
    { "name": "달걀", "amount": 2, "unit": "개" },
    { "name": "간장" },
    { "name": "참깨", "section": "고명", "optional": true },
    { "name": "새 재료명", "category": "채소" }
  ],
  "steps": [
    { "method": "볶기", "text": "식용유에 대파를 볶아 파기름을 낸다." },
    { "method": "볶기", "text": "달걀을 넣어 스크램블한 뒤 밥을 넣고 간장을 둘러 볶는다.", "minutes": 3 }
  ]
}
```

- 애매한 해석(재료 동일성, 부위, 단위, 분류)은 **혼자 정하지 말고 묻는다.** 정한 내용은 규칙 문서의 결정 기록에 한 줄 추가한다(날짜는 오늘, 근거는 사용자 말 인용).
- 여러 레시피를 한 번에 받으면 하나씩 같은 절차로 처리한다.

## 4. 검증(dry run) → 미리보기 → 확인

```bash
curl -sS -X POST "$DOCOOK_URL/api/recipes?dry_run=1" -H "Authorization: Bearer $DOCOOK_TOKEN" \
  -H "Content-Type: application/json" --data-binary @recipe.json
```

- `400 {error:'validation', details:[...]}`: 항목별 사유를 보고 고친다. 재료 마스터에 없다는 오류는 기존 재료의 다른 표기인지 먼저 확인(→ 표준명 사용 + 별칭 등록), 정말 새 재료일 때만 `category`를 붙인다.
- `409 duplicate_name`: 같은 요리면 사용자 확인 후 `PUT /api/recipes/:id` (전체 교체).
- 통과하면 응답의 해석 결과(`matched: alias|new` 포함)로 사용자에게 **미리보기**를 보여준다: 분류, 재료(표준명으로 바뀐 것·새로 생길 재료 표시), 대체 재료 묶음, 단계, 원문에서 뺀 비정량 표현. 사용자가 확인하면 등록한다.

## 5. 등록

```bash
curl -sS -X POST "$DOCOOK_URL/api/recipes" -H "Authorization: Bearer $DOCOOK_TOKEN" \
  -H "Content-Type: application/json" --data-binary @recipe.json
```

`201 {id, created_ingredients, recipe}` → 등록된 id와 새로 만든 재료를 보고한다. 앱 주소: `$DOCOOK_URL/#/recipes/<id>`.

## 재료 마스터 정리 API

| 요청 | 용도 |
|---|---|
| `GET /api/ingredients/resolve?name=` | 이름(별칭 포함) → 표준 재료. 한글은 `curl -G --data-urlencode "name=대파"`로 |
| `POST /api/ingredients {name, category, aliases?}` | 재료 생성 |
| `PATCH /api/ingredients/:id {name?, category?, add_aliases?, remove_aliases?}` | 수정·별칭 추가 |
| `POST /api/ingredients/:id/merge {into_id}` | 중복 병합 (사용자 확인 후) |
| `DELETE /api/ingredients/:id` | 미사용 재료만 삭제 |
| `DELETE /api/recipes/:id` | 레시피 삭제 (먹은 기록·사진 포함 - 반드시 사용자 확인) |
