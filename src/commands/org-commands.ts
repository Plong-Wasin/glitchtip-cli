import { api, list } from '../glitchtip/client.js';
import type { Monitor, MonitorCheck, Organization, Project, ProjectAlert } from '../glitchtip/types.js';
import { resolveProfile } from '../utils/config.js';
import { CliError } from '../utils/errors.js';
import { projectSlug, requireOrg, toId, toInt } from '../utils/args.js';
import { pageFooter, printJson, printTable, shortDate } from '../utils/output.js';
import type { Opts } from '../utils/options.js';

export async function cmdOrgs(opts: Opts): Promise<void> {
  const profile = resolveProfile(opts.profile);
  const { items, next } = await list<Organization>(profile, '/api/0/organizations/', { limit: toInt(opts.limit, 'limit'), cursor: opts.cursor }, { all: opts.all });
  if (opts.json) return printJson(items);
  printTable(items, [
    { header: 'ID', get: (o) => o.id },
    { header: 'SLUG', get: (o) => o.slug },
    { header: 'NAME', get: (o) => o.name },
  ]);
  pageFooter(items.length, 'organization(s)', next);
}

export async function cmdProjects(opts: Opts): Promise<void> {
  const profile = resolveProfile(opts.profile);
  const org = requireOrg(profile, opts);
  const { items, next } = await list<Project>(profile, `/api/0/organizations/${org}/projects/`, { limit: toInt(opts.limit, 'limit'), cursor: opts.cursor }, { all: opts.all });
  if (opts.json) return printJson(items);
  printTable(items, [
    { header: 'ID', get: (p) => p.id },
    { header: 'SLUG', get: (p) => p.slug },
    { header: 'NAME', get: (p) => p.name },
    { header: 'PLATFORM', get: (p) => p.platform },
    { header: 'FIRST EVENT', get: (p) => shortDate(p.firstEvent) },
  ]);
  pageFooter(items.length, 'project(s)', next);
}

export async function cmdMonitors(opts: Opts): Promise<void> {
  const profile = resolveProfile(opts.profile);
  const org = requireOrg(profile, opts);
  const { data } = await api<Monitor[]>(profile, 'GET', `/api/0/organizations/${org}/monitors/`);
  if (opts.json) return printJson(data);
  printTable(data, [
    { header: 'ID', get: (m) => m.id },
    { header: 'NAME', get: (m) => m.name },
    { header: 'TYPE', get: (m) => m.monitorType },
    { header: 'UP', get: (m) => (m.isUp === null ? '-' : m.isUp ? 'up' : 'DOWN') },
    { header: 'EVERY', get: (m) => `${m.interval}s` },
    { header: 'URL', get: (m) => m.url, max: 60 },
  ]);
}

// Recent checks of one monitor.
export async function cmdMonitor(sub: string | undefined, opts: Opts): Promise<void> {
  const profile = resolveProfile(opts.profile);
  const org = requireOrg(profile, opts);
  const id = toId(sub, 'glitchtip monitor <monitor-id>');
  const { items, next } = await list<MonitorCheck>(profile, `/api/0/organizations/${org}/monitors/${id}/checks/`, { limit: toInt(opts.limit, 'limit') ?? 25, cursor: opts.cursor }, { all: opts.all });
  if (opts.json) return printJson(items);
  printTable(items, [
    { header: 'CHECKED', get: (c) => shortDate(c.startCheck) },
    { header: 'RESULT', get: (c) => (c.isUp ? 'up' : 'DOWN') },
    { header: 'REASON', get: (c) => c.reason },
    { header: 'RESPONSE MS', get: (c) => c.responseTime },
  ]);
  pageFooter(items.length, 'check(s)', next);
}

export async function cmdAlerts(opts: Opts): Promise<void> {
  const profile = resolveProfile(opts.profile);
  const org = requireOrg(profile, opts);
  const slug = projectSlug(profile, opts);
  if (!slug) throw new CliError('Alerts belong to a project: pass --project <slug> or set a default project.', 2);
  const { data } = await api<ProjectAlert[]>(profile, 'GET', `/api/0/projects/${org}/${slug}/alerts/`);
  if (opts.json) return printJson(data);
  printTable(data, [
    { header: 'ID', get: (a) => a.id },
    { header: 'NAME', get: (a) => a.name },
    { header: 'KIND', get: (a) => (a.uptime ? 'uptime' : 'issues') },
    { header: 'WHEN', get: (a) => (a.quantity && a.timespanMinutes ? `${a.quantity} events / ${a.timespanMinutes} min` : '-') },
  ]);
}
