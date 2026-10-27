import { api, list } from '../glitchtip/client.js';
import { projectFilter } from '../glitchtip/filters.js';
import type { LogEvent } from '../glitchtip/types.js';
import { resolveProfile } from '../utils/config.js';
import { environment, requireArg, requireOrg, toInt } from '../utils/args.js';
import { pageFooter, printFields, printJson, printTable, shortDate } from '../utils/output.js';
import type { Opts } from '../utils/options.js';

export async function cmdLogs(sub: string | undefined, rest: string[], opts: Opts): Promise<void> {
  const profile = resolveProfile(opts.profile);
  const org = requireOrg(profile, opts);
  const text = [sub, ...rest].filter(Boolean).join(' ') || undefined;
  const { items, next } = await list<LogEvent>(profile, `/api/0/organizations/${org}/logs/`, {
    project: await projectFilter(profile, org, opts),
    level: opts.level ? [opts.level] : undefined,
    service: opts.service,
    environment: environment(profile, opts),
    host: opts.host,
    traceId: opts.trace,
    query: text,
    start: opts.since,
    end: opts.until,
    limit: toInt(opts.limit, 'limit') ?? 50,
    cursor: opts.cursor,
  }, { all: opts.all });
  if (opts.json) return printJson(items);
  printTable(items, [
    { header: 'TIME', get: (l) => shortDate(l.timestamp) },
    { header: 'LEVEL', get: (l) => l.level },
    { header: 'SERVICE', get: (l) => l.service },
    { header: 'HOST', get: (l) => l.host },
    { header: 'BODY', get: (l) => l.body, max: 100 },
  ]);
  pageFooter(items.length, 'log(s)', next);
}

export async function cmdLog(sub: string | undefined, opts: Opts): Promise<void> {
  const profile = resolveProfile(opts.profile);
  const org = requireOrg(profile, opts);
  const id = requireArg(sub, 'glitchtip log <log-id>');
  const { data } = await api<LogEvent & { data?: unknown; traceID?: string | null }>(profile, 'GET', `/api/0/organizations/${org}/logs/${id}/`);
  if (opts.json) return printJson(data);
  printFields([
    ['Log', data.id],
    ['Time', data.timestamp],
    ['Level', data.level],
    ['Service', data.service],
    ['Host', data.host],
    ['Environment', data.environment],
    ['Trace', data.traceID],
    ['Body', data.body],
  ]);
  if (data.data && typeof data.data === 'object' && Object.keys(data.data).length > 0) {
    console.log(`\nData:\n${JSON.stringify(data.data, null, 2)}`);
  }
}
