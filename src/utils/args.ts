import { readFileSync } from 'node:fs';
import { CliError } from './errors.js';
import type { Profile } from './config.js';
import type { Opts } from './options.js';

export function readStdin(): string {
  return readFileSync(0, 'utf8');
}

// key=value pairs for `glitchtip call`; values parse as JSON when they can.
export function parseKeyValues(pairs: string[]): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq < 1) throw new CliError(`Expected key=value, got "${pair}".`);
    const raw = pair.slice(eq + 1);
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      value = raw;
    }
    args[pair.slice(0, eq)] = value;
  }
  return args;
}

export function requireArg(value: string | undefined, usage: string): string {
  if (value === undefined || value === '') throw new CliError(`Usage: ${usage}`, 2);
  return value;
}

export function toInt(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) throw new CliError(`--${name} must be an integer.`, 2);
  return n;
}

// Issue and group ids may be written as "123", "#123" or a GlitchTip issue URL.
export function toId(raw: string | undefined, usage: string): number {
  const text = requireArg(raw, usage);
  const match = /^#?(\d+)$/.exec(text) ?? /\/issues\/(\d+)\/?(?:[?#].*)?$/.exec(text);
  if (!match) throw new CliError(`"${text}" is not an id or issue URL. Usage: ${usage}`, 2);
  return Number(match[1]);
}

export function requireOrg(profile: Profile, opts: Opts): string {
  const org = opts.org || process.env.GLITCHTIP_ORG || profile.org;
  if (!org) throw new CliError('No organization. Pass --org, or save one: `glitchtip auth set-defaults --org <slug>`.', 2);
  return org;
}

export function projectSlug(profile: Profile, opts: Opts): string | undefined {
  return opts.project || process.env.GLITCHTIP_PROJECT || profile.project;
}

export function environment(profile: Profile, opts: Opts): string | undefined {
  return opts.env || process.env.GLITCHTIP_ENV || profile.environment;
}
