import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { CliError } from './errors.js';

export const CONFIG_PATH = process.env.GLITCHTIP_CONFIG || join(homedir(), '.config', 'glitchtip', 'config.json');

export interface StoredProfile {
  url: string;
  token?: string;
  org?: string;
  project?: string;
  environment?: string;
}

export interface Config {
  defaultProfile: string | null;
  profiles: Record<string, StoredProfile>;
}

// A profile ready to make requests: the token is resolved (env beats stored).
export interface Profile extends StoredProfile {
  name: string;
  token: string;
}

export function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) return { defaultProfile: null, profiles: {} };
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as Config;
  config.profiles ??= {};
  return config;
}

export function saveConfig(config: Config): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  chmodSync(CONFIG_PATH, 0o600);
}

export function resolveProfile(name: string | undefined): Profile {
  const config = loadConfig();
  const profileName = name || process.env.GLITCHTIP_PROFILE || config.defaultProfile;

  // No profile at all: GLITCHTIP_URL + GLITCHTIP_TOKEN is enough (CI, agents, one-off runs).
  if (!profileName && process.env.GLITCHTIP_URL && process.env.GLITCHTIP_TOKEN) {
    return { name: 'env', url: process.env.GLITCHTIP_URL.replace(/\/+$/, ''), token: process.env.GLITCHTIP_TOKEN };
  }
  if (!profileName) {
    throw new CliError('No profile selected. Run `glitchtip auth set <name> --url <base-url>` (token on stdin), or set GLITCHTIP_URL and GLITCHTIP_TOKEN.');
  }
  const profile = config.profiles[profileName];
  if (!profile) {
    throw new CliError(`Unknown profile "${profileName}". Known: ${Object.keys(config.profiles).join(', ') || '(none)'}.`);
  }
  const token = process.env.GLITCHTIP_TOKEN || profile.token;
  if (!token) {
    throw new CliError(
      `Profile "${profileName}" has no API token. Create one in the GlitchTip web UI (Profile → Auth Tokens), then run \`glitchtip auth set ${profileName}\` with the token on stdin.`,
    );
  }
  return { ...profile, name: profileName, url: profile.url.replace(/\/+$/, ''), token };
}

export function maskToken(token: string | undefined): string {
  return token ? `…${token.slice(-4)}` : '(none)';
}
