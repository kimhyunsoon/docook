# docook

- **레시피 등록·수정 요청**(레시피 글을 주며 등록/올려/수정해 달라는 요청)은 `docs/recipe-registration.md` 절차를 그대로 따른다. 정규화 기준은 `docs/recipe-normalization.md` - 작업 전 전부 읽고, 새로 정한 규칙은 그 문서의 결정 기록에 추가한다.
- 접속 정보는 `backend/.env`의 `DOCOOK_URL`·`DOCOOK_TOKEN` (git 제외 - 새 PC면 사용자에게 토큰을 받아 채운다).
- 구조·배포는 `docs/architecture.md`. 공용 게이트웨이(caddy·webhook·DDNS)는 dogroo 리포 `gateway/` 소관.
- 고정 어휘(분류·단위·조리 동작)를 바꾸면 `backend/src/vocab.ts`와 규칙 문서를 함께 고친다.
