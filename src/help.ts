import { CONFIG_PATH } from './utils/config.js';
import { VERSION } from './utils/version.js';

export const HELP = `glitchtip ${VERSION} — GlitchTip REST API client

Usage: glitchtip [-p <profile>] <command> ...

Issues:
  issues [text]               List issues, newest first (default: unresolved).
         [--status unresolved|resolved|ignored|any] [--project slug] [--env name]
         [--sort -last_seen|-first_seen|-count|-priority] [--since t] [--until t]
         [--limit N] [--cursor c] [--all] [--query q]
  issue <id|url>              Issue summary.
  latest <id|url>             Latest event: message, tags, in-app stack frames. [--all-frames]
  events <id|url>             Events of an issue.
  event <event-id>            One event: --issue <id> or --project <slug>.
  tags <id|url>               Tag breakdown of an issue.
  hashes <id|url>             Grouping hashes of an issue.
  comments <id|url>           List comments.
  comment <id|url> <text|->   Add a comment (text from stdin with "-").

Changes (only on explicit instruction):
  resolve <id|url>...         Mark resolved. [--next-release | --release <version>]
  ignore <id|url>...          Mark ignored.
  reopen <id|url>...          Mark unresolved.
  delete <id|url>... --yes    Delete issues permanently.
  resolve|ignore|reopen|delete --query <q> [--project p] [--env e] --yes
                              Mass change by search. Without --yes it only lists matches.

Org:
  orgs | projects | monitors | monitor <id> | alerts [--project slug]

Logs:
  logs [text] [--level l] [--service s] [--host h] [--trace id] [--env e]
       [--project slug | --project-id N] [--since now-1d] [--until t] [--limit N]
  log <log-id>

Performance (needs DuckDB cold storage on the server):
  txns [text] [--sort -avg_duration|-count|...] [--project slug | --project-id N]
  txn <group-id> [trend|spans] [--since t] [--until t]
  spans [op] [--sort -total_time|-avg_duration|-count]
  n1 [--op db] [--threshold 5]

Raw API:
  api <GET|POST|PUT|PATCH|DELETE> <path> [key=value ...] [--data JSON|@file|-] [--all]
      e.g. glitchtip api GET /organizations/my-org/releases/ limit=5

Profiles (stored in ${CONFIG_PATH}):
  auth set <profile> --url <base> [--org o] [--project p] [--env e] [--token t | token on stdin]
  auth check [profile]        Call the API with the token to prove it works.
  auth status | auth use <profile> | auth logout [profile]
  auth set-defaults [profile] [--org o] [--project p] [--env e]

Global: -p/--profile <name>, --org <slug>, --json (raw API response), -h/--help, -v/--version
Env:    GLITCHTIP_URL + GLITCHTIP_TOKEN (work without any profile), GLITCHTIP_PROFILE,
        GLITCHTIP_ORG, GLITCHTIP_PROJECT, GLITCHTIP_ENV, GLITCHTIP_CONFIG`;
