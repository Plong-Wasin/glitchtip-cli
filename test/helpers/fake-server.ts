// A fake GlitchTip REST API on a random loopback port. Default fixtures follow
// the shapes in GlitchTip's OpenAPI schema; tests inspect what was requested
// and override replies with `reply`.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export interface RecordedRequest {
  method: string;
  path: string;
  query: Record<string, string[]>;
  body: unknown;
  token: string;
}

export interface FakeReply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface FakeServer {
  url: string;
  requests: RecordedRequest[];
  /** Bearer tokens the API accepts. */
  validTokens: Set<string>;
  /** Override the reply; return undefined to fall back to the default fixtures. */
  reply: ((request: RecordedRequest) => FakeReply | undefined) | undefined;
  reset(): void;
  close(): Promise<void>;
}

const NOW = '2026-10-27T07:25:32.000000Z';

export const issue = (id: number, overrides: Record<string, unknown> = {}) => ({
  id: String(id),
  shortId: `WEB-${id}`,
  title: `Error number ${id}`,
  culprit: 'App\\Service::run',
  level: 'error',
  status: 'unresolved',
  count: '12',
  userCount: 3,
  numComments: 1,
  firstSeen: NOW,
  lastSeen: NOW,
  permalink: `https://glitchtip.example.com/acme/issues/${id}`,
  project: { id: '6', slug: 'web', name: 'Web' },
  ...overrides,
});

export const event = (overrides: Record<string, unknown> = {}) => ({
  id: 'e1',
  eventID: 'abc123',
  groupID: '42',
  dateCreated: NOW,
  title: 'TypeError: boom',
  message: 'boom happened',
  platform: 'php',
  tags: [{ key: 'environment', value: 'production' }, { key: 'server_name', value: 'pod-1' }],
  user: { email: 'a@example.com' },
  entries: [
    {
      type: 'exception',
      data: {
        values: [{
          type: 'TypeError',
          value: 'boom',
          stacktrace: {
            frames: [
              { filename: 'vendor/laravel/Kernel.php', absPath: '/app/vendor/laravel/Kernel.php', lineNo: 10, function: 'handle', inApp: false },
              {
                filename: 'app/Service.php',
                absPath: '/app/app/Service.php',
                lineNo: 130,
                function: 'run',
                inApp: true,
                context: [[129, 'if ($x) {'], [130, '    $this->call($y);'], [131, '}']],
              },
            ],
          },
        }],
      },
    },
    { type: 'request', data: { method: 'GET', url: 'https://shop.example.com/cart' } },
  ],
  ...overrides,
});

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

function defaults(request: RecordedRequest): FakeReply {
  const { method, path } = request;
  const match = (pattern: RegExp) => pattern.exec(path);

  if (method === 'GET' && path === '/api/0/organizations/') return { body: [{ id: '1', slug: 'acme', name: 'Acme', dateCreated: NOW }] };
  if (method === 'GET' && match(/^\/api\/0\/organizations\/[^/]+\/projects\/$/)) {
    return { body: [{ id: '6', slug: 'web', name: 'Web', platform: 'php', firstEvent: NOW, dateCreated: NOW }] };
  }
  if (method === 'GET' && match(/^\/api\/0\/projects\/[^/]+\/[^/]+\/$/)) return { body: { id: '6', slug: 'web', name: 'Web' } };

  if (method === 'GET' && match(/^\/api\/0\/(projects\/[^/]+\/[^/]+|organizations\/[^/]+)\/issues\/$/)) return { body: [issue(1), issue(2)] };
  if (method === 'PUT' && match(/^\/api\/0\/organizations\/[^/]+\/issues\/$/)) return { body: { status: (request.body as { status?: string })?.status } };
  if (method === 'DELETE' && match(/^\/api\/0\/organizations\/[^/]+\/issues\/$/)) return { body: { status: 'deleted' } };

  let m = match(/^\/api\/0\/issues\/(\d+)\/$/);
  if (m && method === 'GET') return { body: issue(Number(m[1])) };
  if (m && method === 'PUT') return { body: issue(Number(m[1]), { status: (request.body as { status?: string })?.status }) };
  if (m && method === 'DELETE') return { status: 204 };

  m = match(/^\/api\/0\/issues\/(\d+)\/(events\/latest|events|tags|comments)\/$/);
  if (m && method === 'GET') {
    if (m[2] === 'events/latest') return { body: event({ groupID: m[1] }) };
    if (m[2] === 'events') return { body: [event(), event({ eventID: 'def456', title: 'Second' })] };
    if (m[2] === 'tags') return { body: [{ key: 'browser', name: 'Browser', totalValues: 10, uniqueValues: 2, topValues: [{ value: 'Chrome', count: 7 }, { value: 'Firefox', count: 3 }] }] };
    return { body: [{ id: 1, dateCreated: NOW, user: { name: 'Plong' }, data: { text: 'first comment' } }] };
  }
  if (method === 'POST' && match(/^\/api\/0\/issues\/\d+\/comments\/$/)) {
    return { status: 201, body: { id: 2, dateCreated: NOW, user: { name: 'Plong' }, data: (request.body as { data: unknown }).data } };
  }
  if (method === 'GET' && match(/^\/api\/0\/organizations\/[^/]+\/issues\/\d+\/hashes\/$/)) {
    return { body: [{ id: 'hash1', latestEvent: { eventID: 'abc123', dateCreated: NOW } }] };
  }
  if (method === 'GET' && match(/^\/api\/0\/organizations\/[^/]+\/issues\/\d+\/events\/[^/]+\/$/)) return { body: event() };
  if (method === 'GET' && match(/^\/api\/0\/projects\/[^/]+\/[^/]+\/events\/[^/]+\/$/)) return { body: event() };

  if (method === 'GET' && match(/^\/api\/0\/organizations\/[^/]+\/monitors\/$/)) {
    return { body: [{ id: 5, name: 'Homepage', monitorType: 'GET', url: 'https://example.com', isUp: false, interval: 60 }] };
  }
  if (method === 'GET' && match(/^\/api\/0\/organizations\/[^/]+\/monitors\/\d+\/checks\/$/)) {
    return { body: [{ startCheck: NOW, isUp: false, reason: 2, responseTime: 1200 }] };
  }
  if (method === 'GET' && match(/^\/api\/0\/projects\/[^/]+\/[^/]+\/alerts\/$/)) {
    return { body: [{ id: 9, name: 'Too many errors', timespanMinutes: 5, quantity: 10, uptime: false }] };
  }

  if (method === 'GET' && match(/^\/api\/0\/organizations\/[^/]+\/logs\/$/)) {
    return { body: [{ id: 'l1', timestamp: NOW, level: 'error', body: 'Payment failed', service: 'api', host: 'pod-1', projectId: 6 }] };
  }
  if (method === 'GET' && match(/^\/api\/0\/organizations\/[^/]+\/logs\/[^/]+\/$/)) {
    return { body: { id: 'l1', timestamp: NOW, level: 'error', body: 'Payment failed', service: 'api', host: 'pod-1', traceID: 't1', data: { order: 7 }, projectId: 6 } };
  }

  if (method === 'GET' && match(/^\/api\/0\/organizations\/[^/]+\/transaction-groups\/$/)) {
    return { body: [{ id: 42, project: 6, transaction: 'GET /cart', op: 'http.server', count: 100, avgDuration: 123.456, p50: 100, p95: 300, errorCount: 2, errorRate: 0.02 }] };
  }
  if (method === 'GET' && match(/^\/api\/0\/organizations\/[^/]+\/transaction-groups\/42\/$/)) {
    return { body: { id: 42, project: 6, transaction: 'GET /cart', op: 'http.server', count: 100, avgDuration: 123.456, p50: 100, p95: 300, errorCount: 2, errorRate: 0.02 } };
  }
  if (method === 'GET' && match(/^\/api\/0\/organizations\/[^/]+\/transaction-groups\/42\/trend\/$/)) {
    return { body: [{ date: '2026-10-26', count: 50, avgDuration: 120, totalTime: 6000 }] };
  }
  if (method === 'GET' && match(/^\/api\/0\/organizations\/[^/]+\/(transaction-groups\/42\/spans|span-groups)\/$/)) {
    return { body: [{ op: 'db', description: 'select * from carts', count: 500, avgDuration: 3.2, p95Duration: 9, totalTime: 1600 }] };
  }
  if (method === 'GET' && match(/^\/api\/0\/organizations\/[^/]+\/n-plus-one\/$/)) {
    return { body: [{ transactionName: 'GET /cart', op: 'db', description: 'select * from items where id = ?', totalSpans: 900, transactionCount: 30, spansPerTxn: 30, avgDuration: 2, totalTime: 1800 }] };
  }
  if (method === 'GET' && match(/^\/api\/0\/organizations\/[^/]+\/releases\/$/)) return { body: [{ version: '1.4.2' }] };

  return { status: 404, body: { detail: 'Not found.' } };
}

export async function startFakeServer(): Promise<FakeServer> {
  const fake: FakeServer = {
    url: '',
    requests: [],
    validTokens: new Set(),
    reply: undefined,
    reset() {
      fake.requests.length = 0;
      fake.validTokens.clear();
      fake.reply = undefined;
    },
    close: () => new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
      const raw = await readBody(req);
      const query: Record<string, string[]> = {};
      for (const [key, value] of url.searchParams) (query[key] ??= []).push(value);
      const request: RecordedRequest = {
        method: req.method ?? 'GET',
        path: url.pathname,
        query,
        body: raw ? JSON.parse(raw) : undefined,
        token,
      };
      fake.requests.push(request);

      const reply: FakeReply = !fake.validTokens.has(token)
        ? { status: 401, body: { detail: 'Unauthorized' } }
        : fake.reply?.(request) ?? defaults(request);

      res.writeHead(reply.status ?? 200, { 'Content-Type': 'application/json', ...reply.headers });
      res.end(reply.body === undefined ? undefined : JSON.stringify(reply.body));
    })().catch((error: unknown) => {
      res.writeHead(500).end(String(error));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  fake.url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return fake;
}
