import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { tokens } from '../style.js';
import { pushModal } from '../ui.js';
import { icon } from '../icons.js';
import { fileUrl, today } from '../api.js';
import { fmtDateLong } from '../fmt.js';
import type { Photo } from '../types.js';

// 사진 크게보기 - 가로 스와이프로 넘기기, 뒤로가기(스와이프)로 닫힘
// 하단 액션: 대표 지정/해제(primary), 삭제(delete) → 이벤트 detail = 사진
@customElement('photo-lightbox')
export class PhotoLightbox extends LitElement {
  static styles = [
    tokens,
    css`
      .overlay {
        position: fixed;
        inset: 0;
        max-width: var(--app-w);
        margin: 0 auto;
        background: #000;
        z-index: 200;
        display: flex;
        flex-direction: column;
        animation: fade-in 0.18s;
        transition: opacity 0.18s;
      }
      .overlay.closing { opacity: 0; }
      @keyframes fade-in { from { opacity: 0; } }
      .top {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: calc(10px + env(safe-area-inset-top)) 16px 10px;
        color: #fff;
        font-size: 0.9rem;
      }
      button {
        background: none;
        border: none;
        color: #fff;
        cursor: pointer;
        font: inherit;
      }
      .top button { padding: 4px 8px; }
      .strip {
        flex: 1;
        display: flex;
        overflow-x: auto;
        scroll-snap-type: x mandatory;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
      }
      .strip::-webkit-scrollbar { display: none; }
      .strip img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        scroll-snap-align: center;
        flex-shrink: 0;
      }
      .bottom {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 10px 12px calc(14px + env(safe-area-inset-bottom));
        color: #ccc;
        font-size: 0.82rem;
      }
      .bottom .date { flex: 1; padding-left: 4px; }
      .bottom button {
        display: flex; align-items: center; gap: 5px;
        padding: 8px 11px; border-radius: 10px;
        background: rgba(255, 255, 255, 0.12);
        font-size: 0.8rem; font-weight: 600;
      }
      .bottom button.on { color: #ffcf6e; }
    `,
  ];

  @state() private open = false;
  @state() private closing = false;
  @state() private photos: Photo[] = [];
  @state() private index = 0;
  @state() private primaryId: number | null = null;

  private startIndex = 0;
  private requestClose?: () => void;

  show(photos: Photo[], startIndex: number, primaryId: number | null): void {
    this.photos = photos;
    this.startIndex = startIndex;
    this.index = startIndex;
    this.primaryId = primaryId;
    this.open = true;
    this.closing = false;
    this.requestClose = pushModal(() => void this.animateOut());
  }

  /** 상세가 다시 불러온 최신 사진 목록 반영 (삭제 후 등) */
  refresh(photos: Photo[], primaryId: number | null): void {
    this.photos = photos;
    this.primaryId = primaryId;
    if (photos.length === 0) this.requestClose?.();
    else this.index = Math.min(this.index, photos.length - 1);
  }

  private async animateOut(): Promise<void> {
    this.closing = true;
    await new Promise((resolve) => setTimeout(resolve, 190));
    this.open = false;
    this.closing = false;
  }

  protected updated(): void {
    if (!this.open) return;
    const strip = this.renderRoot.querySelector<HTMLElement>('.strip');
    if (strip && strip.dataset.scrolled !== '1') {
      strip.dataset.scrolled = '1';
      strip.scrollLeft = this.startIndex * strip.clientWidth;
    }
  }

  private onScroll(e: Event): void {
    const el = e.target as HTMLElement;
    this.index = Math.round(el.scrollLeft / el.clientWidth);
  }

  private emit(name: 'primary' | 'delete'): void {
    const photo = this.photos[this.index];
    if (photo) this.dispatchEvent(new CustomEvent(name, { detail: photo }));
  }

  render(): TemplateResult | typeof nothing {
    if (!this.open) return nothing;
    const current = this.photos[this.index];
    const isPrimary = current?.id === this.primaryId;
    return html`
      <div class="overlay ${this.closing ? 'closing' : ''}">
        <div class="top">
          <span>${this.index + 1} / ${this.photos.length}</span>
          <button @click=${(): void => this.requestClose?.()} aria-label="닫기">${icon('x', 22)}</button>
        </div>
        <div class="strip" @scroll=${this.onScroll}>
          ${this.photos.map((p) => html`<img src=${fileUrl(p.path)} alt="" loading="lazy">`)}
        </div>
        <div class="bottom">
          <span class="date">${current ? fmtDateLong(current.taken_on, today()) : ''}</span>
          <button class=${isPrimary ? 'on' : ''} @click=${(): void => this.emit('primary')}>
            ${icon('star', 15)} ${!isPrimary ? '대표로' : current?.is_primary ? '대표 사진' : '대표 (최근)'}
          </button>
          <button @click=${(): void => this.emit('delete')}>${icon('trash', 15)} 삭제</button>
        </div>
      </div>
    `;
  }
}
