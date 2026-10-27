import { projectId } from './client.js';
import type { Profile } from '../utils/config.js';
import { toInt } from '../utils/args.js';
import type { Opts } from '../utils/options.js';

// Logs and performance endpoints filter by numeric project id. Only an explicit
// --project-id or --project <slug> narrows them; the profile default does not.
export async function projectFilter(profile: Profile, org: string, opts: Opts): Promise<number[] | undefined> {
  const id = toInt(opts['project-id'], 'project-id');
  if (id !== undefined) return [id];
  if (opts.project) return [await projectId(profile, org, opts.project)];
  return undefined;
}
