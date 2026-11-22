import { execFile, execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';

const run = promisify(execFile);
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const UUID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const RPC_TIMEOUT_MS = 15_000;
const DEFAULT_TURN_TIMEOUT_MS = 20 * 60 * 1000;
const VALID_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const VALID_APPROVALS = new Set(['never', 'on-request', 'untrusted']);

let cachedCodexBin;

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
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
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
    if (first && existsSync(first)) {
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
  if (!UUID_RE.test(value ?? '')) throw new Error(`${name} must be a UUID`);
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
  const resolved = map[key];
  if (!resolved) {
    throw new Error(`Invalid --sandbox "${value}" (expected read-only, workspace-write, or danger-full-access)`);
  }
  return resolved;
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

function resolveProjectCwd(rawCwd, { mkdir = false } = {}) {
  const target = path.resolve(rawCwd || process.cwd());
  if (mkdir) mkdirSync(target, { recursive: true });
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    throw new Error(`Project directory does not exist: ${target} (pass --mkdir to create it)`);
  }
  return target;
}

function matchTurn(turn, jobId) {
  const header = taskHeader(jobId);
  const firstMessage = (turn.items || []).findIndex((item) => {
    if (item.type !== 'userMessage') return false;
    const text = (item.content || []).filter((part) => part.type === 'text').map((part) => part.text).join('\n');
    return text === header || text.startsWith(`${header}\n`);
  });
  if (firstMessage === -1) return null;

  const items = turn.items.slice(firstMessage + 1);
  const nextInput = items.findIndex((item) => item.type === 'userMessage');
  const identity = { turnId: turn.id };
  if (nextInput !== -1) return { ...identity, status: 'mixedTurn' };
  if (turn.status !== 'completed') return { ...identity, status: turn.status };

  const replies = items.filter((item) => item.type === 'agentMessage' && item.text?.trim());
  const finalReplies = replies.filter((item) => item.phase === 'final_answer' || item.phase === 'partial_answer');
  const reply = finalReplies.length
    ? finalReplies.map((item) => item.text).join('\n\n')
    : replies.findLast((item) => item.phase == null)?.text;

  return reply
    ? { ...identity, status: 'completed', reply }
    : { ...identity, status: 'completedWithoutReply' };
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

  function failAll(error) {
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
    if (pending.size > 0) {
      const stderrText = stderrChunks.join('').trim();
      failAll(new Error(stderrText || `Codex app-server exited (code ${code ?? 'unknown'}) before replying`));
    }
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
    await request('initialize', {
      clientInfo: { name: 'antigravity_codex_desktop_bridge', version: '0.2.0' },
    });
    write({ method: 'initialized' });
    return await fn({ request, write });
  } finally {
    if (timer) clearTimeout(timer);
    output.close();
    child.stdin.end();
    child.kill();
  }
}

async function listModels({ includeHidden = false } = {}) {
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

async function listProjects({ limit = 30 } = {}) {
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

function openDesktopProject(cwd) {
  const codexBin = resolveCodexBin();
  const child = spawn(codexBin, ['app', cwd], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

function openDesktopUrl(url) {
  if (process.platform === 'win32') {
    const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return;
  }
  const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
  const child = spawn(cmd, [url], { detached: true, stdio: 'ignore' });
  child.unref();
}

async function readJob(threadId, jobId) {
  return withAppServer(async ({ request }) => {
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

async function findThreads(title, cwdFilter) {
  const normalizedCwd = cwdFilter ? path.resolve(cwdFilter) : null;
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

async function runTurnViaAppServer({
  threadId,
  jobId,
  prompt,
  model,
  effort,
  cwd,
  sandbox = 'read-only',
  approval = 'never',
  timeoutMs = DEFAULT_TURN_TIMEOUT_MS,
  onSubmitted,
}) {
  const { threadSandbox, turnSandboxPolicy } = normalizeSandbox(sandbox);
  const approvalPolicy = normalizeApproval(approval);

  let activeTurnId = null;
  let resolveCompleted;
  let rejectCompleted;
  const completedPromise = new Promise((resolve, reject) => {
    resolveCompleted = resolve;
    rejectCompleted = reject;
  });

  return withAppServer(
    async ({ request }) => {
      await request('thread/resume', {
        threadId,
        excludeTurns: true,
        ...(cwd ? { cwd } : {}),
        ...(model ? { model } : {}),
        approvalPolicy,
        sandbox: threadSandbox,
      });

      const turnRes = await request('turn/start', {
        threadId,
        input: [{ type: 'text', text: `${taskHeader(jobId)}\n\n${prompt}` }],
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
        ...(cwd ? { cwd } : {}),
        approvalPolicy,
        sandboxPolicy: turnSandboxPolicy,
      });

      activeTurnId = turnRes.turn?.id ?? null;
      onSubmitted?.(activeTurnId);

      const completedTurn = await completedPromise;
      const matched = matchTurn(completedTurn, jobId);
      if (matched && matched.status !== 'pending') {
        return matched;
      }

      // Fallback in case completed notification omits full items.
      let cursor;
      for (let page = 0; page < 3; page += 1) {
        const list = await request('thread/turns/list', {
          threadId, cursor, limit: 12, sortDirection: 'desc', itemsView: 'full',
        });
        for (const turn of list.data || []) {
          const m = matchTurn(turn, jobId);
          if (m) return m;
        }
        cursor = list.nextCursor;
        if (!cursor) break;
      }
      return {
        turnId: activeTurnId,
        status: completedTurn.status || 'completedWithoutReply',
      };
    },
    {
      timeoutMs,
      onNotification(msg) {
        if (msg.method === 'turn/completed' && msg.params?.threadId === threadId) {
          const turn = msg.params.turn;
          if (!activeTurnId || !turn?.id || turn.id === activeTurnId) {
            resolveCompleted(turn);
          }
        } else if (msg.method === 'error' && msg.params?.threadId === threadId && !msg.params?.willRetry) {
          rejectCompleted(new Error(msg.params?.error?.message || 'Codex turn failed'));
        }
      },
    },
  );
}

async function dispatchDetachedTurn(spec) {
  const { jobId } = spec;
  writeJsonFile(jobSpecPath(jobId), spec);
  writeJsonFile(jobStatePath(jobId), {
    state: 'starting',
    threadId: spec.threadId,
    jobId,
    updatedAt: Date.now(),
  });

  const logFile = jobLogPath(jobId);
  const logFd = openSync(logFile, 'a');
  const worker = spawn(process.execPath, [SCRIPT_PATH, '_run-turn', '--job', jobId], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
  });
  worker.unref();

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
      return {
        status: 'submitted',
        turnId: state.turnId ?? null,
        logFile,
      };
    }
    if (state?.state === 'failed') {
      throw new Error(state.error || 'Background turn worker failed');
    }
    if (workerExited) {
      throw new Error(`Background turn worker exited early (code ${workerExitCode}). Check ${logFile}`);
    }
    await new Promise((r) => setTimeout(r, 80));
  }

  return {
    status: 'uncertain',
    error: `Timed out waiting for worker startup ack. Check ${logFile}`,
    logFile,
  };
}

async function runWorkerCommand(jobId) {
  const spec = readJsonFileSafe(jobSpecPath(jobId));
  if (!spec) throw new Error(`Missing job spec for ${jobId}`);

  try {
    const result = await runTurnViaAppServer({
      ...spec,
      onSubmitted(turnId) {
        writeJsonFile(jobStatePath(jobId), {
          state: 'submitted',
          threadId: spec.threadId,
          jobId,
          turnId,
          updatedAt: Date.now(),
        });
      },
    });
    writeJsonFile(jobStatePath(jobId), {
      state: 'completed',
      threadId: spec.threadId,
      jobId,
      turnId: result.turnId ?? null,
      resultStatus: result.status,
      updatedAt: Date.now(),
    });
  } catch (error) {
    writeJsonFile(jobStatePath(jobId), {
      state: 'failed',
      threadId: spec.threadId,
      jobId,
      error: error.message,
      updatedAt: Date.now(),
    });
    throw error;
  }
}

function parseTimeoutMs(raw) {
  if (raw == null || raw === '') return DEFAULT_TURN_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --timeout-ms "${raw}"`);
  }
  return Math.floor(parsed);
}

async function startCommand(values) {
  if (!values['prompt-file']) throw new Error('start requires --prompt-file');
  const prompt = (await readFile(values['prompt-file'], 'utf8')).trim();
  if (!prompt) throw new Error('The prompt file is empty');

  const cwd = resolveProjectCwd(values.cwd, { mkdir: Boolean(values.mkdir) });
  const model = values.model?.trim() || undefined;
  const effort = normalizeEffort(values.effort);
  const title = values.title?.trim() || undefined;
  const sandbox = values.sandbox || 'read-only';
  const approval = normalizeApproval(values.approval || 'never');
  const { threadSandbox } = normalizeSandbox(sandbox);
  const timeoutMs = parseTimeoutMs(values['timeout-ms']);

  const created = await withAppServer(async ({ request }) => {
    const res = await request('thread/start', {
      cwd,
      ...(model ? { model } : {}),
      approvalPolicy: approval,
      sandbox: threadSandbox,
      ephemeral: false,
    });
    const threadId = res.thread?.id;
    if (!threadId) throw new Error('thread/start did not return thread.id');
    if (title) {
      await request('thread/name/set', { threadId, name: title });
    }
    return {
      threadId,
      model: res.model || model || null,
      effort: effort || res.reasoningEffort || null,
      cwd: res.cwd || cwd,
    };
  });

  if (values['open-project']) openDesktopProject(created.cwd);
  const desktopUrl = `codex://threads/${created.threadId}`;
  if (values.open) openDesktopUrl(desktopUrl);

  const jobId = randomUUID();
  const basePayload = {
    threadId: created.threadId,
    jobId,
    title: title || null,
    cwd: created.cwd,
    model: created.model,
    effort: created.effort,
    sandbox: threadSandbox,
    approval,
    desktopUrl,
  };

  if (values.wait) {
    process.stderr.write(
      `[codex-desktop-bridge] running thread=${created.threadId} job=${jobId} model=${created.model ?? 'default'} url=${desktopUrl}\n`,
    );
    const result = await runTurnViaAppServer({
      threadId: created.threadId,
      jobId,
      prompt,
      model,
      effort,
      cwd: created.cwd,
      sandbox,
      approval,
      timeoutMs,
    });
    process.stdout.write(`${JSON.stringify({ ...basePayload, ...result })}\n`);
    return;
  }

  const dispatch = await dispatchDetachedTurn({
    threadId: created.threadId,
    jobId,
    prompt,
    model,
    effort,
    cwd: created.cwd,
    sandbox,
    approval,
    timeoutMs,
  });
  if (dispatch.status === 'uncertain') process.exitCode = 1;
  process.stdout.write(`${JSON.stringify({ ...basePayload, ...dispatch })}\n`);
}

function isActiveWriterError(error) {
  return /already has an active writer/i.test(error?.message || '');
}

async function sendViaQueue({ threadId, jobId, desktopUrl, prompt, wait, timeoutMs, fallbackNotice }) {
  const codexBin = resolveCodexBin();
  try {
    await run(codexBin, ['queue', '--thread', threadId, '--message', `${taskHeader(jobId)}\n\n${prompt}`], {
      timeout: RPC_TIMEOUT_MS,
      windowsHide: true,
    });
  } catch (error) {
    const result = error.code === 'ENOENT'
      ? { status: 'notSubmitted', error: `Codex binary not found (${codexBin}). Set CODEX_BIN to codex.exe.` }
      : { status: 'uncertain', error: error.stderr?.trim() || error.message };
    process.exitCode = 1;
    process.stdout.write(`${JSON.stringify({ threadId, jobId, desktopUrl, via: 'queue', ...result })}\n`);
    return;
  }

  if (!wait) {
    process.stdout.write(`${JSON.stringify({
      threadId,
      jobId,
      desktopUrl,
      via: 'queue',
      ...(fallbackNotice ? { fallbackFrom: 'app-server', notice: fallbackNotice } : {}),
      status: 'submitted',
    })}\n`);
    return;
  }

  process.stderr.write(
    `[codex-desktop-bridge] queued into active desktop thread=${threadId} job=${jobId} url=${desktopUrl}\n`,
  );
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await readJob(threadId, jobId);
    if (result.status !== 'pending' && result.status !== 'inProgress' && result.status !== 'in_progress') {
      process.stdout.write(`${JSON.stringify({
        threadId,
        jobId,
        desktopUrl,
        via: 'queue',
        ...(fallbackNotice ? { fallbackFrom: 'app-server', notice: fallbackNotice } : {}),
        ...result,
      })}\n`);
      return;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }

  process.exitCode = 1;
  process.stdout.write(`${JSON.stringify({
    threadId,
    jobId,
    desktopUrl,
    via: 'queue',
    ...(fallbackNotice ? { fallbackFrom: 'app-server', notice: fallbackNotice } : {}),
    status: 'timedOutWaitingForQueue',
  })}\n`);
}

async function sendCommand(values) {
  const threadId = requireId(values.thread ?? process.env.CODEX_DESKTOP_THREAD_ID, 'Thread ID');
  const desktopUrl = `codex://threads/${threadId}`;
  if (!values['prompt-file']) throw new Error('send requires --prompt-file');
  const prompt = (await readFile(values['prompt-file'], 'utf8')).trim();
  if (!prompt) throw new Error('The prompt file is empty');

  const model = values.model?.trim() || undefined;
  const effort = normalizeEffort(values.effort);
  const cwd = values.cwd ? resolveProjectCwd(values.cwd, { mkdir: Boolean(values.mkdir) }) : undefined;
  const hasAppServerOverrides = Boolean(model || effort || values.sandbox || values.approval || cwd);
  const via = values.via || 'auto';
  if (!['auto', 'queue', 'app-server'].includes(via)) {
    throw new Error(`Invalid --via "${via}" (expected auto, queue, or app-server)`);
  }

  const jobId = randomUUID();
  const timeoutMs = parseTimeoutMs(values['timeout-ms']);

  if (values.open) openDesktopUrl(desktopUrl);

  if (via === 'queue') {
    await sendViaQueue({ threadId, jobId, desktopUrl, prompt, wait: Boolean(values.wait), timeoutMs });
    return;
  }

  const sandbox = values.sandbox || 'read-only';
  const approval = normalizeApproval(values.approval || 'never');

  try {
    if (values.wait) {
      process.stderr.write(
        `[codex-desktop-bridge] running thread=${threadId} job=${jobId} model=${model ?? 'thread-default'} url=${desktopUrl}\n`,
      );
      const result = await runTurnViaAppServer({
        threadId,
        jobId,
        prompt,
        model,
        effort,
        cwd,
        sandbox,
        approval,
        timeoutMs,
      });
      process.stdout.write(`${JSON.stringify({ threadId, jobId, desktopUrl, via: 'app-server', ...result })}\n`);
      return;
    }

    const dispatch = await dispatchDetachedTurn({
      threadId,
      jobId,
      prompt,
      model,
      effort,
      cwd,
      sandbox,
      approval,
      timeoutMs,
    });
    if (dispatch.status === 'uncertain') process.exitCode = 1;
    process.stdout.write(`${JSON.stringify({ threadId, jobId, desktopUrl, via: 'app-server', ...dispatch })}\n`);
  } catch (error) {
    if (via === 'auto' && isActiveWriterError(error)) {
      const notice = hasAppServerOverrides
        ? 'Thread is active in ChatGPT desktop; fell back to codex queue (uses desktop thread model/settings).'
        : 'Thread is active in ChatGPT desktop; routed via codex queue.';
      process.stderr.write(`[codex-desktop-bridge] ${notice}\n`);
      await sendViaQueue({
        threadId,
        jobId,
        desktopUrl,
        prompt,
        wait: Boolean(values.wait),
        timeoutMs,
        fallbackNotice: notice,
      });
      return;
    }
    throw error;
  }
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
    'Omit --thread when CODEX_DESKTOP_THREAD_ID is set.\n',
  ].join('\n'));
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      thread: { type: 'string' },
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

  const validCommands = new Set(['models', 'projects', 'open-project', 'start', 'send', 'status', 'find', '_run-turn']);
  if (positionals.length !== 1 || !validCommands.has(command)) {
    throw new Error('Expected models, projects, open-project, start, send, status, or find');
  }

  if (command === '_run-turn') {
    const jobId = requireId(values.job, 'Job ID');
    await runWorkerCommand(jobId);
    return;
  }
  if (command === 'models') {
    const res = await listModels({ includeHidden: Boolean(values['include-hidden']) });
    process.stdout.write(`${JSON.stringify(res)}\n`);
    return;
  }
  if (command === 'projects') {
    const limit = values.limit ? Number(values.limit) : 30;
    const res = await listProjects({ limit: Number.isFinite(limit) && limit > 0 ? limit : 30 });
    process.stdout.write(`${JSON.stringify(res)}\n`);
    return;
  }
  if (command === 'open-project') {
    if (!values.cwd) throw new Error('open-project requires --cwd');
    const cwd = resolveProjectCwd(values.cwd, { mkdir: Boolean(values.mkdir) });
    openDesktopProject(cwd);
    process.stdout.write(`${JSON.stringify({ cwd, launched: true })}\n`);
    return;
  }
  if (command === 'find') {
    const title = values.title?.trim();
    if (!title) throw new Error('find requires --title');
    process.stdout.write(`${JSON.stringify(await findThreads(title, values.cwd))}\n`);
    return;
  }
  if (command === 'status') {
    const threadId = requireId(values.thread ?? process.env.CODEX_DESKTOP_THREAD_ID, 'Thread ID');
    const jobId = requireId(values.job, 'Job ID');
    const desktopUrl = `codex://threads/${threadId}`;
    const result = await readJob(threadId, jobId);
    if (result.status === 'pending') {
      const workerState = readJsonFileSafe(jobStatePath(jobId));
      if (workerState) {
        process.stdout.write(`${JSON.stringify({
          threadId,
          jobId,
          desktopUrl,
          ...result,
          workerState: workerState.state,
          ...(workerState.error ? { error: workerState.error } : {}),
        })}\n`);
        return;
      }
    }
    process.stdout.write(`${JSON.stringify({ threadId, jobId, desktopUrl, ...result })}\n`);
    return;
  }
  if (command === 'start') {
    await startCommand(values);
    return;
  }
  if (command === 'send') {
    await sendCommand(values);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
