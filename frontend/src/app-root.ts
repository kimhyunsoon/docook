import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { keyed } from 'lit/directives/keyed.js';
import { tokens } from './style.js';
import { parseHash, initialRoute, rememberTab } from './router.js';
import { scrollStore } from './store.js';
import './views/login-view.js';
import './views/recipes-view.js';
import './views/recipe-detail-view.js';
import './views/calendar-view.js';
import './views/settings-view.js';
import './components/tab-bar.js';

// 해시 라우터: #/login #/recipes #/recipes/:id #/calendar #/settings
// 정렬 등 뷰 상태는 해시 쿼리(#/recipes?view=...)에 replaceState로 기록 - keyed 키는 경로만 사용
// 레시피 등록·수정은 앱에 없음 (Claude 레시피 등록 → API)
@customElement('app-root')
export class AppRoot extends LitElement {
  static styles = [
    tokens,
    css`
      :host {
        display: block;
        min-height: 100dvh;
        max-width: var(--app-w);
        margin: 0 auto;
        background: var(--bg);
      }
      .view {
        animation: view-in 0.22s ease-out;
      }
      @keyframes view-in {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: none; }
      }
    `,
  ];

  @state() private route = initialRoute();

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('hashchange', this.onHashChange);
    rememberTab(parseHash(this.route).path);
  }

  disconnectedCallback(): void {
    window.removeEventListener('hashchange', this.onHashChange);
    super.disconnectedCallback();
  }

  private onHashChange = (): void => {
    scrollStore.save(parseHash(this.route).path, window.scrollY);
    this.route = location.hash || '#/recipes';
    rememberTab(parseHash(this.route).path);
  };

  // 뷰 재생성 후 이전 스크롤 위치 복원 (상세→목록 복귀 체감 개선)
  protected updated(changed: Map<string, unknown>): void {
    if (!changed.has('route')) return;
    const { path } = parseHash(this.route);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => window.scrollTo(0, scrollStore.get(path)));
    });
  }

  private renderView(path: string): TemplateResult {
    if (path.startsWith('#/login')) return html`<login-view></login-view>`;
    if (path.startsWith('#/settings')) return html`<settings-view></settings-view>`;
    if (path.startsWith('#/calendar')) return html`<calendar-view></calendar-view>`;
    const detail = path.match(/^#\/recipes\/(\d+)$/);
    if (detail) return html`<recipe-detail-view recipe-id=${detail[1]!}></recipe-detail-view>`;
    return html`<recipes-view></recipes-view>`;
  }

  render(): TemplateResult {
    const { path } = parseHash(this.route);
    const showTabs =
      path === '#/recipes' ||
      path.startsWith('#/calendar') ||
      path.startsWith('#/settings') ||
      path === '' ||
      path === '#/';
    return html`
      ${keyed(path, html`<div class="view">${this.renderView(path)}</div>`)}
      ${showTabs ? html`<tab-bar .active=${path || '#/recipes'}></tab-bar>` : nothing}
    `;
  }
}
