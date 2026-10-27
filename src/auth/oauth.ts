// OAuth 2.1 against the GlitchTip MCP authorization server: dynamic client
// registration, authorization code + PKCE (S256) on a loopback redirect, and
// refresh tokens.

import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { CliError } from '../utils/errors.js';
import { VERSION } from '../utils/version.js';
import { loadConfig, saveConfig, type OAuthState, type Profile } from '../utils/config.js';

const SCOPES = 'org:read project:read event:read event:write';
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

interface AuthServerMetadata {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

const b64url = (buf: Buffer) => buf.toString('base64url');

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    const cause = error instanceof Error ? (error.cause as Error | undefined) : undefined;
    throw new CliError(`Cannot reach ${url}: ${cause?.message || (error as Error).message}`);
  }
  const body = await response.text();
  if (!response.ok) throw new CliError(`HTTP ${response.status} from ${url}: ${body.slice(0, 500)}`);
  return JSON.parse(body) as T;
}

async function postForm<T>(url: string, params: Record<string, string>): Promise<T> {
  return fetchJson<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params),
  });
}

function toOAuthState(base: Pick<OAuthState, 'clientId' | 'clientSecret' | 'tokenEndpoint'>, token: TokenResponse, previousRefresh?: string): OAuthState {
  return {
    ...base,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? previousRefresh,
    expiresAt: token.expires_in ? Math.floor(Date.now() / 1000) + token.expires_in : undefined,
  };
}

// Wait for the browser redirect on a loopback port, or (with `manual`) for a
// pasted callback URL. Whichever arrives first wins.
function waitForCode(server: ReturnType<typeof createServer>, expectedState: string, manual: boolean): Promise<string> {
  const fromUrl = (raw: string): string => {
    const url = new URL(raw, 'http://127.0.0.1');
    if (url.searchParams.get('state') !== expectedState) throw new CliError('OAuth state mismatch; start the login again.');
    const error = url.searchParams.get('error');
    if (error) throw new CliError(`Authorization failed: ${error} ${url.searchParams.get('error_description') ?? ''}`.trim());
    const code = url.searchParams.get('code');
    if (!code) throw new CliError('Callback URL has no code parameter.');
    return code;
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new CliError('Timed out waiting for the browser sign-in.')), LOGIN_TIMEOUT_MS);
    const rl = manual ? createInterface({ input: process.stdin, output: process.stderr }) : undefined;
    const done = (fn: () => void) => {
      clearTimeout(timer);
      rl?.close();
      fn();
    };

    server.on('request', (req, res) => {
      if (!req.url?.startsWith('/callback')) {
        res.writeHead(404).end();
        return;
      }
      try {
        const code = fromUrl(req.url);
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Signed in. You can close this tab.');
        done(() => resolve(code));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Sign-in failed. See the terminal.');
        done(() => reject(error));
      }
    });

    rl?.question('Paste the full callback URL: ')
      .then((answer) => done(() => resolve(fromUrl(answer.trim()))))
      .catch((error) => done(() => reject(error)));
  });
}

function openBrowser(url: string): void {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(opener, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  } catch {
    // The URL is printed anyway.
  }
}

export async function oauthLogin(baseUrl: string, manual: boolean): Promise<OAuthState> {
  const meta = await fetchJson<AuthServerMetadata>(`${baseUrl}/.well-known/oauth-authorization-server`);

  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  try {
    const client = await fetchJson<{ client_id: string; client_secret?: string }>(meta.registration_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_name: `glitchtip-cli/${VERSION}`,
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'client_secret_post',
        scope: SCOPES,
      }),
    });

    const verifier = b64url(randomBytes(32));
    const state = b64url(randomBytes(16));
    const authorizeUrl = new URL(meta.authorization_endpoint);
    authorizeUrl.search = new URLSearchParams({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: redirectUri,
      scope: SCOPES,
      state,
      code_challenge: b64url(createHash('sha256').update(verifier).digest()),
      code_challenge_method: 'S256',
    }).toString();

    console.error(`Open this URL to sign in:\n\n  ${authorizeUrl}\n`);
    if (!manual) openBrowser(authorizeUrl.toString());

    const code = await waitForCode(server, state, manual);
    const token = await postForm<TokenResponse>(meta.token_endpoint, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: client.client_id,
      ...(client.client_secret ? { client_secret: client.client_secret } : {}),
      code_verifier: verifier,
    });
    return toOAuthState({ clientId: client.client_id, clientSecret: client.client_secret, tokenEndpoint: meta.token_endpoint }, token);
  } finally {
    server.close();
    server.closeAllConnections();
  }
}

// Returns false when there is no refresh token or the server refuses it.
export async function refreshAccessToken(profile: Profile): Promise<boolean> {
  const oauth = profile.oauth;
  if (!oauth?.refreshToken) return false;
  try {
    const token = await postForm<TokenResponse>(oauth.tokenEndpoint, {
      grant_type: 'refresh_token',
      refresh_token: oauth.refreshToken,
      client_id: oauth.clientId,
      ...(oauth.clientSecret ? { client_secret: oauth.clientSecret } : {}),
    });
    profile.oauth = toOAuthState(oauth, token, oauth.refreshToken);
    const config = loadConfig();
    const stored = config.profiles[profile.name];
    if (stored) {
      stored.oauth = profile.oauth;
      saveConfig(config);
    }
    return true;
  } catch {
    return false;
  }
}
