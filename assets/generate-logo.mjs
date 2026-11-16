// 로고 생성기 - 단색 냄비 마크 + Quicksand Bold 워드마크(path 변환)를 SVG로 출력한다
// 사용법: 이 파일을 빈 폴더에 복사 → npm i opentype.js@1.3.4 @fontsource/quicksand@5.1.0 → node generate-logo.mjs <출력폴더>
// PWA 아이콘은 dogroo/assets/compose-icons.py 로 마크에서 합성한다 (dogroo docs/icon-guide.md 참고)
import opentype from 'opentype.js';
import { writeFileSync, readFileSync } from 'node:fs';
const font = opentype.parse(readFileSync(new URL('./node_modules/@fontsource/quicksand/files/quicksand-latin-700-normal.woff', import.meta.url)).buffer);
const out = process.argv[2];

const MARK = '#d9622b', TEXT = '#c4521d';

// 단색 냄비: 뚜껑 손잡이 + 뚜껑 + 양손잡이 + 몸통 (200x200 기준)
function mark() {
  return `
  <g fill="${MARK}">
    <rect x="86" y="44" width="28" height="18" rx="9"/>
    <rect x="28" y="60" width="144" height="22" rx="11"/>
    <rect x="14" y="102" width="34" height="18" rx="9"/>
    <rect x="152" y="102" width="34" height="18" rx="9"/>
    <path d="M38 92 H162 V138 a34 34 0 0 1 -34 34 H72 a34 34 0 0 1 -34 -34 Z"/>
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
