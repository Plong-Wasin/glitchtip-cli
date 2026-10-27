// Raw API access for anything without a shortcut (releases, teams, members,
// stats, ...). Output is always JSON.

import { readFileSync } from 'node:fs';
import { api, list, type Query } from '../glitchtip/client.js';
import { resolveProfile } from '../utils/config.js';
import { CliError } from '../utils/errors.js';
import { parsePairs, readStdin, requireArg } from '../utils/args.js';
import { printJson } from '../utils/output.js';
import type { Opts } from '../utils/options.js';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

// "/organizations/x/" and "organizations/x/" both mean /api/0/organizations/x/.
function normalizePath(path: string): string {
  if (path.startsWith('/api/')) return path;
  return `/api/0/${path.replace(/^\/+/, '')}`;
}

// --data takes JSON, "-" for stdin, or @file.
function readBody(data: string): unknown {
  const text = data === '-' ? readStdin() : data.startsWith('@') ? readFileSync(data.slice(1), 'utf8') : data;
  try {
    return JSON.parse(text);
  } catch {
    throw new CliError('--data must be valid JSON (or - for stdin, or @file).', 2);
  }
}

export async function cmdApi(method: string | undefined, path: string | undefined, pairs: string[], opts: Opts): Promise<void> {
  const usage = 'glitchtip api <GET|POST|PUT|PATCH|DELETE> <path> [key=value ...] [--data JSON|@file|-] [--all]';
  const verb = requireArg(method, usage).toUpperCase();
  if (!METHODS.includes(verb)) throw new CliError(`Method must be one of: ${METHODS.join(', ')}.`, 2);
  const target = normalizePath(requireArg(path, usage));
  const query: Query = parsePairs(pairs);
  const profile = resolveProfile(opts.profile);

  if (verb === 'GET' && opts.all) {
    return printJson((await list<unknown>(profile, target, query, { all: true })).items);
  }
  const { data, next } = await api(profile, verb, target, {
    query,
    body: opts.data === undefined ? undefined : readBody(opts.data),
  });
  if (data !== null && data !== undefined) printJson(data);
  if (next) console.error(`more: --cursor ${next}  (or --all)`);
}
