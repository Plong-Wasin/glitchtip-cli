import { callTool, toolText } from '../glitchtip/client.js';
import { resolveProfile } from '../utils/config.js';
import { CliError } from '../utils/errors.js';
import { environment, projectSlug, requireArg, requireOrg, toId, toInt } from '../utils/args.js';
import { printJson, printToolResult } from '../utils/output.js';
import type { Opts } from '../utils/options.js';

export async function cmdIssues(sub: string | undefined, rest: string[], opts: Opts): Promise<void> {
  const profile = resolveProfile(opts.profile);
  // `issues` and `issues "free text"` both list; the query defaults to unresolved.
  const query = opts.query ?? (rest.length > 0 || sub ? [sub, ...rest].filter(Boolean).join(' ') : undefined);
  const result = await callTool(profile, 'list_issues', {
    organization_slug: requireOrg(profile, opts),
    project_slug: projectSlug(profile, opts),
    query: opts.all ? query : ['is:unresolved', query].filter(Boolean).join(' '),
    environment: environment(profile, opts),
    sort: opts.sort,
    start: opts.since,
    end: opts.until,
    limit: toInt(opts.limit, 'limit') ?? 25,
  });
  printToolResult(result, opts);
}

export async function cmdIssue(sub: string | undefined, opts: Opts): Promise<void> {
  const profile = resolveProfile(opts.profile);
  const id = toId(sub, 'glitchtip issue <id|url>');
  return printToolResult(await callTool(profile, 'get_issue', { issue_id: id }), opts);
}

export async function cmdLatest(sub: string | undefined, opts: Opts): Promise<void> {
  const profile = resolveProfile(opts.profile);
  const id = toId(sub, 'glitchtip latest <issue-id|url>');
  return printToolResult(await callTool(profile, 'get_latest_event', { issue_id: id }), opts);
}

export async function cmdEvent(sub: string | undefined, opts: Opts): Promise<void> {
  const profile = resolveProfile(opts.profile);
  const eventId = requireArg(sub, 'glitchtip event <event-id>');
  return printToolResult(await callTool(profile, 'get_event', {
    event_id: eventId,
    organization_slug: opts.org || process.env.GLITCHTIP_ORG || profile.org,
  }), opts);
}

// Write action: resolve / ignore / reopen one or more issues. Only run these on
// the user's explicit instruction.
export async function cmdSetStatus(status: 'resolved' | 'ignored' | 'unresolved', ids: string[], opts: Opts): Promise<void> {
  const verb = { resolved: 'resolve', ignored: 'ignore', unresolved: 'reopen' }[status];
  const usage = `glitchtip ${verb} <id|url>...${status === 'resolved' ? ' [--next-release | --release <version>]' : ''}`;
  if (ids.length === 0) throw new CliError(`Usage: ${usage}`, 2);
  const profile = resolveProfile(opts.profile);
  const parsed = ids.map((id) => toId(id, usage));
  let failed = 0;
  for (const id of parsed) {
    try {
      const result = await callTool(profile, 'update_issue', {
        issue_id: id,
        status,
        in_next_release: status === 'resolved' && opts['next-release'] ? true : undefined,
        in_release: status === 'resolved' ? opts.release : undefined,
      });
      if (opts.json) printJson({ issue_id: id, status, result: result.structuredContent ?? toolText(result) });
      else console.log(`#${id} → ${status}`);
    } catch (error) {
      failed++;
      console.error(`glitchtip: #${id}: ${(error as Error).message}`);
    }
  }
  if (failed > 0) throw new CliError(`${failed} of ${parsed.length} update(s) failed.`);
}
