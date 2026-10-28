import { html, css, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { tokens, ui, sheet } from '../style.js';
import { icon } from '../icons.js';
import { today, addDays, pickImages } from '../api.js';
import { fmtDateLong } from '../fmt.js';
import { SheetBase } from './sheet-base.js';
import { pickDate } from './date-sheet.js';

export interface MealInput {
  date: string;
  files: File[];
}

interface MealSheetOptions {
  recipeName: string;
  date?: string;
  marked?: string[]; // 이미 먹은 날 (달력 점 표시)
  photoFirst?: boolean; // 사진 추가로 열었을 때 (버튼 문구)
}

// 먹은 기록 시트 - 날짜(오늘·어제·그저께·달력) + 사진(선택, 여러 장)
@customElement('meal-sheet')
export class MealSheet extends SheetBase {
  static styles = [
    tokens,
    ui,
    sheet,
    css`
      .label { font-size: 0.8rem; font-weight: 700; color: var(--text-sub); margin: 6px 2px 8px; }
      .chips { display: flex; gap: 6px; flex-wrap: wrap; }
      .chip {
        padding: 8px 13px; border-radius: 999px;
        background: var(--accent-soft); color: var(--text-sub);
        font-size: 0.86rem; font-weight: 600;
        display: flex; align-items: center; gap: 4px;
      }
      .chip.on { background: var(--accent); color: #fff; }
      .date-line { margin: 10px 2px 18px; font-weight: 700; }
      .photos { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 18px; }
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
    `,
  ];

  @state() private date = '';
  @state() private files: File[] = [];
  @state() private previews: string[] = [];
  private options: MealSheetOptions = { recipeName: '' };
  private result: MealInput | null = null;
  private resolveFn?: (value: MealInput | null) => void;

  protected get sheetTitle(): string {
    return this.options.recipeName;
  }

  show(options: MealSheetOptions): Promise<MealInput | null> {
    this.options = options;
    this.date = options.date ?? today();
    this.setFiles([]);
    this.result = null;
    this.openSheet();
    // 사진 추가로 열었으면 곧바로 사진 선택 (열기 탭과 같은 제스처 안)
    if (options.photoFirst) void this.addPhotos();
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
    const picked = await pickDate(this.date, { title: '먹은 날', marked: this.options.marked });
    if (picked) this.date = picked;
  }

  private submit(): void {
    this.result = { date: this.date, files: [...this.files] };
    this.requestClose();
  }

  protected renderBody(): TemplateResult {
    const base = today();
    const quick = [
      { label: '오늘', date: base },
      { label: '어제', date: addDays(base, -1) },
      { label: '그저께', date: addDays(base, -2) },
    ];
    const isQuick = quick.some((q) => q.date === this.date);
    const marked = new Set(this.options.marked ?? []);
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
      <div class="date-line">
        ${fmtDateLong(this.date, base)}${marked.has(this.date) ? html` <span class="sub">· 이미 기록됨</span>` : nothing}
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

      <button class="btn-primary" @click=${(): void => this.submit()}>
        ${this.files.length > 0 ? `사진 ${this.files.length}장과 기록하기` : '먹은 기록만 남기기'}
      </button>
    `;
  }
}

let instance: MealSheet | null = null;

export function openMealSheet(options: MealSheetOptions): Promise<MealInput | null> {
  if (!instance) {
    instance = document.createElement('meal-sheet') as MealSheet;
    document.body.appendChild(instance);
  }
  return instance.show(options);
}
