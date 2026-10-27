import { callTool } from '../glitchtip/client.js';
import { resolveProfile } from '../utils/config.js';
import { environment, requireArg, requireOrg, toInt } from '../utils/args.js';
import { printToolResult } from '../utils/output.js';
import type { Opts } from '../utils/options.js';

export async function cmdLogs(sub: string | undefined, rest: string[], opts: Opts): Promise<void> {
  const profile = resolveProfile(opts.profile);
  const query = [sub, ...rest].filter(Boolean).join(' ') || undefined;
  return printToolResult(await callTool(profile, 'list_logs', {
    organization_slug: requireOrg(profile, opts),
    project_id: toInt(opts['project-id'], 'project-id'),
    level: opts.level,
    service: opts.service,
    environment: environment(profile, opts),
    host: opts.host,
    query,
    trace_id: opts.trace,
    start: opts.since,
    end: opts.until,
    limit: toInt(opts.limit, 'limit'),
  }), opts);
}

export async function cmdLog(sub: string | undefined, opts: Opts): Promise<void> {
  const profile = resolveProfile(opts.profile);
  return printToolResult(await callTool(profile, 'get_log', {
    organization_slug: requireOrg(profile, opts),
    log_id: requireArg(sub, 'glitchtip log <log-id>'),
  }), opts);
}
