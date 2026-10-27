import { CONFIG_PATH, loadConfig, maskToken, saveConfig } from '../utils/config.js';
import { CliError } from '../utils/errors.js';
import { readStdin, requireArg } from '../utils/args.js';
import { oauthLogin } from '../auth/oauth.js';
import type { Opts } from '../utils/options.js';

const normalizeUrl = (url: string) => url.replace(/\/+$/, '').replace(/\/mcp$/, '');

export async function cmdAuth(sub: string | undefined, rest: string[], opts: Opts): Promise<void> {
  const config = loadConfig();
  switch (sub) {
    case 'login': {
      const name = rest[0] ?? 'default';
      const existing = config.profiles[name];
      const rawUrl = opts.url ?? existing?.url;
      if (!rawUrl) throw new CliError('--url is required for a new profile (e.g. https://glitchtip.example.com).', 2);
      const url = normalizeUrl(rawUrl);
      const oauth = await oauthLogin(url, Boolean(opts.manual));
      config.profiles[name] = {
        ...existing,
        url,
        org: opts.org ?? existing?.org,
        project: opts.project ?? existing?.project,
        environment: opts.env ?? existing?.environment,
        token: undefined, // signing in via OAuth replaces any static token
        oauth,
      };
      config.defaultProfile ??= name;
      saveConfig(config);
      console.log(`Signed in as profile "${name}" → ${url}  ${maskToken(oauth.accessToken)}  (${CONFIG_PATH})`);
      return;
    }
    case 'set': {
      const name = requireArg(rest[0], 'glitchtip auth set <profile> --url <base-url> [--token <token> | token on stdin]');
      const existing = config.profiles[name];
      const url = opts.url ?? existing?.url;
      if (!url) throw new CliError('--url is required for a new profile (e.g. https://glitchtip.example.com).', 2);
      let token = opts.token ?? existing?.token;
      if (!opts.token && !process.stdin.isTTY) token = readStdin().trim();
      if (!token) throw new CliError('Pass --token or pipe the token on stdin.', 2);
      config.profiles[name] = {
        ...existing,
        url: normalizeUrl(url),
        org: opts.org ?? existing?.org,
        project: opts.project ?? existing?.project,
        environment: opts.env ?? existing?.environment,
        token: token.replace(/^Bearer\s+/i, ''),
        oauth: undefined,
      };
      config.defaultProfile ??= name;
      saveConfig(config);
      console.log(`Saved profile "${name}" → ${CONFIG_PATH}`);
      return;
    }
    case 'set-defaults': {
      const name = rest[0] ?? config.defaultProfile;
      const profile = name ? config.profiles[name] : undefined;
      if (!name || !profile) throw new CliError('No such profile. Run `glitchtip auth login` first.');
      if (opts.org !== undefined) profile.org = opts.org;
      if (opts.project !== undefined) profile.project = opts.project;
      if (opts.env !== undefined) profile.environment = opts.env;
      saveConfig(config);
      console.log(`Profile "${name}": org=${profile.org ?? '-'} project=${profile.project ?? '-'} env=${profile.environment ?? '-'}`);
      return;
    }
    case 'use': {
      const name = requireArg(rest[0], 'glitchtip auth use <profile>');
      if (!config.profiles[name]) throw new CliError(`Unknown profile "${name}".`);
      config.defaultProfile = name;
      saveConfig(config);
      console.log(`Default profile: ${name}`);
      return;
    }
    case 'logout':
    case 'remove': {
      const name = requireArg(rest[0] ?? config.defaultProfile ?? undefined, 'glitchtip auth logout <profile>');
      delete config.profiles[name];
      if (config.defaultProfile === name) config.defaultProfile = Object.keys(config.profiles)[0] ?? null;
      saveConfig(config);
      console.log(`Removed profile "${name}".`);
      return;
    }
    case 'status':
    case undefined: {
      const names = Object.keys(config.profiles);
      if (names.length === 0) return console.log(`No profiles in ${CONFIG_PATH}. Run \`glitchtip auth login\`.`);
      for (const name of names) {
        const p = config.profiles[name]!;
        const scope = [p.org, p.project, p.environment].filter(Boolean).join('/');
        const kind = p.token ? 'token' : p.oauth ? 'oauth' : 'none';
        console.log(`${name === config.defaultProfile ? '*' : ' '} ${name.padEnd(10)} ${p.url}  ${kind} ${maskToken(p.token ?? p.oauth?.accessToken)}${scope ? `  [${scope}]` : ''}`);
      }
      return;
    }
    default:
      throw new CliError(`Unknown auth command "${sub}". Try: login, set, set-defaults, use, logout, status.`, 2);
  }
}
