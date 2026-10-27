// A fake GlitchTip: the MCP endpoint (/mcp) plus the OAuth endpoints the CLI
// discovers, all on a random loopback port. Tests inspect what it received.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  token: string;
  sessionId: string;
}

export interface ToolReply {
  content?: { type: string; text: string }[];
  structuredContent?: unknown;
  isError?: boolean;
}

export interface FakeServer {
  url: string;
  calls: ToolCall[];
  /** Bearer tokens the /mcp endpoint accepts. */
  validTokens: Set<string>;
  /** Refresh tokens the token endpoint accepts. */
  refreshTokens: Set<string>;
  registrations: Record<string, unknown>[];
  tokenRequests: Record<string, string>[];
  initializeCount: number;
  /** Reply as an SSE stream instead of plain JSON. */
  sse: boolean;
  /** Override the reply for a tool call; return undefined for the default. */
  reply: ((name: string, args: Record<string, unknown>) => ToolReply | undefined) | undefined;
  reset(): void;
  close(): Promise<void>;
}

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers }).end(JSON.stringify(body));
};

export async function startFakeServer(): Promise<FakeServer> {
  const codes = new Map<string, { challenge: string; redirectUri: string; clientId: string }>();
  let counter = 0;

  const fake: FakeServer = {
    url: '',
    calls: [],
    validTokens: new Set(),
    refreshTokens: new Set(),
    registrations: [],
    tokenRequests: [],
    initializeCount: 0,
    sse: false,
    reply: undefined,
    reset() {
      fake.calls.length = 0;
      fake.validTokens.clear();
      fake.refreshTokens.clear();
      fake.registrations.length = 0;
      fake.tokenRequests.length = 0;
      fake.initializeCount = 0;
      fake.sse = false;
      fake.reply = undefined;
    },
    close: () => new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };

  const rpcReply = (res: ServerResponse, id: unknown, result: unknown, headers: Record<string, string> = {}): void => {
    const message = { jsonrpc: '2.0', id, result };
    if (fake.sse) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', ...headers }).end(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
    } else {
      json(res, 200, message, headers);
    }
  };

  const handleMcp = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
    if (!fake.validTokens.has(token)) {
      return json(res, 401, { error: 'invalid_token' }, { 'WWW-Authenticate': 'Bearer error="invalid_token"' });
    }
    const body = JSON.parse(await readBody(req)) as { id?: number; method: string; params?: { name?: string; arguments?: Record<string, unknown> } };

    if (body.method === 'initialize') {
      fake.initializeCount++;
      return rpcReply(res, body.id, {
        protocolVersion: '2025-06-18',
        serverInfo: { name: 'fake-glitchtip', version: '9.9' },
        capabilities: {},
        instructions: 'Fake instructions.',
      }, { 'Mcp-Session-Id': `sess-${fake.initializeCount}` });
    }

    const sessionId = String(req.headers['mcp-session-id'] ?? '');
    if (!sessionId.startsWith('sess-')) return json(res, 400, { error: 'missing session' });
    if (body.id === undefined) return void res.writeHead(202).end();

    if (body.method === 'tools/list') {
      return rpcReply(res, body.id, {
        tools: [{ name: 't1', description: 'First line\nSecond line', inputSchema: { properties: { a: {}, b: {} }, required: ['a'] } }],
      });
    }
    if (body.method === 'tools/call') {
      const name = body.params?.name ?? '';
      const args = body.params?.arguments ?? {};
      fake.calls.push({ name, arguments: args, token, sessionId });
      const custom = fake.reply?.(name, args);
      return rpcReply(res, body.id, custom ?? { content: [{ type: 'text', text: `ok:${name}` }], structuredContent: { tool: name } });
    }
    return json(res, 200, { jsonrpc: '2.0', id: body.id, error: { code: -32601, message: `no such method ${body.method}` } });
  };

  const handleToken = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const form = Object.fromEntries(new URLSearchParams(await readBody(req)));
    fake.tokenRequests.push(form);
    const issue = (): Record<string, unknown> => {
      const access = `access-${++counter}`;
      const refresh = `refresh-${counter}`;
      fake.validTokens.add(access);
      fake.refreshTokens.add(refresh);
      return { access_token: access, refresh_token: refresh, expires_in: 3600, token_type: 'Bearer' };
    };

    if (form.grant_type === 'authorization_code') {
      const entry = codes.get(form.code ?? '');
      const challenge = createHash('sha256').update(form.code_verifier ?? '').digest('base64url');
      const ok = entry && entry.challenge === challenge && entry.redirectUri === form.redirect_uri
        && entry.clientId === form.client_id && form.client_secret === 'secret-1';
      if (!ok) return json(res, 400, { error: 'invalid_grant' });
      codes.delete(form.code!);
      return json(res, 200, issue());
    }
    if (form.grant_type === 'refresh_token') {
      if (!fake.refreshTokens.has(form.refresh_token ?? '') || form.client_id !== 'client-1' || form.client_secret !== 'secret-1') {
        return json(res, 400, { error: 'invalid_grant' });
      }
      fake.refreshTokens.delete(form.refresh_token!);
      return json(res, 200, issue());
    }
    return json(res, 400, { error: 'unsupported_grant_type' });
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = `${req.method} ${url.pathname}`;
    const done = (promise: Promise<void>) => promise.catch((error: unknown) => json(res, 500, { error: String(error) }));

    switch (route) {
      case 'GET /.well-known/oauth-authorization-server':
        return json(res, 200, {
          issuer: `${fake.url}/mcp`,
          authorization_endpoint: `${fake.url}/mcp/authorize`,
          token_endpoint: `${fake.url}/mcp/token`,
          registration_endpoint: `${fake.url}/mcp/register`,
        });
      case 'POST /mcp/register':
        return void done(readBody(req).then((body) => {
          fake.registrations.push(JSON.parse(body) as Record<string, unknown>);
          json(res, 201, { client_id: 'client-1', client_secret: 'secret-1' });
        }));
      case 'GET /mcp/authorize': {
        // Plays the browser: "approve" immediately and redirect back with a code.
        const code = `code-${++counter}`;
        const redirectUri = url.searchParams.get('redirect_uri') ?? '';
        codes.set(code, { challenge: url.searchParams.get('code_challenge') ?? '', redirectUri, clientId: url.searchParams.get('client_id') ?? '' });
        const back = new URL(redirectUri);
        back.searchParams.set('code', code);
        back.searchParams.set('state', url.searchParams.get('state') ?? '');
        return void res.writeHead(302, { Location: back.toString() }).end();
      }
      case 'POST /mcp/token':
        return void done(handleToken(req, res));
      case 'POST /mcp':
        return void done(handleMcp(req, res));
      default:
        return void res.writeHead(404).end();
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  fake.url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return fake;
}
