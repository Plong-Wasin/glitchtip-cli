// glitchtip — command-line client for the GlitchTip MCP server.
//
// It speaks MCP's JSON-RPC over HTTP to the same endpoint that Claude uses
// (<base>/mcp) and signs in with the server's OAuth flow (authorization code +
// PKCE, dynamic client registration), so scopes and access control stay on the
// server. This tool is only a client.
//
// Entry point only: parses flags and dispatches to src/commands/*.

import { parseArgs } from 'node:util';
import { OPTIONS, type Opts } from './utils/options.js';
import { CliError } from './utils/errors.js';
import { VERSION } from './utils/version.js';
import { HELP } from './help.js';
import { cmdAuth } from './commands/auth-commands.js';
import { cmdCall, cmdInfo, cmdTools } from './commands/raw-commands.js';
import { cmdEvent, cmdIssue, cmdIssues, cmdLatest, cmdSetStatus } from './commands/issue-commands.js';
import { cmdAlerts, cmdMonitors, cmdOrgs, cmdProjects } from './commands/org-commands.js';
import { cmdLog, cmdLogs } from './commands/log-commands.js';
import { cmdPerf } from './commands/perf-commands.js';

// parseArgs reads `--sort -count` as two flags. Glue a dash-leading value to the
// string option before it (`--sort=-count`) unless it is itself a known flag.
function glueDashValues(argv: string[]): string[] {
  const takesValue = new Set<string>();
  const known = new Set<string>();
  for (const [name, spec] of Object.entries(OPTIONS)) {
    known.add(`--${name}`);
    if ('short' in spec) known.add(`-${spec.short}`);
    if (spec.type === 'string') takesValue.add(`--${name}`); // `-n=5` is not valid for short flags
  }
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = argv[i + 1];
    if (takesValue.has(arg) && next !== undefined && next.startsWith('-') && next.length > 1 && !known.has(next.split('=')[0]!)) {
      out.push(`${arg}=${next}`);
      i++;
    } else {
      out.push(arg);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ args: glueDashValues(process.argv.slice(2)), allowPositionals: true, options: OPTIONS });
  const opts: Opts = values;

  if (opts.version) return console.log(VERSION);
  const [command, sub, ...rest] = positionals;
  if (opts.help || !command || command === 'help') return console.log(HELP);

  const ids = [sub, ...rest].filter((x): x is string => Boolean(x));
  switch (command) {
    case 'issues': return cmdIssues(sub, rest, opts);
    case 'issue': return cmdIssue(sub, opts);
    case 'latest': return cmdLatest(sub, opts);
    case 'event': return cmdEvent(sub, opts);
    case 'resolve': return cmdSetStatus('resolved', ids, opts);
    case 'ignore': return cmdSetStatus('ignored', ids, opts);
    case 'reopen': return cmdSetStatus('unresolved', ids, opts);
    case 'orgs': return cmdOrgs(opts);
    case 'projects': return cmdProjects(opts);
    case 'monitors': return cmdMonitors(opts);
    case 'alerts': return cmdAlerts(opts);
    case 'logs': return cmdLogs(sub, rest, opts);
    case 'log': return cmdLog(sub, opts);
    case 'txns':
    case 'txn':
    case 'spans':
    case 'n1': return cmdPerf(command, sub, rest, opts);
    case 'info': return cmdInfo(opts);
    case 'tools': return cmdTools(opts);
    case 'call': return cmdCall(sub, rest, opts);
    case 'auth': return cmdAuth(sub, rest, opts);
    default: throw new CliError(`Unknown command "${command}". Run \`glitchtip --help\`.`, 2);
  }
}

main().catch((error: unknown) => {
  if (error instanceof CliError) {
    console.error(`glitchtip: ${error.message}`);
    process.exit(error.exitCode);
  }
  const code = (error as { code?: unknown })?.code;
  if (typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS')) {
    console.error(`glitchtip: ${(error as Error).message}`);
    process.exit(2);
  }
  console.error(error);
  process.exit(1);
});
