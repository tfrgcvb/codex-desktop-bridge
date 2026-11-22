/* global window, document, fetch, URLSearchParams */
(function () {
  function decodeWorkspaceUri(raw) {
    if (!raw) return '';
    let s = String(raw).trim();
    s = s.replace(/^file:\/\/\/?/i, '');
    try {
      s = decodeURIComponent(s);
    } catch {
      /* keep as-is */
    }
    if (/^\/[a-zA-Z]:[\\/]/.test(s)) {
      s = s.slice(1);
    }
    if (/^[a-zA-Z]:\//.test(s)) {
      s = s.replace(/\//g, '\\');
    }
    return s;
  }

  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') || '';
  let currentWorkspace = decodeWorkspaceUri(params.get('workspace') || '');
  const listeners = new Set();

  function parseLuminance(raw) {
    const c = String(raw || '').trim();
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(c);
    if (hex) {
      const h = hex[1].length === 3
        ? hex[1].split('').map((x) => x + x).join('')
        : hex[1].slice(0, 6);
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    }
    const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(c);
    if (rgb) {
      return (0.299 * Number(rgb[1]) + 0.587 * Number(rgb[2]) + 0.114 * Number(rgb[3])) / 255;
    }
    return null;
  }

  function applyTheme(cssVars) {
    if (!cssVars || typeof cssVars !== 'object') return;
    for (const [k, v] of Object.entries(cssVars)) {
      if (typeof k === 'string' && k.startsWith('--') && typeof v === 'string') {
        document.documentElement.style.setProperty(k, v);
      }
    }
    const bg =
      cssVars['--background'] ||
      cssVars['--editor-background'] ||
      cssVars['--vscode-editor-background'] ||
      cssVars['--vscode-sideBar-background'] ||
      '';
    const lum = parseLuminance(bg);
    if (lum !== null) {
      document.documentElement.dataset.theme = lum < 0.5 ? 'dark' : 'light';
    }
  }

  window.addEventListener('message', (event) => {
    const data = event && event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'theme-change') {
      applyTheme(data.payload && data.payload.cssVariables);
      return;
    }
    if (data.type === 'workspace-change') {
      const uris = data.payload && data.payload.workspaceUris;
      const rawNext = Array.isArray(uris) && uris.length > 0 ? String(uris[0] || '') : '';
      const next = decodeWorkspaceUri(rawNext);
      if (next && next !== currentWorkspace) {
        currentWorkspace = next;
        for (const fn of listeners) {
          try {
            fn({ workspace: currentWorkspace });
          } catch {
            /* ignore */
          }
        }
      }
    }
  });

  function headers(extra) {
    const h = Object.assign({}, extra || {});
    if (token) h['X-Sidecar-Token'] = token;
    return h;
  }

  async function requestJson(url, options) {
    const res = await fetch(url, options);
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok || (data && data.ok === false)) {
      throw new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
    }
    return data || {};
  }

  function boot() {
    const root = document.getElementById('bridge-root');
    if (!root || !window.CodexBridgeApp) return;
    window.CodexBridgeApp.mount(root, {
      getWorkspace() {
        return currentWorkspace;
      },
      subscribeWorkspace(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
      },
      getOverview({ workspace, limit = 25 } = {}) {
        const q = new URLSearchParams();
        if (workspace) q.set('workspace', workspace);
        if (limit) q.set('limit', String(limit));
        return requestJson(`/api/overview?${q.toString()}`, { headers: headers() });
      },
      getThreads({ cwd, q: search, limit = 30 } = {}) {
        const q = new URLSearchParams();
        if (cwd) q.set('cwd', cwd);
        if (search) q.set('q', search);
        if (limit) q.set('limit', String(limit));
        return requestJson(`/api/threads?${q.toString()}`, { headers: headers() });
      },
      getThreadDetail({ threadId, limit = 20 }) {
        const q = new URLSearchParams({ threadId, limit: String(limit) });
        return requestJson(`/api/thread?${q.toString()}`, { headers: headers() });
      },
      startTask(payload) {
        return requestJson('/api/start', {
          method: 'POST',
          headers: headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(payload),
        });
      },
      sendTask(payload) {
        return requestJson('/api/send', {
          method: 'POST',
          headers: headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(payload),
        });
      },
      openDesktop(payload) {
        return requestJson('/api/open', {
          method: 'POST',
          headers: headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(payload),
        });
      },
      interruptTurn(payload) {
        return requestJson('/api/interrupt', {
          method: 'POST',
          headers: headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(payload),
        });
      },
      forkThread(payload) {
        return requestJson('/api/fork', {
          method: 'POST',
          headers: headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(payload),
        });
      },
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
