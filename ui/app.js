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
    const diffDay = Math.floor(diffHr / 24);
    return `${diffDay}天前`;
  }

  function shortPath(p) {
    if (!p) return '';
    const norm = String(p).replace(/\\/g, '/');
    const parts = norm.split('/').filter(Boolean);
    if (parts.length <= 2) return norm;
    return `…/${parts.slice(-2).join('/')}`;
  }

  function statusBadgeHtml(status) {
    const s = String(status || 'unknown');
    if (s === 'completed') {
      return '<span class="cb-badge cb-badge-completed">✓ 已完成</span>';
    }
    if (s === 'inProgress' || s === 'in_progress' || s === 'submitted' || s === 'running') {
      return '<span class="cb-badge cb-badge-progress"><span class="cb-pulse-dot"></span>执行中</span>';
    }
    if (s === 'interrupted') {
      return '<span class="cb-badge cb-badge-interrupted">⏸ 已中断</span>';
    }
    if (s === 'pending') {
      return '<span class="cb-badge cb-badge-pending">⏳ 队列中</span>';
    }
    if (s === 'failed' || s === 'error') {
      return '<span class="cb-badge cb-badge-failed">✕ 失败</span>';
    }
    return `<span class="cb-badge cb-badge-model">${escapeHtml(s)}</span>`;
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

  function mount(container, api) {
    const state = {
      workspace: api.getWorkspace() || '',
      scope: 'all', // 'workspace' | 'all'
      searchQuery: '',
      models: [],
      projects: [],
      threads: [],
      selectedThreadId: null,
      threadDetail: null,
      loadingList: false,
      loadingDetail: false,
      composerMode: 'send', // 'send' | 'start'
      model: '',
      effort: '',
      sandbox: 'read-only',
      via: 'auto',
      newTitle: '',
      newCwd: '',
      openOnDispatch: true,
      promptText: '',
      submitting: false,
      bannerText: '就绪 · 只读旁观不会抢占 ChatGPT 桌面端写入锁',
      bannerIsError: false,
    };

    // Build static skeleton once so inputs never lose focus during polling
    container.innerHTML = `
      <header class="cb-topbar">
        <div class="cb-brand">
          <span class="cb-brand-icon">⇄</span>
          <div class="cb-brand-text">
            <div class="cb-brand-title">Codex Desktop Bridge</div>
            <div class="cb-brand-sub" id="cb-workspace-label">全部工作区</div>
          </div>
        </div>
        <div class="cb-topbar-actions">
          <div class="cb-segmented">
            <button type="button" class="cb-seg-btn" id="cb-scope-ws" title="仅显示当前工作区关联会话">当前项目</button>
            <button type="button" class="cb-seg-btn active" id="cb-scope-all" title="显示本机全部 Codex 会话">全部</button>
          </div>
          <button type="button" class="cb-btn cb-btn-sm cb-btn-primary" id="cb-new-thread-btn">+ 新建会话</button>
          <button type="button" class="cb-btn cb-btn-sm" id="cb-refresh-btn" title="刷新会话与状态">↻</button>
        </div>
      </header>

      <div class="cb-main">
        <aside class="cb-sidebar">
          <div class="cb-sidebar-toolbar">
            <input type="search" class="cb-search-input" id="cb-search-input" placeholder="搜索会话标题或目录..." />
          </div>
          <div class="cb-thread-list" id="cb-thread-list"></div>
        </aside>

        <section class="cb-detail">
          <div class="cb-detail-header" id="cb-detail-header"></div>
          <div class="cb-transcript" id="cb-transcript"></div>

          <form class="cb-composer" id="cb-composer-form">
            <div class="cb-composer-top">
              <div class="cb-segmented">
                <button type="button" class="cb-seg-btn active" id="cb-mode-send">续聊选中会话</button>
                <button type="button" class="cb-seg-btn" id="cb-mode-start">新开桌面会话</button>
              </div>
              <label style="display:inline-flex;align-items:center;gap:4px;font-size:11px;color:var(--cb-text-muted);cursor:pointer;">
                <input type="checkbox" id="cb-open-checkbox" checked />
                派发后在桌面端定位窗口
              </label>
            </div>

            <div class="cb-composer-grid" id="cb-start-fields" style="display:none;">
              <input type="text" class="cb-input" id="cb-title-input" placeholder="新会话标题（例如：Sol 架构审查）" />
              <input type="text" class="cb-input" id="cb-cwd-input" list="cb-projects-datalist" placeholder="项目工作目录 (cwd)" />
              <datalist id="cb-projects-datalist"></datalist>
            </div>

            <div class="cb-composer-grid">
              <select class="cb-select" id="cb-model-select" title="选择 Codex 模型"></select>
              <select class="cb-select" id="cb-effort-select" title="推理深度 (Reasoning Effort)"></select>
              <select class="cb-select" id="cb-sandbox-select" title="沙箱权限策略">
                <option value="read-only">只读沙箱 (read-only)</option>
                <option value="workspace-write">允许改代码 (workspace-write)</option>
                <option value="danger-full-access">完全访问 (danger-full-access)</option>
              </select>
              <select class="cb-select" id="cb-via-select" title="投递通道">
                <option value="auto">通道: 智能 (auto 回退队列)</option>
                <option value="queue">通道: 桌面队列 (codex queue)</option>
                <option value="app-server">通道: 后台直连 (app-server)</option>
              </select>
            </div>

            <textarea class="cb-textarea" id="cb-prompt-input" placeholder="输入派发给 Codex 的任务指令（Ctrl+Enter 发送）..."></textarea>

            <div class="cb-composer-footer">
              <div class="cb-status-banner" id="cb-status-banner"></div>
              <button type="submit" class="cb-btn cb-btn-primary" id="cb-submit-btn">派发任务到 Codex</button>
            </div>
          </form>
        </section>
      </div>
    `;

    const els = {
      wsLabel: container.querySelector('#cb-workspace-label'),
      scopeWsBtn: container.querySelector('#cb-scope-ws'),
      scopeAllBtn: container.querySelector('#cb-scope-all'),
      newThreadBtn: container.querySelector('#cb-new-thread-btn'),
      refreshBtn: container.querySelector('#cb-refresh-btn'),
      searchInput: container.querySelector('#cb-search-input'),
      threadList: container.querySelector('#cb-thread-list'),
      detailHeader: container.querySelector('#cb-detail-header'),
      transcript: container.querySelector('#cb-transcript'),
      composerForm: container.querySelector('#cb-composer-form'),
      modeSendBtn: container.querySelector('#cb-mode-send'),
      modeStartBtn: container.querySelector('#cb-mode-start'),
      openCheckbox: container.querySelector('#cb-open-checkbox'),
      startFields: container.querySelector('#cb-start-fields'),
      titleInput: container.querySelector('#cb-title-input'),
      cwdInput: container.querySelector('#cb-cwd-input'),
      projectsDatalist: container.querySelector('#cb-projects-datalist'),
      modelSelect: container.querySelector('#cb-model-select'),
      effortSelect: container.querySelector('#cb-effort-select'),
      sandboxSelect: container.querySelector('#cb-sandbox-select'),
      viaSelect: container.querySelector('#cb-via-select'),
      promptInput: container.querySelector('#cb-prompt-input'),
      statusBanner: container.querySelector('#cb-status-banner'),
      submitBtn: container.querySelector('#cb-submit-btn'),
    };

    function setBanner(text, isError) {
      state.bannerText = text;
      state.bannerIsError = Boolean(isError);
      els.statusBanner.textContent = text;
      els.statusBanner.style.color = isError ? 'var(--cb-rose)' : 'var(--cb-text-muted)';
    }

    function updateWorkspaceHeader() {
      const cleanWs = state.workspace
        ? state.workspace.replace(/^file:\/\/\/?/i, '').replace(/\//g, '\\')
        : '';
      els.wsLabel.textContent = cleanWs ? shortPath(cleanWs) : '未绑定特定工作区';
      els.wsLabel.title = cleanWs || '';
      if (!els.cwdInput.value && cleanWs) {
        els.cwdInput.value = cleanWs;
      }
      els.scopeWsBtn.classList.toggle('active', state.scope === 'workspace');
      els.scopeAllBtn.classList.toggle('active', state.scope === 'all');
    }

    function setComposerMode(mode) {
      state.composerMode = mode === 'start' ? 'start' : 'send';
      const isStart = state.composerMode === 'start';
      els.modeSendBtn.classList.toggle('active', !isStart);
      els.modeStartBtn.classList.toggle('active', isStart);
      els.startFields.style.display = isStart ? 'grid' : 'none';
      els.viaSelect.style.display = isStart ? 'none' : '';
      els.submitBtn.textContent = isStart ? '创建桌面会话并派发' : '发送续聊任务';
      renderModelSelectOptions();
    }

    function renderModelSelectOptions() {
      const prevModel = els.modelSelect.value || state.model;
      const options = [];
      if (state.composerMode === 'send') {
        options.push('<option value="">模型: 沿用当前会话默认</option>');
      }
      for (const m of state.models) {
        const label = m.displayName ? `${m.displayName} (${m.id})` : m.id;
        options.push(`<option value="${escapeHtml(m.id)}">${escapeHtml(label)}</option>`);
      }
      els.modelSelect.innerHTML = options.join('');
      if (prevModel && state.models.some((m) => m.id === prevModel)) {
        els.modelSelect.value = prevModel;
      } else if (state.composerMode === 'start' && state.models.length > 0) {
        const defaultM = state.models.find((m) => m.isDefault) || state.models[0];
        els.modelSelect.value = defaultM.id;
      } else {
        els.modelSelect.value = '';
      }
      state.model = els.modelSelect.value;
      renderEffortSelectOptions();
    }

    function renderEffortSelectOptions() {
      const selectedModelObj = state.models.find((m) => m.id === els.modelSelect.value);
      const efforts = (selectedModelObj && Array.isArray(selectedModelObj.supportedEfforts) && selectedModelObj.supportedEfforts.length)
        ? selectedModelObj.supportedEfforts
        : ['low', 'medium', 'high', 'xhigh'];
      const prevEffort = els.effortSelect.value || state.effort;
      const html = ['<option value="">推理深度: 默认</option>'];
      for (const ef of efforts) {
        html.push(`<option value="${escapeHtml(ef)}">推理深度: ${escapeHtml(ef)}</option>`);
      }
      els.effortSelect.innerHTML = html.join('');
      if (prevEffort && efforts.includes(prevEffort)) {
        els.effortSelect.value = prevEffort;
      } else if (selectedModelObj && selectedModelObj.defaultEffort && efforts.includes(selectedModelObj.defaultEffort)) {
        els.effortSelect.value = selectedModelObj.defaultEffort;
      } else {
        els.effortSelect.value = '';
      }
      state.effort = els.effortSelect.value;
    }

    function renderProjectsDatalist() {
      const roots = (state.projects && state.projects.projects) || [];
      els.projectsDatalist.innerHTML = roots
        .map((p) => `<option value="${escapeHtml(p.path || p)}"></option>`)
        .join('');
    }

    function getFilteredThreads() {
      const q = state.searchQuery.trim().toLowerCase();
      return state.threads.filter((t) => {
        if (!q) return true;
        const name = String(t.name || '').toLowerCase();
        const cwd = String(t.cwd || '').toLowerCase();
        const id = String(t.threadId || '').toLowerCase();
        return name.includes(q) || cwd.includes(q) || id.includes(q);
      });
    }

    function renderThreadList() {
      const list = getFilteredThreads();
      if (!list.length) {
        els.threadList.innerHTML = `
          <div class="cb-empty">
            <div>暂无匹配的 Codex 会话</div>
            <div style="font-size:11px;margin-top:4px;">点击右上角「+ 新建会话」可直接拉起新任务</div>
          </div>
        `;
        return;
      }

      els.threadList.innerHTML = list
        .map((t) => {
          const isActive = t.threadId === state.selectedThreadId;
          const title = t.name && t.name.trim() ? t.name : `会话 ${String(t.threadId).slice(0, 8)}`;
          const relTime = formatRelativeTime(t.updatedAt);
          return `
            <button type="button" class="cb-thread-item ${isActive ? 'active' : ''}" data-thread-id="${escapeHtml(t.threadId)}">
              <div class="cb-thread-row">
                <span class="cb-thread-name" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
                <span style="font-size:10px;color:var(--cb-text-subtle);flex-shrink:0;">${escapeHtml(relTime)}</span>
              </div>
              <div class="cb-thread-meta">
                <span class="cb-thread-cwd" title="${escapeHtml(t.cwd || '')}">${escapeHtml(shortPath(t.cwd || ''))}</span>
                <span class="cb-badge cb-badge-model">${escapeHtml(String(t.threadId).slice(-6))}</span>
              </div>
            </button>
          `;
        })
        .join('');

      for (const btn of els.threadList.querySelectorAll('[data-thread-id]')) {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-thread-id');
          if (id) selectThread(id, true);
        });
      }
    }

    function renderDetailHeader() {
      const d = state.threadDetail;
      if (!d) {
        els.detailHeader.innerHTML = `
          <div class="cb-detail-title-group">
            <div class="cb-detail-title">未选择会话</div>
            <div class="cb-detail-sub">从左侧列表选择一个 Codex 会话，或在下方直接新建桌面会话</div>
          </div>
        `;
        return;
      }

      const title = d.name && d.name.trim() ? d.name : `会话 ${d.threadId.slice(0, 8)}`;
      const turns = Array.isArray(d.turns) ? d.turns : [];
      const lastTurn = turns.length > 0 ? turns[turns.length - 1] : null;
      const isRunning = lastTurn && (lastTurn.status === 'inProgress' || lastTurn.status === 'in_progress');

      els.detailHeader.innerHTML = `
        <div class="cb-detail-title-group">
          <div class="cb-detail-title">
            <span>${escapeHtml(title)}</span>
            ${lastTurn ? statusBadgeHtml(lastTurn.status) : ''}
          </div>
          <div class="cb-detail-sub" title="${escapeHtml(d.cwd || '')}">
            ${escapeHtml(d.threadId)} · ${escapeHtml(d.cwd || '')}
          </div>
        </div>
        <div class="cb-detail-actions">
          ${isRunning ? '<button type="button" class="cb-btn cb-btn-sm cb-btn-danger" id="cb-interrupt-btn">⏹ 停止回合</button>' : ''}
          <button type="button" class="cb-btn cb-btn-sm" id="cb-fork-btn" title="基于当前会话上下文分支出新会话">⑂ 分支 (Fork)</button>
          <button type="button" class="cb-btn cb-btn-sm cb-btn-primary" id="cb-open-desktop-btn" title="在 ChatGPT 桌面端打开此会话">↗ 桌面端打开</button>
        </div>
      `;

      const openBtn = els.detailHeader.querySelector('#cb-open-desktop-btn');
      if (openBtn) {
        openBtn.addEventListener('click', async () => {
          try {
            await api.openDesktop({ threadId: d.threadId });
            setBanner(`已在 ChatGPT 桌面端唤起会话 ${d.threadId.slice(0, 8)}`);
          } catch (err) {
            setBanner(`打开桌面端失败: ${err.message}`, true);
          }
        });
      }

      const forkBtn = els.detailHeader.querySelector('#cb-fork-btn');
      if (forkBtn) {
        forkBtn.addEventListener('click', async () => {
          try {
            setBanner('正在创建分支会话...');
            const forkTitle = `${title} (Fork)`;
            const res = await api.forkThread({
              threadId: d.threadId,
              title: forkTitle,
              ...(d.cwd ? { cwd: d.cwd } : {}),
            });
            setBanner(`已创建分支会话: ${res.threadId}`);
            await refreshOverview(false);
            if (res.threadId) await selectThread(res.threadId, true);
          } catch (err) {
            setBanner(`分支会话失败: ${err.message}`, true);
          }
        });
      }

      const interruptBtn = els.detailHeader.querySelector('#cb-interrupt-btn');
      if (interruptBtn) {
        interruptBtn.addEventListener('click', async () => {
          try {
            setBanner('正在请求中断当前回合...');
            await api.interruptTurn({
              threadId: d.threadId,
              ...(lastTurn && lastTurn.turnId ? { turnId: lastTurn.turnId } : {}),
            });
            setBanner('已发送中断指令');
            await loadThreadDetail(d.threadId, false);
          } catch (err) {
            setBanner(`中断失败: ${err.message}`, true);
          }
        });
      }
    }

    function renderTranscript(scrollToBottom) {
      const d = state.threadDetail;
      if (!d) {
        els.transcript.innerHTML = `
          <div class="cb-empty">
            <div style="font-size:14px;font-weight:600;margin-bottom:6px;">Codex 实时旁观与调度面板</div>
            <div>在这里实时查看 Codex 的完整推理说明、执行的终端命令与输出、文件修改以及最终回复，无需点开 ChatGPT 桌面窗口抢占写入锁。</div>
          </div>
        `;
        return;
      }

      const turns = Array.isArray(d.turns) ? d.turns : [];
      if (!turns.length) {
        els.transcript.innerHTML = `
          <div class="cb-empty">该会话暂无回合记录，可在下方发送第一条任务。</div>
        `;
        return;
      }

      const wasNearBottom =
        els.transcript.scrollHeight - els.transcript.scrollTop - els.transcript.clientHeight < 80;

      // Preserve open state of command details across refreshes
      const openCmdIds = new Set();
      for (const det of els.transcript.querySelectorAll('details.cb-cmd-block[open]')) {
        const cid = det.getAttribute('data-cmd-id');
        if (cid) openCmdIds.add(cid);
      }

      els.transcript.innerHTML = turns
        .map((turn, idx) => {
          const prompt = turn.promptText || turn.userText || '';
          const commentary = Array.isArray(turn.commentary) ? turn.commentary : [];
          const commands = Array.isArray(turn.commands) ? turn.commands : [];
          const filePaths = extractFileChangePaths(turn.fileChanges);
          const dur = formatDuration(turn.durationMs);

          const commentaryHtml = commentary.length
            ? `<div class="cb-commentary-list">
                ${commentary.map((c) => `<div class="cb-commentary-item">💭 ${escapeHtml(c)}</div>`).join('')}
              </div>`
            : '';

          const commandsHtml = commands
            .map((cmd, cIdx) => {
              const cmdKey = `${turn.turnId || idx}-cmd-${cmd.id || cIdx}`;
              const isOpen = openCmdIds.has(cmdKey);
              const exitBadge =
                cmd.exitCode === 0
                  ? '<span class="cb-badge cb-badge-completed">exit 0</span>'
                  : cmd.exitCode != null
                  ? `<span class="cb-badge cb-badge-failed">exit ${escapeHtml(cmd.exitCode)}</span>`
                  : statusBadgeHtml(cmd.status || 'running');
              const cmdDur = formatDuration(cmd.durationMs);
              return `
                <details class="cb-cmd-block" data-cmd-id="${escapeHtml(cmdKey)}" ${isOpen ? 'open' : ''}>
                  <summary class="cb-cmd-summary">
                    <span class="cb-cmd-code" title="${escapeHtml(cmd.command || '')}">$ ${escapeHtml(cmd.command || '')}</span>
                    <span style="display:inline-flex;align-items:center;gap:5px;flex-shrink:0;">
                      ${cmdDur ? `<span style="color:#94a3b8;font-size:10px;">${escapeHtml(cmdDur)}</span>` : ''}
                      ${exitBadge}
                    </span>
                  </summary>
                  ${
                    cmd.outputPreview
                      ? `<pre class="cb-cmd-output">${escapeHtml(cmd.outputPreview)}</pre>`
                      : '<pre class="cb-cmd-output" style="color:#64748b;">(无标准输出)</pre>'
                  }
                </details>
              `;
            })
            .join('');

          const filesHtml = filePaths.length
            ? `<div class="cb-file-pills">
                ${filePaths.map((fp) => `<span class="cb-file-pill" title="${escapeHtml(fp)}">✎ ${escapeHtml(shortPath(fp))}</span>`).join('')}
              </div>`
            : '';

          const replyHtml = turn.reply
            ? `<div class="cb-final-reply">${escapeHtml(turn.reply)}</div>`
            : turn.error
            ? `<div class="cb-final-reply" style="border-color:var(--cb-rose);color:var(--cb-rose);">错误: ${escapeHtml(
                typeof turn.error === 'string' ? turn.error : JSON.stringify(turn.error)
              )}</div>`
            : '';

          return `
            <article class="cb-turn-card">
              <div class="cb-turn-header">
                <div class="cb-turn-header-left">
                  <strong>回合 #${idx + 1}</strong>
                  ${statusBadgeHtml(turn.status)}
                  ${
                    turn.detectedJobId
                      ? `<span class="cb-badge cb-badge-model" title="由 Antigravity Bridge 派发 (Job ${escapeHtml(turn.detectedJobId)})">⚡ Bridge Job ${escapeHtml(
                          String(turn.detectedJobId).slice(0, 8)
                        )}</span>`
                      : ''
                  }
                </div>
                <div style="display:flex;align-items:center;gap:6px;">
                  ${dur ? `<span class="cb-turn-id">${escapeHtml(dur)}</span>` : ''}
                  ${
                    turn.reply
                      ? `<button type="button" class="cb-btn cb-btn-sm" data-copy-turn="${idx}" title="复制本回合回复">复制</button>`
                      : ''
                  }
                </div>
              </div>
              <div class="cb-turn-body">
                ${prompt ? `<div class="cb-user-prompt">${escapeHtml(prompt)}</div>` : ''}
                ${commentaryHtml}
                ${commandsHtml}
                ${filesHtml}
                ${replyHtml}
              </div>
            </article>
          `;
        })
        .join('');

      for (const copyBtn of els.transcript.querySelectorAll('[data-copy-turn]')) {
        copyBtn.addEventListener('click', () => {
          const idx = Number(copyBtn.getAttribute('data-copy-turn'));
          const t = turns[idx];
          if (t && t.reply && navigator.clipboard) {
            navigator.clipboard.writeText(t.reply);
            copyBtn.textContent = '已复制';
            setTimeout(() => {
              copyBtn.textContent = '复制';
            }, 1200);
          }
        });
      }

      if (scrollToBottom || wasNearBottom) {
        els.transcript.scrollTop = els.transcript.scrollHeight;
      }
    }

    async function loadThreadDetail(threadId, scrollToBottom) {
      if (!threadId) return;
      state.loadingDetail = true;
      try {
        const detail = await api.getThreadDetail({ threadId, limit: 25 });
        if (state.selectedThreadId === threadId) {
          state.threadDetail = detail;
          renderDetailHeader();
          renderTranscript(scrollToBottom);
        }
      } catch (err) {
        setBanner(`加载会话详情失败: ${err.message}`, true);
      } finally {
        state.loadingDetail = false;
      }
    }

    async function selectThread(threadId, scrollToBottom) {
      state.selectedThreadId = threadId;
      renderThreadList();
      await loadThreadDetail(threadId, scrollToBottom);
    }

    async function refreshOverview(autoSelectFirst) {
      state.loadingList = true;
      try {
        const wsParam = state.scope === 'workspace' && state.workspace ? state.workspace : undefined;
        const data = await api.getOverview({ workspace: wsParam, limit: 30 });
        if (Array.isArray(data.models) && data.models.length) {
          state.models = data.models;
          renderModelSelectOptions();
        }
        if (data.projects) {
          state.projects = data.projects;
          renderProjectsDatalist();
        }
        state.threads = Array.isArray(data.threads) ? data.threads : [];
        renderThreadList();

        if (autoSelectFirst && !state.selectedThreadId && state.threads.length > 0) {
          await selectThread(state.threads[0].threadId, true);
        } else if (state.selectedThreadId) {
          await loadThreadDetail(state.selectedThreadId, false);
        } else {
          renderDetailHeader();
          renderTranscript(false);
        }
      } catch (err) {
        setBanner(`同步 Codex 状态失败: ${err.message}`, true);
      } finally {
        state.loadingList = false;
      }
    }

    // Event bindings
    els.scopeWsBtn.addEventListener('click', () => {
      state.scope = 'workspace';
      updateWorkspaceHeader();
      refreshOverview(true);
    });

    els.scopeAllBtn.addEventListener('click', () => {
      state.scope = 'all';
      updateWorkspaceHeader();
      refreshOverview(true);
    });

    els.newThreadBtn.addEventListener('click', () => {
      setComposerMode('start');
      els.titleInput.focus();
    });

    els.refreshBtn.addEventListener('click', () => {
      setBanner('正在刷新 Codex 会话与回合状态...');
      refreshOverview(false).then(() => setBanner('已同步最新状态'));
    });

    els.searchInput.addEventListener('input', () => {
      state.searchQuery = els.searchInput.value || '';
      renderThreadList();
    });

    els.modeSendBtn.addEventListener('click', () => setComposerMode('send'));
    els.modeStartBtn.addEventListener('click', () => setComposerMode('start'));

    els.modelSelect.addEventListener('change', () => {
      state.model = els.modelSelect.value;
      renderEffortSelectOptions();
    });

    els.effortSelect.addEventListener('change', () => {
      state.effort = els.effortSelect.value;
    });

    els.promptInput.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        els.composerForm.requestSubmit();
      }
    });

    els.composerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (state.submitting) return;
      const prompt = (els.promptInput.value || '').trim();
      if (!prompt) {
        setBanner('请输入要派发给 Codex 的任务内容', true);
        return;
      }

      const model = els.modelSelect.value || undefined;
      const effort = els.effortSelect.value || undefined;
      const sandbox = els.sandboxSelect.value || 'read-only';
      const open = Boolean(els.openCheckbox.checked);

      state.submitting = true;
      els.submitBtn.disabled = true;

      try {
        if (state.composerMode === 'start' || !state.selectedThreadId) {
          const title = (els.titleInput.value || '').trim() || undefined;
          const cleanWs = state.workspace
            ? state.workspace.replace(/^file:\/\/\/?/i, '').replace(/\//g, '\\')
            : '';
          const cwd = (els.cwdInput.value || '').trim() || cleanWs || undefined;
          setBanner('正在创建新 Codex 会话并投递任务...');
          const res = await api.startTask({
            prompt,
            ...(cwd ? { cwd } : {}),
            ...(model ? { model } : {}),
            ...(effort ? { effort } : {}),
            ...(title ? { title } : {}),
            sandbox,
            open,
            wait: false,
          });
          els.promptInput.value = '';
          setBanner(`已创建会话 ${String(res.threadId).slice(0, 8)} (Job ${String(res.jobId).slice(0, 8)})`);
          setComposerMode('send');
          await refreshOverview(false);
          if (res.threadId) {
            await selectThread(res.threadId, true);
          }
        } else {
          const via = els.viaSelect.value || 'auto';
          setBanner(`正在向会话 ${state.selectedThreadId.slice(0, 8)} 投递任务...`);
          const res = await api.sendTask({
            threadId: state.selectedThreadId,
            prompt,
            ...(model ? { model } : {}),
            ...(effort ? { effort } : {}),
            sandbox,
            via,
            open,
            wait: false,
          });
          els.promptInput.value = '';
          const notice = res.notice ? ` · ${res.notice}` : '';
          setBanner(`已投递 (通道: ${res.via || via}, 状态: ${res.status})${notice}`);
          await loadThreadDetail(state.selectedThreadId, true);
        }
      } catch (err) {
        setBanner(`派发失败: ${err.message}`, true);
      } finally {
        state.submitting = false;
        els.submitBtn.disabled = false;
      }
    });

    api.subscribeWorkspace(({ workspace }) => {
      state.workspace = workspace || '';
      updateWorkspaceHeader();
      if (state.scope === 'workspace') {
        refreshOverview(true);
      }
    });

    // Initial boot
    updateWorkspaceHeader();
    setBanner(state.bannerText, false);
    refreshOverview(true);

    // Live polling loop: fast (2.5s) when a turn is in progress, normal (7s) otherwise
    let tickCount = 0;
    setInterval(() => {
      if (document.hidden || state.submitting) return;
      tickCount += 1;
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
      } else if (tickCount % 3 === 0) {
        refreshOverview(false);
      }
    }, 2500);
  }

  window.CodexBridgeApp = { mount };
})();
