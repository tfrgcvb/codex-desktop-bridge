/* global window, document, navigator */
(function () {
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatDuration(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    const sec = ms / 1000;
    if (sec < 60) return `${sec.toFixed(1)}s`;
    const min = Math.floor(sec / 60);
    const rem = Math.round(sec % 60);
    return `${min}m ${rem}s`;
  }

  function formatRelativeTime(epochSecOrMs) {
    if (!epochSecOrMs) return '';
    const ms = epochSecOrMs > 1e12 ? epochSecOrMs : epochSecOrMs * 1000;
    const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    if (diffSec < 15) return '刚刚';
    if (diffSec < 60) return `${diffSec}秒前`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}分钟前`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}小时前`;
    return `${Math.floor(diffHr / 24)}天前`;
  }

  function shortPath(p) {
    if (!p) return '';
    const norm = String(p).replace(/\\/g, '/');
    const parts = norm.split('/').filter(Boolean);
    if (parts.length <= 2) return norm;
    return `…/${parts.slice(-2).join('/')}`;
  }

  function extractFileChangePaths(fileChanges) {
    const paths = [];
    if (!Array.isArray(fileChanges)) return paths;
    for (const fc of fileChanges) {
      if (Array.isArray(fc && fc.changes)) {
        for (const ch of fc.changes) {
          const p = (ch && (ch.path || ch.file || ch.newPath)) || (typeof ch === 'string' ? ch : '');
          if (p) paths.push(p);
        }
      } else if (fc && fc.path) {
        paths.push(fc.path);
      }
    }
    return Array.from(new Set(paths));
  }

  // Authentic 4-Color Gemini Brand Sparkle & Material 3 Icons (from Icons.tsx)
  let sparkleUid = 0;
  function geminiSparkleSvg(className = '') {
    const uid = ++sparkleUid;
    const starPath =
      'M14 1.5C14 8.40356 19.5964 14 26.5 14C19.5964 14 14 19.5964 14 26.5C14 19.5964 8.40356 14 1.5 14C8.40356 14 14 8.40356 14 1.5Z';
    return `
      <svg viewBox="0 0 28 28" width="22" height="22" fill="none" class="${className}" aria-hidden="true">
        <defs>
          <linearGradient id="gem-base-${uid}" x1="3" y1="25" x2="25" y2="3" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#FBBC04" />
            <stop offset="50%" stop-color="#34A853" />
            <stop offset="100%" stop-color="#4285F4" />
          </linearGradient>
          <radialGradient id="gem-red-${uid}" cx="0.22" cy="0.22" r="0.65">
            <stop offset="0%" stop-color="#EA4335" />
            <stop offset="58%" stop-color="#EA4335" stop-opacity="0.88" />
            <stop offset="100%" stop-color="#EA4335" stop-opacity="0" />
          </radialGradient>
          <radialGradient id="gem-yellow-${uid}" cx="0.22" cy="0.82" r="0.64">
            <stop offset="0%" stop-color="#FBBC04" />
            <stop offset="58%" stop-color="#FBBC04" stop-opacity="0.92" />
            <stop offset="100%" stop-color="#FBBC04" stop-opacity="0" />
          </radialGradient>
          <radialGradient id="gem-green-${uid}" cx="0.82" cy="0.82" r="0.64">
            <stop offset="0%" stop-color="#34A853" />
            <stop offset="58%" stop-color="#34A853" stop-opacity="0.9" />
            <stop offset="100%" stop-color="#34A853" stop-opacity="0" />
          </radialGradient>
          <radialGradient id="gem-blue-${uid}" cx="0.82" cy="0.18" r="0.7">
            <stop offset="0%" stop-color="#4285F4" />
            <stop offset="62%" stop-color="#4285F4" stop-opacity="0.94" />
            <stop offset="100%" stop-color="#4285F4" stop-opacity="0" />
          </radialGradient>
        </defs>
        <path d="${starPath}" fill="url(#gem-base-${uid})" />
        <path d="${starPath}" fill="url(#gem-red-${uid})" />
        <path d="${starPath}" fill="url(#gem-yellow-${uid})" />
        <path d="${starPath}" fill="url(#gem-green-${uid})" />
        <path d="${starPath}" fill="url(#gem-blue-${uid})" />
      </svg>
    `;
  }

  const ICONS = {
    compose: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3H6a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-6"/><path d="M18.375 2.625a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.375-9.375Z"/></svg>`,
    search: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
    grid: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="7" x="3" y="3" rx="1.5"/><rect width="7" height="7" x="14" y="3" rx="1.5"/><rect width="7" height="7" x="14" y="14" rx="1.5"/><rect width="7" height="7" x="3" y="14" rx="1.5"/></svg>`,
    clock: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>`,
    external: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>`,
    settings: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
    plus: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`,
    arrowUp: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>`,
    chevronDown: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`,
    close: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
    copy: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`,
    check: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
    thumbUp: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg>`,
    thumbDown: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"/></svg>`,
    fork: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9"/><path d="M12 12v3"/></svg>`,
    terminal: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/></svg>`,
    refresh: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>`,
  };

  // Periodic Table Element mapping for Codex Models
  const ELEMENT_PRESETS = {
    'gpt-6.2-sol': { symbol: 'So', shortName: 'Sol', theme: 'blue', desc: '主力代码审查与工程实现 (GPT-6.2 Sol)' },
    'gpt-6.2-astra': { symbol: 'As', shortName: 'Astra', theme: 'purple', desc: '深度架构规划与复杂推理 (GPT-6.2 Astra)' },
    'gpt-6.1-terra': { symbol: 'Te', shortName: 'Terra', theme: 'green', desc: '前端视觉、多媒体与全栈协作 (GPT-6.1 Terra)' },
    'gpt-6-luna': { symbol: 'Lu', shortName: 'Luna', theme: 'orange', desc: '极速轻量问答与快速验证 (GPT-6 Luna)' },
  };
  const THEMES = ['blue', 'purple', 'green', 'orange'];

  function buildModelElements(models, includeInherit) {
    const list = [];
    if (includeInherit) {
      list.push({
        z: 0,
        id: '',
        symbol: 'In',
        shortName: 'Inherit',
        displayName: '沿用会话默认模型',
        theme: 'blue',
        desc: '使用目标桌面会话当前选定的模型与配置',
        supportedEfforts: ['low', 'medium', 'high', 'xhigh'],
      });
    }
    const raw = Array.isArray(models) && models.length
      ? models
      : [
          { id: 'gpt-6.2-sol', displayName: 'GPT-6.2 Sol', isDefault: true, supportedEfforts: ['low', 'medium', 'high', 'xhigh'] },
          { id: 'gpt-6.2-astra', displayName: 'GPT-6.2 Astra', supportedEfforts: ['low', 'medium', 'high', 'xhigh'] },
          { id: 'gpt-6.1-terra', displayName: 'GPT-6.1 Terra', supportedEfforts: ['low', 'medium', 'high'] },
          { id: 'gpt-6-luna', displayName: 'GPT-6 Luna', supportedEfforts: ['low', 'medium', 'high'] },
        ];

    raw.forEach((m, idx) => {
      const preset = ELEMENT_PRESETS[m.id] || {};
      const cleanTail = String(m.id || '').split('-').pop() || 'Cx';
      const fallbackSym = cleanTail.slice(0, 1).toUpperCase() + cleanTail.slice(1, 2).toLowerCase();
      list.push({
        z: idx + 1,
        id: m.id,
        symbol: preset.symbol || fallbackSym,
        shortName: preset.shortName || m.displayName || m.id,
        displayName: m.displayName || m.id,
        theme: preset.theme || THEMES[idx % THEMES.length],
        desc: preset.desc || m.description || `OpenAI Codex 模型 (${m.id})`,
        supportedEfforts:
          Array.isArray(m.supportedEfforts) && m.supportedEfforts.length
            ? m.supportedEfforts
            : ['low', 'medium', 'high', 'xhigh'],
        defaultEffort: m.defaultEffort || 'high',
        isDefault: Boolean(m.isDefault),
      });
    });
    return list;
  }

  const STARTER_SUGGESTIONS = [
    {
      label: '对当前工作区代码做只读审查，指出潜在 Bug 与文件行号',
      sandbox: 'read-only',
    },
    {
      label: '梳理当前项目的顶层架构、模块边界与核心数据流',
      sandbox: 'read-only',
    },
    {
      label: '运行测试并修复当前工作区中失败的用例或边界问题',
      sandbox: 'workspace-write',
    },
  ];

  function mount(container, api) {
    const state = {
      workspace: api.getWorkspace() || '',
      scope: 'all', // 'workspace' | 'all'
      models: [],
      projects: [],
      threads: [],
      selectedThreadId: null, // null = Hero Landing Stage ("Where should we start?")
      threadDetail: null,
      model: 'gpt-6.2-sol',
      effort: 'high',
      sandbox: 'read-only', // 'read-only' | 'workspace-write'
      via: 'auto',
      newTitle: '',
      newCwd: '',
      promptValue: '',
      showOptionsChips: false,
      showSymbolInBar: true,
      openOnDispatch: false,
      isHistoryDrawerOpen: false,
      isModelPopupOpen: false,
      isSearchModalOpen: false,
      isSettingsOpen: false,
      searchQuery: '',
      expandedThinking: {}, // turnId -> boolean
      feedbackMap: {}, // turnId -> 'up' | 'down'
      copiedTurnId: null,
      submitting: false,
      snackbarText: null,
      snackbarTimer: null,
    };

    function notify(msg) {
      state.snackbarText = msg;
      renderSnackbar();
      if (state.snackbarTimer) clearTimeout(state.snackbarTimer);
      state.snackbarTimer = setTimeout(() => {
        state.snackbarText = null;
        renderSnackbar();
      }, 3200);
    }

    function cleanWorkspacePath() {
      return state.workspace
        ? state.workspace.replace(/^file:\/\/\/?/i, '').replace(/\//g, '\\')
        : '';
    }

    function getActiveModelElement() {
      const elements = buildModelElements(state.models, Boolean(state.selectedThreadId));
      return (
        elements.find((e) => e.id === state.model) ||
        elements.find((e) => e.isDefault) ||
        elements[0]
      );
    }

    // Build persistent shell
    container.innerHTML = `
      <div class="gm-ambient-halo" id="gm-halo"></div>

      <!-- Left Icon Rail (Material 3 surface, Sidebar.tsx) -->
      <aside class="gm-rail" aria-label="主导航">
        <div class="gm-rail-top">
          <div class="gm-rail-item">
            <button type="button" class="gm-icon-btn" id="gm-nav-home" aria-label="Codex Bridge 主页">
              ${geminiSparkleSvg()}
            </button>
            <div class="gm-tooltip">新建协作 (Ctrl+Shift+O)</div>
          </div>

          <nav class="gm-rail-nav">
            <div class="gm-rail-item">
              <button type="button" class="gm-icon-btn active" id="gm-nav-new" aria-label="新建会话">
                ${ICONS.compose}
              </button>
              <div class="gm-tooltip">新建会话</div>
            </div>

            <div class="gm-rail-item">
              <button type="button" class="gm-icon-btn" id="gm-nav-search" aria-label="搜索会话与模型">
                ${ICONS.search}
              </button>
              <div class="gm-tooltip">搜索会话与模型 (Ctrl+K)</div>
            </div>

            <div class="gm-rail-item">
              <button type="button" class="gm-icon-btn" id="gm-nav-models" aria-label="模型元素周期表">
                ${ICONS.grid}
              </button>
              <div class="gm-tooltip">模型与推理深度选择</div>
            </div>

            <div class="gm-rail-item">
              <button type="button" class="gm-icon-btn" id="gm-nav-history" aria-label="历史会话">
                ${ICONS.clock}
              </button>
              <div class="gm-tooltip">历史 Codex 会话</div>
            </div>

            <div class="gm-rail-item">
              <button type="button" class="gm-icon-btn" id="gm-nav-desktop" aria-label="在 ChatGPT 桌面端打开">
                ${ICONS.external}
              </button>
              <div class="gm-tooltip">在 ChatGPT 桌面端打开</div>
            </div>
          </nav>
        </div>

        <div class="gm-rail-bottom">
          <div class="gm-rail-item">
            <button type="button" class="gm-icon-btn" id="gm-nav-refresh" aria-label="刷新状态">
              ${ICONS.refresh}
            </button>
            <div class="gm-tooltip">刷新会话状态</div>
          </div>
          <div class="gm-rail-item">
            <button type="button" class="gm-icon-btn" id="gm-nav-settings" aria-label="设置">
              ${ICONS.settings}
            </button>
            <div class="gm-tooltip">桥接设置</div>
          </div>
        </div>
      </aside>

      <!-- Slide-over Recent Threads Drawer -->
      <div id="gm-drawer-root"></div>

      <!-- Main Content Stage -->
      <div class="gm-stage">
        <header class="gm-topbar" id="gm-topbar"></header>
        <div id="gm-stage-body" style="flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;"></div>
        <div class="gm-bottom-dock" id="gm-bottom-dock"></div>
      </div>

      <!-- Modals & Snackbar -->
      <div id="gm-modal-root"></div>
      <div id="gm-snackbar-root"></div>
    `;

    const els = {
      halo: container.querySelector('#gm-halo'),
      navHome: container.querySelector('#gm-nav-home'),
      navNew: container.querySelector('#gm-nav-new'),
      navSearch: container.querySelector('#gm-nav-search'),
      navModels: container.querySelector('#gm-nav-models'),
      navHistory: container.querySelector('#gm-nav-history'),
      navDesktop: container.querySelector('#gm-nav-desktop'),
      navRefresh: container.querySelector('#gm-nav-refresh'),
      navSettings: container.querySelector('#gm-nav-settings'),
      drawerRoot: container.querySelector('#gm-drawer-root'),
      topbar: container.querySelector('#gm-topbar'),
      stageBody: container.querySelector('#gm-stage-body'),
      bottomDock: container.querySelector('#gm-bottom-dock'),
      modalRoot: container.querySelector('#gm-modal-root'),
      snackbarRoot: container.querySelector('#gm-snackbar-root'),
    };

    function updateRailActiveState() {
      els.navNew.classList.toggle('active', !state.selectedThreadId && !state.isHistoryDrawerOpen);
      els.navHistory.classList.toggle('active', state.isHistoryDrawerOpen || Boolean(state.selectedThreadId));
      els.navModels.classList.toggle('active', state.isModelPopupOpen);
      els.navSearch.classList.toggle('active', state.isSearchModalOpen);
      els.navSettings.classList.toggle('active', state.isSettingsOpen);
      els.halo.style.opacity = state.selectedThreadId ? '0.32' : '1';
    }

    function renderTopbar() {
      const d = state.threadDetail;
      if (!state.selectedThreadId || !d) {
        const ws = cleanWorkspacePath();
        els.topbar.innerHTML = `
          <div class="gm-topbar-left">
            <span class="gm-session-title" style="color:var(--gm-text-secondary);">Codex Desktop Bridge</span>
            ${ws ? `<span class="gm-status-chip" title="${escapeHtml(ws)}">${escapeHtml(shortPath(ws))}</span>` : ''}
          </div>
          <div class="gm-topbar-actions">
            <button type="button" class="gm-action-pill" id="gm-top-recent-btn">
              ${ICONS.clock}
              <span>最近会话 (${state.threads.length})</span>
            </button>
          </div>
        `;
        const recentBtn = els.topbar.querySelector('#gm-top-recent-btn');
        if (recentBtn) {
          recentBtn.addEventListener('click', () => {
            state.isHistoryDrawerOpen = !state.isHistoryDrawerOpen;
            updateRailActiveState();
            renderDrawer();
          });
        }
        return;
      }

      const title = d.name && d.name.trim() ? d.name : `会话 ${d.threadId.slice(0, 8)}`;
      const turns = Array.isArray(d.turns) ? d.turns : [];
      const lastTurn = turns.length > 0 ? turns[turns.length - 1] : null;
      const status = lastTurn ? lastTurn.status : d.statusType || 'ready';
      const isRunning = status === 'inProgress' || status === 'in_progress';
      const chipClass =
        status === 'completed'
          ? 'completed'
          : isRunning
          ? 'running'
          : status === 'interrupted'
          ? 'interrupted'
          : status === 'failed'
          ? 'failed'
          : '';

      els.topbar.innerHTML = `
        <div class="gm-topbar-left">
          <span class="gm-session-title" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
          <span class="gm-status-chip ${chipClass}">${escapeHtml(status)}</span>
        </div>
        <div class="gm-topbar-actions">
          ${
            isRunning
              ? `<button type="button" class="gm-action-pill gm-action-pill-danger" id="gm-top-stop-btn">⏹ 停止</button>`
              : ''
          }
          <button type="button" class="gm-action-pill" id="gm-top-fork-btn" title="基于当前会话分支新会话">
            ${ICONS.fork}
            <span>分支</span>
          </button>
          <button type="button" class="gm-action-pill gm-action-pill-primary" id="gm-top-open-btn" title="在 ChatGPT 桌面端打开此会话">
            ${ICONS.external}
            <span>桌面端打开</span>
          </button>
        </div>
      `;

      const openBtn = els.topbar.querySelector('#gm-top-open-btn');
      if (openBtn) {
        openBtn.addEventListener('click', async () => {
          try {
            await api.openDesktop({ threadId: d.threadId });
            notify(`已在 ChatGPT 桌面端唤起会话 ${d.threadId.slice(0, 8)}`);
          } catch (err) {
            notify(`打开桌面端失败: ${err.message}`);
          }
        });
      }

      const forkBtn = els.topbar.querySelector('#gm-top-fork-btn');
      if (forkBtn) {
        forkBtn.addEventListener('click', async () => {
          try {
            notify('正在创建分支会话...');
            const res = await api.forkThread({
              threadId: d.threadId,
              title: `${title} (Fork)`,
              ...(d.cwd ? { cwd: d.cwd } : {}),
            });
            notify(`已创建分支会话 ${String(res.threadId).slice(0, 8)}`);
            await refreshOverview(false);
            if (res.threadId) await selectThread(res.threadId, true);
          } catch (err) {
            notify(`分支失败: ${err.message}`);
          }
        });
      }

      const stopBtn = els.topbar.querySelector('#gm-top-stop-btn');
      if (stopBtn) {
        stopBtn.addEventListener('click', async () => {
          try {
            await api.interruptTurn({
              threadId: d.threadId,
              ...(lastTurn && lastTurn.turnId ? { turnId: lastTurn.turnId } : {}),
            });
            notify('已发送中断回合请求');
            await loadThreadDetail(d.threadId, false);
          } catch (err) {
            notify(`中断失败: ${err.message}`);
          }
        });
      }
    }

    function buildComposerHtml() {
      const activeEl = getActiveModelElement();
      const ws = cleanWorkspacePath();
      const cwdVal = state.newCwd || ws;
      const isNewSession = !state.selectedThreadId;

      return `
        <form class="gm-composer-wrap" id="gm-composer-form">
          <div class="gm-composer-box">
            ${
              state.showOptionsChips || isNewSession
                ? `<div class="gm-composer-chips">
                    ${
                      isNewSession
                        ? `<span class="gm-chip" title="新建桌面会话标题">
                            <span>标题:</span>
                            <input type="text" id="gm-chip-title" value="${escapeHtml(state.newTitle)}" placeholder="自动生成或输入标题..." />
                          </span>
                          <span class="gm-chip" title="项目工作目录 (cwd)">
                            <span>目录:</span>
                            <input type="text" id="gm-chip-cwd" value="${escapeHtml(cwdVal)}" placeholder="工作区路径..." />
                          </span>`
                        : `<span class="gm-chip" title="续聊投递通道">
                            <span>通道:</span>
                            <select id="gm-chip-via" style="background:transparent;border:none;color:var(--gm-text);font-size:11.5px;outline:none;">
                              <option value="auto" ${state.via === 'auto' ? 'selected' : ''}>智能 (auto 回退队列)</option>
                              <option value="queue" ${state.via === 'queue' ? 'selected' : ''}>桌面端实时队列 (queue)</option>
                              <option value="app-server" ${state.via === 'app-server' ? 'selected' : ''}>后台直连 (app-server)</option>
                            </select>
                          </span>`
                    }
                    <span class="gm-chip">
                      <span>权限: ${state.sandbox === 'workspace-write' ? '允许改代码' : '只读审查'}</span>
                    </span>
                  </div>`
                : ''
            }

            <div class="gm-composer-row">
              <button
                type="button"
                class="gm-icon-btn ${state.showOptionsChips ? 'active' : ''}"
                id="gm-toggle-chips-btn"
                title="展开/收起会话参数 (标题、目录、投递通道)"
              >
                ${ICONS.plus}
              </button>

              <textarea
                rows="1"
                class="gm-composer-input"
                id="gm-prompt-input"
                placeholder="${
                  isNewSession
                    ? '向 Codex 派发新会话任务（Enter 发送，Shift+Enter 换行）...'
                    : '在当前会话继续追问 Codex...'
                }"
              >${escapeHtml(state.promptValue)}</textarea>

              <!-- Inline Model Trigger matching Gemini-4-Model-Periodic-Table: "[So] Sol High v" -->
              <button
                type="button"
                class="gm-model-trigger ${state.isModelPopupOpen ? 'open' : ''}"
                id="gm-model-trigger-btn"
                title="点击打开模型元素表与推理深度选择器"
              >
                ${
                  state.showSymbolInBar && activeEl.symbol
                    ? `<span class="gm-model-symbol">${escapeHtml(activeEl.symbol)}</span>`
                    : ''
                }
                <span class="gm-model-name">${escapeHtml(activeEl.shortName)}</span>
                ${
                  state.effort
                    ? `<span class="gm-model-effort">${escapeHtml(state.effort)}</span>`
                    : ''
                }
                ${ICONS.chevronDown}
              </button>

              <button
                type="submit"
                class="gm-send-btn"
                id="gm-send-btn"
                title="派发任务"
                ${state.submitting ? 'disabled' : ''}
              >
                ${ICONS.arrowUp}
              </button>
            </div>
          </div>
        </form>
      `;
    }

    function bindComposerEvents(rootEl) {
      const form = rootEl.querySelector('#gm-composer-form');
      const input = rootEl.querySelector('#gm-prompt-input');
      const chipsBtn = rootEl.querySelector('#gm-toggle-chips-btn');
      const modelBtn = rootEl.querySelector('#gm-model-trigger-btn');
      const titleInput = rootEl.querySelector('#gm-chip-title');
      const cwdInput = rootEl.querySelector('#gm-chip-cwd');
      const viaSelect = rootEl.querySelector('#gm-chip-via');

      if (titleInput) {
        titleInput.addEventListener('input', () => {
          state.newTitle = titleInput.value;
        });
      }
      if (cwdInput) {
        cwdInput.addEventListener('input', () => {
          state.newCwd = cwdInput.value;
        });
      }
      if (viaSelect) {
        viaSelect.addEventListener('change', () => {
          state.via = viaSelect.value;
        });
      }
      if (chipsBtn) {
        chipsBtn.addEventListener('click', () => {
          state.showOptionsChips = !state.showOptionsChips;
          renderStage();
        });
      }
      if (modelBtn) {
        modelBtn.addEventListener('click', () => {
          state.isModelPopupOpen = !state.isModelPopupOpen;
          updateRailActiveState();
          renderModals();
        });
      }
      if (input) {
        input.addEventListener('input', () => {
          state.promptValue = input.value;
          input.style.height = 'auto';
          input.style.height = `${Math.min(130, input.scrollHeight)}px`;
        });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (form) form.requestSubmit();
          }
        });
      }
      if (form) {
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          await handleDispatchPrompt();
        });
      }
    }

    async function handleDispatchPrompt() {
      if (state.submitting) return;
      const prompt = (state.promptValue || '').trim();
      if (!prompt) {
        notify('请输入要派发给 Codex 的任务提示词');
        return;
      }

      state.submitting = true;
      const sendBtn = container.querySelector('#gm-send-btn');
      if (sendBtn) sendBtn.disabled = true;

      try {
        const model = state.model || undefined;
        const effort = state.effort || undefined;
        const sandbox = state.sandbox || 'read-only';
        const open = Boolean(state.openOnDispatch);

        if (!state.selectedThreadId) {
          const title = (state.newTitle || '').trim() || prompt.slice(0, 36);
          const cwd = (state.newCwd || '').trim() || cleanWorkspacePath() || undefined;
          notify('正在创建新 Codex 会话并派发任务...');
          const res = await api.startTask({
            prompt,
            ...(cwd ? { cwd } : {}),
            ...(model ? { model } : {}),
            ...(effort ? { effort } : {}),
            title,
            sandbox,
            open,
            wait: false,
          });
          state.promptValue = '';
          state.newTitle = '';
          notify(`已创建会话 ${String(res.threadId).slice(0, 8)} · 正在后台执行`);
          await refreshOverview(false);
          if (res.threadId) {
            await selectThread(res.threadId, true);
          }
        } else {
          notify(`正在向会话 ${state.selectedThreadId.slice(0, 8)} 投递续聊任务...`);
          const res = await api.sendTask({
            threadId: state.selectedThreadId,
            prompt,
            ...(model ? { model } : {}),
            ...(effort ? { effort } : {}),
            sandbox,
            via: state.via || 'auto',
            open,
            wait: false,
          });
          state.promptValue = '';
          notify(
            res.notice
              ? `已回退至桌面端队列实时执行`
              : `已投递任务 (通道: ${res.via || state.via})`
          );
          await loadThreadDetail(state.selectedThreadId, true);
          renderBottomDock();
        }
      } catch (err) {
        notify(`派发失败: ${err.message}`);
      } finally {
        state.submitting = false;
        const btn = container.querySelector('#gm-send-btn');
        if (btn) btn.disabled = false;
      }
    }

    function renderBottomDock() {
      if (!state.selectedThreadId) {
        els.bottomDock.style.display = 'none';
        els.bottomDock.innerHTML = '';
        return;
      }
      els.bottomDock.style.display = 'block';
      els.bottomDock.innerHTML = buildComposerHtml();
      bindComposerEvents(els.bottomDock);
    }

    function renderStage(scrollToBottom) {
      renderTopbar();
      updateRailActiveState();

      // Case 1: Hero Landing Stage ("Where should we start?" from App.tsx)
      if (!state.selectedThreadId) {
        els.bottomDock.style.display = 'none';
        const recentPreview = state.threads.slice(0, 3);
        els.stageBody.innerHTML = `
          <div class="gm-hero-stage custom-scrollbar">
            <div class="gm-hero-inner">
              <h1 class="gm-hero-heading">Where should we start?</h1>
              <p class="gm-hero-sub">只读旁观不抢占 ChatGPT 桌面端写入锁 · 支持随时动态切模型或一键跳桌面端接管</p>

              ${buildComposerHtml()}

              <!-- Workspace Sandbox Mode Switcher matching App.tsx Chat / Task pills -->
              <div class="gm-mode-switcher" role="tablist">
                <button
                  type="button"
                  class="gm-mode-pill ${state.sandbox === 'read-only' ? 'active' : ''}"
                  data-sandbox-mode="read-only"
                >
                  只读审查 (Read-only)
                </button>
                <button
                  type="button"
                  class="gm-mode-pill ${state.sandbox === 'workspace-write' ? 'active' : ''}"
                  data-sandbox-mode="workspace-write"
                >
                  代码协作 (Workspace-write)
                </button>
              </div>

              <!-- Clean Monochrome Starter Prompt Suggestions -->
              <div class="gm-suggestions">
                ${STARTER_SUGGESTIONS.map(
                  (item, idx) => `
                    <button type="button" class="gm-suggestion-btn" data-suggestion-idx="${idx}">
                      ${ICONS.terminal}
                      <span>${escapeHtml(item.label)}</span>
                    </button>
                  `
                ).join('')}
              </div>

              ${
                recentPreview.length
                  ? `<div style="margin-top:22px;width:100%;max-width:480px;">
                      <div style="font-size:11.5px;color:var(--gm-text-muted);padding:0 12px 6px;">最近活跃的 Codex 会话</div>
                      <div style="display:flex;flex-direction:column;gap:3px;">
                        ${recentPreview
                          .map((t) => {
                            const title = t.name && t.name.trim() ? t.name : `会话 ${String(t.threadId).slice(0, 8)}`;
                            return `
                              <button type="button" class="gm-suggestion-btn" data-jump-thread="${escapeHtml(t.threadId)}">
                                ${ICONS.clock}
                                <span style="flex:1;">${escapeHtml(title)}</span>
                                <span style="font-size:11px;color:var(--gm-text-muted);">${escapeHtml(formatRelativeTime(t.updatedAt))}</span>
                              </button>
                            `;
                          })
                          .join('')}
                      </div>
                    </div>`
                  : ''
              }
            </div>
          </div>
        `;

        bindComposerEvents(els.stageBody);

        for (const modeBtn of els.stageBody.querySelectorAll('[data-sandbox-mode]')) {
          modeBtn.addEventListener('click', () => {
            state.sandbox = modeBtn.getAttribute('data-sandbox-mode') || 'read-only';
            renderStage(false);
          });
        }

        for (const sugBtn of els.stageBody.querySelectorAll('[data-suggestion-idx]')) {
          sugBtn.addEventListener('click', () => {
            const idx = Number(sugBtn.getAttribute('data-suggestion-idx'));
            const item = STARTER_SUGGESTIONS[idx];
            if (item) {
              state.promptValue = item.label;
              state.sandbox = item.sandbox;
              renderStage(false);
              const inp = els.stageBody.querySelector('#gm-prompt-input');
              if (inp) inp.focus();
            }
          });
        }

        for (const jumpBtn of els.stageBody.querySelectorAll('[data-jump-thread]')) {
          jumpBtn.addEventListener('click', () => {
            const tid = jumpBtn.getAttribute('data-jump-thread');
            if (tid) selectThread(tid, true);
          });
        }
        return;
      }

      // Case 2: Active Session Conversation View (ConversationView.tsx)
      const d = state.threadDetail;
      const prevScrollEl = els.stageBody.querySelector('.gm-conversation-scroll');
      const wasNearBottom = prevScrollEl
        ? prevScrollEl.scrollHeight - prevScrollEl.scrollTop - prevScrollEl.clientHeight < 90
        : true;

      const openCmdSet = new Set();
      for (const det of els.stageBody.querySelectorAll('details.gm-cmd-details[open]')) {
        const cid = det.getAttribute('data-cmd-id');
        if (cid) openCmdSet.add(cid);
      }

      const turns = (d && Array.isArray(d.turns)) ? d.turns : [];

      if (!d || !turns.length) {
        els.stageBody.innerHTML = `
          <div class="gm-conversation-scroll custom-scrollbar">
            <div class="gm-conversation-inner" style="padding-top:48px;text-align:center;color:var(--gm-text-muted);">
              ${d ? '该会话暂无回合记录，可在下方输入首条任务。' : '正在同步 Codex 会话历史...'}
            </div>
          </div>
        `;
      } else {
        els.stageBody.innerHTML = `
          <div class="gm-conversation-scroll custom-scrollbar">
            <div class="gm-conversation-inner">
              ${turns
                .map((turn, idx) => {
                  const turnKey = turn.turnId || `turn-${idx}`;
                  const prompt = turn.promptText || turn.userText || '';
                  const commentary = Array.isArray(turn.commentary) ? turn.commentary : [];
                  const commands = Array.isArray(turn.commands) ? turn.commands : [];
                  const filePaths = extractFileChangePaths(turn.fileChanges);
                  const hasThinking = commentary.length > 0 || commands.length > 0 || filePaths.length > 0;
                  const isRunning = turn.status === 'inProgress' || turn.status === 'in_progress';
                  // Expand thinking by default when running or when there's no final reply yet
                  const isExpanded =
                    state.expandedThinking[turnKey] !== undefined
                      ? state.expandedThinking[turnKey]
                      : isRunning || !turn.reply;
                  const dur = formatDuration(turn.durationMs);
                  const vote = state.feedbackMap[turnKey] || null;
                  const isCopied = state.copiedTurnId === turnKey;

                  const thinkingSummaryLabel = [
                    commentary.length ? `${commentary.length} 条思考` : '',
                    commands.length ? `${commands.length} 条命令` : '',
                    filePaths.length ? `${filePaths.length} 个文件变更` : '',
                    dur ? dur : '',
                  ]
                    .filter(Boolean)
                    .join(' · ');

                  return `
                    <!-- User Prompt Bubble -->
                    <div class="gm-user-turn">
                      <div class="gm-user-meta">
                        <span class="gm-user-meta-tag">回合 #${idx + 1}</span>
                        ${
                          turn.detectedJobId
                            ? `<span class="gm-user-meta-tag">Bridge Job ${escapeHtml(String(turn.detectedJobId).slice(0, 8))}</span>`
                            : ''
                        }
                      </div>
                      <div class="gm-user-bubble">${escapeHtml(prompt || '(无文本提示词)')}</div>
                    </div>

                    <!-- Model Response Row with 4-Color Gemini Sparkle & Inline Show Thinking -->
                    <div class="gm-model-turn">
                      <div class="gm-sparkle-col">
                        ${geminiSparkleSvg(isRunning ? 'sparkle-spin' : '')}
                      </div>
                      <div class="gm-model-body">
                        ${
                          hasThinking
                            ? `<div class="gm-thinking-block">
                                <button
                                  type="button"
                                  class="gm-thinking-toggle"
                                  data-toggle-thinking="${escapeHtml(turnKey)}"
                                >
                                  <span>${isExpanded ? 'Hide thinking' : 'Show thinking'} (${escapeHtml(thinkingSummaryLabel || '执行轨迹')})</span>
                                  <span style="display:inline-flex;transform:rotate(${isExpanded ? '180deg' : '0deg'});transition:transform 0.15s ease;">
                                    ${ICONS.chevronDown}
                                  </span>
                                </button>
                                ${
                                  isExpanded
                                    ? `<div class="gm-thinking-panel">
                                        ${commentary
                                          .map((c) => `<div>${escapeHtml(c)}</div>`)
                                          .join('')}
                                        ${commands
                                          .map((cmd, cIdx) => {
                                            const cmdId = `${turnKey}-cmd-${cmd.id || cIdx}`;
                                            const cmdOpen = openCmdSet.has(cmdId);
                                            const exitLabel =
                                              cmd.exitCode === 0
                                                ? 'exit 0'
                                                : cmd.exitCode != null
                                                ? `exit ${cmd.exitCode}`
                                                : cmd.status || 'running';
                                            return `
                                              <details class="gm-cmd-details" data-cmd-id="${escapeHtml(cmdId)}" ${cmdOpen ? 'open' : ''}>
                                                <summary class="gm-cmd-summary">
                                                  <span class="gm-cmd-code" title="${escapeHtml(cmd.command || '')}">$ ${escapeHtml(cmd.command || '')}</span>
                                                  <span style="font-size:10.5px;flex-shrink:0;">${escapeHtml(exitLabel)}</span>
                                                </summary>
                                                <pre class="gm-cmd-pre custom-scrollbar">${escapeHtml(cmd.outputPreview || '(无标准输出)')}</pre>
                                              </details>
                                            `;
                                          })
                                          .join('')}
                                        ${
                                          filePaths.length
                                            ? `<div class="gm-file-row">
                                                ${filePaths
                                                  .map((fp) => `<span class="gm-file-chip" title="${escapeHtml(fp)}">✎ ${escapeHtml(shortPath(fp))}</span>`)
                                                  .join('')}
                                              </div>`
                                            : ''
                                        }
                                      </div>`
                                    : ''
                                }
                              </div>`
                            : ''
                        }

                        ${
                          turn.reply
                            ? `<div class="gm-prose">${escapeHtml(turn.reply)}</div>`
                            : turn.error
                            ? `<div class="gm-prose" style="color:var(--gm-rose);">错误: ${escapeHtml(
                                typeof turn.error === 'string' ? turn.error : JSON.stringify(turn.error)
                              )}</div>`
                            : isRunning
                            ? `<div style="font-size:13.5px;color:var(--gm-text-muted);">Codex 正在执行中…</div>`
                            : `<div style="font-size:13px;color:var(--gm-text-muted);">状态: ${escapeHtml(turn.status || 'completed')}</div>`
                        }

                        <!-- Authentic Google Gemini Message Action Row -->
                        <div class="gm-action-row">
                          <button
                            type="button"
                            class="gm-mini-icon-btn ${vote === 'up' ? 'active' : ''}"
                            data-vote-turn="${escapeHtml(turnKey)}"
                            data-vote-dir="up"
                            title="有帮助"
                          >
                            ${ICONS.thumbUp}
                          </button>
                          <button
                            type="button"
                            class="gm-mini-icon-btn ${vote === 'down' ? 'active' : ''}"
                            data-vote-turn="${escapeHtml(turnKey)}"
                            data-vote-dir="down"
                            title="需改进"
                          >
                            ${ICONS.thumbDown}
                          </button>
                          ${
                            turn.reply
                              ? `<button
                                  type="button"
                                  class="gm-mini-icon-btn ${isCopied ? 'active' : ''}"
                                  data-copy-turn="${idx}"
                                  data-turn-key="${escapeHtml(turnKey)}"
                                  title="复制回复"
                                >
                                  ${isCopied ? ICONS.check : ICONS.copy}
                                </button>`
                              : ''
                          }
                        </div>
                      </div>
                    </div>
                  `;
                })
                .join('')}
            </div>
          </div>
        `;

        for (const toggleBtn of els.stageBody.querySelectorAll('[data-toggle-thinking]')) {
          toggleBtn.addEventListener('click', () => {
            const key = toggleBtn.getAttribute('data-toggle-thinking');
            if (!key) return;
            const cur = state.expandedThinking[key] !== undefined ? state.expandedThinking[key] : true;
            state.expandedThinking[key] = !cur;
            renderStage(false);
          });
        }

        for (const voteBtn of els.stageBody.querySelectorAll('[data-vote-turn]')) {
          voteBtn.addEventListener('click', () => {
            const key = voteBtn.getAttribute('data-vote-turn');
            const dir = voteBtn.getAttribute('data-vote-dir');
            if (!key || !dir) return;
            state.feedbackMap[key] = state.feedbackMap[key] === dir ? null : dir;
            renderStage(false);
          });
        }

        for (const copyBtn of els.stageBody.querySelectorAll('[data-copy-turn]')) {
          copyBtn.addEventListener('click', async () => {
            const idx = Number(copyBtn.getAttribute('data-copy-turn'));
            const key = copyBtn.getAttribute('data-turn-key');
            const t = turns[idx];
            if (t && t.reply && navigator.clipboard) {
              try {
                await navigator.clipboard.writeText(t.reply);
                state.copiedTurnId = key;
                renderStage(false);
                setTimeout(() => {
                  state.copiedTurnId = null;
                  renderStage(false);
                }, 1500);
              } catch {
                /* ignore */
              }
            }
          });
        }

        const nextScrollEl = els.stageBody.querySelector('.gm-conversation-scroll');
        if (nextScrollEl && (scrollToBottom || wasNearBottom)) {
          nextScrollEl.scrollTop = nextScrollEl.scrollHeight;
        }
      }

      if (!els.bottomDock.innerHTML || els.bottomDock.style.display === 'none') {
        renderBottomDock();
      }
    }

    function renderDrawer() {
      if (!state.isHistoryDrawerOpen) {
        els.drawerRoot.innerHTML = '';
        return;
      }

      els.drawerRoot.innerHTML = `
        <div class="gm-drawer-backdrop" id="gm-drawer-backdrop"></div>
        <aside class="gm-drawer drawer-animate-in" aria-label="历史会话列表">
          <div class="gm-drawer-header">
            <span class="gm-drawer-title">Recent Codex Sessions</span>
            <button type="button" class="gm-icon-btn" id="gm-drawer-close" aria-label="关闭抽屉">
              ${ICONS.close}
            </button>
          </div>
          <div class="gm-scope-pills">
            <button type="button" class="gm-pill-tab ${state.scope === 'all' ? 'active' : ''}" data-scope="all">全部会话</button>
            <button type="button" class="gm-pill-tab ${state.scope === 'workspace' ? 'active' : ''}" data-scope="workspace">当前工作区</button>
          </div>
          <div class="gm-thread-list custom-scrollbar">
            ${
              state.threads.length
                ? state.threads
                    .map((t) => {
                      const active = t.threadId === state.selectedThreadId;
                      const title = t.name && t.name.trim() ? t.name : `会话 ${String(t.threadId).slice(0, 8)}`;
                      return `
                        <button type="button" class="gm-thread-item ${active ? 'active' : ''}" data-select-thread="${escapeHtml(t.threadId)}">
                          <div class="gm-thread-item-main">
                            <div class="gm-thread-item-title">${escapeHtml(title)}</div>
                            <div class="gm-thread-item-sub">${escapeHtml(shortPath(t.cwd || ''))} · ${escapeHtml(formatRelativeTime(t.updatedAt))}</div>
                          </div>
                        </button>
                      `;
                    })
                    .join('')
                : `<div style="padding:24px 12px;text-align:center;color:var(--gm-text-muted);font-size:12.5px;">暂无匹配的 Codex 会话</div>`
            }
          </div>
        </aside>
      `;

      const backdrop = els.drawerRoot.querySelector('#gm-drawer-backdrop');
      const closeBtn = els.drawerRoot.querySelector('#gm-drawer-close');
      const closeDrawer = () => {
        state.isHistoryDrawerOpen = false;
        updateRailActiveState();
        renderDrawer();
      };
      if (backdrop) backdrop.addEventListener('click', closeDrawer);
      if (closeBtn) closeBtn.addEventListener('click', closeDrawer);

      for (const scopeBtn of els.drawerRoot.querySelectorAll('[data-scope]')) {
        scopeBtn.addEventListener('click', async () => {
          state.scope = scopeBtn.getAttribute('data-scope') || 'all';
          await refreshOverview(false);
          renderDrawer();
        });
      }

      for (const itemBtn of els.drawerRoot.querySelectorAll('[data-select-thread]')) {
        itemBtn.addEventListener('click', async () => {
          const tid = itemBtn.getAttribute('data-select-thread');
          state.isHistoryDrawerOpen = false;
          updateRailActiveState();
          renderDrawer();
          if (tid) await selectThread(tid, true);
        });
      }
    }

    function renderModals() {
      // 1. Periodic-Table Model & Thinking Effort Popup (PeriodicTablePopup.tsx style)
      if (state.isModelPopupOpen) {
        const elements = buildModelElements(state.models, Boolean(state.selectedThreadId));
        const activeEl = getActiveModelElement();
        const efforts = activeEl.supportedEfforts || ['low', 'medium', 'high', 'xhigh'];

        els.modalRoot.innerHTML = `
          <div class="gm-modal-backdrop" id="gm-modal-backdrop">
            <div class="gm-periodic-popup popup-animate-in" role="dialog" aria-label="选择 Codex 模型与推理深度">
              <div class="gm-popup-header">
                <div class="gm-popup-title">
                  ${geminiSparkleSvg()}
                  <span>Codex Model Periodic Selector</span>
                </div>
                <button type="button" class="gm-icon-btn" id="gm-modal-close">${ICONS.close}</button>
              </div>

              <!-- Element Tile Grid -->
              <div class="gm-element-grid">
                ${elements
                  .map((el) => {
                    const isSelected = el.id === state.model;
                    return `
                      <button
                        type="button"
                        class="gm-element-cell theme-${escapeHtml(el.theme)} ${isSelected ? 'selected' : ''}"
                        data-pick-model="${escapeHtml(el.id)}"
                      >
                        <span class="gm-element-z">${el.z === 0 ? '0' : el.z}</span>
                        ${isSelected ? '<span class="gm-element-dot"></span>' : ''}
                        <span class="gm-element-sym">${escapeHtml(el.symbol)}</span>
                        <span class="gm-element-label">${escapeHtml(el.shortName)}</span>
                      </button>
                    `;
                  })
                  .join('')}
              </div>

              <!-- Inspected Element Description -->
              <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 4px;font-size:12.5px;color:var(--gm-text-secondary);">
                <div>
                  <strong style="color:var(--gm-text);">${escapeHtml(activeEl.displayName)}</strong>
                  <span style="margin-left:6px;color:var(--gm-text-muted);">${escapeHtml(activeEl.desc)}</span>
                </div>
              </div>

              <!-- Thinking Level (Reasoning Effort) Segmented Selector -->
              <div class="gm-effort-bar">
                <span style="font-size:12.5px;font-weight:500;color:var(--gm-text-secondary);">Thinking level (Effort)</span>
                <div class="gm-effort-pills">
                  ${efforts
                    .map(
                      (ef) => `
                        <button
                          type="button"
                          class="gm-effort-pill ${state.effort === ef ? 'active' : ''}"
                          data-pick-effort="${escapeHtml(ef)}"
                        >
                          ${escapeHtml(ef)}
                        </button>
                      `
                    )
                    .join('')}
                </div>
              </div>
            </div>
          </div>
        `;

        const closePopup = () => {
          state.isModelPopupOpen = false;
          updateRailActiveState();
          renderModals();
          renderStage(false);
          renderBottomDock();
        };

        const backdrop = els.modalRoot.querySelector('#gm-modal-backdrop');
        const closeBtn = els.modalRoot.querySelector('#gm-modal-close');
        if (backdrop) {
          backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) closePopup();
          });
        }
        if (closeBtn) closeBtn.addEventListener('click', closePopup);

        for (const cell of els.modalRoot.querySelectorAll('[data-pick-model]')) {
          cell.addEventListener('click', () => {
            state.model = cell.getAttribute('data-pick-model') || '';
            const nextEl = getActiveModelElement();
            if (nextEl.supportedEfforts && !nextEl.supportedEfforts.includes(state.effort)) {
              state.effort = nextEl.defaultEffort || nextEl.supportedEfforts[0] || 'high';
            }
            renderModals();
            renderStage(false);
            renderBottomDock();
          });
        }

        for (const efBtn of els.modalRoot.querySelectorAll('[data-pick-effort]')) {
          efBtn.addEventListener('click', () => {
            state.effort = efBtn.getAttribute('data-pick-effort') || 'high';
            closePopup();
          });
        }
        return;
      }

      // 2. Search Modal (Ctrl+K from App.tsx)
      if (state.isSearchModalOpen) {
        const q = state.searchQuery.trim().toLowerCase();
        const matchingThreads = state.threads
          .filter((t) => {
            if (!q) return true;
            return (
              String(t.name || '').toLowerCase().includes(q) ||
              String(t.cwd || '').toLowerCase().includes(q) ||
              String(t.threadId || '').toLowerCase().includes(q)
            );
          })
          .slice(0, 10);

        els.modalRoot.innerHTML = `
          <div class="gm-modal-backdrop" id="gm-modal-backdrop">
            <div class="gm-periodic-popup popup-animate-in" role="dialog" aria-label="搜索 Codex 会话">
              <div style="display:flex;align-items:center;gap:10px;padding-bottom:10px;border-bottom:1px solid var(--gm-border);">
                ${ICONS.search}
                <input
                  type="text"
                  id="gm-search-modal-input"
                  value="${escapeHtml(state.searchQuery)}"
                  placeholder="搜索 Codex 会话标题、目录或 UUID..."
                  style="flex:1;background:transparent;border:none;color:var(--gm-text);font-size:15px;outline:none;"
                />
                <button type="button" class="gm-icon-btn" id="gm-modal-close">${ICONS.close}</button>
              </div>
              <div class="custom-scrollbar" style="max-height:280px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;" id="gm-search-results">
                ${
                  matchingThreads.length
                    ? matchingThreads
                        .map((t) => {
                          const title = t.name && t.name.trim() ? t.name : `会话 ${String(t.threadId).slice(0, 8)}`;
                          return `
                            <button type="button" class="gm-thread-item" data-pick-thread="${escapeHtml(t.threadId)}">
                              <div class="gm-thread-item-main">
                                <div class="gm-thread-item-title">${escapeHtml(title)}</div>
                                <div class="gm-thread-item-sub">${escapeHtml(t.cwd || '')} · ${escapeHtml(formatRelativeTime(t.updatedAt))}</div>
                              </div>
                            </button>
                          `;
                        })
                        .join('')
                    : `<div style="padding:20px;text-align:center;color:var(--gm-text-muted);">未找到匹配的会话</div>`
                }
              </div>
            </div>
          </div>
        `;

        const closeSearch = () => {
          state.isSearchModalOpen = false;
          updateRailActiveState();
          renderModals();
        };
        const backdrop = els.modalRoot.querySelector('#gm-modal-backdrop');
        const closeBtn = els.modalRoot.querySelector('#gm-modal-close');
        const searchInp = els.modalRoot.querySelector('#gm-search-modal-input');
        if (backdrop) {
          backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) closeSearch();
          });
        }
        if (closeBtn) closeBtn.addEventListener('click', closeSearch);
        if (searchInp) {
          searchInp.focus();
          searchInp.setSelectionRange(searchInp.value.length, searchInp.value.length);
          searchInp.addEventListener('input', () => {
            state.searchQuery = searchInp.value;
            renderModals();
          });
        }
        for (const btn of els.modalRoot.querySelectorAll('[data-pick-thread]')) {
          btn.addEventListener('click', async () => {
            const tid = btn.getAttribute('data-pick-thread');
            closeSearch();
            if (tid) await selectThread(tid, true);
          });
        }
        return;
      }

      // 3. Settings Modal (Authentic Material 3 Switches from App.tsx)
      if (state.isSettingsOpen) {
        els.modalRoot.innerHTML = `
          <div class="gm-modal-backdrop" id="gm-modal-backdrop">
            <div class="gm-periodic-popup popup-animate-in" style="max-width:420px;" role="dialog" aria-label="设置">
              <div class="gm-popup-header">
                <span class="gm-popup-title">Settings</span>
                <button type="button" class="gm-icon-btn" id="gm-modal-close">${ICONS.close}</button>
              </div>

              <div style="display:flex;flex-direction:column;gap:14px;">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
                  <div>
                    <div style="font-size:14px;color:var(--gm-text);">Show element symbol in prompt bar</div>
                    <div style="font-size:12px;color:var(--gm-text-muted);">在底部输入栏模型胶囊旁显示化学元素代号 (So / As / Te / Lu)</div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked="${state.showSymbolInBar}"
                    class="gm-switch ${state.showSymbolInBar ? 'checked' : ''}"
                    id="gm-switch-symbol"
                  >
                    <span class="gm-switch-thumb"></span>
                  </button>
                </div>

                <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
                  <div>
                    <div style="font-size:14px;color:var(--gm-text);">Auto-open in ChatGPT Desktop</div>
                    <div style="font-size:12px;color:var(--gm-text-muted);">派发任务后自动唤起 ChatGPT 桌面端窗口 (关闭则保持只读旁观不抢锁)</div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked="${state.openOnDispatch}"
                    class="gm-switch ${state.openOnDispatch ? 'checked' : ''}"
                    id="gm-switch-open"
                  >
                    <span class="gm-switch-thumb"></span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        `;

        const closeSettings = () => {
          state.isSettingsOpen = false;
          updateRailActiveState();
          renderModals();
        };
        const backdrop = els.modalRoot.querySelector('#gm-modal-backdrop');
        const closeBtn = els.modalRoot.querySelector('#gm-modal-close');
        if (backdrop) {
          backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) closeSettings();
          });
        }
        if (closeBtn) closeBtn.addEventListener('click', closeSettings);

        const symSwitch = els.modalRoot.querySelector('#gm-switch-symbol');
        if (symSwitch) {
          symSwitch.addEventListener('click', () => {
            state.showSymbolInBar = !state.showSymbolInBar;
            renderModals();
            renderStage(false);
            renderBottomDock();
          });
        }

        const openSwitch = els.modalRoot.querySelector('#gm-switch-open');
        if (openSwitch) {
          openSwitch.addEventListener('click', () => {
            state.openOnDispatch = !state.openOnDispatch;
            renderModals();
          });
        }
        return;
      }

      els.modalRoot.innerHTML = '';
    }

    function renderSnackbar() {
      if (!state.snackbarText) {
        els.snackbarRoot.innerHTML = '';
        return;
      }
      els.snackbarRoot.innerHTML = `
        <div class="gm-snackbar popup-animate-in" role="status">${escapeHtml(state.snackbarText)}</div>
      `;
    }

    async function loadThreadDetail(threadId, scrollToBottom) {
      if (!threadId) return;
      try {
        const detail = await api.getThreadDetail({ threadId, limit: 25 });
        if (state.selectedThreadId === threadId) {
          state.threadDetail = detail;
          renderStage(scrollToBottom);
        }
      } catch (err) {
        notify(`加载会话详情失败: ${err.message}`);
      }
    }

    async function selectThread(threadId, scrollToBottom) {
      state.selectedThreadId = threadId;
      renderBottomDock();
      await loadThreadDetail(threadId, scrollToBottom);
    }

    function startNewChatStage() {
      state.selectedThreadId = null;
      state.threadDetail = null;
      if (!state.model) state.model = 'gpt-6.2-sol';
      state.isHistoryDrawerOpen = false;
      renderDrawer();
      renderStage(false);
      renderBottomDock();
    }

    async function refreshOverview(autoSelectFirst) {
      try {
        const wsParam = state.scope === 'workspace' && state.workspace ? state.workspace : undefined;
        const data = await api.getOverview({ workspace: wsParam, limit: 30 });
        if (Array.isArray(data.models) && data.models.length) {
          state.models = data.models;
        }
        if (data.projects) {
          state.projects = data.projects;
        }
        state.threads = Array.isArray(data.threads) ? data.threads : [];

        if (autoSelectFirst && !state.selectedThreadId && state.threads.length > 0) {
          await selectThread(state.threads[0].threadId, true);
        } else if (state.selectedThreadId) {
          await loadThreadDetail(state.selectedThreadId, false);
        } else {
          renderStage(false);
        }
      } catch (err) {
        notify(`同步 Codex 状态失败: ${err.message}`);
      }
    }

    // Rail Navigation Listeners
    els.navHome.addEventListener('click', startNewChatStage);
    els.navNew.addEventListener('click', startNewChatStage);
    els.navSearch.addEventListener('click', () => {
      state.isSearchModalOpen = !state.isSearchModalOpen;
      state.isModelPopupOpen = false;
      state.isSettingsOpen = false;
      updateRailActiveState();
      renderModals();
    });
    els.navModels.addEventListener('click', () => {
      state.isModelPopupOpen = !state.isModelPopupOpen;
      state.isSearchModalOpen = false;
      state.isSettingsOpen = false;
      updateRailActiveState();
      renderModals();
    });
    els.navHistory.addEventListener('click', () => {
      state.isHistoryDrawerOpen = !state.isHistoryDrawerOpen;
      updateRailActiveState();
      renderDrawer();
    });
    els.navDesktop.addEventListener('click', async () => {
      try {
        if (state.selectedThreadId) {
          await api.openDesktop({ threadId: state.selectedThreadId });
          notify(`已在 ChatGPT 桌面端打开会话 ${state.selectedThreadId.slice(0, 8)}`);
        } else {
          const cwd = cleanWorkspacePath();
          await api.openDesktop({ ...(cwd ? { cwd } : {}) });
          notify('已在 ChatGPT 桌面端打开当前项目');
        }
      } catch (err) {
        notify(`打开桌面端失败: ${err.message}`);
      }
    });
    els.navRefresh.addEventListener('click', async () => {
      await refreshOverview(false);
      notify('已刷新最新 Codex 会话与回合状态');
    });
    els.navSettings.addEventListener('click', () => {
      state.isSettingsOpen = !state.isSettingsOpen;
      state.isModelPopupOpen = false;
      state.isSearchModalOpen = false;
      updateRailActiveState();
      renderModals();
    });

    // Global Keyboard Shortcuts matching App.tsx (Ctrl+K, Ctrl+Shift+O, Escape)
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        state.isSearchModalOpen = !state.isSearchModalOpen;
        state.isModelPopupOpen = false;
        state.isSettingsOpen = false;
        updateRailActiveState();
        renderModals();
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        startNewChatStage();
      } else if (e.key === 'Escape') {
        if (state.isModelPopupOpen || state.isSearchModalOpen || state.isSettingsOpen || state.isHistoryDrawerOpen) {
          state.isModelPopupOpen = false;
          state.isSearchModalOpen = false;
          state.isSettingsOpen = false;
          state.isHistoryDrawerOpen = false;
          updateRailActiveState();
          renderDrawer();
          renderModals();
        }
      }
    });

    api.subscribeWorkspace(({ workspace }) => {
      state.workspace = workspace || '';
      if (state.scope === 'workspace') {
        refreshOverview(false);
      } else {
        renderTopbar();
      }
    });

    // Initial boot: show the Gemini Web Hero Stage or active thread
    renderStage(false);
    refreshOverview(false);

    // Live polling loop
    let tick = 0;
    setInterval(() => {
      if (document.hidden || state.submitting) return;
      tick += 1;
      const d = state.threadDetail;
      const turns = (d && Array.isArray(d.turns)) ? d.turns : [];
      const lastTurn = turns.length > 0 ? turns[turns.length - 1] : null;
      const isRunning =
        lastTurn &&
        (lastTurn.status === 'inProgress' ||
          lastTurn.status === 'in_progress' ||
          lastTurn.status === 'submitted' ||
          lastTurn.status === 'pending');

      if (isRunning && state.selectedThreadId) {
        loadThreadDetail(state.selectedThreadId, false);
      } else if (tick % 3 === 0) {
        refreshOverview(false);
      }
    }, 2500);
  }

  window.CodexBridgeApp = { mount };
})();
