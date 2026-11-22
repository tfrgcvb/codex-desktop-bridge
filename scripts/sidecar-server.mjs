import { timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  forkThread, getJobStatus, getThreadDetail, interruptTurn, listModels, listProjects,
  listThreads, openDesktopProject, openDesktopUrl, sendThreadTask, startThreadTask,
} from './desktop-bridge.mjs';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(SCRIPT_PATH);
const UI_DIR = path.resolve(SCRIPT_DIR, '..', 'ui');
const HOST = '127.0.0.1';
const MAX_BODY_BYTES = 1024 * 1024;
const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.css', ['app.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'application/javascript; charset=utf-8']],
  ['/sidecar-bridge.js', ['sidecar-bridge.js', 'application/javascript; charset=utf-8']],
]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(response, status, result) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(result));
}

function matchesToken(value, expected) {
  if (typeof value !== 'string') return false;
  const bytes = Buffer.from(value);
  return bytes.length === expected.length && timingSafeEqual(bytes, expected);
}

function queryLimit(query) {
  const value = query.get('limit');
  if (value === null) return undefined;
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new HttpError(400, 'limit must be a positive integer');
  return limit;
}

async function overview(query) {
  let cwd = query.get('workspace') || undefined;
  if (/^file:\/\//i.test(cwd ?? '')) {
    try {
      cwd = fileURLToPath(cwd);
    } catch {
      throw new HttpError(400, 'workspace must be a valid file URL');
    }
  }
  const limit = queryLimit(query);
  const [{ models }, projects, { threads }] = await Promise.all([
    listModels(),
    listProjects({ limit }),
    listThreads({ cwd, limit }),
  ]);
  return { models, projects, threads };
}

const GET_ROUTES = new Map([
  ['/api/overview', overview],
  ['/api/models', () => listModels()],
  ['/api/projects', () => listProjects()],
  ['/api/threads', (query) => listThreads({
    cwd: query.get('cwd'), searchTerm: query.get('q'), limit: queryLimit(query),
  })],
  ['/api/thread', (query) => getThreadDetail({ threadId: query.get('threadId'), limit: queryLimit(query) })],
  ['/api/status', (query) => getJobStatus({ threadId: query.get('threadId'), jobId: query.get('jobId') })],
]);

async function openDesktop({ threadId, cwd, mkdir }) {
  if (threadId) {
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(threadId)) {
      throw new HttpError(400, 'threadId must be a UUID');
    }
    await openDesktopUrl(`codex://threads/${threadId}`);
  }
  if (cwd) await openDesktopProject(cwd, { mkdir });
  return {};
}

const TASK_OPTIONS = ['prompt', 'cwd', 'model', 'effort', 'sandbox', 'approval', 'open', 'wait'];
const POST_ROUTES = new Map([
  ['/api/start', [
    (body) => startThreadTask({ ...body, inProcessAsync: !body.wait }),
    [...TASK_OPTIONS, 'mkdir', 'title', 'openProject'],
  ]],
  ['/api/send', [
    (body) => sendThreadTask({ ...body, inProcessAsync: !body.wait }),
    [...TASK_OPTIONS, 'threadId', 'via'],
  ]],
  ['/api/open', [openDesktop, ['threadId', 'cwd', 'mkdir']]],
  ['/api/interrupt', [interruptTurn, ['threadId', 'turnId']]],
  ['/api/fork', [forkThread, ['threadId', 'title', 'cwd', 'model']]],
]);
const BOOLEAN_FIELDS = new Set(['mkdir', 'open', 'openProject', 'wait']);

async function readJsonBody(request, fields) {
  // Browser cross-origin requests with this content type require a CORS preflight.
  if (request.headers.origin && !/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
    throw new HttpError(415, 'Expected application/json');
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) {
      request.resume();
      throw new HttpError(413, 'Request body is too large');
    }
    chunks.push(chunk);
  }

  let data;
  try {
    data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new HttpError(400, 'Expected a JSON object');
  }
  const result = {};
  for (const name of fields) {
    if (!Object.hasOwn(data, name)) continue;
    const expected = BOOLEAN_FIELDS.has(name) ? 'boolean' : 'string';
    if (typeof data[name] !== expected) throw new HttpError(400, `${name} must be a ${expected}`);
    result[name] = data[name];
  }
  return result;
}

async function handleRequest(request, response, token) {
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(request.headers.host ?? '')) {
    throw new HttpError(403, 'Expected a loopback Host header');
  }
  const url = new URL(request.url, `http://${HOST}`);
  if (url.pathname.startsWith('/api/')) {
    if (token.length && !matchesToken(request.headers['x-sidecar-token'], token)
        && !matchesToken(url.searchParams.get('token'), token)) {
      throw new HttpError(401, 'Unauthorized');
    }

    const get = GET_ROUTES.get(url.pathname);
    const post = POST_ROUTES.get(url.pathname);
    let result;
    if (request.method === 'GET' && get) {
      result = await get(url.searchParams);
    } else if (request.method === 'POST' && post) {
      const [handler, fields] = post;
      result = await handler(await readJsonBody(request, fields));
    } else if (get || post) {
      response.setHeader('Allow', get ? 'GET' : 'POST');
      throw new HttpError(405, 'Method not allowed');
    } else {
      throw new HttpError(404, 'Not found');
    }
    sendJson(response, 200, { ok: true, ...result });
    return;
  }

  const file = STATIC_FILES.get(url.pathname);
  if (request.method !== 'GET' || !file) throw new HttpError(404, 'Not found');
  const [filename, mimeType] = file;
  let contents;
  try {
    contents = await readFile(path.join(UI_DIR, filename));
  } catch (error) {
    if (error.code === 'ENOENT') throw new HttpError(404, 'Not found');
    throw error;
  }
  response.writeHead(200, { 'Content-Type': mimeType, 'X-Content-Type-Options': 'nosniff' });
  response.end(contents);
}

export async function startSidecarServer({
  port = Number(process.env.ANTIGRAVITY_SIDECAR_WEB_PORT || 0),
  token = process.env.ANTIGRAVITY_SIDECAR_UI_TOKEN || '',
  quiet = false,
} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('Port must be an integer between 0 and 65535');
  }
  const expectedToken = Buffer.from(token);
  const server = createServer((request, response) => {
    handleRequest(request, response, expectedToken).catch((error) => {
      sendJson(response, error instanceof HttpError ? error.status : 500, { ok: false, error: error.message });
    });
  });
  server.listen(port, HOST);
  await once(server, 'listening');
  if (!quiet) process.stdout.write(`[codex-bridge-sidecar] listening on ${HOST}:${server.address().port}\n`);
  return server;
}

if (path.resolve(process.argv[1] || '') === SCRIPT_PATH) {
  try {
    const { values } = parseArgs({ options: { port: { type: 'string' } } });
    await startSidecarServer({ port: values.port === undefined ? undefined : Number(values.port) });
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
