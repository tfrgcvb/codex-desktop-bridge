import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { parseArgs, promisify } from 'node:util';

const run = promisify(execFile);
const codex = process.env.CODEX_BIN || 'codex';
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const timeoutMs = 15_000;

function taskHeader(jobId) {
  return `[Antigravity/Gemini task ${jobId}]`;
}

function requireId(value, name) {
  if (!uuid.test(value ?? '')) throw new Error(`${name} must be a UUID`);
  return value.toLowerCase();
}

function matchTurn(turn, jobId) {
  const header = taskHeader(jobId);
  const firstMessage = turn.items.findIndex((item) => {
    if (item.type !== 'userMessage') return false;
    const text = item.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
    return text === header || text.startsWith(`${header}\n`);
  });
  if (firstMessage === -1) return null;

  const items = turn.items.slice(firstMessage + 1);
  const nextInput = items.findIndex((item) => item.type === 'userMessage');
  const identity = { turnId: turn.id };
  if (nextInput !== -1) return { ...identity, status: 'mixedTurn' };
  if (turn.status !== 'completed') return { ...identity, status: turn.status };

  const replies = items.filter((item) => item.type === 'agentMessage' && item.text.trim());
  const finalReplies = replies.filter((item) => item.phase === 'final_answer' || item.phase === 'partial_answer');
  const reply = finalReplies.length
    ? finalReplies.map((item) => item.text).join('\n\n')
    : replies.findLast((item) => item.phase == null)?.text;

  return reply
    ? { ...identity, status: 'completed', reply }
    : { ...identity, status: 'completedWithoutReply' };
}

async function withHistoryReader(read) {
  // This connection reads the shared local history and never opens a turn.
  const child = spawn(codex, ['app-server', '--listen', 'stdio://'], {
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true,
  });
  const output = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const lines = output[Symbol.asyncIterator]();
  let sequence = 0;
  let failure;
  child.on('error', (error) => { failure = error; });
  child.stdin.on('error', (error) => { failure ??= error; });
  const timer = setTimeout(() => {
    failure ??= new Error('Timed out reading Codex history');
    output.close();
    child.kill();
  }, timeoutMs);

  function write(message) {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async function request(method, params) {
    const id = ++sequence;
    write({ id, method, params });
    for (;;) {
      const { value, done } = await lines.next();
      if (done) throw failure ?? new Error('Codex app-server closed before replying');
      if (!value.trim()) continue;
      const response = JSON.parse(value);
      if (response.id !== id || response.method) continue;
      if (response.error) throw new Error(response.error.message);
      return response.result;
    }
  }

  try {
    await request('initialize', {
      clientInfo: { name: 'antigravity_codex_desktop_bridge', version: '0.1.0' },
    });
    write({ method: 'initialized' });
    return await read(request);
  } finally {
    clearTimeout(timer);
    output.close();
    child.stdin.end();
    child.kill();
  }
}

async function readJob(threadId, jobId) {
  return withHistoryReader(async (request) => {
    let cursor;
    for (let page = 0; page < 5; page += 1) {
      const result = await request('thread/turns/list', {
        threadId, cursor, limit: 12, sortDirection: 'desc', itemsView: 'full',
      });
      for (const turn of result.data) {
        const match = matchTurn(turn, jobId);
        if (match) return match;
      }
      cursor = result.nextCursor;
      if (!cursor) return { status: 'pending' };
    }
    return { status: 'outsideScanWindow' };
  });
}

async function findThreads(title) {
  return withHistoryReader(async (request) => {
    const result = await request('thread/list', { searchTerm: title, limit: 30 });
    const threads = result.data.filter((thread) => thread.name === title).map((thread) => ({
      threadId: thread.id,
      cwd: thread.cwd,
      desktopUrl: `codex://threads/${thread.id}`,
    }));
    return { threads, hasMore: Boolean(result.nextCursor) };
  });
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      thread: { type: 'string' },
      'prompt-file': { type: 'string' },
      job: { type: 'string' },
      title: { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  const [command] = positionals;
  if (values.help || !command) {
    process.stdout.write([
      'send   [--thread <UUID>] --prompt-file <file>',
      'status [--thread <UUID>] --job <UUID>',
      'find   --title <exact desktop chat title>',
      'Omit --thread when CODEX_DESKTOP_THREAD_ID is set.\n',
    ].join('\n'));
    return;
  }
  if (positionals.length !== 1 || !['send', 'status', 'find'].includes(command)) {
    throw new Error('Expected send, status, or find');
  }
  if (command === 'find') {
    const title = values.title?.trim();
    if (!title) throw new Error('find requires --title');
    process.stdout.write(`${JSON.stringify(await findThreads(title))}\n`);
    return;
  }

  const threadId = requireId(values.thread ?? process.env.CODEX_DESKTOP_THREAD_ID, 'Thread ID');
  const desktopUrl = `codex://threads/${threadId}`;
  if (command === 'status') {
    const jobId = requireId(values.job, 'Job ID');
    const result = await readJob(threadId, jobId);
    process.stdout.write(`${JSON.stringify({ threadId, jobId, desktopUrl, ...result })}\n`);
    return;
  }

  if (!values['prompt-file']) throw new Error('send requires --prompt-file');
  const prompt = (await readFile(values['prompt-file'], 'utf8')).trim();
  if (!prompt) throw new Error('The prompt file is empty');
  const jobId = randomUUID();
  let result;
  try {
    await run(codex, ['queue', '--thread', threadId, '--message', `${taskHeader(jobId)}\n\n${prompt}`], {
      timeout: timeoutMs, windowsHide: true,
    });
    result = { status: 'submitted' };
  } catch (error) {
    result = error.code === 'ENOENT'
      ? { status: 'notSubmitted', error: 'Codex binary not found. Set CODEX_BIN to the executable.' }
      : { status: 'uncertain', error: error.stderr?.trim() || error.message };
    process.exitCode = 1;
  }
  process.stdout.write(`${JSON.stringify({ threadId, jobId, desktopUrl, ...result })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
