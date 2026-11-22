import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  forkThread, getJobStatus, getThreadDetail, interruptTurn, listModels, listProjects,
  listThreads, openDesktopProject, sendThreadTask, startThreadTask,
} from './desktop-bridge.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const RESOURCE_URI = 'ui://codex-bridge/card.html';
const resource = {
  uri: RESOURCE_URI,
  name: 'Codex Desktop Bridge',
  mimeType: 'text/html;profile=mcp-app',
};
const PROTOCOL_VERSIONS = new Set(['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']);
const DEFAULT_PROTOCOL_VERSION = '2025-11-25';

const string = { type: 'string' };
const boolean = { type: 'boolean' };
const limit = { type: 'integer', minimum: 1 };

function tool(name, description, handler, properties, required = [], showUi = false) {
  return {
    descriptor: {
      name,
      description,
      inputSchema: { type: 'object', properties, required, additionalProperties: false },
      ...(showUi ? { _meta: { ui: { resourceUri: RESOURCE_URI } } } : {}),
    },
    handler,
  };
}

const tools = [
  tool('codex_models', 'List available Codex models and reasoning efforts.', listModels, { includeHidden: boolean }),
  tool('codex_projects', 'List saved and recent Codex projects.', listProjects, { limit }),
  tool('codex_open_project', 'Open a project in Codex Desktop.',
    ({ cwd, mkdir }) => openDesktopProject(cwd, { mkdir }), { cwd: string, mkdir: boolean }, ['cwd']),
  tool('codex_threads', 'Search or list Codex threads.', listThreads, { cwd: string, searchTerm: string, limit }),
  tool('codex_thread_detail', 'Read a Codex thread and its recent turns.', getThreadDetail,
    { threadId: string, limit }, ['threadId'], true),
  tool('codex_start', 'Start a Codex thread and submit its first prompt.',
    (args) => startThreadTask({ wait: false, ...args, inProcessAsync: true }), {
      prompt: string, cwd: string, mkdir: boolean, model: string, effort: string, title: string,
      sandbox: string, approval: string, open: boolean, openProject: boolean, wait: boolean,
    }, ['prompt'], true),
  tool('codex_send', 'Submit a prompt to an existing Codex thread.',
    (args) => sendThreadTask({ wait: false, ...args, inProcessAsync: true }), {
      threadId: string, prompt: string, model: string, effort: string, cwd: string,
      sandbox: string, approval: string, via: string, open: boolean, wait: boolean,
    }, ['threadId', 'prompt'], true),
  tool('codex_status', 'Read the status and telemetry of a submitted job.', getJobStatus,
    { threadId: string, jobId: string }, ['threadId', 'jobId'], true),
  tool('codex_interrupt', 'Interrupt a Codex turn.', interruptTurn, { threadId: string, turnId: string }, ['threadId']),
  tool('codex_fork', 'Fork a Codex thread.', forkThread,
    { threadId: string, title: string, cwd: string, model: string }, ['threadId']),
];
const toolsByName = new Map(tools.map((entry) => [entry.descriptor.name, entry]));

class RpcError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateArgs(args, { properties, required }) {
  if (!isObject(args)) throw new RpcError(-32602, 'Tool arguments must be an object');
  for (const key of required) {
    if (!Object.hasOwn(args, key)) throw new RpcError(-32602, `Missing argument: ${key}`);
  }
  for (const [key, value] of Object.entries(args)) {
    if (!Object.hasOwn(properties, key)) throw new RpcError(-32602, `Unknown argument: ${key}`);
    const { type, minimum } = properties[key];
    const valid = type === 'integer' ? Number.isSafeInteger(value) && value >= minimum : typeof value === type;
    if (!valid) throw new RpcError(-32602, `Invalid argument: ${key}`);
  }
}

async function callTool({ name, arguments: args = {} }) {
  const entry = toolsByName.get(name);
  if (!entry) throw new RpcError(-32602, `Unknown tool: ${name}`);
  validateArgs(args, entry.descriptor.inputSchema);
  let result;
  let isError = false;
  try {
    result = await entry.handler(args);
    isError = Boolean(result.error) || result.status === 'timedOutWaitingForQueue';
  } catch (error) {
    result = { error: error.message };
    isError = true;
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    structuredContent: { tool: name, ...result },
    ...(isError ? { isError } : {}),
  };
}

async function readResource(uri) {
  if (uri !== RESOURCE_URI) throw new RpcError(-32002, 'Resource not found');
  let text;
  try {
    text = await readFile(path.resolve(SCRIPT_DIR, '..', 'ui', 'mcp-card.html'), 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    text = '<!doctype html><html lang="en"><meta charset="utf-8"><title>Codex Desktop Bridge</title><p>Codex Desktop Bridge</p></html>';
  }
  return { contents: [{ uri, mimeType: resource.mimeType, text }] };
}

async function handleRequest(method, params = {}) {
  if (!isObject(params)) throw new RpcError(-32602, 'Params must be an object');
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: PROTOCOL_VERSIONS.has(params.protocolVersion) ? params.protocolVersion : DEFAULT_PROTOCOL_VERSION,
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'codex-desktop-bridge', version: '0.3.0' },
      };
    case 'notifications/initialized':
    case 'ping':
      return {};
    case 'resources/list':
      return { resources: [resource] };
    case 'resources/read':
      return readResource(params.uri);
    case 'tools/list':
      return { tools: tools.map(({ descriptor }) => descriptor) };
    case 'tools/call':
      return callTool(params);
    default:
      throw new RpcError(-32601, `Method not found: ${method}`);
  }
}

function writeMessage(message, framed) {
  const body = JSON.stringify({ jsonrpc: '2.0', ...message });
  process.stdout.write(framed ? `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}` : `${body}\n`);
}

function writeError(id, code, message, framed) {
  writeMessage({ id, error: { code, message } }, framed);
}

async function receiveMessage(body, framed) {
  let request;
  try {
    request = JSON.parse(body.toString('utf8'));
  } catch {
    writeError(null, -32700, 'Parse error', framed);
    return;
  }
  const validId = typeof request?.id === 'string' || typeof request?.id === 'number';
  if (!isObject(request) || request.jsonrpc !== '2.0' || typeof request.method !== 'string'
      || (Object.hasOwn(request, 'id') && !validId)) {
    writeError(validId ? request.id : null, -32600, 'Invalid request', framed);
    return;
  }
  if (!Object.hasOwn(request, 'id')) return;

  try {
    const result = await handleRequest(request.method, request.params);
    writeMessage({ id: request.id, result }, framed);
  } catch (error) {
    writeError(request.id, error instanceof RpcError ? error.code : -32603, error.message, framed);
  }
}

let pending = Buffer.alloc(0);
let frameLength = null;
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;

process.stdin.on('data', (chunk) => {
  pending = Buffer.concat([pending, chunk]);

  while (pending.length) {
    if (frameLength !== null) {
      if (pending.length < frameLength) break;
      void receiveMessage(pending.subarray(0, frameLength), true);
      pending = pending.subarray(frameLength);
      frameLength = null;
      continue;
    }

    const lineEnd = pending.indexOf(0x0a);
    if (lineEnd === -1) break;
    const line = pending.subarray(0, lineEnd).toString('utf8');
    if (/^Content-(Length|Type)\s*:/i.test(line)) {
      const headerEnd = /\r?\n\r?\n/.exec(pending.toString('latin1'));
      if (!headerEnd) break;
      const header = pending.subarray(0, headerEnd.index).toString('ascii');
      const length = /^Content-Length:\s*(\d+)[ \t]*\r?$/im.exec(header);
      const count = Number(length?.[1]);
      if (!Number.isInteger(count) || count <= 0 || count > MAX_MESSAGE_BYTES) {
        writeError(null, -32700, 'Invalid Content-Length', true);
        pending = Buffer.alloc(0);
        return;
      }
      frameLength = count;
      pending = pending.subarray(headerEnd.index + headerEnd[0].length);
    } else {
      if (line.trim()) void receiveMessage(pending.subarray(0, lineEnd), false);
      pending = pending.subarray(lineEnd + 1);
    }
  }

  if (pending.length > MAX_MESSAGE_BYTES) {
    writeError(null, -32700, 'Input exceeds the maximum message size', frameLength !== null);
    pending = Buffer.alloc(0);
    frameLength = null;
  }
});

process.stdin.on('end', () => {
  if (frameLength === null && pending.toString('utf8').trim()) void receiveMessage(pending, false);
  else if (frameLength !== null) writeError(null, -32700, 'Incomplete message', true);
});
