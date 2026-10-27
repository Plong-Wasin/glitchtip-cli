import { api, list, projectId, type Query } from '../glitchtip/client.js';
import type { Comment, Issue, IssueEvent, IssueHash, IssueTag } from '../glitchtip/types.js';
import { resolveProfile, type Profile } from '../utils/config.js';
import { CliError } from '../utils/errors.js';
import { environment, projectSlug, readStdin, requireArg, requireOrg, toId, toInt } from '../utils/args.js';
import { printEvent, printIssue } from '../utils/format.js';
import { pageFooter, printJson, printTable, shortDate } from '../utils/output.js';
import type { Opts } from '../utils/options.js';

const STATUSES = ['unresolved', 'resolved', 'ignored', 'any'];

// ---------------------------------------------------------------- read

export async function cmdIssues(sub: string | undefined, rest: string[], opts: Opts): Promise<void> {
  const profile = resolveProfile(opts.profile);
  const org = requireOrg(profile, opts);
  const slug = projectSlug(profile, opts);

  const status = opts.status ?? 'unresolved';
  if (!STATUSES.includes(status)) throw new CliError(`--status must be one of: ${STATUSES.join(', ')}.`, 2);
  const text = opts.query ?? ([sub, ...rest].filter(Boolean).join(' ') || undefined);
  const query = [status === 'any' ? undefined : `is:${status}`, text].filter(Boolean).join(' ');

  // The project endpoint takes a slug; the organization endpoint wants numeric project ids.
  const path = slug ? `/api/0/projects/${org}/${slug}/issues/` : `/api/0/organizations/${org}/issues/`;
  const { items, next } = await list<Issue>(profile, path, {
    query: query || undefined,
    environment: environment(profile, opts),
    sort: opts.sort,
    start: opts.since,
    end: opts.until,
    limit: toInt(opts.limit, 'limit') ?? 25,
    cursor: opts.cursor,
  }, { all: opts.all });

  if (opts.json) return printJson(items);
  printTable(items, [
    { header: 'ID', get: (i) => i.id },
    { header: 'STATUS', get: (i) => i.status },
    { header: 'LEVEL', get: (i) => i.level },
    { header: 'COUNT', get: (i) => i.count },
    { header: 'LAST SEEN', get: (i) => shortDate(i.lastSeen) },
    { header: 'PROJECT', get: (i) => i.project.slug ?? i.project.name },
    { header: 'TITLE', get: (i) => i.title, max: 80 },
  ]);
  pageFooter(items.length, 'issue(s)', next);
}

export async function cmdIssue(sub: string | undefined, opts: Opts): Promise<void> {
  const profile = resolveProfile(opts.profile);
  const id = toId(sub, 'glitchtip issue <id|url>');
  const { data } = await api<Issue>(profile, 'GET', `/api/0/issues/${id}/`);
  if (opts.json) return printJson(data);
  printIssue(data);
}

export async function cmdLatest(sub: string | undefined, opts: Opts): Promise<void> {
  const profile = resolveProfile(opts.profile);
  const id = toId(sub, 'glitchtip latest <issue-id|url>');
  const { data } = await api<IssueEvent>(profile, 'GET', `/api/0/issues/${id}/events/latest/`);
  if (opts.json) return printJson(data);
  printEvent(data, { allFrames: opts['all-frames'] });
}

export async function cmdEvents(sub: string | undefined, opts: Opts): Promise<void> {
  const profile = resolveProfile(opts.profile);
  const id = toId(sub, 'glitchtip events <issue-id|url>');
  const { items, next } = await list<IssueEvent>(profile, `/api/0/issues/${id}/events/`, {
    limit: toInt(opts.limit, 'limit') ?? 25,
    cursor: opts.cursor,
  }, { all: opts.all });
  if (opts.json) return printJson(items);
  printTable(items, [
    { header: 'EVENT', get: (e) => e.eventID },
    { header: 'DATE', get: (e) => shortDate(e.dateCreated) },
    { header: 'TITLE', get: (e) => e.title, max: 80 },
  ]);
  pageFooter(items.length, 'event(s)', next);
}

// One event by its id: through its issue when --issue is given, otherwise through the project.
export async function cmdEvent(sub: string | undefined, opts: Opts): Promise<void> {
  const profile = resolveProfile(opts.profile);
  const eventId = requireArg(sub, 'glitchtip event <event-id> [--issue <id> | --project <slug>]');
  const org = requireOrg(profile, opts);
  let path: string;
  if (opts.issue) {
    path = `/api/0/organizations/${org}/issues/${toId(opts.issue, 'glitchtip event <event-id> --issue <id>')}/events/${eventId}/`;
  } else {
    const slug = projectSlug(profile, opts);
    if (!slug) throw new CliError('An event is looked up through its project or issue: pass --project <slug> or --issue <id>.', 2);
    path = `/api/0/projects/${org}/${slug}/events/${eventId}/`;
  }
  const { data } = await api<IssueEvent>(profile, 'GET', path);
  if (opts.json) return printJson(data);
  printEvent(data, { allFrames: opts['all-frames'] });
}

export async function cmdTags(sub: string | undefined, opts: Opts): Promise<void> {
  const profile = resolveProfile(opts.profile);
  const id = toId(sub, 'glitchtip tags <issue-id|url>');
  const { data } = await api<IssueTag[]>(profile, 'GET', `/api/0/issues/${id}/tags/`);
  if (opts.json) return printJson(data);
  printTable(data, [
    { header: 'TAG', get: (t) => t.key },
    { header: 'VALUES', get: (t) => `${t.uniqueValues} unique / ${t.totalValues}` },
    { header: 'TOP', get: (t) => t.topValues.slice(0, 3).map((v) => `${v.value} (${v.count})`).join(', '), max: 90 },
  ]);
}

export async function cmdHashes(sub: string | undefined, opts: Opts): Promise<void> {
  const profile = resolveProfile(opts.profile);
  const org = requireOrg(profile, opts);
  const id = toId(sub, 'glitchtip hashes <issue-id|url>');
  const { data } = await api<IssueHash[]>(profile, 'GET', `/api/0/organizations/${org}/issues/${id}/hashes/`);
  if (opts.json) return printJson(data);
  printTable(data, [
    { header: 'HASH', get: (h) => h.id },
    { header: 'LATEST EVENT', get: (h) => h.latestEvent?.eventID },
    { header: 'DATE', get: (h) => shortDate(h.latestEvent?.dateCreated) },
  ]);
}

export async function cmdComments(sub: string | undefined, opts: Opts): Promise<void> {
  const profile = resolveProfile(opts.profile);
  const id = toId(sub, 'glitchtip comments <issue-id|url>');
  const { data } = await api<Comment[]>(profile, 'GET', `/api/0/issues/${id}/comments/`);
  if (opts.json) return printJson(data);
  for (const comment of data) {
    const who = comment.user?.name || comment.user?.username || comment.user?.email || 'unknown';
    console.log(`${shortDate(comment.dateCreated)}  ${who}\n  ${(comment.data.text ?? '').replace(/\n/g, '\n  ')}\n`);
  }
}

// ---------------------------------------------------------------- write

// Comment text comes from the arguments, or from stdin when it is "-".
export async function cmdComment(sub: string | undefined, rest: string[], opts: Opts): Promise<void> {
  const profile = resolveProfile(opts.profile);
  const usage = 'glitchtip comment <issue-id|url> <text | ->';
  const id = toId(sub, usage);
  const text = (rest[0] === '-' ? readStdin() : rest.join(' ')).trim();
  if (!text) throw new CliError(`Usage: ${usage}`, 2);
  const { data } = await api<Comment>(profile, 'POST', `/api/0/issues/${id}/comments/`, { body: { data: { text } } });
  if (opts.json) return printJson(data);
  console.log(`Commented on #${id}.`);
}

type NewStatus = 'resolved' | 'ignored' | 'unresolved';

interface Selection {
  ids: number[];
  /** Organization-level selection by search query (no ids). */
  byQuery: boolean;
}

// Issues come either as ids or, for mass changes, from --query (never both).
function selection(args: string[], opts: Opts, usage: string): Selection {
  if (args.length > 0 && opts.query !== undefined) throw new CliError('Pass issue ids or --query, not both.', 2);
  if (args.length === 0 && opts.query === undefined) throw new CliError(`Usage: ${usage}`, 2);
  return { ids: args.map((arg) => toId(arg, usage)), byQuery: args.length === 0 };
}

// Query filters for the organization-level bulk endpoints.
async function bulkQuery(profile: Profile, org: string, opts: Opts): Promise<Query> {
  const slug = projectSlug(profile, opts);
  return {
    query: opts.query,
    project: slug ? [await projectId(profile, org, slug)] : undefined,
    environment: environment(profile, opts),
    start: opts.since,
    end: opts.until,
  };
}

// A mass change must be confirmed: show what would match, then refuse without --yes.
async function requireConfirmation(profile: Profile, org: string, filters: Query, verb: string, opts: Opts): Promise<void> {
  if (opts.yes) return;
  const { items, next } = await list<Issue>(profile, `/api/0/organizations/${org}/issues/`, { ...filters, limit: 25 });
  printTable(items, [
    { header: 'ID', get: (i) => i.id },
    { header: 'STATUS', get: (i) => i.status },
    { header: 'TITLE', get: (i) => i.title, max: 80 },
  ]);
  throw new CliError(`--query would ${verb} ${items.length}${next ? '+' : ''} issue(s) (first 25 shown). Re-run with --yes to apply.`, 2);
}

export async function cmdSetStatus(status: NewStatus, args: string[], opts: Opts): Promise<void> {
  const verb = { resolved: 'resolve', ignored: 'ignore', unresolved: 'reopen' }[status];
  const usage = `glitchtip ${verb} <id|url>... | --query <q> --yes${status === 'resolved' ? ' [--next-release | --release <version>]' : ''}`;
  const choice = selection(args, opts, usage);
  const profile = resolveProfile(opts.profile);
  const statusDetails = status === 'resolved' && (opts['next-release'] || opts.release)
    ? { inNextRelease: opts['next-release'] ? true : undefined, inRelease: opts.release }
    : undefined;
  const body = { status, ...(statusDetails ? { statusDetails } : {}) };

  if (choice.byQuery) {
    const org = requireOrg(profile, opts);
    const filters = await bulkQuery(profile, org, opts);
    await requireConfirmation(profile, org, filters, verb, opts);
    await api(profile, 'PUT', `/api/0/organizations/${org}/issues/`, { query: filters, body });
    console.log(`Issues matching "${opts.query}" → ${status}`);
    return;
  }

  // One request per id, so a missing or forbidden issue is reported by itself.
  let failed = 0;
  for (const id of choice.ids) {
    try {
      const { data } = await api<Issue>(profile, 'PUT', `/api/0/issues/${id}/`, { body });
      if (opts.json) printJson(data);
      else console.log(`#${id} → ${status}`);
    } catch (error) {
      failed++;
      console.error(`glitchtip: #${id}: ${(error as Error).message}`);
    }
  }
  if (failed > 0) throw new CliError(`${failed} of ${choice.ids.length} update(s) failed.`);
}

// Deleting an issue is permanent, so it always needs --yes.
export async function cmdDelete(args: string[], opts: Opts): Promise<void> {
  const usage = 'glitchtip delete <id|url>... --yes | glitchtip delete --query <q> --yes';
  const choice = selection(args, opts, usage);
  const profile = resolveProfile(opts.profile);

  if (choice.byQuery) {
    const org = requireOrg(profile, opts);
    const filters = await bulkQuery(profile, org, opts);
    await requireConfirmation(profile, org, filters, 'permanently delete', opts);
    await api(profile, 'DELETE', `/api/0/organizations/${org}/issues/`, { query: filters });
    console.log(`Deleted issues matching "${opts.query}".`);
    return;
  }
  if (!opts.yes) throw new CliError(`Deleting ${choice.ids.map((id) => `#${id}`).join(' ')} is permanent. Re-run with --yes.`, 2);

  let failed = 0;
  for (const id of choice.ids) {
    try {
      await api(profile, 'DELETE', `/api/0/issues/${id}/`);
      console.log(`#${id} deleted`);
    } catch (error) {
      failed++;
      console.error(`glitchtip: #${id}: ${(error as Error).message}`);
    }
  }
  if (failed > 0) throw new CliError(`${failed} of ${choice.ids.length} delete(s) failed.`);
}
