import { LitElement, html, css, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { tokens, ui } from '../style.js';
import { api } from '../api.js';
import { toast, uiConfirm } from '../ui.js';
import { icon } from '../icons.js';
import { applyTheme, currentTheme, type ThemeMode } from '../theme.js';

const THEME_LABEL: Record<ThemeMode, string> = { auto: '자동', light: '라이트', dark: '다크' };

@customElement('settings-view')
export class SettingsView extends LitElement {
  static styles = [
    tokens,
    ui,
    css`
      :host { display: block; min-height: 100dvh; background: var(--bg); padding-bottom: calc(80px + env(safe-area-inset-bottom)); }
      .top {
        display: flex; align-items: center; gap: 10px;
        padding: calc(12px + env(safe-area-inset-top)) 16px 12px;
        position: sticky; top: 0; background: var(--bg); z-index: 5;
      }
      .top h1 { font-size: 1.15rem; margin: 0; }
      .block { margin: 12px 16px; }
      .row {
        display: flex; align-items: center; justify-content: space-between;
        padding: 6px 0; gap: 10px;
      }
      .label { display: flex; align-items: center; gap: 6px; font-weight: 600; }
      .token {
        margin-top: 8px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 0.78rem; word-break: break-all;
        background: var(--bg); border: 1px solid var(--border); border-radius: 10px;
        padding: 10px 12px; color: var(--text-sub);
      }
      .token-actions { display: flex; gap: 6px; margin-top: 8px; }
      .token-actions button { display: flex; align-items: center; gap: 5px; }
    `,
  ];

  @state() private username = '';
  @state() private token = '';
  @state() private reveal = false;

  connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  private async load(): Promise<void> {
    const [me, token] = await Promise.all([
      api<{ username: string }>('/api/auth/me'),
      api<{ token: string }>('/api/settings/api-token'),
    ]);
    this.username = me.username;
    this.token = token.token;
  }

  private setTheme(mode: ThemeMode): void {
    applyTheme(mode);
    this.requestUpdate();
  }

  private async copyToken(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.token);
      toast('API 토큰을 복사했어요', { duration: 1500 });
    } catch {
      this.reveal = true;
      toast('복사할 수 없어요 - 직접 선택해 복사하세요');
    }
  }

  private async regenerate(): Promise<void> {
    const ok = await uiConfirm('API 토큰을 새로 발급할까요?\n기존 토큰은 바로 사용할 수 없게 돼요.', {
      confirmLabel: '재발급',
      danger: true,
    });
    if (!ok) return;
    const res = await api<{ token: string }>('/api/settings/api-token/regenerate', { method: 'POST' });
    this.token = res.token;
    this.reveal = true;
    toast('새 토큰을 발급했어요');
  }

  private async logout(): Promise<void> {
    await api('/api/auth/logout', { method: 'POST' });
    location.hash = '#/login';
    toast('로그아웃했어요');
  }

  render(): TemplateResult {
    const theme = currentTheme();
    const masked = this.token ? `${this.token.slice(0, 6)}${'•'.repeat(20)}${this.token.slice(-4)}` : '';
    return html`
      <div class="top">
        <h1>설정</h1>
      </div>

      <div class="block card">
        <div class="row">
          <span>테마</span>
          <div class="segmented" style="width: 210px">
            ${(['auto', 'light', 'dark'] as ThemeMode[]).map(
              (mode) => html`
                <button class=${theme === mode ? 'on' : ''} @click=${(): void => this.setTheme(mode)}>
                  ${THEME_LABEL[mode]}
                </button>
              `,
            )}
          </div>
        </div>
      </div>

      <div class="block card">
        <div class="label">API 토큰</div>
        <div class="token">${this.reveal ? this.token : masked}</div>
        <div class="token-actions">
          <button class="btn-soft" @click=${(): void => void this.copyToken()}>${icon('copy', 14)} 복사</button>
          <button class="btn-soft" @click=${(): void => { this.reveal = !this.reveal; }}>${this.reveal ? '가리기' : '보기'}</button>
          <button class="btn-ghost" style="margin-left:auto;display:flex;align-items:center;gap:4px" @click=${(): void => void this.regenerate()}>
            ${icon('refresh', 14)} 재발급
          </button>
        </div>
      </div>

      <div class="block card">
        <div class="row">
          <span>${this.username}</span>
          <button class="btn-ghost" style="display:flex;align-items:center;gap:5px" @click=${(): void => void this.logout()}>
            ${icon('log-out', 15)} 로그아웃
          </button>
        </div>
      </div>
    `;
  }
}
