import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { tokens, ui } from '../style.js';
import { toast } from '../ui.js';
import { icon } from '../icons.js';
import { parseHash, replaceHashQuery } from '../router.js';
import { cachedRecipes, loadRecipes } from '../store.js';
import { checkToday, undoToday, saveMeal } from '../actions.js';
import { openMealSheet } from '../sheets/meal-sheet.js';
import type { RecipeSummary } from '../types.js';
import '../components/recipe-item.js';

type ViewMode = 'group' | 'list';
type SortKey = 'recent' | 'stale' | 'count' | 'name';

const STATE_KEY = 'docook:recipes-state';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'recent', label: '최근 먹은' },
  { key: 'stale', label: '오래 안 먹은' },
  { key: 'count', label: '많이 먹은' },
  { key: 'name', label: '이름' },
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

// 요리 탭 - 분류별 그룹 / 정렬 목록, 검색(이름·재료), 오늘 먹음 체크
// 모드·정렬은 해시 쿼리와 localStorage에 기록되어 상세→뒤로가기·재접속에도 보존된다
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
        padding: calc(12px + env(safe-area-inset-top)) 16px 10px;
        border-bottom: 1px solid var(--border);
      }
      .title-row { display: flex; align-items: center; gap: 4px; }
      .title-row h1 { font-size: 1.15rem; margin: 0; flex: 1; }
      .title-row button {
        color: var(--text-sub); background: none; padding: 7px;
        display: grid; place-items: center;
      }
      .title-row button.on { color: var(--accent); }
      .search-row { padding-top: 8px; }
      .mode-row { padding-top: 8px; }
      .sort-row { display: flex; gap: 6px; padding-top: 8px; overflow-x: auto; scrollbar-width: none; }
      .sort-row::-webkit-scrollbar { display: none; }
      .sort-chip {
        padding: 6px 11px; border-radius: 999px;
        background: var(--accent-soft); color: var(--text-sub);
        font-size: 0.78rem; white-space: nowrap; flex-shrink: 0;
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
  @state() private searchOpen = false;
  @state() private view: ViewMode = 'group';
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

  // 복원 우선순위: 해시 쿼리 > localStorage > 기본(그룹)
  private restoreState(): void {
    const { params } = parseHash(location.hash);
    let saved: { view?: string; sort?: string } = {};
    if (params.has('view')) {
      saved = { view: params.get('view')!, sort: params.get('sort') ?? '' };
    } else {
      try {
        saved = JSON.parse(localStorage.getItem(STATE_KEY) ?? '{}') as typeof saved;
      } catch {
        saved = {};
      }
    }
    if (saved.view === 'list') this.view = 'list';
    const sort = SORTS.find((s) => s.key === saved.sort);
    if (sort) this.sort = sort.key;
    this.syncState();
  }

  private syncState(): void {
    const isList = this.view === 'list';
    replaceHashQuery('#/recipes', { view: isList ? 'list' : null, sort: isList ? this.sort : null });
    localStorage.setItem(STATE_KEY, JSON.stringify({ view: this.view, sort: this.sort }));
  }

  private async load(): Promise<void> {
    this.recipes = await loadRecipes();
    this.loaded = true;
  }

  private get visible(): RecipeSummary[] {
    const q = this.q.trim().toLowerCase();
    if (!q) return this.recipes;
    return this.recipes.filter(
      (r) => r.name.toLowerCase().includes(q) || r.ingredient_names.some((n) => n.toLowerCase().includes(q)),
    );
  }

  private async onCheck(r: RecipeSummary): Promise<void> {
    await checkToday(r.id, r.name, () => void this.load());
    await this.load();
  }

  private async onUndo(r: RecipeSummary): Promise<void> {
    await undoToday(r.id);
    await this.load();
  }

  // 체크 버튼 길게 = 날짜·사진 선택 기록
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
        @check=${(): void => void this.onCheck(r)}
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
    if (this.view === 'group') {
      // 그룹 안은 이름순 고정 - 체크해도 순서가 흔들리지 않게
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
        case 'stale': return cmpDate(a.last_eaten_on, b.last_eaten_on, false) || byName(a, b);
        case 'count': return b.meal_count - a.meal_count || byName(a, b);
        default: return byName(a, b);
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
          <div class="title-row">
            <h1>요리 ${this.loaded ? this.visible.length : ''}</h1>
            <button aria-label="검색" class=${this.searchOpen ? 'on' : ''} @click=${(): void => {
              this.searchOpen = !this.searchOpen;
              if (!this.searchOpen) this.q = '';
            }}>${icon(this.searchOpen ? 'x' : 'search')}</button>
          </div>
          ${this.searchOpen
            ? html`
                <div class="search-row">
                  <input
                    type="search"
                    placeholder="요리 이름·재료로 검색"
                    .value=${this.q}
                    @input=${(e: Event): void => { this.q = (e.target as HTMLInputElement).value; }}
                  >
                </div>
              `
            : nothing}
          <div class="mode-row">
            <div class="segmented">
              <button class=${this.view === 'group' ? 'on' : ''} @click=${(): void => { this.view = 'group'; this.syncState(); }}>분류</button>
              <button class=${this.view === 'list' ? 'on' : ''} @click=${(): void => { this.view = 'list'; this.syncState(); }}>목록</button>
            </div>
          </div>
          ${this.view === 'list'
            ? html`
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
              `
            : nothing}
        </div>
        <div class="ptr ${this.pulling ? 'show' : ''}">놓으면 새로고침</div>

        ${this.loaded ? this.renderList() : this.renderSkeleton()}
      </div>
    `;
  }
}
