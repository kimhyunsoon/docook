import { html, css, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { tokens, ui, sheet } from '../style.js';
import { icon } from '../icons.js';
import { fileUrl } from '../api.js';
import { categoryEmoji } from '../fmt.js';
import { cachedRecipes, loadRecipes } from '../store.js';
import { SheetBase } from './sheet-base.js';
import type { RecipeSummary } from '../types.js';

export type PickResult = { recipe: RecipeSummary } | { newName: string };

interface PickerOptions {
  title: string;
  done?: number[]; // 이미 기록된 요리 id (체크 표시)
}

// 요리 고르기 - 이름 검색, 최근 먹은 순. 이름이 딱 맞는 요리가 없으면 맨 아래에 검색어로 새 메뉴 추가
@customElement('recipe-picker')
export class RecipePicker extends SheetBase {
  static styles = [
    tokens,
    ui,
    sheet,
    css`
      .search-box { padding: 0 16px 8px; }
      .search-box input { box-sizing: border-box; }
      .item {
        display: flex; align-items: center; gap: 11px; width: 100%;
        padding: 8px 2px; background: none; color: var(--text); text-align: left;
        border-bottom: 1px solid var(--border);
      }
      .item .thumb {
        width: 42px; height: 42px; border-radius: 10px; object-fit: cover; flex-shrink: 0;
        background: var(--accent-soft); display: grid; place-items: center; font-size: 1.1rem;
      }
      .item .name { flex: 1; min-width: 0; font-weight: 700; font-size: 0.92rem; }
      .item .done { color: var(--accent); }
      .item.new .thumb { color: var(--accent); }
      .item.new .name { color: var(--accent); }
      .empty { color: var(--text-sub); text-align: center; padding: 20px; font-size: 0.88rem; }
    `,
  ];

  @state() private q = '';
  @state() private recipes: RecipeSummary[] = [];
  private options: PickerOptions = { title: '' };
  private result: PickResult | null = null;
  private resolveFn?: (value: PickResult | null) => void;

  constructor() {
    super();
    this.panelHeight = '78dvh';
  }

  protected get sheetTitle(): string {
    return this.options.title;
  }

  show(options: PickerOptions): Promise<PickResult | null> {
    this.options = options;
    this.q = '';
    this.result = null;
    this.recipes = cachedRecipes() ?? [];
    void loadRecipes().then((list) => {
      this.recipes = list;
    });
    this.openSheet();
    return new Promise((resolve) => {
      this.resolveFn = resolve;
    });
  }

  protected onClosed(): void {
    this.resolveFn?.(this.result);
  }

  private pick(result: PickResult): void {
    this.result = result;
    this.requestClose();
  }

  // 이름 포함 검색, 최근 먹은 순 (안 먹은 건 뒤에 이름순)
  private get visible(): RecipeSummary[] {
    const q = this.q.trim().toLowerCase();
    return this.recipes
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .sort(
        (a, b) =>
          (b.last_eaten_on ?? '').localeCompare(a.last_eaten_on ?? '') || a.name.localeCompare(b.name, 'ko'),
      );
  }

  protected renderBelowHead(): TemplateResult {
    return html`
      <div class="search-box">
        <input
          type="search"
          placeholder="메뉴 이름 검색"
          .value=${this.q}
          @input=${(e: Event): void => { this.q = (e.target as HTMLInputElement).value; }}
        >
      </div>
    `;
  }

  protected renderBody(): TemplateResult {
    const q = this.q.trim();
    const list = this.visible;
    const exact = list.some((r) => r.name.toLowerCase() === q.toLowerCase());
    const done = new Set(this.options.done ?? []);
    return html`
      ${list.length === 0 && !q ? html`<div class="empty">메뉴가 없어요</div>` : nothing}
      ${list.map(
        (r) => html`
          <button class="item" @click=${(): void => this.pick({ recipe: r })}>
            ${r.photo
              ? html`<img class="thumb" src=${fileUrl(r.photo)} alt="" loading="lazy">`
              : html`<span class="thumb">${categoryEmoji(r.category)}</span>`}
            <span class="name">${r.name}</span>
            ${done.has(r.id) ? html`<span class="done">${icon('check', 18)}</span>` : nothing}
          </button>
        `,
      )}
      ${q && !exact
        ? html`
            <button class="item new" @click=${(): void => this.pick({ newName: q })}>
              <span class="thumb">${icon('plus', 20)}</span>
              <span class="name">'${q}' 새 메뉴로 추가</span>
            </button>
          `
        : nothing}
    `;
  }
}

let instance: RecipePicker | null = null;

export function pickRecipe(options: PickerOptions): Promise<PickResult | null> {
  if (!instance) {
    instance = document.createElement('recipe-picker') as RecipePicker;
    document.body.appendChild(instance);
  }
  return instance.show(options);
}
