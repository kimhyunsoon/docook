import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { tokens, ui } from '../style.js';
import { toast } from '../ui.js';
import { icon } from '../icons.js';
import { parseHash, replaceHashQuery } from '../router.js';
import { cachedRecipes, loadRecipes } from '../store.js';
import { undoToday, saveMeal } from '../actions.js';
import { openMealSheet } from '../sheets/meal-sheet.js';
import type { RecipeSummary } from '../types.js';
import '../components/recipe-item.js';

type SortKey = 'recent' | 'stale' | 'country';

const STATE_KEY = 'docook:recipes-state';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'recent', label: '최근 먹은' },
  { key: 'stale', label: '오래 안 먹은' },
  { key: 'country', label: '국가별' },
];

// 레시피 분류 순서 (backend vocab.ts RECIPE_CATEGORIES와 동일)
const CATEGORY_ORDER = ['한국', '일본', '중국', '대만', '미국', '프랑스', '이탈리아', '인도네시아', '태국', '베트남', '인도', '멕시코', '퓨전'];

// null(안 먹음)은 방향과 무관하게 항상 마지막
function cmpDate(a: string | null, b: string | null, desc: boolean): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return desc ? b.localeCompare(a) : a.localeCompare(b);
}

const byName = (a: RecipeSummary, b: RecipeSummary): number => a.name.localeCompare(b.name, 'ko');

const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)]!;

// 검색창 예시 - 등록된 요리 하나에서 재료 2개를 골라 '달걀, 토마토'처럼 (그대로 검색하면 결과가 나온다)
// 양념·향신료는 빼고(main_ingredients), 재료가 2개 이상인 요리가 없으면 빈 문자열 → '재료로 검색해보세요!'
function randomExample(recipes: RecipeSummary[]): string {
  const candidates = recipes.filter((r) => new Set(r.main_ingredients).size >= 2);
  if (candidates.length === 0) return '';
  const names = [...new Set(pick(candidates).main_ingredients)];
  const first = pick(names);
  const second = pick(names.filter((n) => n !== first));
  return `${first}, ${second}`;
}

// 요리 탭 - 검색(이름·재료, 쉼표로 AND) + 정렬(최근 먹은·오래 안 먹은·국가별 묶음), 오늘 먹음 체크
// 정렬은 해시 쿼리와 localStorage에 기록되어 상세→뒤로가기·재접속에도 보존된다
@customElement('recipes-view')
export class RecipesView extends LitElement {
  static styles = [
    tokens,
    ui,
    css`
      :host { display: block; min-height: 100dvh; background: var(--bg); padding-bottom: calc(90px + env(safe-area-inset-bottom)); }
      .top {
        position: sticky; top: 0; z-index: 5;
        background: var(--bg);
        padding: calc(10px + env(safe-area-inset-top)) 16px 10px;
        border-bottom: 1px solid var(--border);
      }
      /* iOS 검색 필드 - 캡슐형, 시스템 fill(tertiarySystemFill) 배경, 포커스 링 없음 */
      .search {
        position: relative;
        display: flex; align-items: center;
        height: 36px; border-radius: 999px;
        background: var(--fill);
        color: var(--placeholder);
      }
      .search .lead { position: absolute; left: 12px; pointer-events: none; display: grid; }
      .search input {
        flex: 1; height: 100%; min-width: 0;
        border: none; outline: none; background: none; border-radius: 999px;
        padding: 0 34px 0 34px;
        font-size: 0.93rem; letter-spacing: -0.1px; color: var(--text);
        caret-color: var(--accent);
      }
      .search input:focus { outline: none; }
      .search input::placeholder { color: var(--placeholder); opacity: 1; }
      .search input::-webkit-search-cancel-button { display: none; }
      /* xmark.circle.fill */
      .search .clear {
        position: absolute; right: 9px;
        width: 18px; height: 18px; border-radius: 50%;
        display: grid; place-items: center; padding: 0;
        background: var(--placeholder);
      }
      .search .clear svg { color: var(--bg); }
      .sort-row { display: flex; gap: 6px; padding-top: 10px; overflow-x: auto; scrollbar-width: none; }
      .sort-row::-webkit-scrollbar { display: none; }
      .sort-chip {
        padding: 6px 12px; border-radius: 999px;
        background: var(--accent-soft); color: var(--text-sub);
        font-size: 0.8rem; white-space: nowrap; flex-shrink: 0;
      }
      .sort-chip.on { background: var(--accent); color: #fff; font-weight: 700; }
      .group-head {
        display: flex; align-items: baseline; gap: 6px;
        margin: 14px 16px 2px;
        font-size: 0.8rem; font-weight: 700; color: var(--accent);
      }
      .group-head .count { color: var(--text-sub); font-weight: 400; }
      .empty { text-align: center; color: var(--text-sub); padding: 60px 24px; line-height: 1.6; }
      .empty .big { font-size: 2.4rem; margin-bottom: 8px; }
      .ptr { text-align: center; color: var(--text-sub); font-size: 0.76rem; overflow: hidden; height: 0; transition: height 0.15s; }
      .ptr.show { height: 28px; padding-top: 8px; }
      .sk-row { display: flex; gap: 10px; padding: 9px 16px; align-items: center; }
      .sk-thumb { width: 52px; height: 52px; flex-shrink: 0; }
      .sk-lines { flex: 1; display: flex; flex-direction: column; gap: 6px; }
      .sk-line { height: 11px; }
    `,
  ];

  @state() private recipes: RecipeSummary[] = [];
  @state() private loaded = false;
  @state() private q = '';
  @state() private placeholder = '';
  @state() private sort: SortKey = 'recent';
  @state() private pulling = false;

  private touchStartY = 0;

  connectedCallback(): void {
    super.connectedCallback();
    this.restoreState();
    const cached = cachedRecipes();
    if (cached) {
      this.recipes = cached;
      this.loaded = true;
    }
    void this.load();
  }

  // 복원 우선순위: 해시 쿼리 > localStorage > 기본(최근 먹은)
  private restoreState(): void {
    const { params } = parseHash(location.hash);
    let saved: { sort?: string } = {};
    if (params.has('sort')) {
      saved = { sort: params.get('sort')! };
    } else {
      try {
        saved = JSON.parse(localStorage.getItem(STATE_KEY) ?? '{}') as typeof saved;
      } catch {
        saved = {};
      }
    }
    const sort = SORTS.find((s) => s.key === saved.sort);
    if (sort) this.sort = sort.key;
    this.syncState();
  }

  private syncState(): void {
    replaceHashQuery('#/recipes', { sort: this.sort === 'recent' ? null : this.sort });
    localStorage.setItem(STATE_KEY, JSON.stringify({ sort: this.sort }));
  }

  private async load(): Promise<void> {
    this.recipes = await loadRecipes();
    this.loaded = true;
    if (!this.placeholder) this.placeholder = randomExample(this.recipes);
  }

  // 쉼표로 나눈 검색어를 모두 만족하는 요리 ('달걀, 토마토' = 둘 다 쓰는 요리)
  private get visible(): RecipeSummary[] {
    const terms = this.q
      .toLowerCase()
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (terms.length === 0) return this.recipes;
    return this.recipes.filter((r) =>
      terms.every(
        (t) => r.name.toLowerCase().includes(t) || r.ingredient_names.some((n) => n.toLowerCase().includes(t)),
      ),
    );
  }

  private async onUndo(r: RecipeSummary): Promise<void> {
    await undoToday(r.id);
    await this.load();
  }

  // 먹음 버튼 탭 = 날짜·사진 선택 기록
  private async onRecord(r: RecipeSummary): Promise<void> {
    const input = await openMealSheet({ recipeName: r.name });
    if (!input) return;
    await saveMeal(r.id, input);
    await this.load();
  }

  // 당겨서 새로고침 (문서 최상단에서만)
  private onTouchStart = (e: TouchEvent): void => {
    this.touchStartY = window.scrollY === 0 ? (e.touches[0]?.clientY ?? 0) : -1;
  };
  private onTouchMove = (e: TouchEvent): void => {
    if (this.touchStartY < 0) return;
    this.pulling = (e.touches[0]?.clientY ?? 0) - this.touchStartY > 70;
  };
  private onTouchEnd = (): void => {
    if (this.pulling) {
      this.pulling = false;
      void this.load().then(() => toast('새로고침 완료', { duration: 1200 }));
    }
    this.touchStartY = -1;
  };

  private renderItem(r: RecipeSummary): TemplateResult {
    return html`
      <recipe-item
        .recipe=${r}
        @open=${(): void => { location.hash = `#/recipes/${r.id}`; }}
        @undo=${(): void => void this.onUndo(r)}
        @record=${(): void => void this.onRecord(r)}
      ></recipe-item>
    `;
  }

  private renderList(): TemplateResult {
    if (this.recipes.length === 0) {
      return html`
        <div class="empty">
          <div class="big">🍳</div>
          아직 레시피가 없어요
        </div>
      `;
    }
    const visible = this.visible;
    if (visible.length === 0) return html`<div class="empty">검색 결과가 없어요</div>`;
    if (this.sort === 'country') {
      // 국가 안은 이름순 고정 - 체크해도 순서가 흔들리지 않게
      const groups = new Map<string, RecipeSummary[]>();
      for (const r of [...visible].sort(byName)) {
        if (!groups.has(r.category)) groups.set(r.category, []);
        groups.get(r.category)!.push(r);
      }
      const names = [...groups.keys()].sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));
      return html`${names.map(
        (g) => html`
          <div class="group-head">${g} <span class="count">${groups.get(g)!.length}</span></div>
          ${groups.get(g)!.map((r) => this.renderItem(r))}
        `,
      )}`;
    }
    const sorted = [...visible].sort((a, b) => {
      switch (this.sort) {
        case 'recent': return cmpDate(a.last_eaten_on, b.last_eaten_on, true) || byName(a, b);
        default: return cmpDate(a.last_eaten_on, b.last_eaten_on, false) || byName(a, b);
      }
    });
    return html`${sorted.map((r) => this.renderItem(r))}`;
  }

  private renderSkeleton(): TemplateResult {
    return html`${[1, 2, 3, 4, 5, 6].map(
      () => html`
        <div class="sk-row">
          <div class="skeleton sk-thumb"></div>
          <div class="sk-lines">
            <div class="skeleton sk-line" style="width: 40%"></div>
            <div class="skeleton sk-line" style="width: 65%"></div>
          </div>
        </div>
      `,
    )}`;
  }

  render(): TemplateResult {
    return html`
      <div
        @touchstart=${this.onTouchStart}
        @touchmove=${this.onTouchMove}
        @touchend=${this.onTouchEnd}
      >
        <div class="top">
          <label class="search">
            <span class="lead">${icon('search', 15)}</span>
            <input
              type="search"
              enterkeyhint="search"
              placeholder=${this.placeholder || '재료로 검색해보세요!'}
              .value=${this.q}
              @input=${(e: Event): void => { this.q = (e.target as HTMLInputElement).value; }}
            >
            ${this.q
              ? html`<button class="clear" aria-label="지우기" @click=${(e: Event): void => { e.preventDefault(); this.q = ''; }}>${icon('x', 12)}</button>`
              : nothing}
          </label>
          <div class="sort-row">
            ${SORTS.map(
              (s) => html`
                <button
                  class="sort-chip ${this.sort === s.key ? 'on' : ''}"
                  @click=${(): void => { this.sort = s.key; this.syncState(); }}
                >${s.label}</button>
              `,
            )}
          </div>
        </div>
        <div class="ptr ${this.pulling ? 'show' : ''}">놓으면 새로고침</div>

        ${this.loaded ? this.renderList() : this.renderSkeleton()}
      </div>
    `;
  }
}
