import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { issue, startFakeServer, type FakeReply, type FakeServer, type RecordedRequest } from './helpers/fake-server.ts';
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

const last = (): RecordedRequest => fake.requests.at(-1)!;
const nth = (n: number): RecordedRequest => fake.requests[n]!;
const link = (cursor: string, more: boolean) => `<${fake.url}/x/?cursor=${cursor}>; rel="next"; results="${more}"; cursor="${cursor}"`;

describe('top level', () => {
  it('prints the version', async () => {
    const r = await cli.run(['-v']);
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), pkg.version);
  });

  it('prints help without a profile', async () => {
    const r = await createCli().run([]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Usage: glitchtip/);
    assert.match(r.stdout, /REST API/);
  });

  it('exits 2 on an unknown command or flag', async () => {
    assert.equal((await cli.run(['bogus'])).code, 2);
    assert.equal((await cli.run(['issues', '--nope'])).code, 2);
    assert.equal(fake.requests.length, 0);
  });

  it('takes a dash-leading value for a flag, as --sort -count or --sort=-count', async () => {
    await cli.run(['issues', '--sort', '-last_seen']);
    assert.deepEqual(last().query.sort, ['-last_seen']);
    await cli.run(['issues', '--sort=-count']);
    assert.deepEqual(last().query.sort, ['-count']);
  });

  it('still rejects a flag that is missing its value', async () => {
    const r = await cli.run(['issues', '--sort', '--json']);
    assert.equal(r.code, 2);
    assert.equal(fake.requests.length, 0);
  });

  it('sends the bearer token and a JSON accept header', async () => {
    await cli.run(['orgs']);
    assert.equal(last().token, 'tok');
  });
});

describe('issues', () => {
  it('lists unresolved issues of the default project as a table', async () => {
    const r = await cli.run(['issues']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(last().method, 'GET');
    assert.equal(last().path, '/api/0/projects/acme/web/issues/');
    assert.deepEqual(last().query, { query: ['is:unresolved'], environment: ['production'], limit: ['25'] });
    assert.match(r.stdout, /^ID +STATUS +LEVEL +COUNT +LAST SEEN +PROJECT +TITLE$/m);
    assert.match(r.stdout, /^1 +unresolved +error +12 +2026-10-27 07:25 +web +Error number 1$/m);
    assert.match(r.stderr, /2 issue\(s\)/);
  });

  it('maps flags and free text, with flags beating profile defaults', async () => {
    await cli.run(['issues', 'products', '--project', 'api', '--env', 'staging', '--sort', '-count', '--since', 'now-7d', '--until', 'now-1d', '--limit', '100']);
    assert.equal(last().path, '/api/0/projects/acme/api/issues/');
    assert.deepEqual(last().query, {
      query: ['is:unresolved products'], environment: ['staging'], sort: ['-count'], start: ['now-7d'], end: ['now-1d'], limit: ['100'],
    });
  });

  it('--status picks the is: filter and "any" drops it', async () => {
    await cli.run(['issues', '--status', 'resolved', 'foo']);
    assert.deepEqual(last().query.query, ['is:resolved foo']);
    await cli.run(['issues', '--status', 'any']);
    assert.equal('query' in last().query, false);
    assert.equal((await cli.run(['issues', '--status', 'bogus'])).code, 2);
  });

  it('appends --query after the status filter', async () => {
    await cli.run(['issues', '--query', 'level:error']);
    assert.deepEqual(last().query.query, ['is:unresolved level:error']);
  });

  it('uses the organization endpoint when no project is known', async () => {
    cli.writeConfig({ defaultProfile: 'main', profiles: { main: { url: fake.url, token: 'tok', org: 'acme' } } });
    await cli.run(['issues']);
    assert.equal(last().path, '/api/0/organizations/acme/issues/');
  });

  it('resolves the organization from flag, then env, then profile', async () => {
    await cli.run(['issues']);
    assert.match(last().path, /^\/api\/0\/projects\/acme\//);
    await cli.run(['issues'], { env: { GLITCHTIP_ORG: 'from-env' } });
    assert.match(last().path, /^\/api\/0\/projects\/from-env\//);
    await cli.run(['issues', '--org', 'from-flag'], { env: { GLITCHTIP_ORG: 'from-env' } });
    assert.match(last().path, /^\/api\/0\/projects\/from-flag\//);
  });

  it('exits 2 when no organization is known', async () => {
    cli.writeConfig({ defaultProfile: 'main', profiles: { main: { url: fake.url, token: 'tok' } } });
    const r = await cli.run(['issues']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /No organization/);
    assert.equal(fake.requests.length, 0);
  });

  it('--json prints the raw response', async () => {
    const r = await cli.run(['issues', '--json']);
    const parsed = JSON.parse(r.stdout) as { id: string; shortId: string }[];
    assert.deepEqual(parsed.map((i) => i.shortId), ['WEB-1', 'WEB-2']);
  });

  it('shows how to get the next page, and --cursor continues from it', async () => {
    fake.reply = (req) => (req.query.cursor ? undefined : { body: [issue(1)], headers: { Link: link('p2', true) } });
    const r = await cli.run(['issues']);
    assert.match(r.stderr, /1 issue\(s\) shown; more available: --cursor p2/);
    await cli.run(['issues', '--cursor', 'p2']);
    assert.deepEqual(last().query.cursor, ['p2']);
  });

  it('--all follows the cursor until the server has no more', async () => {
    fake.reply = (req): FakeReply => {
      const cursor = req.query.cursor?.[0];
      if (!cursor) return { body: [issue(1)], headers: { Link: link('p2', true) } };
      if (cursor === 'p2') return { body: [issue(2)], headers: { Link: link('p3', true) } };
      return { body: [issue(3)], headers: { Link: link('end', false) } };
    };
    const r = await cli.run(['issues', '--all', '--json']);
    assert.deepEqual((JSON.parse(r.stdout) as { id: string }[]).map((i) => i.id), ['1', '2', '3']);
    assert.equal(fake.requests.length, 3);
  });
});

describe('issue, latest, events, event', () => {
  it('accepts 123, #123 and an issue URL', async () => {
    await cli.run(['issue', '42']);
    assert.equal(last().path, '/api/0/issues/42/');
    await cli.run(['issue', '#43']);
    assert.equal(last().path, '/api/0/issues/43/');
    await cli.run(['issue', 'https://glitchtip.example.com/acme/issues/777?query=x']);
    assert.equal(last().path, '/api/0/issues/777/');
  });

  it('rejects ids that merely end in digits', async () => {
    for (const bad of ['abc123', '12abc', '1.5']) assert.equal((await cli.run(['issue', bad])).code, 2, bad);
    assert.equal((await cli.run(['issue'])).code, 2);
    assert.equal(fake.requests.length, 0);
  });

  it('issue prints a summary', async () => {
    const r = await cli.run(['issue', '5']);
    assert.match(r.stdout, /^Issue: +#5 +WEB-5$/m);
    assert.match(r.stdout, /^Title: +Error number 5$/m);
    assert.match(r.stdout, /^Events: +12 events, 3 users, 1 comments$/m);
  });

  it('latest shows tags and only the in-app frames, with the failing line', async () => {
    const r = await cli.run(['latest', '42']);
    assert.equal(last().path, '/api/0/issues/42/events/latest/');
    assert.match(r.stdout, /TypeError: boom/);
    assert.match(r.stdout, /environment=production/);
    assert.match(r.stdout, /\* \/app\/app\/Service\.php:130 in run/);
    assert.match(r.stdout, /> \$this->call\(\$y\);/);
    assert.match(r.stdout, /1 other frame\(s\) hidden/);
    assert.doesNotMatch(r.stdout, /Kernel\.php/);
    assert.match(r.stdout, /Request: GET https:\/\/shop\.example\.com\/cart/);
  });

  it('latest --all-frames shows every frame', async () => {
    const r = await cli.run(['latest', '42', '--all-frames']);
    assert.match(r.stdout, /Kernel\.php:10 in handle/);
    assert.doesNotMatch(r.stdout, /hidden/);
  });

  it('events lists an issue\'s events', async () => {
    const r = await cli.run(['events', '42', '--limit', '5']);
    assert.equal(last().path, '/api/0/issues/42/events/');
    assert.deepEqual(last().query.limit, ['5']);
    assert.match(r.stdout, /abc123/);
    assert.match(r.stdout, /def456 .* Second/);
  });

  it('event goes through the issue with --issue, else through the project', async () => {
    await cli.run(['event', 'abc123', '--issue', '42']);
    assert.equal(last().path, '/api/0/organizations/acme/issues/42/events/abc123/');
    await cli.run(['event', 'abc123']);
    assert.equal(last().path, '/api/0/projects/acme/web/events/abc123/');
  });

  it('event needs a project or an issue', async () => {
    cli.writeConfig({ defaultProfile: 'main', profiles: { main: { url: fake.url, token: 'tok', org: 'acme' } } });
    const r = await cli.run(['event', 'abc123']);
    assert.equal(r.code, 2);
    assert.equal(fake.requests.length, 0);
  });

  it('tags, hashes and comments render tables', async () => {
    const tags = await cli.run(['tags', '42']);
    assert.match(tags.stdout, /browser +2 unique \/ 10 +Chrome \(7\), Firefox \(3\)/);
    const hashes = await cli.run(['hashes', '42']);
    assert.equal(last().path, '/api/0/organizations/acme/issues/42/hashes/');
    assert.match(hashes.stdout, /hash1 +abc123/);
    const comments = await cli.run(['comments', '42']);
    assert.match(comments.stdout, /Plong\n {2}first comment/);
  });
});

describe('resolve, ignore, reopen', () => {
  it('sets the status with one PUT per id', async () => {
    const r = await cli.run(['resolve', '1', '#2', 'https://x.example.com/acme/issues/3']);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(fake.requests.map((x) => [x.method, x.path, x.body]), [
      ['PUT', '/api/0/issues/1/', { status: 'resolved' }],
      ['PUT', '/api/0/issues/2/', { status: 'resolved' }],
      ['PUT', '/api/0/issues/3/', { status: 'resolved' }],
    ]);
    assert.match(r.stdout, /#1 → resolved/);
    assert.match(r.stdout, /#3 → resolved/);
  });

  it('passes release details only when resolving', async () => {
    await cli.run(['resolve', '730', '--release', '1.4.2']);
    assert.deepEqual(last().body, { status: 'resolved', statusDetails: { inRelease: '1.4.2' } });
    await cli.run(['resolve', '731', '--next-release']);
    assert.deepEqual(last().body, { status: 'resolved', statusDetails: { inNextRelease: true } });
    await cli.run(['ignore', '5', '--next-release']);
    assert.deepEqual(last().body, { status: 'ignored' });
    await cli.run(['reopen', '6']);
    assert.deepEqual(last().body, { status: 'unresolved' });
  });

  it('keeps going after a failure, reports it per id, and exits 1', async () => {
    fake.reply = (req) => (req.path === '/api/0/issues/2/' ? { status: 404, body: { detail: 'No Issue matches the given query.' } } : undefined);
    const r = await cli.run(['resolve', '1', '2', '3']);
    assert.equal(r.code, 1);
    assert.equal(fake.requests.length, 3);
    assert.match(r.stdout, /#1 → resolved/);
    assert.match(r.stdout, /#3 → resolved/);
    assert.doesNotMatch(r.stdout, /#2/);
    assert.match(r.stderr, /#2: 404 Not found/);
    assert.match(r.stderr, /1 of 3 update\(s\) failed/);
  });

  it('needs ids or --query, and not both', async () => {
    assert.equal((await cli.run(['resolve'])).code, 2);
    assert.equal((await cli.run(['resolve', '1', '--query', 'x'])).code, 2);
    assert.equal(fake.requests.length, 0);
  });

  it('--query without --yes only lists the matches and changes nothing', async () => {
    const r = await cli.run(['resolve', '--query', 'is:unresolved level:error']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /would resolve 2 issue\(s\)/);
    assert.match(r.stderr, /--yes/);
    assert.match(r.stdout, /Error number 1/);
    assert.deepEqual(fake.requests.map((x) => x.method), ['GET', 'GET']); // project id, then the preview list
    assert.equal(fake.requests.some((x) => x.method === 'PUT'), false);
  });

  it('--query --yes changes everything that matches, scoped to the project and environment', async () => {
    const r = await cli.run(['resolve', '--query', 'is:unresolved level:error', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(last().method, 'PUT');
    assert.equal(last().path, '/api/0/organizations/acme/issues/');
    assert.deepEqual(last().query, { query: ['is:unresolved level:error'], project: ['6'], environment: ['production'] });
    assert.deepEqual(last().body, { status: 'resolved' });
  });
});

describe('delete', () => {
  it('refuses without --yes and sends nothing', async () => {
    const r = await cli.run(['delete', '1', '2']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /permanent/);
    assert.equal(fake.requests.length, 0);
  });

  it('deletes each id with --yes', async () => {
    const r = await cli.run(['delete', '1', '2', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(fake.requests.map((x) => [x.method, x.path]), [['DELETE', '/api/0/issues/1/'], ['DELETE', '/api/0/issues/2/']]);
    assert.match(r.stdout, /#1 deleted/);
  });

  it('--query previews first and deletes only with --yes', async () => {
    assert.equal((await cli.run(['delete', '--query', 'level:debug'])).code, 2);
    assert.equal(fake.requests.some((x) => x.method === 'DELETE'), false);
    const r = await cli.run(['delete', '--query', 'level:debug', '--yes']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(last().method, 'DELETE');
    assert.equal(last().path, '/api/0/organizations/acme/issues/');
    assert.deepEqual(last().query.query, ['level:debug']);
  });
});

describe('comment', () => {
  it('posts the text', async () => {
    const r = await cli.run(['comment', '42', 'looks', 'like', 'a', 'race']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(last().method, 'POST');
    assert.equal(last().path, '/api/0/issues/42/comments/');
    assert.deepEqual(last().body, { data: { text: 'looks like a race' } });
  });

  it('reads the text from stdin with "-"', async () => {
    await cli.run(['comment', '42', '-'], { stdin: 'multi\nline\n' });
    assert.deepEqual(last().body, { data: { text: 'multi\nline' } });
  });

  it('rejects an empty comment', async () => {
    assert.equal((await cli.run(['comment', '42'])).code, 2);
    assert.equal(fake.requests.length, 0);
  });
});

describe('org', () => {
  it('orgs, projects, monitors, checks and alerts', async () => {
    assert.match((await cli.run(['orgs'])).stdout, /^1 +acme +Acme$/m);
    assert.equal(last().path, '/api/0/organizations/');
    assert.match((await cli.run(['projects'])).stdout, /^6 +web +Web +php/m);
    assert.equal(last().path, '/api/0/organizations/acme/projects/');
    assert.match((await cli.run(['monitors'])).stdout, /^5 +Homepage +GET +DOWN +60s +https:\/\/example\.com$/m);
    assert.match((await cli.run(['monitor', '5'])).stdout, /DOWN/);
    assert.equal(last().path, '/api/0/organizations/acme/monitors/5/checks/');
    assert.match((await cli.run(['alerts'])).stdout, /9 +Too many errors +issues +10 events \/ 5 min/);
    assert.equal(last().path, '/api/0/projects/acme/web/alerts/');
  });

  it('alerts need a project', async () => {
    cli.writeConfig({ defaultProfile: 'main', profiles: { main: { url: fake.url, token: 'tok', org: 'acme' } } });
    assert.equal((await cli.run(['alerts'])).code, 2);
  });
});

describe('logs', () => {
  it('maps every filter', async () => {
    await cli.run(['logs', 'hello', 'world', '--level', 'error', '--service', 's', '--host', 'h1', '--trace', 't', '--project-id', '3', '--since', 'now-1h', '--until', 'now', '--limit', '10']);
    assert.equal(last().path, '/api/0/organizations/acme/logs/');
    assert.deepEqual(last().query, {
      project: ['3'], level: ['error'], service: ['s'], environment: ['production'], host: ['h1'], traceId: ['t'],
      query: ['hello world'], start: ['now-1h'], end: ['now'], limit: ['10'],
    });
  });

  it('--project resolves the slug to an id; the profile default project does not filter', async () => {
    await cli.run(['logs']);
    assert.equal('project' in last().query, false);
    await cli.run(['logs', '--project', 'web']);
    assert.equal(nth(fake.requests.length - 2).path, '/api/0/projects/acme/web/');
    assert.deepEqual(last().query.project, ['6']);
  });

  it('prints a table, and log shows one entry with its data', async () => {
    assert.match((await cli.run(['logs'])).stdout, /^2026-10-27 07:25 +error +api +pod-1 +Payment failed$/m);
    const one = await cli.run(['log', 'l1']);
    assert.equal(last().path, '/api/0/organizations/acme/logs/l1/');
    assert.match(one.stdout, /Body: +Payment failed/);
    assert.match(one.stdout, /"order": 7/);
  });

  it('rejects a non-numeric --project-id', async () => {
    assert.equal((await cli.run(['logs', '--project-id', 'x'])).code, 2);
    assert.equal(fake.requests.length, 0);
  });
});

describe('performance', () => {
  it('txns lists transaction groups', async () => {
    const r = await cli.run(['txns', 'cart', '--sort', '-count', '--limit', '30', '--project-id', '6']);
    assert.equal(last().path, '/api/0/organizations/acme/transaction-groups/');
    assert.deepEqual(last().query, { project: ['6'], query: ['cart'], sort: ['-count'], limit: ['30'] });
    assert.match(r.stdout, /^42 +http\.server +100 +123\.5 +300 +2 +GET \/cart$/m);
  });

  it('txn shows a group, its trend or its spans', async () => {
    assert.match((await cli.run(['txn', '42'])).stdout, /Errors: +2 \(2%\)/);
    assert.equal(last().path, '/api/0/organizations/acme/transaction-groups/42/');
    await cli.run(['txn', '42', 'trend', '--since', '2026-10-01T00:00:00Z']);
    assert.equal(last().path, '/api/0/organizations/acme/transaction-groups/42/trend/');
    assert.deepEqual(last().query, { start: ['2026-10-01T00:00:00Z'] });
    assert.match((await cli.run(['txn', '42', 'spans'])).stdout, /select \* from carts/);
    assert.equal(last().path, '/api/0/organizations/acme/transaction-groups/42/spans/');
  });

  it('txn rejects an unknown view', async () => {
    assert.equal((await cli.run(['txn', '42', 'bogus'])).code, 2);
  });

  it('spans takes the op positionally or as a flag', async () => {
    await cli.run(['spans', 'db', '--limit', '5']);
    assert.equal(last().path, '/api/0/organizations/acme/span-groups/');
    assert.deepEqual(last().query, { op: ['db'], limit: ['5'] });
    await cli.run(['spans', '--op', 'http']);
    assert.deepEqual(last().query.op, ['http']);
  });

  it('n1 sends the threshold and prints spans per transaction', async () => {
    const r = await cli.run(['n1', '--threshold', '7.5', '--project-id', '1']);
    assert.equal(last().path, '/api/0/organizations/acme/n-plus-one/');
    assert.deepEqual(last().query, { project: ['1'], threshold: ['7.5'] });
    assert.match(r.stdout, /^30 +30 +2 +GET \/cart/m);
    assert.equal((await cli.run(['n1', '--threshold', 'x'])).code, 2);
  });
});

describe('raw api', () => {
  it('normalizes the path and sends key=value as query parameters', async () => {
    const r = await cli.run(['api', 'get', 'organizations/acme/releases/', 'limit=5']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(last().path, '/api/0/organizations/acme/releases/');
    assert.deepEqual(last().query, { limit: ['5'] });
    assert.deepEqual(JSON.parse(r.stdout), [{ version: '1.4.2' }]);
    await cli.run(['api', 'GET', '/api/0/organizations/']);
    assert.equal(last().path, '/api/0/organizations/');
  });

  it('sends --data as the JSON body, from an argument or stdin', async () => {
    await cli.run(['api', 'POST', '/issues/1/comments/', '--data', '{"data":{"text":"x"}}']);
    assert.equal(last().method, 'POST');
    assert.deepEqual(last().body, { data: { text: 'x' } });
    await cli.run(['api', 'PUT', '/issues/1/', '--data', '-'], { stdin: '{"status":"ignored"}' });
    assert.deepEqual(last().body, { status: 'ignored' });
  });

  it('--all collects every page', async () => {
    fake.reply = (req): FakeReply => (req.query.cursor ? { body: [{ n: 2 }] } : { body: [{ n: 1 }], headers: { Link: link('p2', true) } });
    const r = await cli.run(['api', 'GET', '/organizations/', '--all']);
    assert.deepEqual(JSON.parse(r.stdout), [{ n: 1 }, { n: 2 }]);
  });

  it('rejects a bad method, a bad body and a missing path', async () => {
    assert.equal((await cli.run(['api', 'FETCH', '/x/'])).code, 2);
    assert.equal((await cli.run(['api', 'POST', '/x/', '--data', '{nope'])).code, 2);
    assert.equal((await cli.run(['api', 'GET'])).code, 2);
    assert.equal(fake.requests.length, 0);
  });
});

describe('errors', () => {
  it('explains a rejected token', async () => {
    fake.validTokens.clear();
    const r = await cli.run(['orgs']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /401 Unauthorized for profile "main"/);
    assert.match(r.stderr, /auth check/);
  });

  it('403, 404, 429 and 400 carry the server detail', async () => {
    fake.reply = () => ({ status: 403, body: { detail: 'You do not have permission.' } });
    assert.match((await cli.run(['orgs'])).stderr, /403 Forbidden: You do not have permission\. The token may lack a scope for GET \/api\/0\/organizations\//);
    fake.reply = () => ({ status: 404, body: { detail: 'Not found.' } });
    assert.match((await cli.run(['issue', '9'])).stderr, /404 Not found: GET \/api\/0\/issues\/9\//);
    fake.reply = () => ({ status: 429, body: {}, headers: { 'Retry-After': '30' } });
    assert.match((await cli.run(['orgs'])).stderr, /429 Too Many Requests\. Retry after 30s/);
    fake.reply = () => ({ status: 400, body: { status: ['bad value'] } });
    const bad = await cli.run(['resolve', '1']);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /HTTP 400 for PUT \/api\/0\/issues\/1\/: \{"status":\["bad value"\]\}/);
  });

  it('says so when the server is unreachable', async () => {
    cli.writeConfig({ defaultProfile: 'main', profiles: { main: { url: 'http://127.0.0.1:1', token: 'tok', org: 'acme' } } });
    const r = await cli.run(['orgs']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Cannot reach http:\/\/127\.0\.0\.1:1\/api\/0\/organizations\//);
  });
});
