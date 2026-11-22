import { execFile, execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import { once } from 'node:events';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';

const run = promisify(execFile);
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const UUID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const TASK_HEADER_RE = /^\[Antigravity\/Gemini task ([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\](?=\r?\n|$)/i;
const RPC_TIMEOUT_MS = 15_000;
const DEFAULT_TURN_TIMEOUT_MS = 20 * 60 * 1000;
const VALID_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const VALID_APPROVALS = new Set(['never', 'on-request', 'untrusted']);

let cachedCodexBin;
const activeTurnSessions = new Map();

function codexHomeDir() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

function bridgeTmpDir() {
  return path.join(codexHomeDir(), 'tmp', 'codex-desktop-bridge');
}

function ensureBridgeTmpDir() {
  const dir = bridgeTmpDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

function jobSpecPath(jobId) {
  return path.join(bridgeTmpDir(), `${jobId}.spec.json`);
}

function jobStatePath(jobId) {
  return path.join(bridgeTmpDir(), `${jobId}.state.json`);
}

function jobLogPath(jobId) {
  return path.join(bridgeTmpDir(), `${jobId}.log`);
}

function writeJsonFile(filePath, data) {
  ensureBridgeTmpDir();
  const temporary = `${filePath}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    renameSync(temporary, filePath);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function readJsonFileSafe(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function resolveCodexBin() {
  if (cachedCodexBin) return cachedCodexBin;
  if (process.env.CODEX_BIN) {
    cachedCodexBin = process.env.CODEX_BIN;
    return cachedCodexBin;
  }

  try {
    const cmd = process.platform === 'win32' ? 'where.exe' : 'which';
    const out = execFileSync(cmd, ['codex'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
      timeout: 3000,
    });
    const first = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    if (first && existsSync(first) && !/\.(cmd|bat)$/i.test(first)) {
      cachedCodexBin = first;
      return cachedCodexBin;
    }
  } catch {
    // Fall through to platform-specific discovery.
  }

  if (process.platform === 'win32') {
    const windowsApps = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'WindowsApps');
    try {
      const dirs = readdirSync(windowsApps)
        .filter((name) => name.startsWith('OpenAI.Codex_'))
        .sort()
        .reverse();
      for (const dir of dirs) {
        const candidate = path.join(windowsApps, dir, 'app', 'resources', 'codex.exe');
        if (existsSync(candidate)) {
          cachedCodexBin = candidate;
          return cachedCodexBin;
        }
      }
    } catch {
      // Ignore permission or missing WindowsApps errors.
    }

    // WindowsApps may block directory enumeration while allowing the registered executable to run.
    try {
      const locations = execFileSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        'Get-AppxPackage -Name OpenAI.Codex | Select-Object -ExpandProperty InstallLocation',
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 3000 });
      for (const location of locations.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
        const candidate = path.join(location, 'app', 'resources', 'codex.exe');
        if (existsSync(candidate)) {
          cachedCodexBin = candidate;
          return cachedCodexBin;
        }
      }
    } catch {
      // Continue to npm discovery.
    }

    const npmCandidate = path.join(process.env.APPDATA || '', 'npm', 'codex.cmd');
    if (existsSync(npmCandidate)) {
      cachedCodexBin = npmCandidate;
      return cachedCodexBin;
    }
  }

  cachedCodexBin = 'codex';
  return cachedCodexBin;
}

function taskHeader(jobId) {
  return `[Antigravity/Gemini task ${jobId}]`;
}

function requireId(value, name) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw new Error(`${name} must be a UUID`);
  return value.toLowerCase();
}

function normalizeSandbox(value = 'read-only') {
  const key = String(value).trim();
  const map = {
    'read-only': {
      threadSandbox: 'read-only',
      turnSandboxPolicy: { type: 'readOnly', networkAccess: false },
    },
    readOnly: {
      threadSandbox: 'read-only',
      turnSandboxPolicy: { type: 'readOnly', networkAccess: false },
    },
    'workspace-write': {
      threadSandbox: 'workspace-write',
      turnSandboxPolicy: { type: 'workspaceWrite', networkAccess: false },
    },
    workspaceWrite: {
      threadSandbox: 'workspace-write',
      turnSandboxPolicy: { type: 'workspaceWrite', networkAccess: false },
    },
    'danger-full-access': {
      threadSandbox: 'danger-full-access',
      turnSandboxPolicy: { type: 'dangerFullAccess' },
    },
    dangerFullAccess: {
      threadSandbox: 'danger-full-access',
      turnSandboxPolicy: { type: 'dangerFullAccess' },
    },
  };
  if (!Object.hasOwn(map, key)) {
    throw new Error(`Invalid --sandbox "${value}" (expected read-only, workspace-write, or danger-full-access)`);
  }
  return map[key];
}

function normalizeApproval(value = 'never') {
  const key = String(value).trim();
  if (!VALID_APPROVALS.has(key)) {
    throw new Error(`Invalid --approval "${value}" (expected never, on-request, or untrusted)`);
  }
  return key;
}

function normalizeEffort(value) {
  if (value == null || value === '') return undefined;
  const key = String(value).trim().toLowerCase();
  if (!VALID_EFFORTS.has(key)) {
    throw new Error(`Invalid --effort "${value}" (expected low, medium, high, xhigh, max, or ultra)`);
  }
  return key;
}

function normalizeCwdInput(rawCwd) {
  if (!rawCwd) return process.cwd();
  let s = String(rawCwd).trim();
  if (/^file:\/\//i.test(s)) {
    try {
      return fileURLToPath(s);
    } catch {
      s = s.replace(/^file:\/\/\/?/i, '');
    }
  }
  if (/%[0-9a-f]{2}/i.test(s)) {
    try {
      s = decodeURIComponent(s);
    } catch {
      // Keep original string if percent decoding fails.
    }
  }
  if (process.platform === 'win32' && /^\/[a-zA-Z]:[\\/]/.test(s)) {
    s = s.slice(1);
  }
  return path.resolve(s);
}

function resolveProjectCwd(rawCwd, { mkdir = false } = {}) {
  const target = normalizeCwdInput(rawCwd);
  if (mkdir) mkdirSync(target, { recursive: true });
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    throw new Error(`Project directory does not exist: ${target} (pass --mkdir to create it)`);
  }
  return target;
}

function userMessageText(item) {
  return (item?.content || []).filter((part) => part.type === 'text').map((part) => part.text).join('\n');
}

export function summarizeTurn(turn, jobId) {
  const items = turn.items || [];
  const userText = userMessageText(items.find((item) => item.type === 'userMessage'));
  const header = TASK_HEADER_RE.exec(userText);
  const replies = items.filter((item) => item.type === 'agentMessage' && item.text?.trim());
  const finalReplies = replies.filter((item) => item.phase === 'final_answer' || item.phase === 'partial_answer');

  return {
    turnId: turn.id,
    status: turn.status,
    error: turn.error ?? null,
    startedAt: turn.startedAt ?? null,
    completedAt: turn.completedAt ?? null,
    durationMs: turn.durationMs ?? null,
    userText,
    promptText: header ? userText.slice(header[0].length).trimStart() : userText,
    detectedJobId: header?.[1]?.toLowerCase() ?? jobId ?? null,
    commentary: items.filter((item) => item.type === 'agentMessage' && item.phase === 'commentary')
      .map((item) => item.text ?? ''),
    commands: items.filter((item) => item.type === 'commandExecution').map((item) => ({
      id: item.id,
      command: item.command,
      cwd: item.cwd,
      status: item.status,
      exitCode: item.exitCode ?? null,
      durationMs: item.durationMs ?? null,
      outputPreview: (item.aggregatedOutput ?? '').slice(0, 1200),
    })),
    fileChanges: items.filter((item) => item.type === 'fileChange').map(({ id, status, changes }) => ({
      id, status, changes,
    })),
    reply: finalReplies.length
      ? finalReplies.map((item) => item.text).join('\n\n')
      : replies.findLast((item) => item.phase == null)?.text ?? null,
  };
}

function turnTelemetry(turn) {
  const { userText, promptText, detectedJobId, ...telemetry } = summarizeTurn(turn);
  return telemetry;
}

export function matchTurn(turn, jobId) {
  const header = taskHeader(jobId);
  const firstMessage = (turn.items || []).findIndex((item) => {
    if (item.type !== 'userMessage') return false;
    const text = userMessageText(item);
    return text === header || text.startsWith(`${header}\n`) || text.startsWith(`${header}\r\n`);
  });
  if (firstMessage === -1) return null;

  const items = turn.items.slice(firstMessage + 1);
  const nextInput = items.findIndex((item) => item.type === 'userMessage');
  const result = turnTelemetry({ ...turn, items: nextInput === -1 ? items : items.slice(0, nextInput) });
  if (nextInput !== -1) return { ...result, status: 'mixedTurn', reply: null };
  if (result.status === 'completed' && !result.reply) result.status = 'completedWithoutReply';
  return result;
}

function handleDefaultServerRequest(msg, reply, errReply) {
  switch (msg.method) {
    case 'item/commandExecution/requestApproval':
    case 'item/fileChange/requestApproval':
      reply({ decision: 'decline' });
      break;
    case 'execCommandApproval':
    case 'applyPatchApproval':
      reply({ decision: 'denied' });
      break;
    default:
      errReply(-32601, `Unsupported server request in desktop-bridge: ${msg.method}`);
      break;
  }
}

async function withAppServer(fn, { timeoutMs = RPC_TIMEOUT_MS, onNotification } = {}) {
  const codexBin = resolveCodexBin();
  const child = spawn(codexBin, ['app-server', '--listen', 'stdio://'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const output = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const stderrChunks = [];
  child.stderr.on('data', (chunk) => stderrChunks.push(chunk.toString('utf8')));

  const pending = new Map();
  let sequence = 0;
  let settledFailure;
  let rejectSession;
  const sessionFailure = new Promise((_, reject) => { rejectSession = reject; });

  function failAll(error) {
    rejectSession(error);
    if (!settledFailure) settledFailure = error;
    for (const entry of pending.values()) {
      entry.reject(error);
    }
    pending.clear();
  }

  child.on('error', (error) => {
    const wrapped = error.code === 'ENOENT'
      ? new Error(`Codex binary not found (${codexBin}). Set CODEX_BIN to codex.exe.`)
      : error;
    failAll(wrapped);
  });
  child.stdin.on('error', (error) => failAll(error));
  child.on('close', (code) => {
    const stderrText = stderrChunks.join('').trim();
    failAll(new Error(stderrText || `Codex app-server exited (code ${code ?? 'unknown'})`));
  });

  const timer = timeoutMs > 0
    ? setTimeout(() => {
        failAll(new Error(`Timed out after ${timeoutMs}ms waiting for Codex app-server`));
        output.close();
        child.kill();
      }, timeoutMs)
    : null;

  function write(message) {
    if (!child.stdin.destroyed) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }
  }

  output.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.id != null && !msg.method) {
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else entry.resolve(msg.result);
      return;
    }
    if (msg.method && msg.id != null) {
      handleDefaultServerRequest(
        msg,
        (result) => write({ id: msg.id, result }),
        (code, message) => write({ id: msg.id, error: { code, message } }),
      );
      return;
    }
    if (msg.method) {
      onNotification?.(msg);
    }
  });

  function request(method, params) {
    if (settledFailure) return Promise.reject(settledFailure);
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      write({ id, method, params });
    });
  }

  try {
    return await Promise.race([sessionFailure, (async () => {
      await request('initialize', {
        clientInfo: { name: 'antigravity_codex_desktop_bridge', version: '0.3.0' },
        capabilities: { experimentalApi: true },
      });
      write({ method: 'initialized' });
      return fn({ request });
    })()]);
  } finally {
    if (timer) clearTimeout(timer);
    output.close();
    child.stdin.end();
    child.kill();
  }
}

export async function listModels({ includeHidden = false } = {}) {
  return withAppServer(async ({ request }) => {
    const models = [];
    let cursor = null;
    do {
      const res = await request('model/list', { cursor, includeHidden });
      for (const item of res.data || []) {
        models.push({
          id: item.id,
          model: item.model,
          displayName: item.displayName,
          description: item.description,
          isDefault: Boolean(item.isDefault),
          defaultReasoningEffort: item.defaultReasoningEffort ?? null,
          supportedEfforts: (item.supportedReasoningEfforts || []).map((e) => e.reasoningEffort),
        });
      }
      cursor = res.nextCursor ?? null;
    } while (cursor);
    return { models };
  });
}

export async function listProjects({ limit = 30 } = {}) {
  const globalState = readJsonFileSafe(path.join(codexHomeDir(), '.codex-global-state.json')) || {};
  const savedRoots = new Set();
  for (const [key, value] of Object.entries(globalState)) {
    if ((key === 'electron-saved-workspace-roots' || key.startsWith('electron-owner-value:electron-saved-workspace-roots:')) && Array.isArray(value)) {
      for (const root of value) savedRoots.add(root);
    }
  }
  const localProjects = globalState['local-projects']
    ? Object.values(globalState['local-projects']).map((proj) => ({
        id: proj.id,
        name: proj.name,
        rootPaths: proj.rootPaths || [],
      }))
    : [];

  const recent = await withAppServer(async ({ request }) => {
    const res = await request('thread/list', { limit });
    return [...new Set((res.data || []).map((t) => t.cwd).filter(Boolean))];
  });

  return {
    savedRoots: [...savedRoots],
    localProjects,
    recentCwds: recent,
  };
}

async function launchDesktop(command, args) {
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  await once(child, 'spawn');
  child.unref();
}

export async function openDesktopProject(cwd, { mkdir = false } = {}) {
  cwd = resolveProjectCwd(cwd, { mkdir });
  await launchDesktop(resolveCodexBin(), ['app', cwd]);
  return { cwd, launched: true };
}

export async function openDesktopUrl(url) {
  if (process.platform === 'win32') {
    return launchDesktop('rundll32.exe', ['url.dll,FileProtocolHandler', url]);
  }
  const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
  return launchDesktop(cmd, [url]);
}

function withThreadSession(threadId, fn) {
  const active = activeTurnSessions.get(threadId);
  return active ? fn({ request: active }) : withAppServer(fn);
}

async function readJob(threadId, jobId) {
  return withThreadSession(threadId, async ({ request }) => {
    let cursor;
    for (let page = 0; page < 5; page += 1) {
      const result = await request('thread/turns/list', {
        threadId, cursor, limit: 12, sortDirection: 'desc', itemsView: 'full',
      });
      for (const turn of result.data || []) {
        const match = matchTurn(turn, jobId);
        if (match) return match;
      }
      cursor = result.nextCursor;
      if (!cursor) return { status: 'pending' };
    }
    return { status: 'outsideScanWindow' };
  });
}

export async function findThreads(title, cwdFilter) {
  const normalizedCwd = cwdFilter ? normalizeCwdInput(cwdFilter) : null;
  return withAppServer(async ({ request }) => {
    const result = await request('thread/list', {
      searchTerm: title,
      ...(normalizedCwd ? { cwd: normalizedCwd } : {}),
      limit: 30,
    });
    const threads = (result.data || [])
      .filter((thread) => thread.name === title)
      .map((thread) => ({
        threadId: thread.id,
        name: thread.name,
        cwd: thread.cwd,
        updatedAt: thread.updatedAt ?? null,
        desktopUrl: `codex://threads/${thread.id}`,
      }));
    return { threads, hasMore: Boolean(result.nextCursor) };
  });
}

function threadSummary(thread) {
  return {
    threadId: thread.id,
    name: thread.name ?? null,
    cwd: thread.cwd,
    source: thread.source,
    originator: thread.originator,
    modelProvider: thread.modelProvider,
    desktopUrl: `codex://threads/${thread.id}`,
  };
}

export async function listThreads({ cwd, searchTerm, limit = 25 } = {}) {
  return withAppServer(async ({ request }) => {
    const result = await request('thread/list', {
      limit,
      ...(cwd ? { cwd: normalizeCwdInput(cwd) } : {}),
      ...(searchTerm ? { searchTerm } : {}),
    });
    return {
      threads: (result.data || []).map((thread) => ({
        ...threadSummary(thread), updatedAt: thread.updatedAt ?? null,
      })),
      hasMore: Boolean(result.nextCursor),
    };
  });
}

export async function getThreadDetail({ threadId, limit = 15 } = {}) {
  threadId = requireId(threadId, 'Thread ID');
  return withThreadSession(threadId, async ({ request }) => {
    const { thread } = await request('thread/read', { threadId, includeTurns: false });
    const { data = [] } = await request('thread/turns/list', {
      threadId, limit, sortDirection: 'desc', itemsView: 'full',
    });
    return {
      ...threadSummary({ ...thread, id: threadId }),
      statusType: thread?.status?.type || 'unknown',
      turns: [...data].reverse().map((turn) => summarizeTurn(turn)),
    };
  });
}

export async function interruptTurn({ threadId, turnId } = {}) {
  threadId = requireId(threadId, 'Thread ID');
  return withThreadSession(threadId, async ({ request }) => {
    if (!turnId) {
      const { data } = await request('thread/turns/list', { threadId, limit: 1, sortDirection: 'desc' });
      turnId = data?.[0]?.id;
      if (!turnId) throw new Error(`No turns found for thread ${threadId}`);
    }
    await request('turn/interrupt', { threadId, turnId });
    return { threadId, turnId, interrupted: true };
  });
}

export async function forkThread({ threadId, title, cwd, model } = {}) {
  threadId = requireId(threadId, 'Thread ID');
  return withAppServer(async ({ request }) => {
    const res = await request('thread/fork', {
      threadId,
      ...(cwd ? { cwd: normalizeCwdInput(cwd) } : {}),
      ...(model ? { model } : {}),
      ephemeral: false,
    });
    const newThreadId = res.thread?.id;
    if (!newThreadId) throw new Error('thread/fork did not return thread.id');
    if (title) await request('thread/name/set', { threadId: newThreadId, name: title });
    return {
      sourceThreadId: threadId,
      threadId: newThreadId,
      title: title || res.thread?.name || null,
      cwd: res.cwd,
      model: res.model,
      desktopUrl: `codex://threads/${newThreadId}`,
    };
  });
}

async function createTaskThread(request, { cwd, model, effort, title, threadSandbox, approval, open, openProject }) {
  const res = await request('thread/start', {
    cwd,
    ...(model ? { model } : {}),
    approvalPolicy: approval,
    sandbox: threadSandbox,
    ephemeral: false,
  });
  const threadId = res.thread?.id;
  if (!threadId) throw new Error('thread/start did not return thread.id');
  if (title) await request('thread/name/set', { threadId, name: title });

  const desktopUrl = `codex://threads/${threadId}`;
  cwd = res.cwd || cwd;
  if (openProject) await openDesktopProject(cwd);
  if (open) await openDesktopUrl(desktopUrl);
  return {
    threadId, desktopUrl, cwd,
    title: title || null,
    model: res.model || model || null,
    effort: effort || res.reasoningEffort || null,
    sandbox: threadSandbox,
    approval,
  };
}

async function runTurnViaAppServer(spec, { onReady, onSubmitted, onProgress } = {}) {
  const { jobId, prompt, model, effort, cwd, sandbox, approval, timeoutMs } = spec;
  const { threadSandbox, turnSandboxPolicy } = normalizeSandbox(sandbox);
  let threadId = spec.threadId;
  let activeTurnId;
  let sessionRequest;
  let resolveCompleted;
  const completed = new Promise((resolve) => { resolveCompleted = resolve; });
  // Some app-server builds notify before the turn/start response arrives.
  const earlyCompletions = new Map();

  try {
    return await withAppServer(async ({ request }) => {
      const base = { jobId };
      let turnCwd = cwd;
      if (spec.createThread) {
        const created = await createTaskThread(request, { ...spec, threadSandbox });
        Object.assign(base, created);
        threadId = created.threadId;
        turnCwd = created.cwd;
      } else {
        Object.assign(base, { threadId, desktopUrl: `codex://threads/${threadId}`, via: 'app-server' });
      }

      onReady?.(base);
      onProgress?.(`running thread=${threadId} job=${jobId} model=${base.model ?? model ?? (spec.createThread ? 'default' : 'thread-default')} url=${base.desktopUrl}`);
      if (!spec.createThread) {
        await request('thread/resume', {
          threadId,
          excludeTurns: true,
          ...(cwd ? { cwd } : {}),
          ...(model ? { model } : {}),
          approvalPolicy: approval,
          sandbox: threadSandbox,
        });
      }

      const turnRes = await request('turn/start', {
        threadId,
        input: [{ type: 'text', text: `${taskHeader(jobId)}\n\n${prompt}` }],
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
        ...(turnCwd ? { cwd: turnCwd } : {}),
        approvalPolicy: approval,
        sandboxPolicy: turnSandboxPolicy,
      });

      activeTurnId = turnRes.turn?.id;
      if (!activeTurnId) throw new Error('turn/start did not return turn.id');
      sessionRequest = request;
      activeTurnSessions.set(threadId, sessionRequest);
      onSubmitted?.({ ...base, turnId: activeTurnId, status: 'submitted' });
      if (earlyCompletions.has(activeTurnId)) resolveCompleted(earlyCompletions.get(activeTurnId));
      earlyCompletions.clear();

      const completedTurn = await completed;
      const matched = matchTurn(completedTurn, jobId);
      if (matched && matched.status !== 'completedWithoutReply') return { ...base, ...matched };

      // The completion notification may omit the turn's full item history.
      let cursor;
      for (let page = 0; page < 3; page += 1) {
        const list = await request('thread/turns/list', {
          threadId, cursor, limit: 12, sortDirection: 'desc', itemsView: 'full',
        });
        const turn = (list.data || []).find((entry) => entry.id === activeTurnId);
        const history = turn && matchTurn(turn, jobId);
        if (history && !['inProgress', 'in_progress'].includes(history.status)) return { ...base, ...history };
        if (turn) break;
        cursor = list.nextCursor;
        if (!cursor) break;
      }
      return { ...base, ...(matched || turnTelemetry(completedTurn)) };
    }, {
      timeoutMs,
      onNotification(msg) {
        if (msg.method !== 'turn/completed' || msg.params?.threadId !== threadId) return;
        const turn = msg.params.turn;
        if (!turn) return;
        if (!activeTurnId) earlyCompletions.set(turn.id, turn);
        else if (turn.id === activeTurnId) resolveCompleted(turn);
      },
    });
  } catch (error) {
    if (activeTurnId) error.turnSubmitted = true;
    throw error;
  } finally {
    if (sessionRequest && activeTurnSessions.get(threadId) === sessionRequest) activeTurnSessions.delete(threadId);
  }
}

function writeJobState({ threadId, jobId }, state, fields = {}) {
  writeJsonFile(jobStatePath(jobId), { state, threadId, jobId, ...fields, updatedAt: Date.now() });
}

async function runTrackedTurn(spec, onSubmitted) {
  let task = spec;
  try {
    const result = await runTurnViaAppServer(spec, {
      onReady(base) {
        task = base;
        if (spec.createThread) writeJobState(task, 'starting', { base });
      },
      onSubmitted(payload) {
        task = payload;
        writeJobState(task, 'submitted', { turnId: task.turnId, base: payload });
        onSubmitted?.(payload);
      },
    });
    writeJobState(task, 'completed', {
      turnId: result.turnId,
      base: task,
      resultStatus: result.status,
      result,
    });
  } catch (error) {
    writeJobState(task, 'failed', { turnId: task.turnId, error: error.message });
    throw error;
  }
}

function dispatchInProcessTurn(spec) {
  writeJobState(spec, 'starting');
  return new Promise((resolve, reject) => {
    // Resolve at submission. The child and its completion handler stay in this process.
    runTrackedTurn(spec, resolve).catch(reject);
  });
}

async function dispatchDetachedTurn(spec) {
  const { jobId } = spec;
  writeJsonFile(jobSpecPath(jobId), spec);
  writeJobState(spec, 'starting');

  const logFile = jobLogPath(jobId);
  const logFd = openSync(logFile, 'a');
  let worker;
  try {
    worker = spawn(process.execPath, [SCRIPT_PATH, '_run-turn', '--job', jobId], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
    });
    await once(worker, 'spawn');
    worker.unref();
  } finally {
    closeSync(logFd);
  }

  let workerExited = false;
  let workerExitCode = null;
  worker.on('exit', (code) => {
    workerExited = true;
    workerExitCode = code;
  });

  const deadline = Date.now() + RPC_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const state = readJsonFileSafe(jobStatePath(jobId));
    if (state?.state === 'submitted' || state?.state === 'completed') {
      return { ...state.base, status: 'submitted', turnId: state.turnId ?? null, logFile };
    }
    if (state?.state === 'failed') {
      const error = new Error(state.error || 'Background turn worker failed');
      error.turnSubmitted = Boolean(state.turnId);
      throw error;
    }
    if (workerExited) {
      throw new Error(`Background turn worker exited early (code ${workerExitCode}). Check ${logFile}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }

  const state = readJsonFileSafe(jobStatePath(jobId));
  return {
    jobId,
    ...(spec.threadId ? { threadId: spec.threadId, desktopUrl: `codex://threads/${spec.threadId}`, via: 'app-server' } : {}),
    ...state?.base,
    status: 'uncertain',
    error: `Timed out waiting for worker startup ack. Check ${logFile}`,
    logFile,
  };
}

function dispatchTask(spec, { wait, inProcessAsync, onProgress }) {
  if (wait) return runTurnViaAppServer(spec, { onProgress });
  if (inProcessAsync) return dispatchInProcessTurn(spec);
  return dispatchDetachedTurn(spec);
}

async function runWorkerCommand(jobId) {
  const spec = readJsonFileSafe(jobSpecPath(jobId));
  if (!spec) throw new Error(`Missing job spec for ${jobId}`);
  await runTrackedTurn(spec);
}

function parseTimeoutMs(raw) {
  if (raw == null || raw === '') return DEFAULT_TURN_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --timeout-ms "${raw}"`);
  }
  return Math.floor(parsed);
}

export async function startThreadTask(options = {}) {
  const prompt = requirePrompt(options.prompt);
  const cwd = resolveProjectCwd(options.cwd, { mkdir: Boolean(options.mkdir) });
  const model = options.model?.trim() || undefined;
  const effort = normalizeEffort(options.effort);
  const title = options.title?.trim() || undefined;
  const sandbox = options.sandbox || 'read-only';
  const approval = normalizeApproval(options.approval || 'never');
  normalizeSandbox(sandbox);

  return dispatchTask({
    createThread: true,
    jobId: randomUUID(),
    prompt,
    model,
    effort,
    title,
    cwd,
    sandbox,
    approval,
    open: options.open,
    openProject: options.openProject,
    timeoutMs: parseTimeoutMs(options.timeoutMs),
  }, options);
}

function requirePrompt(prompt) {
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('A non-empty prompt is required');
  return prompt.trim();
}

function isActiveWriterError(error) {
  return /already has an active writer/i.test(error?.message || '');
}

async function sendViaQueue({ threadId, jobId, desktopUrl, prompt, wait, timeoutMs, fallbackNotice, onProgress }) {
  const codexBin = resolveCodexBin();
  const base = { threadId, jobId, desktopUrl, via: 'queue' };
  try {
    await run(codexBin, ['queue', '--thread', threadId, '--message', `${taskHeader(jobId)}\n\n${prompt}`], {
      timeout: RPC_TIMEOUT_MS,
      windowsHide: true,
    });
  } catch (error) {
    return error.code === 'ENOENT'
      ? { ...base, status: 'notSubmitted', error: `Codex binary not found (${codexBin}). Set CODEX_BIN to codex.exe.` }
      : { ...base, status: 'uncertain', error: error.stderr?.trim() || error.message };
  }

  if (fallbackNotice) {
    base.fallbackFrom = 'app-server';
    base.notice = fallbackNotice;
    if (!wait) writeJobState({ threadId, jobId }, 'submitted');
  }
  if (!wait) return { ...base, status: 'submitted' };

  onProgress?.(`queued into active desktop thread=${threadId} job=${jobId} url=${desktopUrl}`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await readJob(threadId, jobId);
    if (!['pending', 'inProgress', 'in_progress'].includes(result.status)) return { ...base, ...result };
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return { ...base, status: 'timedOutWaitingForQueue' };
}

export async function sendThreadTask(options = {}) {
  const threadId = requireId(options.threadId ?? process.env.CODEX_DESKTOP_THREAD_ID, 'Thread ID');
  const desktopUrl = `codex://threads/${threadId}`;
  const prompt = requirePrompt(options.prompt);
  const model = options.model?.trim() || undefined;
  const effort = normalizeEffort(options.effort);
  const cwd = options.cwd ? resolveProjectCwd(options.cwd, { mkdir: Boolean(options.mkdir) }) : undefined;
  const via = options.via || 'auto';
  if (!['auto', 'queue', 'app-server'].includes(via)) {
    throw new Error(`Invalid --via "${via}" (expected auto, queue, or app-server)`);
  }

  const jobId = randomUUID();
  const timeoutMs = parseTimeoutMs(options.timeoutMs);
  const { wait, onProgress } = options;
  const queued = { threadId, jobId, desktopUrl, prompt, wait, timeoutMs, onProgress };
  if (options.open) await openDesktopUrl(desktopUrl);
  if (via === 'queue') return sendViaQueue(queued);

  try {
    return await dispatchTask({
      threadId, jobId, prompt, model, effort, cwd, timeoutMs,
      sandbox: options.sandbox || 'read-only',
      approval: normalizeApproval(options.approval || 'never'),
    }, options);
  } catch (error) {
    if (via !== 'auto' || !isActiveWriterError(error) || error.turnSubmitted) throw error;
    const hasOverrides = Boolean(model || effort || options.sandbox || options.approval || cwd);
    const fallbackNotice = hasOverrides
      ? 'Thread is active in ChatGPT desktop; fell back to codex queue (uses desktop thread model/settings).'
      : 'Thread is active in ChatGPT desktop; routed via codex queue.';
    onProgress?.(fallbackNotice);
    return sendViaQueue({ ...queued, fallbackNotice });
  }
}

export async function getJobStatus({ threadId, jobId } = {}) {
  threadId = requireId(threadId ?? process.env.CODEX_DESKTOP_THREAD_ID, 'Thread ID');
  jobId = requireId(jobId, 'Job ID');
  const base = { threadId, jobId, desktopUrl: `codex://threads/${threadId}` };
  const worker = readJsonFileSafe(jobStatePath(jobId));
  const state = worker?.threadId === threadId ? worker : null;
  let result;
  try {
    result = await readJob(threadId, jobId);
  } catch (error) {
    if (!state) throw error;
    result = { status: 'pending' };
  }
  if (state?.state === 'completed' && ['pending', 'outsideScanWindow', 'inProgress', 'in_progress'].includes(result.status)) {
    return { ...base, ...state.result, status: state.resultStatus, workerState: state.state };
  }
  if (state?.state === 'failed' && ['inProgress', 'in_progress'].includes(result.status)) {
    return { ...base, ...result, status: 'failed', workerState: state.state, error: state.error };
  }
  if (state && result.status === 'pending') {
    return {
      ...base,
      ...result,
      ...(state.turnId ? { turnId: state.turnId } : {}),
      workerState: state.state,
      ...(state.error ? { error: state.error } : {}),
    };
  }
  return { ...base, ...result };
}

async function readPromptFile(command, filename) {
  if (!filename) throw new Error(`${command} requires --prompt-file`);
  const prompt = (await readFile(filename, 'utf8')).trim();
  if (!prompt) throw new Error('The prompt file is empty');
  return prompt;
}

function writeCliResult(result) {
  if (['uncertain', 'notSubmitted', 'timedOutWaitingForQueue'].includes(result.status)) process.exitCode = 1;
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function printHelp() {
  process.stdout.write([
    'models       [--include-hidden]',
    'projects     [--limit <N>]',
    'open-project --cwd <dir> [--mkdir]',
    'start        --prompt-file <file> [--cwd <dir>] [--mkdir] [--model <id>] [--effort <level>]',
    '             [--title <name>] [--sandbox <read-only|workspace-write>] [--approval <never|on-request>]',
    '             [--open] [--open-project] [--wait] [--timeout-ms <ms>]',
    'send         [--thread <UUID>] --prompt-file <file> [--via <auto|queue|app-server>]',
    '             [--model <id>] [--effort <level>] [--sandbox <mode>] [--approval <policy>] [--wait] [--open]',
    'status       [--thread <UUID>] --job <UUID>',
    'find         --title <exact desktop chat title> [--cwd <dir>]',
    'threads      [--cwd <dir>] [--title <search>] [--limit <N>]',
    'thread-detail --thread <UUID> [--limit <N>]',
    'interrupt    --thread <UUID> [--turn <UUID>]',
    'fork         --thread <UUID> [--title <name>] [--cwd <dir>] [--model <id>]',
    'Omit --thread when CODEX_DESKTOP_THREAD_ID is set.\n',
  ].join('\n'));
}

function cliLimit(value, fallback) {
  const limit = Number(value);
  return Number.isInteger(limit) && limit > 0 ? limit : fallback;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      thread: { type: 'string' },
      turn: { type: 'string' },
      'prompt-file': { type: 'string' },
      job: { type: 'string' },
      title: { type: 'string' },
      cwd: { type: 'string' },
      model: { type: 'string' },
      effort: { type: 'string' },
      sandbox: { type: 'string' },
      approval: { type: 'string' },
      via: { type: 'string' },
      limit: { type: 'string' },
      'timeout-ms': { type: 'string' },
      'include-hidden': { type: 'boolean' },
      mkdir: { type: 'boolean' },
      open: { type: 'boolean' },
      'open-project': { type: 'boolean' },
      wait: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });

  const [command] = positionals;
  if (values.help || !command) {
    printHelp();
    return;
  }

  const validCommands = new Set([
    'models', 'projects', 'open-project', 'start', 'send', 'status', 'find',
    'threads', 'thread-detail', 'interrupt', 'fork', '_run-turn',
  ]);
  if (positionals.length !== 1 || !validCommands.has(command)) {
    throw new Error('Expected models, projects, open-project, start, send, status, find, threads, thread-detail, interrupt, or fork');
  }

  if (command === '_run-turn') {
    const jobId = requireId(values.job, 'Job ID');
    await runWorkerCommand(jobId);
    return;
  }

  const threadId = values.thread;
  let result;
  switch (command) {
    case 'models':
      result = await listModels({ includeHidden: values['include-hidden'] });
      break;
    case 'projects':
      result = await listProjects({ limit: cliLimit(values.limit, 30) });
      break;
    case 'open-project':
      if (!values.cwd) throw new Error('open-project requires --cwd');
      result = await openDesktopProject(values.cwd, { mkdir: values.mkdir });
      break;
    case 'find': {
      const title = values.title?.trim();
      if (!title) throw new Error('find requires --title');
      result = await findThreads(title, values.cwd);
      break;
    }
    case 'threads':
      result = await listThreads({ cwd: values.cwd, searchTerm: values.title, limit: cliLimit(values.limit, 25) });
      break;
    case 'thread-detail':
      result = await getThreadDetail({ threadId, limit: cliLimit(values.limit, 15) });
      break;
    case 'interrupt':
      result = await interruptTurn({ threadId, turnId: values.turn && requireId(values.turn, 'Turn ID') });
      break;
    case 'fork':
      result = await forkThread({ threadId, title: values.title, cwd: values.cwd, model: values.model });
      break;
    case 'status':
      result = await getJobStatus({ threadId, jobId: values.job });
      break;
    case 'start':
    case 'send': {
      if (command === 'send') requireId(threadId ?? process.env.CODEX_DESKTOP_THREAD_ID, 'Thread ID');
      const options = {
        ...values,
        threadId,
        prompt: await readPromptFile(command, values['prompt-file']),
        openProject: values['open-project'],
        timeoutMs: values['timeout-ms'],
        onProgress(message) {
          process.stderr.write(`[codex-desktop-bridge] ${message}\n`);
        },
      };
      result = await (command === 'start' ? startThreadTask(options) : sendThreadTask(options));
      break;
    }
  }
  writeCliResult(result);
}

if (path.resolve(process.argv[1] || '') === SCRIPT_PATH) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
