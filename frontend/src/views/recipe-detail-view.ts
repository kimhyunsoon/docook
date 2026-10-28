import { LitElement, html, css, nothing, svg, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tokens, ui } from '../style.js';
import { api, today, addDays, fileUrl } from '../api.js';
import { toast, uiConfirm, Press } from '../ui.js';
import { icon } from '../icons.js';
import { fmtDate, fmtDateLong, fmtRel, fmtAmount, avgGap } from '../fmt.js';
import { refreshRecipes } from '../store.js';
import { saveMeal, undoToday } from '../actions.js';
import { openMealSheet } from '../sheets/meal-sheet.js';
import type { Photo, RecipeDetail, RecipeIngredient } from '../types.js';
import '../sheets/photo-lightbox.js';
import type { PhotoLightbox } from '../sheets/photo-lightbox.js';

const HEATMAP_WEEKS = 26;
const CELL = 13;
const GAP = 3;

@customElement('recipe-detail-view')
export class RecipeDetailView extends LitElement {
  static styles = [
    tokens,
    ui,
    css`
      :host { display: block; min-height: 100dvh; background: var(--bg); padding-bottom: calc(40px + env(safe-area-inset-bottom)); }
      .top {
        display: flex; align-items: center; gap: 6px;
        padding: calc(12px + env(safe-area-inset-top)) 16px 12px;
        position: sticky; top: 0; background: var(--bg); z-index: 5;
      }
      .top .back { padding: 6px 8px 6px 0; color: var(--text); background: none; display: grid; place-items: center; }
      .top h1 { font-size: 1.15rem; margin: 0; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .hero {
        display: block; margin: 0 16px; width: calc(100% - 32px);
        aspect-ratio: 4 / 3; object-fit: cover; border-radius: 16px;
        background: var(--accent-soft); cursor: pointer;
      }
      .headline { margin: 12px 18px 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .summary { color: var(--text-sub); font-size: 0.88rem; }
      .stats {
        display: grid; grid-template-columns: 1fr 1fr 1fr;
        margin: 12px 16px 0;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 14px;
        padding: 12px 4px;
        text-align: center;
      }
      .stats > div { padding: 0 8px; min-width: 0; }
      .stats > div + div { border-left: 1px solid var(--border); }
      .stats .k { font-size: 0.74rem; color: var(--text-sub); margin-bottom: 3px; }
      .stats .v { font-size: 0.9rem; font-weight: 700; word-break: keep-all; }
      .actions { display: flex; gap: 8px; margin: 12px 16px 0; }
      .actions .btn-primary { flex: 1; }
      .actions .btn-soft { display: flex; align-items: center; gap: 5px; white-space: nowrap; }
      /* 오늘 먹음 - 목록의 흐린 체크 버튼과 같은 결 (재탭 = 취소) */
      .btn-primary.done { background: transparent; border: 1px dashed var(--border); color: var(--text-sub); }
      .block { margin: 12px 16px; }
      .block h2 { font-size: 0.98rem; margin: 0 0 8px; display: flex; align-items: center; gap: 8px; }
      .block h2 .grow { flex: 1; }
      .block h2 .count { color: var(--text-sub); font-weight: 400; font-size: 0.82rem; }
      .section-name { font-size: 0.78rem; font-weight: 700; color: var(--accent); margin: 10px 0 2px; }
      .ing-list { list-style: none; margin: 0; padding: 0; }
      .ing-list li { padding: 7px 0; border-bottom: 1px solid var(--border); font-size: 0.92rem; }
      .ing-list .row { display: flex; align-items: baseline; gap: 8px; }
      .ing-list .row + .row { margin-top: 4px; }
      .ing-list li:last-child { border-bottom: none; }
      .ing-list .note { color: var(--text-sub); font-size: 0.8rem; }
      .ing-list .opt { font-size: 0.7rem; color: var(--text-sub); border: 1px solid var(--border); border-radius: 6px; padding: 0 5px; }
      .ing-list .or { color: var(--text-sub); font-size: 0.78rem; }
      .ing-list .amt { margin-left: auto; color: var(--text-sub); font-variant-numeric: tabular-nums; white-space: nowrap; }
      .steps { list-style: none; margin: 0; padding: 0; }
      .steps li { display: flex; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--border); }
      .steps li:last-child { border-bottom: none; }
      .steps .no {
        flex-shrink: 0; width: 24px; height: 24px; border-radius: 50%;
        background: var(--accent); color: #fff; font-size: 0.78rem; font-weight: 700;
        display: grid; place-items: center;
      }
      .steps .body { flex: 1; min-width: 0; font-size: 0.92rem; line-height: 1.55; }
      .steps .meta { display: flex; gap: 6px; margin-bottom: 2px; }
      .steps .method {
        font-size: 0.7rem; font-weight: 700; color: var(--accent);
        background: var(--accent-soft); border-radius: 6px; padding: 1px 6px;
      }
      .steps .min { font-size: 0.72rem; color: var(--text-sub); display: flex; align-items: center; gap: 2px; }
      .seg-mini { width: 140px; }
      .chart-wrap { overflow-x: auto; padding: 4px 0 6px; scrollbar-width: none; }
      .chart-wrap::-webkit-scrollbar { display: none; }
      .chart-wrap svg { display: block; width: 100%; height: auto; }
      .chart-cap { text-align: center; font-size: 0.78rem; color: var(--text-sub); }
      .timeline { list-style: none; padding: 0; margin: 0; }
      .timeline li {
        display: flex; align-items: center; gap: 10px;
        padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 0.9rem;
      }
      .timeline .cam { color: var(--text-sub); }
      .timeline .del { margin-left: auto; color: var(--text-sub); background: none; padding: 4px 6px; }
      .photo-day { font-size: 0.8rem; font-weight: 700; color: var(--text-sub); margin: 12px 2px 6px; }
      .photo-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; }
      .photo-grid .cell { position: relative; aspect-ratio: 1; cursor: pointer; }
      .photo-grid img { width: 100%; height: 100%; object-fit: cover; border-radius: 10px; display: block; background: var(--accent-soft); }
      .photo-grid .badge {
        position: absolute; left: 5px; top: 5px;
        background: rgba(0, 0, 0, 0.55); color: #ffcf6e;
        border-radius: 7px; padding: 3px; display: grid; place-items: center;
      }
      .empty-line { color: var(--text-sub); font-size: 0.86rem; padding: 6px 0; }
    `,
  ];

  @property({ attribute: 'recipe-id' }) recipeId = '';
  @state() private recipe: RecipeDetail | null = null;
  @state() private logView: 'graph' | 'list' = 'graph';

  private mealGesture = new Press(
    () => void this.checkToday(),
    () => void this.record(false),
  );

  connectedCallback(): void {
    super.connectedCallback();
    void this.load();
    if (!localStorage.getItem('hint-record')) {
      localStorage.setItem('hint-record', '1');
      setTimeout(() => toast('먹었어요 버튼을 길게 누르면 다른 날짜로 기록할 수 있어요', { duration: 4000 }), 600);
    }
  }

  private async load(): Promise<void> {
    this.recipe = await api<RecipeDetail>(`/api/recipes/${this.recipeId}`);
    this.lightbox?.refresh(this.recipe.photos, this.recipe.primary_photo_id);
  }

  private async reload(): Promise<void> {
    await this.load();
    void refreshRecipes(); // 목록 캐시 동기화 (back으로 복귀 시 최신)
  }

  // 그래프는 항상 오른쪽 끝(최근)부터 보이도록
  protected updated(): void {
    if (this.logView !== 'graph') return;
    const wrap = this.renderRoot.querySelector<HTMLElement>('.chart-wrap');
    if (wrap && wrap.dataset.scrolled !== '1') {
      wrap.dataset.scrolled = '1';
      wrap.scrollLeft = wrap.scrollWidth;
    }
  }

  private get lightbox(): PhotoLightbox | null {
    return this.renderRoot?.querySelector('photo-lightbox') ?? null;
  }

  private get eatenToday(): boolean {
    return this.recipe?.meals[0]?.eaten_on === today();
  }

  private async checkToday(): Promise<void> {
    await api(`/api/recipes/${this.recipeId}/meals`, { method: 'POST' });
    toast('오늘 먹은 기록을 남겼어요', { duration: 1600 });
    await this.reload();
  }

  private async undo(): Promise<void> {
    await undoToday(Number(this.recipeId));
    await this.reload();
  }

  // 날짜·사진 시트 (photoFirst = 사진 추가 버튼으로 열기)
  private async record(photoFirst: boolean): Promise<void> {
    const r = this.recipe;
    if (!r) return;
    const input = await openMealSheet({
      recipeName: r.name,
      marked: r.meals.map((m) => m.eaten_on),
      photoFirst,
    });
    if (!input) return;
    await saveMeal(r.id, input);
    await this.reload();
  }

  private async deleteMeal(id: number, date: string): Promise<void> {
    const ok = await uiConfirm(`${fmtDate(date)} 먹은 기록을 삭제할까요?\n(그날 사진은 남아요)`, {
      confirmLabel: '삭제',
      danger: true,
    });
    if (!ok) return;
    await api(`/api/meals/${id}`, { method: 'DELETE' });
    await this.reload();
  }

  private openLightbox(photo: Photo): void {
    const r = this.recipe!;
    this.lightbox?.show(r.photos, r.photos.indexOf(photo), r.primary_photo_id);
  }

  // 명시 대표면 해제(→ 최근 사진이 대표), 아니면 대표로 지정
  private async togglePrimary(e: Event): Promise<void> {
    const photo = (e as CustomEvent<Photo>).detail;
    if (photo.is_primary) {
      await api(`/api/photos/${photo.id}/primary`, { method: 'DELETE' });
      toast('대표 지정을 해제했어요 · 최근 사진이 대표가 돼요', { duration: 2000 });
    } else {
      await api(`/api/photos/${photo.id}/primary`, { method: 'POST' });
      toast('대표 사진으로 지정했어요', { duration: 1500 });
    }
    await this.reload();
  }

  private async deletePhoto(e: Event): Promise<void> {
    const photo = (e as CustomEvent<Photo>).detail;
    const ok = await uiConfirm('이 사진을 삭제할까요?', { confirmLabel: '삭제', danger: true });
    if (!ok) return;
    await api(`/api/photos/${photo.id}`, { method: 'DELETE' });
    await this.reload();
  }

  // 어느 탭에서 들어왔든 이전 화면으로 (직접 진입이면 요리 탭으로)
  private goBack(): void {
    if (history.length > 1) history.back();
    else location.hash = '#/recipes';
  }

  private renderIngredients(): TemplateResult {
    const r = this.recipe!;
    if (r.ingredients.length === 0) return html`<div class="empty-line">재료 정보가 없어요</div>`;
    // 묶음(section) 순서는 첫 등장 순, 묶음 없는 재료가 먼저
    // 대체 재료(alternative)는 앞 재료와 한 묶음으로 - "피망 2개 / 혹은 오이고추 5개"
    const sections = new Map<string, RecipeIngredient[][]>();
    for (const ing of r.ingredients) {
      const key = ing.section ?? '';
      if (!sections.has(key)) sections.set(key, []);
      const groups = sections.get(key)!;
      if (ing.alternative && groups.length > 0) groups[groups.length - 1]!.push(ing);
      else groups.push([ing]);
    }
    const keys = [...sections.keys()].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : 0));
    return html`${keys.map(
      (key) => html`
        ${key ? html`<div class="section-name">${key}</div>` : nothing}
        <ul class="ing-list">
          ${sections.get(key)!.map(
            (group) => html`
              <li>
                ${group.map(
                  (ing, i) => html`
                    <div class="row">
                      ${i > 0 ? html`<span class="or">혹은</span>` : nothing}
                      <span>${ing.name}</span>
                      ${ing.note ? html`<span class="note">${ing.note}</span>` : nothing}
                      ${ing.optional ? html`<span class="opt">선택</span>` : nothing}
                      <span class="amt">${fmtAmount(ing.amount, ing.unit)}</span>
                    </div>
                  `,
                )}
              </li>
            `,
          )}
        </ul>
      `,
    )}`;
  }

  private renderSteps(): TemplateResult {
    const r = this.recipe!;
    if (r.steps.length === 0) return html`<div class="empty-line">조리 순서가 없어요</div>`;
    return html`
      <ol class="steps">
        ${r.steps.map(
          (s) => html`
            <li>
              <span class="no">${s.step_no}</span>
              <div class="body">
                ${s.method || s.minutes
                  ? html`
                      <div class="meta">
                        ${s.method ? html`<span class="method">${s.method}</span>` : nothing}
                        ${s.minutes ? html`<span class="min">${icon('clock', 12)} ${s.minutes}분</span>` : nothing}
                      </div>
                    `
                  : nothing}
                ${s.text}
              </div>
            </li>
          `,
        )}
      </ol>
    `;
  }

  // 먹은 날 히트맵 (최근 26주, 한 칸 = 하루, 사진 있는 날은 진하게)
  private renderChart(): TemplateResult {
    const r = this.recipe!;
    const eaten = new Set(r.meals.map((m) => m.eaten_on));
    const photoDays = new Set(r.photos.map((p) => p.taken_on));
    const base = today();
    const thisSunday = addDays(base, -new Date(`${base}T00:00:00`).getDay());
    const LEFT = 20;
    const TOP = 16;
    const step = CELL + GAP;
    const width = LEFT + HEATMAP_WEEKS * step - GAP + 2;
    const height = TOP + 7 * step - GAP + 2;
    const cells: TemplateResult[] = [];
    let prevMonth = '';
    for (let w = 0; w < HEATMAP_WEEKS; w++) {
      const weekStart = addDays(thisSunday, -7 * (HEATMAP_WEEKS - 1 - w));
      const month = weekStart.slice(5, 7);
      if (month !== prevMonth) {
        prevMonth = month;
        cells.push(svg`<text x=${LEFT + w * step} y="10" font-size="9" fill="var(--text-sub)">${Number(month)}월</text>`);
      }
      for (let d = 0; d < 7; d++) {
        const date = addDays(weekStart, d);
        if (date > base) continue;
        const on = eaten.has(date);
        cells.push(svg`<rect
          x=${LEFT + w * step} y=${TOP + d * step}
          width=${CELL} height=${CELL} rx="4"
          fill=${on ? 'var(--accent)' : 'var(--border)'}
          opacity=${on ? (photoDays.has(date) ? '1' : '0.65') : '0.35'}
          stroke=${date === base ? 'var(--accent)' : 'none'} stroke-width="1.5"
        />`);
      }
    }
    for (const { d, label } of [
      { d: 1, label: '월' },
      { d: 3, label: '수' },
      { d: 5, label: '금' },
    ]) {
      cells.push(svg`<text x="0" y=${TOP + d * step + CELL - 3} font-size="9" fill="var(--text-sub)">${label}</text>`);
    }
    const from = addDays(thisSunday, -7 * (HEATMAP_WEEKS - 1));
    const inRange = r.meals.filter((m) => m.eaten_on >= from).length;
    return html`
      <div class="chart-wrap">
        <svg viewBox="0 0 ${width} ${height}" style="min-width:${width}px">${cells}</svg>
      </div>
      <div class="chart-cap">최근 ${HEATMAP_WEEKS}주 ${inRange}회 · 진한 칸은 사진 있는 날</div>
    `;
  }

  private renderMealList(): TemplateResult {
    const r = this.recipe!;
    if (r.meals.length === 0) return html`<div class="empty-line">아직 먹은 기록이 없어요</div>`;
    const photoDays = new Set(r.photos.map((p) => p.taken_on));
    const base = today();
    return html`
      <ul class="timeline">
        ${r.meals.map(
          (m) => html`
            <li>
              <span>${fmtDateLong(m.eaten_on, base)}</span>
              ${photoDays.has(m.eaten_on) ? html`<span class="cam">${icon('camera', 14)}</span>` : nothing}
              <span class="sub">${fmtRel(m.eaten_on, base)}</span>
              <button class="del" aria-label="삭제" @click=${(): void => void this.deleteMeal(m.id, m.eaten_on)}>
                ${icon('x', 15)}
              </button>
            </li>
          `,
        )}
      </ul>
    `;
  }

  // 사진 - 날짜별 묶음 (최근 날짜 먼저)
  private renderPhotos(): TemplateResult {
    const r = this.recipe!;
    if (r.photos.length === 0) return html`<div class="empty-line">사진이 없어요. 먹은 날 사진을 남겨보세요</div>`;
    const days = new Map<string, Photo[]>();
    for (const p of r.photos) {
      if (!days.has(p.taken_on)) days.set(p.taken_on, []);
      days.get(p.taken_on)!.push(p);
    }
    const base = today();
    return html`${[...days.entries()].map(
      ([day, photos]) => html`
        <div class="photo-day">${fmtDateLong(day, base)}</div>
        <div class="photo-grid">
          ${photos.map(
            (p) => html`
              <div class="cell" @click=${(): void => this.openLightbox(p)}>
                <img src=${fileUrl(p.thumb_path ?? p.path)} alt="" loading="lazy">
                ${p.id === r.primary_photo_id ? html`<span class="badge">${icon('star', 12)}</span>` : nothing}
              </div>
            `,
          )}
        </div>
      `,
    )}`;
  }

  render(): TemplateResult {
    const r = this.recipe;
    if (!r) {
      return html`<div class="top"><button class="back" @click=${this.goBack}>${icon('chevron-left', 24)}</button></div>`;
    }
    const base = today();
    const primary = r.photos.find((p) => p.id === r.primary_photo_id) ?? null;
    const last = r.meals[0]?.eaten_on ?? null;
    const gap = avgGap(r.meals.map((m) => m.eaten_on));
    return html`
      <div class="top">
        <button class="back" @click=${this.goBack} aria-label="뒤로">${icon('chevron-left', 24)}</button>
        <h1>${r.name}</h1>
      </div>

      ${primary
        ? html`<img class="hero" src=${fileUrl(primary.path)} alt="" @click=${(): void => this.openLightbox(primary)}>`
        : nothing}

      ${r.summary ? html`<div class="headline"><span class="summary">${r.summary}</span></div>` : nothing}

      <div class="stats">
        <div>
          <div class="k">마지막</div>
          <div class="v">${fmtRel(last, base) ?? '-'}</div>
        </div>
        <div>
          <div class="k">먹은 횟수</div>
          <div class="v">${r.meals.length}회</div>
        </div>
        <div>
          <div class="k">평균 간격</div>
          <div class="v">${gap ? `${gap}일` : '-'}</div>
        </div>
      </div>

      <div class="actions">
        ${this.eatenToday
          ? html`<button class="btn-primary done" @click=${(): void => void this.undo()}>오늘 먹음 취소</button>`
          : html`
              <button
                class="btn-primary"
                @pointerdown=${this.mealGesture.down}
                @pointermove=${this.mealGesture.move}
                @pointerup=${this.mealGesture.up}
                @pointercancel=${this.mealGesture.up}
                @click=${this.mealGesture.click}
              >오늘 먹었어요</button>
            `}
        <button class="btn-soft" @click=${(): void => void this.record(true)}>${icon('camera', 17)} 사진</button>
      </div>

      <div class="block card">
        <h2>
          재료 <span class="count">${r.ingredients.filter((i) => !i.alternative).length}</span>
          ${r.servings ? html`<span class="grow"></span><span class="count">${r.servings}인분 기준</span>` : nothing}
        </h2>
        ${this.renderIngredients()}
      </div>

      <div class="block card">
        <h2>조리 순서</h2>
        ${this.renderSteps()}
      </div>

      <div class="block">
        <h2>
          먹은 기록 <span class="grow"></span>
          <div class="segmented seg-mini">
            <button class=${this.logView === 'graph' ? 'on' : ''} @click=${(): void => { this.logView = 'graph'; }}>그래프</button>
            <button class=${this.logView === 'list' ? 'on' : ''} @click=${(): void => { this.logView = 'list'; }}>목록</button>
          </div>
        </h2>
        ${this.logView === 'graph' ? this.renderChart() : this.renderMealList()}
      </div>

      <div class="block">
        <h2>사진 <span class="count">${r.photos.length}</span></h2>
        ${this.renderPhotos()}
      </div>


      <photo-lightbox
        @primary=${(e: Event): void => void this.togglePrimary(e)}
        @delete=${(e: Event): void => void this.deletePhoto(e)}
      ></photo-lightbox>
    `;
  }
}
