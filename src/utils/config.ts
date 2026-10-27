import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { CliError } from './errors.js';

export const CONFIG_PATH = process.env.GLITCHTIP_CONFIG || join(homedir(), '.config', 'glitchtip', 'config.json');

export interface OAuthState {
  clientId: string;
  clientSecret?: string;
  tokenEndpoint: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // epoch seconds
}

export interface StoredProfile {
  url: string;
  token?: string; // static bearer token; takes precedence over oauth
  org?: string;
  project?: string;
  environment?: string;
  oauth?: OAuthState;
}

export interface Config {
  defaultProfile: string | null;
  profiles: Record<string, StoredProfile>;
}

export interface Profile extends StoredProfile {
  name: string;
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
  if (!profileName) throw new CliError('No profile selected. Run `glitchtip auth login`.');
  const profile = config.profiles[profileName];
  if (!profile) {
    throw new CliError(`Unknown profile "${profileName}". Known: ${Object.keys(config.profiles).join(', ') || '(none)'}.`);
  }
  return { ...profile, name: profileName, url: profile.url.replace(/\/+$/, '') };
}

export function maskToken(token: string | undefined): string {
  return token ? `…${token.slice(-4)}` : '(none)';
}
