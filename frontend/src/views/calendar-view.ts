import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { tokens, ui } from '../style.js';
import { api, today, fileUrl } from '../api.js';
import { icon } from '../icons.js';
import { parseHash, replaceHashQuery } from '../router.js';
import { fmtDateLong, categoryEmoji } from '../fmt.js';
import type { CalendarMeal } from '../types.js';

const DOW_LABELS = ['월', '화', '수', '목', '금', '토', '일'];

function ymd(year: number, month: number, date: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
}

// 달력 탭 - 월 달력에 날짜별 먹은 요리 썸네일, 날짜 탭 → 아래에 그날 요리 목록
// 보던 월·선택일은 해시 쿼리(#/calendar?d=YYYY-MM-DD)에 기록되어 상세→뒤로가기에도 유지된다
@customElement('calendar-view')
export class CalendarView extends LitElement {
  static styles = [
    tokens,
    ui,
    css`
      :host { display: block; min-height: 100dvh; background: var(--bg); padding-bottom: calc(90px + env(safe-area-inset-bottom)); }
      .top {
        position: sticky; top: 0; z-index: 5; background: var(--bg);
        padding: calc(12px + env(safe-area-inset-top)) 16px 8px;
        display: flex; align-items: center; gap: 4px;
      }
      .top h1 { font-size: 1.15rem; margin: 0; flex: 1; }
      .top .today-btn { font-size: 0.8rem; color: var(--accent); background: var(--accent-soft); padding: 6px 10px; border-radius: 8px; font-weight: 700; }
      .month-sum { padding: 0 18px 8px; }
      .grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 3px; padding: 0 10px; }
      .dow { text-align: center; font-size: 0.74rem; font-weight: 700; color: var(--text-sub); padding: 4px 0; }
      .sun { color: var(--danger); }
      .day {
        position: relative; aspect-ratio: 1 / 1.18; border-radius: 10px;
        background: var(--surface); border: 1px solid var(--border);
        padding: 0; overflow: hidden; color: var(--text);
        display: flex; flex-direction: column;
      }
      .day.future { opacity: 0.45; }
      .day.sel { outline: 2px solid var(--accent); outline-offset: -1px; }
      .day .num {
        font-size: 0.72rem; font-weight: 700; padding: 3px 0 0 5px; text-align: left;
        font-variant-numeric: tabular-nums; position: relative; z-index: 1;
      }
      .day.today .num { color: var(--accent); }
      .day.has-photo .num { color: #fff; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6); }
      .day img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .day .emoji { flex: 1; display: grid; place-items: center; font-size: 1.15rem; padding-bottom: 6px; }
      .day .more {
        position: absolute; right: 3px; bottom: 3px; z-index: 1;
        font-size: 0.62rem; font-weight: 700; color: #fff;
        background: var(--accent); border-radius: 6px; padding: 0 4px;
      }
      .list-head { margin: 16px 18px 4px; font-weight: 700; font-size: 0.95rem; }
      .meal {
        display: flex; align-items: center; gap: 11px;
        padding: 9px 16px; border-bottom: 1px solid var(--border); cursor: pointer;
      }
      .meal .thumb {
        width: 46px; height: 46px; border-radius: 10px; object-fit: cover; flex-shrink: 0;
        background: var(--accent-soft); display: grid; place-items: center; font-size: 1.2rem;
      }
      .meal .name { font-weight: 700; font-size: 0.92rem; flex: 1; }
      .meal .chev { color: var(--text-sub); }
      .empty { color: var(--text-sub); text-align: center; padding: 24px 16px; font-size: 0.88rem; }
    `,
  ];

  @state() private year = 2026;
  @state() private month = 0; // 0~11
  @state() private selected = today();
  @state() private meals: CalendarMeal[] = [];
  @state() private loaded = false;

  connectedCallback(): void {
    super.connectedCallback();
    const d = parseHash(location.hash).params.get('d');
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) this.selected = d;
    this.year = Number(this.selected.slice(0, 4));
    this.month = Number(this.selected.slice(5, 7)) - 1;
    void this.load();
  }

  private async load(): Promise<void> {
    const from = ymd(this.year, this.month, 1);
    const to = ymd(this.year, this.month, new Date(this.year, this.month + 1, 0).getDate());
    const meals = await api<CalendarMeal[]>(`/api/meals?from=${from}&to=${to}`);
    // 응답 전에 월을 넘겼으면 버림
    if (from === ymd(this.year, this.month, 1)) {
      this.meals = meals;
      this.loaded = true;
    }
  }

  private select(date: string): void {
    this.selected = date;
    replaceHashQuery('#/calendar', { d: date === today() ? null : date });
  }

  private moveMonth(delta: number): void {
    const next = new Date(this.year, this.month + delta, 1);
    this.year = next.getFullYear();
    this.month = next.getMonth();
    // 이번 달로 오면 오늘, 아니면 1일 선택
    const base = today();
    this.select(base.slice(0, 7) === ymd(this.year, this.month, 1).slice(0, 7) ? base : ymd(this.year, this.month, 1));
    this.loaded = false;
    void this.load();
  }

  private goToday(): void {
    const base = today();
    this.year = Number(base.slice(0, 4));
    this.month = Number(base.slice(5, 7)) - 1;
    this.select(base);
    void this.load();
  }

  private renderDay(date: number, byDay: Map<string, CalendarMeal[]>, base: string): TemplateResult {
    const value = ymd(this.year, this.month, date);
    const meals = byDay.get(value) ?? [];
    // 사진 있는 요리를 썸네일로 우선
    const cover = meals.find((m) => m.has_day_photo) ?? meals.find((m) => m.photo) ?? meals[0];
    const cls = [
      value === base ? 'today' : '',
      value === this.selected ? 'sel' : '',
      value > base ? 'future' : '',
      cover?.photo ? 'has-photo' : '',
    ].join(' ');
    return html`
      <button class="day ${cls}" @click=${(): void => this.select(value)}>
        ${cover?.photo ? html`<img src=${fileUrl(cover.photo)} alt="" loading="lazy">` : nothing}
        <span class="num">${date}</span>
        ${cover && !cover.photo ? html`<span class="emoji">${categoryEmoji(cover.category)}</span>` : nothing}
        ${meals.length > 1 ? html`<span class="more">+${meals.length - 1}</span>` : nothing}
      </button>
    `;
  }

  render(): TemplateResult {
    const base = today();
    const byDay = new Map<string, CalendarMeal[]>();
    for (const m of this.meals) {
      if (!byDay.has(m.eaten_on)) byDay.set(m.eaten_on, []);
      byDay.get(m.eaten_on)!.push(m);
    }
    const first = new Date(this.year, this.month, 1);
    const daysInMonth = new Date(this.year, this.month + 1, 0).getDate();
    const dayMeals = byDay.get(this.selected) ?? [];
    const kinds = new Set(this.meals.map((m) => m.recipe_id)).size;
    return html`
      <div class="top">
        <button class="btn-icon" aria-label="이전 달" @click=${(): void => this.moveMonth(-1)}>${icon('chevron-left', 22)}</button>
        <h1>${this.year}년 ${this.month + 1}월</h1>
        <button class="btn-icon" aria-label="다음 달" @click=${(): void => this.moveMonth(1)}>${icon('chevron-right', 22)}</button>
        <button class="today-btn" @click=${(): void => this.goToday()}>오늘</button>
      </div>
      <div class="sub month-sum">
        ${this.loaded ? (this.meals.length > 0 ? `${this.meals.length}번 먹음 · ${kinds}가지 요리` : '이 달은 기록이 없어요') : ' '}
      </div>

      <div class="grid">
        ${DOW_LABELS.map((d, i) => html`<span class="dow ${i === 6 ? 'sun' : ''}">${d}</span>`)}
        ${Array.from({ length: (first.getDay() + 6) % 7 }, () => html`<span></span>`)}
        ${Array.from({ length: daysInMonth }, (_, i) => this.renderDay(i + 1, byDay, base))}
      </div>

      <div class="list-head">${fmtDateLong(this.selected, base)}</div>
      ${dayMeals.length === 0
        ? html`<div class="empty">먹은 기록이 없어요</div>`
        : dayMeals.map(
            (m) => html`
              <div class="meal" @click=${(): void => { location.hash = `#/recipes/${m.recipe_id}`; }}>
                ${m.photo
                  ? html`<img class="thumb" src=${fileUrl(m.photo)} alt="" loading="lazy">`
                  : html`<div class="thumb">${categoryEmoji(m.category)}</div>`}
                <span class="name">${m.name}</span>
                <span class="chev">${icon('chevron-right', 18)}</span>
              </div>
            `,
          )}
    `;
  }
}
