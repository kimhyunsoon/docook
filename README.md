# 🍳 두쿡 (docook)

개인용 요리 레시피·먹은 기록 PWA. 레시피 등록은 앱이 아닌 Claude Code(이 리포에서 요청 → API)로 한다. 구조는 [docs/architecture.md](docs/architecture.md), 등록 절차는 [docs/recipe-registration.md](docs/recipe-registration.md), 정규화 규칙은 [docs/recipe-normalization.md](docs/recipe-normalization.md) 참고.

## 개발

```sh
./dev.sh   # backend(:4346) + frontend(:4347) 동시 기동
           # → http://localhost:4347 접속
```

- 초기 계정: `backend/.env`의 `INITIAL_USERNAME` / `INITIAL_PASSWORD`
- 레시피 등록: `backend/.env`의 `DOCOOK_URL`·`DOCOOK_TOKEN`(앱 설정 화면에서 복사)을 채우고, 이 리포에서 연 Claude Code에 "이 레시피 등록해줘" + 레시피 글 (`CLAUDE.md`가 등록 절차를 안내)

## 로고

`assets/`의 SVG가 원본, `assets/generate-logo.mjs`가 생성기(냄비 마크 + Quicksand Bold 워드마크). 파비콘·아이콘 재생성:

```sh
rsvg-convert -w 406 assets/docook-text.svg | magick - -define webp:lossless=true frontend/public/logo-text.webp
for s in 180 192 512; do rsvg-convert -w $s assets/icon.svg -o frontend/public/icons/icon-$s.png; done
rsvg-convert -w 512 assets/icon-maskable.svg -o frontend/public/icons/icon-512-maskable.png
rsvg-convert -w 48 assets/docook-mark.svg -o frontend/public/favicon.png
rsvg-convert -w 256 assets/docook-mark.svg | magick - -define icon:auto-resize=48,32,16 frontend/public/favicon.ico
```
