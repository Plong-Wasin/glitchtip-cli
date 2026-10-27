// GlitchTip REST API client: bearer-token requests to <base>/api/0/..., JSON in
// and out, cursor pagination through the Link header.

import { CliError } from '../utils/errors.js';
import { VERSION } from '../utils/version.js';
import type { Profile } from '../utils/config.js';

export type QueryValue = string | number | boolean | null | undefined | (string | number)[];
export type Query = Record<string, QueryValue>;

export interface ApiOptions {
  query?: Query;
  body?: unknown;
}

export interface ApiResult<T> {
  data: T;
  /** Cursor of the next page, when the server says there is one. */
  next?: string;
}

/** Hard stop for `--all`, so a huge project cannot loop forever. */
export const MAX_PAGES = 50;

export function buildUrl(profile: Profile, path: string, query: Query = {}): string {
  const url = new URL(profile.url + path);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    // Arrays repeat the key (?id=1&id=2), which is how the API takes lists.
    for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(item));
  }
  return url.toString();
}

// `Link: <...>; rel="next"; results="true"; cursor="abc"` (Sentry-style, which GlitchTip follows).
export function nextCursor(link: string | null): string | undefined {
  if (!link) return undefined;
  for (const part of link.split(/,\s*(?=<)/)) {
    if (!/rel="next"/.test(part)) continue;
    if (/results="false"/.test(part)) return undefined;
    const match = /cursor="([^"]+)"/.exec(part) ?? /[?&]cursor=([^&>]+)/.exec(part);
    return match ? decodeURIComponent(match[1]!) : undefined;
  }
  return undefined;
}

function errorDetail(body: string): string {
  try {
    const parsed = JSON.parse(body) as { detail?: unknown; message?: unknown };
    const detail = parsed.detail ?? parsed.message;
    if (typeof detail === 'string') return detail.replace(/\.+$/, ''); // callers add their own punctuation
    return JSON.stringify(parsed).slice(0, 500);
  } catch {
    return body.slice(0, 300);
  }
}

export async function api<T = unknown>(profile: Profile, method: string, path: string, options: ApiOptions = {}): Promise<ApiResult<T>> {
  const url = buildUrl(profile, path, options.query);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${profile.token}`,
    Accept: 'application/json',
    'User-Agent': `glitchtip-cli/${VERSION}`,
  };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (error) {
    const cause = error instanceof Error ? (error.cause as Error | undefined) : undefined;
    throw new CliError(`Cannot reach ${url}: ${cause?.message || (error as Error).message}`);
  }

  const text = await response.text();
  if (!response.ok) {
    const detail = errorDetail(text);
    switch (response.status) {
      case 401:
        throw new CliError(`401 Unauthorized for profile "${profile.name}" (${profile.url}): ${detail}. Check the API token (\`glitchtip auth check\`).`);
      case 403:
        throw new CliError(`403 Forbidden: ${detail}. The token may lack a scope for ${method} ${path}.`);
      case 404:
        throw new CliError(`404 Not found: ${method} ${path} (${detail}).`);
      case 429: {
        const retry = response.headers.get('retry-after');
        throw new CliError(`429 Too Many Requests.${retry ? ` Retry after ${retry}s.` : ''}`);
      }
      default:
        throw new CliError(`HTTP ${response.status} for ${method} ${path}: ${detail}`);
    }
  }

  const data = (text ? JSON.parse(text) : null) as T;
  return { data, next: nextCursor(response.headers.get('link')) };
}

/**
 * GET a list endpoint. By default returns one page; with `all` follows the
 * cursor until the server has no more (capped at MAX_PAGES).
 */
export async function list<T>(profile: Profile, path: string, query: Query, options: { all?: boolean } = {}): Promise<{ items: T[]; next?: string }> {
  const items: T[] = [];
  let cursor = typeof query.cursor === 'string' ? query.cursor : undefined;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await api<T[]>(profile, 'GET', path, { query: { ...query, cursor } });
    items.push(...(Array.isArray(result.data) ? result.data : []));
    cursor = result.next;
    if (!options.all || !cursor) break;
  }
  return { items, next: cursor };
}

/** Numeric id of a project, which several organization-level endpoints require instead of the slug. */
export async function projectId(profile: Profile, org: string, slug: string): Promise<number> {
  const { data } = await api<{ id: string }>(profile, 'GET', `/api/0/projects/${org}/${slug}/`);
  return Number(data.id);
}
