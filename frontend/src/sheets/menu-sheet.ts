import { html, css, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { tokens, ui, sheet } from '../style.js';
import { icon } from '../icons.js';
import { today, addDays, pickImages } from '../api.js';
import { fmtDateLong, CATEGORY_ORDER } from '../fmt.js';
import { cachedRecipes } from '../store.js';
import { SheetBase } from './sheet-base.js';
import { pickDate } from './date-sheet.js';

export interface MenuInput {
  name: string;
  category: string;
  date: string | null; // null = 먹은 기록 없이 메뉴만
  files: File[];
}

interface MenuSheetOptions {
  name?: string; // 미리 채울 이름 (달력 검색어)
  date?: string; // 지정되면 그날 먹은 기록으로 고정 (달력에서 추가)
}

// 메뉴 추가 시트 - 레시피·재료 없이 이름 + 국가 + 사진(선택)
// 사진을 넣으면 먹은 날을 고르고 그날 기록도 함께 남는다 (사진 = 먹은 기록)
@customElement('menu-sheet')
export class MenuSheet extends SheetBase {
  static styles = [
    tokens,
    ui,
    sheet,
    css`
      .label { font-size: 0.8rem; font-weight: 700; color: var(--text-sub); margin: 14px 2px 8px; }
      .label:first-child { margin-top: 6px; }
      .name { width: 100%; box-sizing: border-box; }
      .err { color: var(--danger); font-size: 0.8rem; margin: 6px 2px 0; }
      .chips { display: flex; gap: 6px; flex-wrap: wrap; }
      .chip {
        padding: 8px 13px; border-radius: 999px;
        background: var(--accent-soft); color: var(--text-sub);
        font-size: 0.86rem; font-weight: 600;
        display: flex; align-items: center; gap: 4px;
      }
      .chip.on { background: var(--accent); color: #fff; }
      .date-line { margin: 10px 2px 0; font-weight: 700; }
      .photos { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
      .photos .cell { position: relative; aspect-ratio: 1; }
      .photos img { width: 100%; height: 100%; object-fit: cover; border-radius: 10px; display: block; }
      .photos .rm {
        position: absolute; top: 3px; right: 3px;
        width: 22px; height: 22px; border-radius: 50%;
        background: rgba(0, 0, 0, 0.55); color: #fff;
        display: grid; place-items: center; padding: 0;
      }
      .photos .add {
        aspect-ratio: 1; border-radius: 10px;
        border: 1.5px dashed var(--border); background: none; color: var(--text-sub);
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
        font-size: 0.72rem;
      }
      .btn-primary { margin-top: 20px; }
    `,
  ];

  @state() private name = '';
  @state() private category = '한국';
  @state() private date = '';
  @state() private files: File[] = [];
  @state() private previews: string[] = [];
  private options: MenuSheetOptions = {};
  private result: MenuInput | null = null;
  private resolveFn?: (value: MenuInput | null) => void;

  protected get sheetTitle(): string {
    return '메뉴 추가';
  }

  show(options: MenuSheetOptions): Promise<MenuInput | null> {
    this.options = options;
    this.name = options.name ?? '';
    this.category = '한국';
    this.date = options.date ?? today();
    this.setFiles([]);
    this.result = null;
    this.openSheet();
    // 이름 칸에 바로 입력 (iOS는 제스처 밖 focus에 키보드를 안 띄울 수 있음 - 그래도 커서는 놓인다)
    void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLInputElement>('.name')?.focus());
    return new Promise((resolve) => {
      this.resolveFn = resolve;
    });
  }

  protected onClosed(): void {
    this.setFiles([]);
    this.resolveFn?.(this.result);
  }

  private setFiles(files: File[]): void {
    for (const url of this.previews) URL.revokeObjectURL(url);
    this.files = files;
    this.previews = files.map((f) => URL.createObjectURL(f));
  }

  private async addPhotos(): Promise<void> {
    const picked = await pickImages(true);
    if (picked.length > 0) this.setFiles([...this.files, ...picked]);
  }

  private async openCalendar(): Promise<void> {
    const picked = await pickDate(this.date, { title: '먹은 날' });
    if (picked) this.date = picked;
  }

  // 이미 있는 이름 (서버도 대소문자 무시 UNIQUE로 거부한다)
  private get duplicate(): boolean {
    const key = this.name.trim().toLowerCase();
    return !!key && (cachedRecipes() ?? []).some((r) => r.name.toLowerCase() === key);
  }

  // 달력에서 열었으면 항상 그날 기록, 목록에서 열었으면 사진이 있을 때만 기록
  private get records(): boolean {
    return !!this.options.date || this.files.length > 0;
  }

  private submit(): void {
    const name = this.name.trim();
    if (!name || this.duplicate) return;
    this.result = {
      name,
      category: this.category,
      date: this.records ? this.date : null,
      files: [...this.files],
    };
    this.requestClose();
  }

  private renderDate(): TemplateResult | typeof nothing {
    const base = today();
    if (this.options.date) {
      return html`
        <div class="label">먹은 날</div>
        <div class="date-line">${fmtDateLong(this.date, base)}</div>
      `;
    }
    if (this.files.length === 0) return nothing;
    const quick = [
      { label: '오늘', date: base },
      { label: '어제', date: addDays(base, -1) },
      { label: '그저께', date: addDays(base, -2) },
    ];
    const isQuick = quick.some((q) => q.date === this.date);
    return html`
      <div class="label">먹은 날</div>
      <div class="chips">
        ${quick.map(
          (q) => html`
            <button class="chip ${this.date === q.date ? 'on' : ''}" @click=${(): void => { this.date = q.date; }}>
              ${q.label}
            </button>
          `,
        )}
        <button class="chip ${isQuick ? '' : 'on'}" @click=${(): void => void this.openCalendar()}>
          ${icon('calendar', 14)} ${isQuick ? '다른 날' : fmtDateLong(this.date, base)}
        </button>
      </div>
    `;
  }

  protected renderBody(): TemplateResult {
    const empty = !this.name.trim();
    const label = this.records
      ? this.files.length > 0
        ? `추가하고 사진 ${this.files.length}장 기록하기`
        : '추가하고 기록하기'
      : '메뉴 추가';
    return html`
      <div class="label">이름</div>
      <input
        class="name"
        placeholder="예: 고등어조림"
        enterkeyhint="done"
        .value=${this.name}
        @input=${(e: Event): void => { this.name = (e.target as HTMLInputElement).value; }}
        @keydown=${(e: KeyboardEvent): void => {
          if (e.key === 'Enter' && !e.isComposing) (e.target as HTMLInputElement).blur();
        }}
      >
      ${this.duplicate ? html`<div class="err">이미 있는 메뉴예요</div>` : nothing}

      <div class="label">국가</div>
      <div class="chips">
        ${CATEGORY_ORDER.map(
          (c) => html`
            <button class="chip ${this.category === c ? 'on' : ''}" @click=${(): void => { this.category = c; }}>${c}</button>
          `,
        )}
      </div>

      <div class="label">사진 (선택)</div>
      <div class="photos">
        ${this.previews.map(
          (url, i) => html`
            <div class="cell">
              <img src=${url} alt="">
              <button class="rm" aria-label="빼기" @click=${(): void => this.setFiles(this.files.filter((_, j) => j !== i))}>
                ${icon('x', 13)}
              </button>
            </div>
          `,
        )}
        <button class="add" @click=${(): void => void this.addPhotos()}>${icon('camera', 20)} 추가</button>
      </div>

      ${this.renderDate()}

      <button class="btn-primary" ?disabled=${empty || this.duplicate} @click=${(): void => this.submit()}>${label}</button>
    `;
  }
}

let instance: MenuSheet | null = null;

export function openMenuSheet(options: MenuSheetOptions = {}): Promise<MenuInput | null> {
  if (!instance) {
    instance = document.createElement('menu-sheet') as MenuSheet;
    document.body.appendChild(instance);
  }
  return instance.show(options);
}
