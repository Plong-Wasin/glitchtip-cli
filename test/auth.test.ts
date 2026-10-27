import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeServer, type FakeServer } from './helpers/fake-server.ts';
import { cleanupCliDirs, createCli, type Cli, type Running } from './helpers/cli.ts';

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
  cli = createCli();
});

describe('profiles', () => {
  it('stores a static token from stdin, trims the url and masks the token in status', async () => {
    const set = await cli.run(['auth', 'set', 'ci', '--url', 'https://gt.example.com/mcp/', '--org', 'acme'], { stdin: 'tok_abcd1234\n' });
    assert.equal(set.code, 0);
    assert.equal(cli.readConfig().profiles.ci?.url, 'https://gt.example.com');
    assert.equal(cli.readConfig().profiles.ci?.token, 'tok_abcd1234');
    assert.equal(cli.configMode(), 0o600);

    const status = await cli.run(['auth', 'status']);
    assert.match(status.stdout, /^\* ci +https:\/\/gt\.example\.com +token …1234 +\[acme\]$/m);
    assert.doesNotMatch(status.stdout, /tok_abcd1234/);
  });

  it('strips a Bearer prefix from --token', async () => {
    await cli.run(['auth', 'set', 'a', '--url', 'https://a.example.com', '--token', 'Bearer zzzz9999']);
    assert.equal(cli.readConfig().profiles.a?.token, 'zzzz9999');
  });

  it('requires a url for a new profile and a token', async () => {
    const noUrl = await cli.run(['auth', 'set', 'x'], { stdin: 'tok' });
    assert.equal(noUrl.code, 2);
    assert.match(noUrl.stderr, /--url is required/);
    const noToken = await cli.run(['auth', 'set', 'x', '--url', 'https://x.example.com']);
    assert.equal(noToken.code, 2);
    assert.match(noToken.stderr, /Pass --token/);
    assert.equal(cli.configExists(), false);
  });

  it('makes the first profile the default and switches with use', async () => {
    await cli.run(['auth', 'set', 'one', '--url', 'https://1.example.com', '--token', 't1']);
    await cli.run(['auth', 'set', 'two', '--url', 'https://2.example.com', '--token', 't2']);
    assert.equal(cli.readConfig().defaultProfile, 'one');
    assert.equal((await cli.run(['auth', 'use', 'two'])).code, 0);
    assert.equal(cli.readConfig().defaultProfile, 'two');
    const bad = await cli.run(['auth', 'use', 'nope']);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /Unknown profile "nope"/);
  });

  it('logout removes a profile and moves the default', async () => {
    await cli.run(['auth', 'set', 'one', '--url', 'https://1.example.com', '--token', 't1']);
    await cli.run(['auth', 'set', 'two', '--url', 'https://2.example.com', '--token', 't2']);
    await cli.run(['auth', 'logout', 'one']);
    assert.deepEqual(Object.keys(cli.readConfig().profiles), ['two']);
    assert.equal(cli.readConfig().defaultProfile, 'two');
  });

  it('set-defaults changes org, project and environment', async () => {
    await cli.run(['auth', 'set', 'one', '--url', 'https://1.example.com', '--token', 't1']);
    await cli.run(['auth', 'set-defaults', '--org', 'o', '--project', 'p', '--env', 'e']);
    const profile = cli.readConfig().profiles.one;
    assert.deepEqual([profile?.org, profile?.project, profile?.environment], ['o', 'p', 'e']);
  });

  it('status says what to do when there are no profiles', async () => {
    const r = await cli.run(['auth', 'status']);
    assert.match(r.stdout, /No profiles/);
  });

  it('exits 1 with the known names for an unknown profile', async () => {
    cli.writeConfig({ defaultProfile: 'main', profiles: { main: { url: fake.url, token: 'tok' } } });
    const r = await cli.run(['-p', 'nope', 'issues']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Unknown profile "nope"\. Known: main/);
  });

  it('exits 1 and points to auth login when no profile exists', async () => {
    const r = await cli.run(['issues']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /auth login/);
  });
});

describe('credentials', () => {
  const twoProfiles = () =>
    cli.writeConfig({
      defaultProfile: 'main',
      profiles: {
        main: { url: fake.url, token: 'tok', org: 'acme' },
        other: { url: fake.url, token: 'tok2', org: 'acme' },
      },
    });

  it('selects a profile with -p, then GLITCHTIP_PROFILE, else the default', async () => {
    twoProfiles();
    fake.validTokens.add('tok').add('tok2');
    await cli.run(['issues']);
    assert.equal(fake.calls.at(-1)?.token, 'tok');
    await cli.run(['-p', 'other', 'issues']);
    assert.equal(fake.calls.at(-1)?.token, 'tok2');
    await cli.run(['issues'], { env: { GLITCHTIP_PROFILE: 'other' } });
    assert.equal(fake.calls.at(-1)?.token, 'tok2');
  });

  it('GLITCHTIP_TOKEN beats the profile token', async () => {
    twoProfiles();
    fake.validTokens.add('envtok');
    const r = await cli.run(['issues'], { env: { GLITCHTIP_TOKEN: 'envtok' } });
    assert.equal(r.code, 0);
    assert.equal(fake.calls.at(-1)?.token, 'envtok');
  });

  it('a rejected static token is reported, never refreshed', async () => {
    twoProfiles();
    const r = await cli.run(['issues']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /401 Unauthorized for profile "main"/);
    assert.match(r.stderr, /Check the token/);
    assert.equal(fake.tokenRequests.length, 0);
  });

  it('a profile without credentials asks to sign in', async () => {
    cli.writeConfig({ defaultProfile: 'main', profiles: { main: { url: fake.url, org: 'acme' } } });
    const r = await cli.run(['issues']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /not signed in/);
    assert.equal(fake.calls.length, 0);
  });

  const oauthProfile = (refreshToken: string) =>
    cli.writeConfig({
      defaultProfile: 'main',
      profiles: {
        main: {
          url: fake.url,
          org: 'acme',
          oauth: { clientId: 'client-1', clientSecret: 'secret-1', tokenEndpoint: `${fake.url}/mcp/token`, accessToken: 'stale', refreshToken },
        },
      },
    });

  it('refreshes an expired OAuth token on 401, retries, and saves the new tokens', async () => {
    oauthProfile('r0');
    fake.refreshTokens.add('r0');
    const r = await cli.run(['issues']);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(fake.tokenRequests, [
      { grant_type: 'refresh_token', refresh_token: 'r0', client_id: 'client-1', client_secret: 'secret-1' },
    ]);
    const oauth = cli.readConfig().profiles.main?.oauth as { accessToken: string; refreshToken: string };
    assert.match(oauth.accessToken, /^access-/);
    assert.notEqual(oauth.refreshToken, 'r0');
    assert.equal(fake.calls.at(-1)?.token, oauth.accessToken);
    assert.equal(cli.configMode(), 0o600);
  });

  it('asks to sign in again when the refresh token is refused', async () => {
    oauthProfile('revoked');
    const r = await cli.run(['issues']);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /401 Unauthorized/);
    assert.match(r.stderr, /auth login main/);
    assert.equal(fake.calls.length, 0);
  });
});

describe('auth login (OAuth + PKCE)', () => {
  // Plays the browser: opens the authorize URL the CLI printed and follows the redirect.
  async function approve(running: Running): Promise<{ authorizeUrl: URL; location: URL }> {
    const raw = await running.waitForStderr(/http:\/\/127\.0\.0\.1:\d+\/mcp\/authorize\?\S+/);
    const authorizeUrl = new URL(raw);
    const response = await fetch(authorizeUrl, { redirect: 'manual' });
    return { authorizeUrl, location: new URL(response.headers.get('location')!) };
  }

  it('signs in from a pasted callback URL and the saved token works', async () => {
    const running = cli.start(['auth', 'login', 'main', '--url', `${fake.url}/mcp/`, '--org', 'acme', '--manual']);
    const { authorizeUrl, location } = await approve(running);
    running.stdin.write(`${location}\n`);
    const r = await running.done;

    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Signed in as profile "main"/);

    const params = authorizeUrl.searchParams;
    assert.equal(params.get('response_type'), 'code');
    assert.equal(params.get('code_challenge_method'), 'S256');
    assert.equal(params.get('client_id'), 'client-1');
    assert.equal(params.get('scope'), 'org:read project:read event:read event:write');
    assert.match(params.get('redirect_uri')!, /^http:\/\/127\.0\.0\.1:\d+\/callback$/);

    const registration = fake.registrations[0]!;
    assert.match(String(registration.client_name), /^glitchtip-cli\//);
    assert.deepEqual(registration.redirect_uris, [params.get('redirect_uri')]);
    assert.equal(registration.token_endpoint_auth_method, 'client_secret_post');

    // The fake server verified code_verifier against the challenge, so success proves PKCE.
    const profile = cli.readConfig().profiles.main!;
    assert.equal(cli.readConfig().defaultProfile, 'main');
    assert.equal(profile.url, fake.url);
    assert.equal(profile.org, 'acme');
    assert.equal('token' in profile, false);
    assert.equal(cli.configMode(), 0o600);

    const next = await cli.run(['issues', '-p', 'main']);
    assert.equal(next.code, 0, next.stderr);
    assert.equal(fake.calls.at(-1)?.token, (profile.oauth as { accessToken: string }).accessToken);
  });

  it('also accepts the redirect on the loopback port', async () => {
    const running = cli.start(['auth', 'login', 'main', '--url', fake.url, '--manual']);
    const { location } = await approve(running);
    const response = await fetch(location);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Signed in/);
    running.stdin.end();
    const r = await running.done;
    assert.equal(r.code, 0, r.stderr);
    assert.ok(cli.readConfig().profiles.main?.oauth);
  });

  it('refuses a callback whose state does not match', async () => {
    const running = cli.start(['auth', 'login', 'main', '--url', fake.url, '--manual']);
    const { location } = await approve(running);
    location.searchParams.set('state', 'forged');
    running.stdin.write(`${location}\n`);
    const r = await running.done;
    assert.equal(r.code, 1);
    assert.match(r.stderr, /state mismatch/);
    assert.equal(cli.configExists(), false);
  });

  it('reports an authorization error from the callback', async () => {
    const running = cli.start(['auth', 'login', 'main', '--url', fake.url, '--manual']);
    const { authorizeUrl } = await approve(running);
    const state = authorizeUrl.searchParams.get('state')!;
    running.stdin.write(`http://127.0.0.1/callback?error=access_denied&state=${state}\n`);
    const r = await running.done;
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Authorization failed: access_denied/);
    assert.equal(cli.configExists(), false);
  });

  it('re-login reuses the saved url and replaces a static token', async () => {
    cli.writeConfig({ defaultProfile: 'p', profiles: { p: { url: fake.url, token: 'old', project: 'web' } } });
    const running = cli.start(['auth', 'login', 'p', '--manual']);
    const { location } = await approve(running);
    running.stdin.write(`${location}\n`);
    const r = await running.done;
    assert.equal(r.code, 0, r.stderr);
    const profile = cli.readConfig().profiles.p!;
    assert.equal('token' in profile, false);
    assert.ok(profile.oauth);
    assert.equal(profile.project, 'web');
  });

  it('requires --url for a new profile', async () => {
    const r = await cli.run(['auth', 'login']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /--url is required/);
    assert.equal(fake.registrations.length, 0);
  });
});
