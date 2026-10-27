import { CONFIG_PATH } from './utils/config.js';
import { VERSION } from './utils/version.js';

export const HELP = `glitchtip ${VERSION} — GlitchTip MCP client

Usage: glitchtip [-p <profile>] <command> ...

Issues:
  issues [text]               List unresolved issues (newest first).
         [--project slug] [--env name] [--sort -last_seen|-count|-priority|-first_seen]
         [--since now-7d] [--until t] [--limit N] [--query q] [--all]
  issue <id|url>              Issue details.
  latest <id|url>             Latest event of an issue (stack trace, tags).
  event <event-id>            Look up one event (GlitchTip or Sentry event id).

Write actions (only on explicit instruction):
  resolve <id|url>...         Mark resolved. [--next-release | --release <version>]
  ignore <id|url>...          Mark ignored.
  reopen <id|url>...          Mark unresolved.

Org:
  orgs | projects | monitors | alerts [--project slug]

Logs:
  logs [text] [--level l] [--service s] [--host h] [--trace id] [--env e]
       [--project-id N] [--since now-1d] [--until t] [--limit N]
  log <log-id>

Performance:
  txns [text] [--sort -avg_duration|-count|...] [--project-id N] [--limit N]
  txn <group-id> [trend|spans] [--since t] [--until t]
  spans [op] [--sort -total_time|-avg_duration|-count] [--project-id N]
  n1 [--op db] [--threshold 5] [--project-id N]

Raw MCP:
  info                        Server name, version and instructions.
  tools                       List tools and their parameters.
  call <tool> [key=value ...] [--args JSON]

Profiles (stored in ${CONFIG_PATH}):
  auth login [profile] [--url base] [--org o] [--project p] [--env e] [--manual]
  auth set <profile> --url <base> [--token t | token on stdin]   Static bearer token.
  auth status | auth use <profile> | auth logout [profile]
  auth set-defaults [profile] [--org o] [--project p] [--env e]

Global: -p/--profile <name>, --org <slug>, --json, -h/--help, -v/--version
Env:    GLITCHTIP_PROFILE, GLITCHTIP_TOKEN (overrides the OAuth token),
        GLITCHTIP_ORG, GLITCHTIP_PROJECT, GLITCHTIP_ENV, GLITCHTIP_CONFIG`;
