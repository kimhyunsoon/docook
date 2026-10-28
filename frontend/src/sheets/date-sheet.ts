import { html, css, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { tokens, ui, sheet } from '../style.js';
import { icon } from '../icons.js';
import { today } from '../api.js';
import { SheetBase } from './sheet-base.js';

// 월요일 시작 요일 헤더
const DOW_LABELS = ['월', '화', '수', '목', '금', '토', '일'];

function ymd(year: number, month: number, date: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
}

interface DateOptions {
  title?: string;
  marked?: string[]; // 점으로 표시할 날짜 (이미 먹은 날)
}

// 먹은 날짜 고르기 - 월 달력, 미래 날짜 비활성. show('2026-10-27') → 'YYYY-MM-DD' | null(취소)
@customElement('date-sheet')
export class DateSheet extends SheetBase {
  static styles = [
    tokens,
    ui,
    sheet,
    css`
      /* 먹은 기록 시트 위에 겹쳐 열린다 */
      :host { position: relative; z-index: 120; }
      .cal-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 2px 4px 10px;
      }
      .cal-head b { font-size: 1.02rem; }
      .grid {
        display: grid;
        grid-template-columns: repeat(7, 1fr);
        row-gap: 4px;
        padding-bottom: 14px;
      }
      .dow {
        text-align: center;
        font-size: 0.78rem;
        font-weight: 700;
        color: var(--text-sub);
        padding: 6px 0;
      }
      .sun { color: var(--danger); }
      .day {
        position: relative;
        place-self: center;
        width: 42px;
        height: 42px;
        display: grid;
        place-items: center;
        background: none;
        border-radius: 50%;
        font-size: 0.95rem;
        font-weight: 600;
        color: var(--text);
        font-variant-numeric: tabular-nums;
      }
      .day:disabled { color: color-mix(in srgb, var(--text-sub) 45%, transparent); }
      .day.today { box-shadow: inset 0 0 0 1.5px var(--accent); }
      /* 이미 먹은 날 - 숫자 아래 점 */
      .day.marked::after {
        content: '';
        position: absolute;
        bottom: 5px;
        left: 50%;
        transform: translateX(-50%);
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: var(--accent);
      }
      .day.selected { background: var(--accent); color: #fff; }
      .day.selected.marked::after { background: #fff; }
    `,
  ];

  protected get sheetTitle(): string {
    return this.options.title ?? '날짜 선택';
  }

  @state() private viewYear = 2026;
  @state() private viewMonth = 0; // 0~11
  private selected = '';
  private options: DateOptions = {};
  private picked: string | null = null;
  private resolveFn?: (value: string | null) => void;

  show(current: string, options: DateOptions = {}): Promise<string | null> {
    this.options = options;
    this.selected = current;
    const base = new Date(`${current || today()}T00:00`);
    this.viewYear = base.getFullYear();
    this.viewMonth = base.getMonth();
    this.picked = null;
    this.openSheet();
    return new Promise((resolve) => {
      this.resolveFn = resolve;
    });
  }

  protected onClosed(): void {
    this.resolveFn?.(this.picked);
  }

  private moveMonth(delta: number): void {
    const next = new Date(this.viewYear, this.viewMonth + delta, 1);
    this.viewYear = next.getFullYear();
    this.viewMonth = next.getMonth();
  }

  protected renderBody(): TemplateResult {
    const first = new Date(this.viewYear, this.viewMonth, 1);
    const daysInMonth = new Date(this.viewYear, this.viewMonth + 1, 0).getDate();
    const base = today();
    const marked = new Set(this.options.marked ?? []);
    const isCurrentMonth = ymd(this.viewYear, this.viewMonth, 1) >= base.slice(0, 8) + '01';
    return html`
      <div class="cal-head">
        <button class="btn-icon" aria-label="이전 달" @click=${(): void => this.moveMonth(-1)}>
          ${icon('chevron-left', 20)}
        </button>
        <b>${this.viewYear}년 ${this.viewMonth + 1}월</b>
        <button class="btn-icon" aria-label="다음 달" ?disabled=${isCurrentMonth} @click=${(): void => this.moveMonth(1)}>
          ${icon('chevron-right', 20)}
        </button>
      </div>
      <div class="grid">
        ${DOW_LABELS.map((d, i) => html`<span class="dow ${i === 6 ? 'sun' : ''}">${d}</span>`)}
        ${Array.from({ length: (first.getDay() + 6) % 7 }, () => html`<span></span>`)}
        ${Array.from({ length: daysInMonth }, (_, i) => {
          const value = ymd(this.viewYear, this.viewMonth, i + 1);
          const cls = [
            value === base ? 'today' : '',
            value === this.selected ? 'selected' : '',
            marked.has(value) ? 'marked' : '',
          ].join(' ');
          return html`
            <button
              class="day ${cls}"
              ?disabled=${value > base}
              @click=${(): void => {
                this.picked = value;
                this.requestClose();
              }}
            >${i + 1}</button>
          `;
        })}
      </div>
    `;
  }
}

// 전역 싱글턴 - 어느 화면에서든 pickDate()로 사용
let instance: DateSheet | null = null;

export function pickDate(current: string, options?: DateOptions): Promise<string | null> {
  if (!instance) {
    instance = document.createElement('date-sheet') as DateSheet;
    document.body.appendChild(instance);
  }
  return instance.show(current, options);
}
