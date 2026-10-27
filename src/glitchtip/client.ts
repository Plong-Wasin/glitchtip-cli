// MCP over HTTP (streamable transport): initialize once per process, then send
// JSON-RPC requests to <base>/mcp with the profile's bearer token.

import { CliError } from '../utils/errors.js';
import { PROTOCOL_VERSION, VERSION } from '../utils/version.js';
import type { Profile } from '../utils/config.js';
import { refreshAccessToken } from '../auth/oauth.js';
import type { JsonRpcMessage, ToolResult } from './types.js';

let rpcId = 0;
let sessionId: string | undefined;
let initialized = false;

function bearerToken(profile: Profile): string {
  const token = process.env.GLITCHTIP_TOKEN || profile.token || profile.oauth?.accessToken;
  if (!token) throw new CliError(`Profile "${profile.name}" is not signed in. Run \`glitchtip auth login ${profile.name}\`.`);
  return token;
}

async function post(profile: Profile, body: unknown): Promise<Response> {
  const url = `${profile.url}/mcp`;
  try {
    return await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearerToken(profile)}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': PROTOCOL_VERSION,
        'User-Agent': `glitchtip-cli/${VERSION}`,
        ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    const cause = error instanceof Error ? (error.cause as Error | undefined) : undefined;
    throw new CliError(`Cannot reach ${url}: ${cause?.message || (error as Error).message}`);
  }
}

// Sends one request; on 401 with an OAuth profile, refreshes the token and retries once.
async function send(profile: Profile, body: unknown): Promise<Response> {
  let response = await post(profile, body);
  if (response.status === 401 && !process.env.GLITCHTIP_TOKEN && !profile.token && (await refreshAccessToken(profile))) {
    response = await post(profile, body);
  }
  if (response.status === 401) {
    const fix = profile.token || process.env.GLITCHTIP_TOKEN ? 'Check the token' : `Run \`glitchtip auth login ${profile.name}\``;
    throw new CliError(`401 Unauthorized for profile "${profile.name}" (${profile.url}). ${fix}.`);
  }
  if (response.status === 403) throw new CliError('403 Forbidden. The signed-in user lacks access to this resource.');
  if (response.status === 429) {
    const retry = response.headers.get('retry-after');
    throw new CliError(`429 Too Many Requests.${retry ? ` Retry after ${retry}s.` : ''}`);
  }
  return response;
}

async function ensureSession(profile: Profile): Promise<void> {
  if (initialized) return;
  const response = await send(profile, {
    jsonrpc: '2.0',
    id: ++rpcId,
    method: 'initialize',
    params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'glitchtip-cli', version: VERSION } },
  });
  if (!response.ok) throw new CliError(`HTTP ${response.status} from ${profile.url}/mcp: ${(await response.text()).slice(0, 500)}`);
  sessionId = response.headers.get('mcp-session-id') ?? undefined;
  await response.text();
  initialized = true;
  await (await send(profile, { jsonrpc: '2.0', method: 'notifications/initialized' })).text();
}

function parseSse(body: string): JsonRpcMessage {
  const payloads = body.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim());
  const messages = payloads.filter(Boolean).map((p) => JSON.parse(p) as JsonRpcMessage);
  const reply = messages.find((m) => 'result' in m || 'error' in m);
  if (!reply) throw new CliError('Server sent an event stream without a JSON-RPC reply.');
  return reply;
}

export async function rpc<T = unknown>(profile: Profile, method: string, params: unknown): Promise<T> {
  await ensureSession(profile);
  const response = await send(profile, { jsonrpc: '2.0', id: ++rpcId, method, params });
  const body = await response.text();
  if (!response.ok) throw new CliError(`HTTP ${response.status} from ${profile.url}/mcp: ${body.slice(0, 500)}`);
  const message: JsonRpcMessage = (response.headers.get('content-type') || '').includes('text/event-stream')
    ? parseSse(body)
    : JSON.parse(body);
  if (message.error) throw new CliError(`MCP error ${message.error.code}: ${message.error.message}`);
  return message.result as T;
}

// Optional arguments the caller left unset must not reach the server.
function drop(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined));
}

export async function callTool(profile: Profile, tool: string, args: Record<string, unknown>): Promise<ToolResult> {
  const result = await rpc<ToolResult>(profile, 'tools/call', { name: tool, arguments: drop(args) });
  if (result.isError) throw new CliError(toolText(result) || `${tool} failed.`);
  return result;
}

export function toolText(result: ToolResult): string {
  return (result.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
}
