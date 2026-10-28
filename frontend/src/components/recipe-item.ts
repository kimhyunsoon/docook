import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { tokens, ui } from '../style.js';
import { today, addDays, fileUrl } from '../api.js';
import { Press } from '../ui.js';
import { icon } from '../icons.js';
import { fmtRel, categoryEmoji } from '../fmt.js';
import type { RecipeSummary } from '../types.js';

const STRIP_WEEKS = 12;

// 목록 아이템 - 탭 → open / 체크 버튼 탭 → check(오늘 먹음) / 길게 → record(날짜·사진 시트)
// 오늘 이미 먹었으면 흐린 체크 버튼 (재탭 = 오늘 기록 취소 → undo)
@customElement('recipe-item')
export class RecipeItem extends LitElement {
  static styles = [
    tokens,
    ui,
    css`
      :host { display: block; }
      .row {
        display: flex; align-items: center; gap: 11px;
        padding: 9px 16px;
        border-bottom: 1px solid var(--border);
        cursor: pointer;
        user-select: none;
        -webkit-user-select: none;
        -webkit-touch-callout: none;
      }
      .thumb {
        width: 52px; height: 52px; border-radius: 12px; object-fit: cover;
        background: var(--accent-soft); flex-shrink: 0;
        display: grid; place-items: center; font-size: 1.4rem;
      }
      .info { flex: 1; min-width: 0; }
      .name { font-weight: 700; font-size: 0.93rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ing {
        color: var(--text-sub); font-size: 0.74rem;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .last { display: flex; align-items: center; gap: 8px; color: var(--text-sub); font-size: 0.74rem; margin-top: 2px; }
      .last .when.today { color: var(--accent); font-weight: 700; }
      /* 최근 12주 미니 그래프 - 한 칸 = 한 주 */
      .strip { display: flex; gap: 2px; align-items: flex-end; height: 10px; }
      .strip i { width: 4px; border-radius: 1px; background: var(--border); height: 4px; }
      .strip i.on { background: var(--accent); height: 10px; }
      .strip i.on.many { filter: brightness(0.78); }
      .act {
        flex-shrink: 0;
        width: 42px; height: 42px; border-radius: 13px;
        display: grid; place-items: center;
        background: var(--accent-soft); color: var(--accent);
      }
      /* 오늘 이미 먹음 - 다시 누르고 싶지 않게 가시성을 낮춘다 (재탭 = 오늘 기록 취소) */
      .act.done { background: transparent; border: 1px dashed var(--border); color: var(--text-sub); opacity: 0.5; }
    `,
  ];

  @property({ attribute: false }) recipe!: RecipeSummary;

  private emit(name: string): void {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }));
  }

  private actGesture = new Press(
    () => this.emit('check'),
    () => this.emit('record'),
  );

  // 이번 주를 마지막 칸으로, 주별 먹은 횟수
  private weekCounts(base: string): number[] {
    const counts = new Array<number>(STRIP_WEEKS).fill(0);
    const weekStart = addDays(base, -((new Date(`${base}T00:00:00`).getDay() + 6) % 7)); // 이번 주 월요일
    for (const d of this.recipe.recent_meals) {
      const diff = Math.round((Date.parse(`${weekStart}T00:00:00`) - Date.parse(`${d}T00:00:00`)) / 86400000);
      const idx = STRIP_WEEKS - 1 - Math.ceil(Math.max(0, diff) / 7);
      if (idx >= 0) counts[idx] = (counts[idx] ?? 0) + 1;
    }
    return counts;
  }

  render(): TemplateResult {
    const r = this.recipe;
    const base = today();
    const rel = fmtRel(r.last_eaten_on, base);
    const doneToday = r.last_eaten_on === base;
    const ingredients = (r.main_ingredients.length > 0 ? r.main_ingredients : r.ingredient_names).join(', ');
    return html`
      <div class="row" @click=${(): void => this.emit('open')}>
        ${r.photo
          ? html`<img class="thumb" src=${fileUrl(r.photo)} alt="" loading="lazy">`
          : html`<div class="thumb">${categoryEmoji(r.category)}</div>`}
        <div class="info">
          <div class="name">${r.name}</div>
          ${ingredients ? html`<div class="ing">${ingredients}</div>` : nothing}
          <div class="last">
            <span class="when ${doneToday ? 'today' : ''}">${rel ? `${rel} 먹음` : '아직 안 먹음'}</span>
            ${r.meal_count > 0
              ? html`
                  <span class="strip" aria-hidden="true">
                    ${this.weekCounts(base).map((c) => html`<i class=${c > 1 ? 'on many' : c > 0 ? 'on' : ''}></i>`)}
                  </span>
                  <span>${r.meal_count}회</span>
                `
              : nothing}
          </div>
        </div>
        ${doneToday
          ? html`
              <button
                class="act done"
                aria-label="오늘 먹음 취소"
                @click=${(e: Event): void => {
                  e.stopPropagation();
                  this.emit('undo');
                }}
              >${icon('check', 20)}</button>
            `
          : html`
              <button
                class="act"
                aria-label="오늘 먹음"
                @pointerdown=${(e: PointerEvent): void => { e.stopPropagation(); this.actGesture.down(e); }}
                @pointermove=${this.actGesture.move}
                @pointerup=${this.actGesture.up}
                @pointercancel=${this.actGesture.up}
                @click=${(e: Event): void => { e.stopPropagation(); this.actGesture.click(e); }}
              >${icon('utensils', 20)}</button>
            `}
      </div>
    `;
  }
}
