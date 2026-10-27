import { callTool } from '../glitchtip/client.js';
import { resolveProfile } from '../utils/config.js';
import { projectSlug, requireOrg } from '../utils/args.js';
import { printToolResult } from '../utils/output.js';
import type { Opts } from '../utils/options.js';

export async function cmdOrgs(opts: Opts): Promise<void> {
  return printToolResult(await callTool(resolveProfile(opts.profile), 'list_organizations', {}), opts);
}

export async function cmdProjects(opts: Opts): Promise<void> {
  const profile = resolveProfile(opts.profile);
  return printToolResult(await callTool(profile, 'list_projects', { organization_slug: requireOrg(profile, opts) }), opts);
}

export async function cmdMonitors(opts: Opts): Promise<void> {
  const profile = resolveProfile(opts.profile);
  return printToolResult(await callTool(profile, 'list_monitors', { organization_slug: requireOrg(profile, opts) }), opts);
}

export async function cmdAlerts(opts: Opts): Promise<void> {
  const profile = resolveProfile(opts.profile);
  return printToolResult(await callTool(profile, 'list_alerts', {
    organization_slug: requireOrg(profile, opts),
    project_slug: projectSlug(profile, opts),
  }), opts);
}
