import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeServer, type FakeServer } from './helpers/fake-server.ts';
import { cleanupCliDirs, createCli, type Cli } from './helpers/cli.ts';

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
});

describe('auth set', () => {
  it('saves a profile with the token from --token, as the default, mode 600', async () => {
    const r = await cli.run(['auth', 'set', 'main', '--url', fake.url, '--token', 'tok', '--org', 'acme', '--project', 'web', '--env', 'production']);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(cli.readConfig(), {
      defaultProfile: 'main',
      profiles: { main: { url: fake.url, token: 'tok', org: 'acme', project: 'web', environment: 'production' } },
    });
    assert.equal(cli.configMode(), 0o600);
  });

  it('reads the token from stdin and strips a Bearer prefix', async () => {
    const r = await cli.run(['auth', 'set', 'main', '--url', fake.url], { stdin: 'Bearer tok\n' });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(cli.readConfig().profiles.main?.token, 'tok');
  });

  it('normalizes the URL: trailing slash, /api, /api/0 and /mcp are dropped', async () => {
    for (const suffix of ['/', '/api', '/api/0', '/api/0/', '/mcp']) {
      await cli.run(['auth', 'set', 'p', '--url', `https://glitchtip.example.com${suffix}`, '--token', 't']);
      assert.equal(cli.readConfig().profiles.p?.url, 'https://glitchtip.example.com', suffix);
    }
  });

  it('requires a URL for a new profile and a token', async () => {
    const noUrl = await cli.run(['auth', 'set', 'main', '--token', 'tok']);
    assert.equal(noUrl.code, 2);
    assert.match(noUrl.stderr, /--url is required/);
    const noToken = await cli.run(['auth', 'set', 'main', '--url', fake.url]);
    assert.equal(noToken.code, 2);
    assert.match(noToken.stderr, /Pass --token/);
    assert.equal(cli.configExists(), false);
  });

  it('updating a profile keeps what is not passed again', async () => {
    await cli.run(['auth', 'set', 'main', '--url', fake.url, '--token', 'tok', '--org', 'acme']);
    await cli.run(['auth', 'set', 'main', '--project', 'web']);
    assert.deepEqual(cli.readConfig().profiles.main, { url: fake.url, token: 'tok', org: 'acme', project: 'web' });
  });

  it('keeps the first profile as the default', async () => {
    await cli.run(['auth', 'set', 'a', '--url', fake.url, '--token', 't1']);
    await cli.run(['auth', 'set', 'b', '--url', fake.url, '--token', 't2']);
    assert.equal(cli.readConfig().defaultProfile, 'a');
  });
});

describe('auth check', () => {
  beforeEach(() => {
    cli.writeConfig({ defaultProfile: 'main', profiles: { main: { url: fake.url, token: 'tok' } } });
  });

  it('proves the token works and lists the visible organizations', async () => {
    const r = await cli.run(['auth', 'check']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /OK: profile "main" .* can see 1 organization\(s\): acme/);
    assert.equal(fake.requests.at(-1)!.path, '/api/0/organizations/');
    assert.equal(fake.requests.at(-1)!.token, 'tok');
  });

  it('fails with exit 1 and a hint when the token is rejected', async () => {
    fake.validTokens.clear();
    const r = await cli.run(['auth', 'check']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /401 Unauthorized/);
  });

  it('checks a named profile', async () => {
    cli.writeConfig({
      defaultProfile: 'main',
      profiles: { main: { url: 'http://127.0.0.1:1', token: 'x' }, other: { url: fake.url, token: 'tok' } },
    });
    const r = await cli.run(['auth', 'check', 'other']);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /profile "other"/);
  });
});

describe('profiles', () => {
  beforeEach(() => {
    cli.writeConfig({
      defaultProfile: 'a',
      profiles: {
        a: { url: fake.url, token: 'tok', org: 'acme' },
        b: { url: fake.url, token: 'other-token', org: 'beta' },
      },
    });
  });

  it('status masks tokens and marks the default', async () => {
    const r = await cli.run(['auth', 'status']);
    assert.match(r.stdout, /^\* a +http\S+ +token …tok +\[acme\]$/m);
    assert.match(r.stdout, /^ {2}b /m);
    assert.match(r.stdout, /token …oken/);
    assert.doesNotMatch(r.stdout, /other-token/);
  });

  it('status with no profiles explains how to add one', async () => {
    const r = await createCli().run(['auth']);
    assert.match(r.stdout, /No profiles/);
  });

  it('use switches the default; unknown names fail', async () => {
    assert.equal((await cli.run(['auth', 'use', 'b'])).code, 0);
    assert.equal(cli.readConfig().defaultProfile, 'b');
    assert.equal((await cli.run(['auth', 'use', 'nope'])).code, 1);
  });

  it('-p and GLITCHTIP_PROFILE select a profile per call', async () => {
    await cli.run(['issues', '-p', 'b']);
    assert.match(fake.requests.at(-1)!.path, /^\/api\/0\/organizations\/beta\/issues\/$/);
    assert.equal(fake.requests.at(-1)!.token, 'other-token');
    fake.validTokens.add('other-token');
    await cli.run(['issues'], { env: { GLITCHTIP_PROFILE: 'b' } });
    assert.match(fake.requests.at(-1)!.path, /beta/);
  });

  it('set-defaults changes org, project and environment', async () => {
    const r = await cli.run(['auth', 'set-defaults', 'a', '--project', 'web', '--env', 'staging']);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(cli.readConfig().profiles.a, { url: fake.url, token: 'tok', org: 'acme', project: 'web', environment: 'staging' });
  });

  it('logout removes a profile and moves the default', async () => {
    await cli.run(['auth', 'logout', 'a']);
    const config = cli.readConfig();
    assert.deepEqual(Object.keys(config.profiles), ['b']);
    assert.equal(config.defaultProfile, 'b');
  });

  it('an unknown profile gets a helpful error', async () => {
    const r = await cli.run(['issues', '-p', 'zzz']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Unknown profile "zzz". Known: a, b/);
  });
});

describe('token sources', () => {
  it('works from GLITCHTIP_URL + GLITCHTIP_TOKEN without any profile', async () => {
    const r = await cli.run(['orgs'], { env: { GLITCHTIP_URL: `${fake.url}/`, GLITCHTIP_TOKEN: 'tok' } });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(fake.requests.at(-1)!.token, 'tok');
    assert.equal(cli.configExists(), false);
  });

  it('GLITCHTIP_TOKEN beats the stored token', async () => {
    cli.writeConfig({ defaultProfile: 'main', profiles: { main: { url: fake.url, token: 'stale' } } });
    fake.validTokens.add('fresh');
    const r = await cli.run(['orgs'], { env: { GLITCHTIP_TOKEN: 'fresh' } });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(fake.requests.at(-1)!.token, 'fresh');
  });

  it('a profile without a token says how to add one', async () => {
    cli.writeConfig({ defaultProfile: 'main', profiles: { main: { url: fake.url } } });
    const r = await cli.run(['orgs']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Profile "main" has no API token/);
    assert.match(r.stderr, /Auth Tokens/);
    assert.equal(fake.requests.length, 0);
  });

  it('no profile and no env explains the options', async () => {
    const r = await cli.run(['orgs']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /No profile selected/);
    assert.match(r.stderr, /GLITCHTIP_URL/);
  });
});

describe('auth login', () => {
  it('was removed and says what to do instead', async () => {
    const r = await cli.run(['auth', 'login']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /Browser login was removed/);
    assert.match(r.stderr, /auth set/);
  });

  it('unknown auth subcommand exits 2', async () => {
    assert.equal((await cli.run(['auth', 'bogus'])).code, 2);
  });
});
