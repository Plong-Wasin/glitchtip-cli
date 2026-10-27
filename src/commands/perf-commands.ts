// Performance data: transaction groups, spans, N+1 detection.

import { callTool } from '../glitchtip/client.js';
import { resolveProfile } from '../utils/config.js';
import { CliError } from '../utils/errors.js';
import { requireOrg, toId, toInt } from '../utils/args.js';
import { printToolResult } from '../utils/output.js';
import type { Opts } from '../utils/options.js';

export async function cmdPerf(command: 'txns' | 'txn' | 'spans' | 'n1', sub: string | undefined, rest: string[], opts: Opts): Promise<void> {
  const profile = resolveProfile(opts.profile);
  const org = requireOrg(profile, opts);
  const projectId = toInt(opts['project-id'], 'project-id');
  const range = { start: opts.since, end: opts.until };
  const limit = toInt(opts.limit, 'limit');

  if (command === 'txns') {
    const query = [sub, ...rest].filter(Boolean).join(' ') || undefined;
    return printToolResult(await callTool(profile, 'list_transaction_groups', {
      organization_slug: org, project_id: projectId, query, sort: opts.sort, limit,
    }), opts);
  }
  if (command === 'txn') {
    const usage = 'glitchtip txn <group-id> [trend|spans]';
    const groupId = toId(sub, usage);
    const tool = { undefined: 'get_transaction_group', trend: 'get_transaction_trend', spans: 'list_transaction_spans' }[String(rest[0])];
    if (!tool) throw new CliError(`Usage: ${usage}`, 2);
    const withRange = tool === 'get_transaction_group' ? {} : range;
    return printToolResult(await callTool(profile, tool, { organization_slug: org, group_id: groupId, ...withRange }), opts);
  }
  if (command === 'spans') {
    return printToolResult(await callTool(profile, 'list_span_groups', {
      organization_slug: org, project_id: projectId, op: opts.op ?? sub, sort: opts.sort, limit, ...range,
    }), opts);
  }
  return printToolResult(await callTool(profile, 'detect_n_plus_one', {
    organization_slug: org,
    project_id: projectId,
    op: opts.op,
    threshold: opts.threshold === undefined ? undefined : Number(opts.threshold),
    limit,
    ...range,
  }), opts);
}
