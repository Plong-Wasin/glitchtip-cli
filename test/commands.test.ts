import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startFakeServer, type FakeServer } from './helpers/fake-server.ts';
import { cleanupCliDirs, createCli, type Cli } from './helpers/cli.ts';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

let fake: FakeServer;
let cli: Cli;

before(async () => {
  fake = await startFakeServer();
});

after(async () => {
  await fake.close();
  cleanupCliDirs();
});

beforeEach(() => {
  fake.reset();
  fake.validTokens.add('tok');
  cli = createCli();
  cli.writeConfig({
    defaultProfile: 'main',
    profiles: { main: { url: fake.url, token: 'tok', org: 'acme', project: 'web', environment: 'production' } },
  });
});

const lastCall = () => fake.calls.at(-1)!;

describe('top level', () => {
  it('prints the version', async () => {
    const r = await cli.run(['-v']);
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), pkg.version);
  });

  it('prints help without needing a profile', async () => {
    const r = await createCli().run([]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Usage: glitchtip/);
  });

  it('exits 2 on an unknown command', async () => {
    const r = await cli.run(['bogus']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /Unknown command "bogus"/);
  });

  it('exits 2 on an unknown flag', async () => {
    const r = await cli.run(['issues', '--nope']);
    assert.equal(r.code, 2);
  });

  it('takes a dash-leading value for a flag, as --sort -count or --sort=-count', async () => {
    await cli.run(['issues', '--sort', '-last_seen']);
    assert.equal(lastCall().arguments.sort, '-last_seen');
    await cli.run(['issues', '--sort=-count']);
    assert.equal(lastCall().arguments.sort, '-count');
  });

  it('still rejects a flag that is missing its value', async () => {
    fake.calls.length = 0;
    const r = await cli.run(['issues', '--sort', '--json']);
    assert.equal(r.code, 2);
    assert.equal(fake.calls.length, 0);
  });
});

describe('issues', () => {
  it('lists unresolved issues with the profile defaults', async () => {
    const r = await cli.run(['issues']);
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), 'ok:list_issues');
    assert.equal(lastCall().name, 'list_issues');
    assert.deepEqual(lastCall().arguments, {
      organization_slug: 'acme',
      project_slug: 'web',
      query: 'is:unresolved',
      environment: 'production',
      limit: 25,
    });
  });

  it('maps flags and free text, with flags beating profile defaults', async () => {
    await cli.run([
      'issues', 'products', '--project', 'api', '--env', 'staging', '--sort', '-count',
      '--since', 'now-7d', '--until', 'now-1d', '--limit', '100',
    ]);
    assert.deepEqual(lastCall().arguments, {
      organization_slug: 'acme',
      project_slug: 'api',
      query: 'is:unresolved products',
      environment: 'staging',
      sort: '-count',
      start: 'now-7d',
      end: 'now-1d',
      limit: 100,
    });
  });

  it('appends --query after the implicit is:unresolved', async () => {
    await cli.run(['issues', '--query', 'level:error']);
    assert.equal(lastCall().arguments.query, 'is:unresolved level:error');
  });

  it('--all drops the implicit is:unresolved', async () => {
    await cli.run(['issues', '--all', 'is:resolved']);
    assert.equal(lastCall().arguments.query, 'is:resolved');
    await cli.run(['issues', '--all']);
    assert.equal('query' in lastCall().arguments, false);
  });

  it('resolves the organization from flag, then env, then profile', async () => {
    await cli.run(['issues']);
    assert.equal(lastCall().arguments.organization_slug, 'acme');
    await cli.run(['issues'], { env: { GLITCHTIP_ORG: 'from-env' } });
    assert.equal(lastCall().arguments.organization_slug, 'from-env');
    await cli.run(['issues', '--org', 'from-flag'], { env: { GLITCHTIP_ORG: 'from-env' } });
    assert.equal(lastCall().arguments.organization_slug, 'from-flag');
  });

  it('exits 2 when no organization is known', async () => {
    cli.writeConfig({ defaultProfile: 'main', profiles: { main: { url: fake.url, token: 'tok' } } });
    const r = await cli.run(['projects']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /No organization/);
    assert.equal(fake.calls.length, 0);
  });
});

describe('issue, latest, event', () => {
  it('accepts 123, #123 and an issue URL', async () => {
    await cli.run(['issue', '42']);
    assert.deepEqual(lastCall().arguments, { issue_id: 42 });
    await cli.run(['issue', '#43']);
    assert.deepEqual(lastCall().arguments, { issue_id: 43 });
    await cli.run(['issue', 'https://glitchtip.example.com/acme/issues/777?query=x']);
    assert.deepEqual(lastCall().arguments, { issue_id: 777 });
  });

  it('rejects ids that merely end in digits', async () => {
    for (const bad of ['abc123', '12abc', '1.5']) {
      const r = await cli.run(['issue', bad]);
      assert.equal(r.code, 2, bad);
    }
    const r = await cli.run(['issue']);
    assert.equal(r.code, 2);
    assert.equal(fake.calls.length, 0);
  });

  it('latest calls get_latest_event', async () => {
    await cli.run(['latest', '9']);
    assert.equal(lastCall().name, 'get_latest_event');
    assert.deepEqual(lastCall().arguments, { issue_id: 9 });
  });

  it('event passes the id and the organization', async () => {
    await cli.run(['event', '019c4a0ac93a75f0a26ef22012159759']);
    assert.equal(lastCall().name, 'get_event');
    assert.deepEqual(lastCall().arguments, { event_id: '019c4a0ac93a75f0a26ef22012159759', organization_slug: 'acme' });
  });
});

describe('resolve, ignore, reopen', () => {
  it('resolves several ids, one update_issue call each', async () => {
    const r = await cli.run(['resolve', '1', '#2', 'https://x.example.com/acme/issues/3', '--next-release']);
    assert.equal(r.code, 0);
    assert.deepEqual(fake.calls.map((c) => c.name), ['update_issue', 'update_issue', 'update_issue']);
    assert.deepEqual(fake.calls.map((c) => c.arguments), [
      { issue_id: 1, status: 'resolved', in_next_release: true },
      { issue_id: 2, status: 'resolved', in_next_release: true },
      { issue_id: 3, status: 'resolved', in_next_release: true },
    ]);
    assert.match(r.stdout, /#1 → resolved/);
    assert.match(r.stdout, /#3 → resolved/);
  });

  it('passes --release and nothing else for a plain resolve', async () => {
    await cli.run(['resolve', '730', '--release', '1.4.2']);
    assert.deepEqual(lastCall().arguments, { issue_id: 730, status: 'resolved', in_release: '1.4.2' });
    await cli.run(['resolve', '731']);
    assert.deepEqual(lastCall().arguments, { issue_id: 731, status: 'resolved' });
  });

  it('ignore and reopen set their status and ignore release flags', async () => {
    await cli.run(['ignore', '5', '--next-release']);
    assert.deepEqual(lastCall().arguments, { issue_id: 5, status: 'ignored' });
    await cli.run(['reopen', '6']);
    assert.deepEqual(lastCall().arguments, { issue_id: 6, status: 'unresolved' });
  });

  it('uses one MCP session for all ids', async () => {
    await cli.run(['resolve', '1', '2', '3']);
    assert.equal(fake.initializeCount, 1);
    assert.deepEqual([...new Set(fake.calls.map((c) => c.sessionId))], ['sess-1']);
  });

  it('keeps going after a failure, reports it per id, and exits 1', async () => {
    fake.reply = (_name, args) => (args.issue_id === 2 ? { isError: true, content: [{ type: 'text', text: 'boom' }] } : undefined);
    const r = await cli.run(['resolve', '1', '2', '3']);
    assert.equal(r.code, 1);
    assert.equal(fake.calls.length, 3);
    assert.match(r.stdout, /#1 → resolved/);
    assert.match(r.stdout, /#3 → resolved/);
    assert.doesNotMatch(r.stdout, /#2/);
    assert.match(r.stderr, /#2: boom/);
    assert.match(r.stderr, /1 of 3 update\(s\) failed/);
  });

  it('exits 2 without ids and sends nothing', async () => {
    const r = await cli.run(['resolve']);
    assert.equal(r.code, 2);
    assert.equal(fake.calls.length, 0);
  });

  it('--json prints one object per id', async () => {
    const r = await cli.run(['resolve', '1', '--json']);
    assert.deepEqual(JSON.parse(r.stdout), { issue_id: 1, status: 'resolved', result: { tool: 'update_issue' } });
  });
});

describe('org', () => {
  it('orgs sends no arguments', async () => {
    await cli.run(['orgs']);
    assert.equal(lastCall().name, 'list_organizations');
    assert.deepEqual(lastCall().arguments, {});
  });

  it('projects, monitors and alerts', async () => {
    await cli.run(['projects']);
    assert.deepEqual([lastCall().name, lastCall().arguments], ['list_projects', { organization_slug: 'acme' }]);
    await cli.run(['monitors']);
    assert.deepEqual([lastCall().name, lastCall().arguments], ['list_monitors', { organization_slug: 'acme' }]);
    await cli.run(['alerts']);
    assert.deepEqual([lastCall().name, lastCall().arguments], ['list_alerts', { organization_slug: 'acme', project_slug: 'web' }]);
  });
});

describe('logs', () => {
  it('maps every filter', async () => {
    await cli.run([
      'logs', 'hello', 'world', '--level', 'error', '--service', 's', '--host', 'h1', '--trace', 't',
      '--project-id', '3', '--since', 'now-1h', '--until', 'now', '--limit', '10',
    ]);
    assert.equal(lastCall().name, 'list_logs');
    assert.deepEqual(lastCall().arguments, {
      organization_slug: 'acme',
      project_id: 3,
      level: 'error',
      service: 's',
      environment: 'production',
      host: 'h1',
      query: 'hello world',
      trace_id: 't',
      start: 'now-1h',
      end: 'now',
      limit: 10,
    });
  });

  it('log fetches one entry', async () => {
    await cli.run(['log', 'abc-123']);
    assert.equal(lastCall().name, 'get_log');
    assert.deepEqual(lastCall().arguments, { organization_slug: 'acme', log_id: 'abc-123' });
  });

  it('rejects a non-numeric --project-id', async () => {
    const r = await cli.run(['logs', '--project-id', 'x']);
    assert.equal(r.code, 2);
    assert.equal(fake.calls.length, 0);
  });
});

describe('performance', () => {
  it('txns lists transaction groups', async () => {
    await cli.run(['txns', 'cart', '--sort', '-count', '--limit', '30', '--project-id', '6']);
    assert.equal(lastCall().name, 'list_transaction_groups');
    assert.deepEqual(lastCall().arguments, { organization_slug: 'acme', project_id: 6, query: 'cart', sort: '-count', limit: 30 });
  });

  it('txn shows a group, its trend or its spans', async () => {
    await cli.run(['txn', '42']);
    assert.deepEqual([lastCall().name, lastCall().arguments], ['get_transaction_group', { organization_slug: 'acme', group_id: 42 }]);
    await cli.run(['txn', '42', 'trend', '--since', '2026-10-01T00:00:00Z']);
    assert.deepEqual([lastCall().name, lastCall().arguments], [
      'get_transaction_trend',
      { organization_slug: 'acme', group_id: 42, start: '2026-10-01T00:00:00Z' },
    ]);
    await cli.run(['txn', '42', 'spans']);
    assert.equal(lastCall().name, 'list_transaction_spans');
  });

  it('txn rejects an unknown view', async () => {
    const r = await cli.run(['txn', '42', 'bogus']);
    assert.equal(r.code, 2);
    assert.equal(fake.calls.length, 0);
  });

  it('spans takes the op positionally or as a flag', async () => {
    await cli.run(['spans', 'db', '--limit', '5']);
    assert.deepEqual([lastCall().name, lastCall().arguments], ['list_span_groups', { organization_slug: 'acme', op: 'db', limit: 5 }]);
    await cli.run(['spans', '--op', 'http']);
    assert.equal(lastCall().arguments.op, 'http');
  });

  it('n1 sends the threshold as a number', async () => {
    await cli.run(['n1', '--threshold', '7.5', '--project-id', '1']);
    assert.equal(lastCall().name, 'detect_n_plus_one');
    assert.deepEqual(lastCall().arguments, { organization_slug: 'acme', project_id: 1, threshold: 7.5 });
  });
});

describe('raw MCP', () => {
  it('tools lists names with required and optional parameters', async () => {
    const r = await cli.run(['tools']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /^t1 a \[b\]$/m);
    assert.match(r.stdout, /^ {4}First line$/m);
  });

  it('info prints the server name and instructions', async () => {
    const r = await cli.run(['info']);
    assert.match(r.stdout, /fake-glitchtip 9\.9/);
    assert.match(r.stdout, /Fake instructions\./);
  });

  it('call parses key=value as JSON when it can and merges --args', async () => {
    await cli.run(['call', 'list_issues', 'organization_slug=acme', 'limit=5', 'query=is:unresolved', 'flag=true', '--args', '{"sort":"-count","limit":1}']);
    assert.equal(lastCall().name, 'list_issues');
    assert.deepEqual(lastCall().arguments, { organization_slug: 'acme', limit: 5, query: 'is:unresolved', flag: true, sort: '-count' });
  });

  it('call rejects malformed input', async () => {
    assert.equal((await cli.run(['call'])).code, 2);
    assert.equal((await cli.run(['call', 't', '--args', '{nope'])).code, 2);
    assert.equal((await cli.run(['call', 't', 'novalue'])).code, 1);
    assert.equal(fake.calls.length, 0);
  });

  it('call prints a tool error and exits 1', async () => {
    fake.reply = () => ({ isError: true, content: [{ type: 'text', text: 'denied' }] });
    const r = await cli.run(['call', 'update_issue']);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /denied/);
  });
});

describe('output and errors', () => {
  it('--json prints structuredContent when the tool has it', async () => {
    const r = await cli.run(['issue', '1', '--json']);
    assert.deepEqual(JSON.parse(r.stdout), { tool: 'get_issue' });
  });

  it('--json falls back to the whole result', async () => {
    fake.reply = () => ({ content: [{ type: 'text', text: 'hi' }] });
    const r = await cli.run(['issue', '1', '--json']);
    assert.deepEqual(JSON.parse(r.stdout), { content: [{ type: 'text', text: 'hi' }] });
  });

  it('reports a tool error on stderr and exits 1', async () => {
    fake.reply = () => ({ isError: true, content: [{ type: 'text', text: 'boom' }] });
    const r = await cli.run(['issue', '1']);
    assert.equal(r.code, 1);
    assert.equal(r.stderr.trim(), 'glitchtip: boom');
    assert.equal(r.stdout, '');
  });

  it('understands an SSE reply', async () => {
    fake.sse = true;
    const r = await cli.run(['issue', '5']);
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), 'ok:get_issue');
  });

  it('says so when the server is unreachable', async () => {
    cli.writeConfig({ defaultProfile: 'main', profiles: { main: { url: 'http://127.0.0.1:1', token: 'tok', org: 'acme' } } });
    const r = await cli.run(['issue', '1']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Cannot reach http:\/\/127\.0\.0\.1:1\/mcp/);
  });
});
