// 로고 생성기 - 냄비 마크 + Quicksand Bold 워드마크(path 변환)를 SVG로 출력한다
// 사용법: 이 파일을 빈 폴더에 복사 → npm i opentype.js@1.3.4 @fontsource/quicksand@5.1.0 → node generate-logo.mjs <출력폴더>
// 이후 rsvg-convert·magick로 webp·아이콘·파비콘 생성 (README 참고)
import opentype from 'opentype.js';
import { writeFileSync, readFileSync } from 'node:fs';
const font = opentype.parse(readFileSync(new URL('./node_modules/@fontsource/quicksand/files/quicksand-latin-700-normal.woff', import.meta.url)).buffer);
const out = process.argv[2];

const ACCENT = '#e0692f', DEEP = '#b9481a', LIGHT = '#f6a46b', TEXT = '#c4521d', BG = '#fbe9dd';

// 냄비 + 김 (200x200 기준)
function mark(color = true) {
  const steam = (x) => `<path d="M${x} 66 c-9 -9 -9 -17 0 -26 s 9 -17 0 -26" fill="none" stroke="${LIGHT}" stroke-width="9" stroke-linecap="round"/>`;
  return `
  <g>
    ${steam(72)}${steam(100)}${steam(128)}
    <rect x="12" y="104" width="30" height="16" rx="8" fill="${DEEP}"/>
    <rect x="158" y="104" width="30" height="16" rx="8" fill="${DEEP}"/>
    <path d="M36 94 H164 V138 a34 34 0 0 1 -34 34 H70 a34 34 0 0 1 -34 -34 Z" fill="${ACCENT}"/>
    <path d="M52 112 V136 a18 18 0 0 0 10 16" fill="none" stroke="#fff" stroke-opacity="0.45" stroke-width="8" stroke-linecap="round"/>
    <rect x="26" y="80" width="148" height="20" rx="10" fill="${DEEP}"/>
  </g>`;
}

function text(size, cx, baseline) {
  const p = font.getPath('docook', 0, 0, size);
  const bb = p.getBoundingBox();
  const w = bb.x2 - bb.x1;
  const p2 = font.getPath('docook', cx - w / 2 - bb.x1, baseline, size);
  return { d: p2.toPathData(2), w, h: bb.y2 - bb.y1, top: bb.y1 };
}

const svg = (w, h, body, bg) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${bg ? `<rect width="${w}" height="${h}" fill="${bg}"/>` : ''}${body}</svg>`;

// 마크 단독
writeFileSync(`${out}/docook-mark.svg`, svg(200, 200, mark()));
// 텍스트 단독 (여백 포함)
{
  const t = text(120, 0, 0);
  const pad = 8;
  const W = Math.ceil(t.w + pad * 2), H = Math.ceil(t.h + pad * 2);
  const tt = text(120, W / 2, pad - t.top);
  writeFileSync(`${out}/docook-text.svg`, svg(W, H, `<path d="${tt.d}" fill="${TEXT}"/>`));
}
// 마크 + 텍스트 세로 조합
{
  const t = text(84, 0, 0);
  const W = Math.ceil(Math.max(t.w, 200) + 24), H = 176 + 16 + Math.ceil(t.h) + 12;
  const tt = text(84, W / 2, 176 + 16 - t.top);
  writeFileSync(`${out}/docook.svg`, svg(W, H, `<g transform="translate(${(W - 200) / 2},0)">${mark()}</g><path d="${tt.d}" fill="${TEXT}"/>`));
}
// PWA 아이콘 (512, 배경 + 마크 + 텍스트) - dogroo 아이콘 구성과 동일
{
  const t = text(96, 0, 0);
  const markSize = 250, top = 70;
  const tt = text(96, 256, top + markSize + 30 - t.top);
  writeFileSync(`${out}/icon.svg`, svg(512, 512, `<g transform="translate(${256 - markSize / 2},${top}) scale(${markSize / 200})">${mark()}</g><path d="${tt.d}" fill="${TEXT}"/>`, BG));
}
// 마스커블 (안전 영역 = 중앙 80% 원 안에 들어가게 축소)
{
  const t = text(70, 0, 0);
  const markSize = 190, top = 108;
  const tt = text(70, 256, top + markSize + 20 - t.top);
  writeFileSync(`${out}/icon-maskable.svg`, svg(512, 512, `<g transform="translate(${256 - markSize / 2},${top}) scale(${markSize / 200})">${mark()}</g><path d="${tt.d}" fill="${TEXT}"/>`, BG));
}
