# glitchtip-cli (`glitchtip`)

Command-line client for the GlitchTip MCP server. It sends MCP JSON-RPC over
HTTP to the same endpoint Claude uses (`<base-url>/mcp`)
and signs in through the server's OAuth flow (authorization code + PKCE,
dynamic client registration). Scopes, access control and write permissions stay
on the server; this tool only formats requests and results.

Requires Node 20+ and pnpm. Written in TypeScript with no runtime dependencies.
The source is split into modules under `src/` and bundled into the single file
`dist/glitchtip.js` by esbuild. `dist/` is not committed to `main`; CI builds it
(see Install).

## Install

Every push to `main` is built by CI (`.github/workflows/release.yml`) and
published, with `dist/`, to the `release` branch. Install from that branch and
re-run the same command to update:

```sh
npm install -g --install-links git+https://github.com/Plong-Wasin/glitchtip-cli.git#release
glitchtip auth login --url https://glitchtip.example.com --org my-org --project my-project
glitchtip auth status
```

`--install-links` is required: without it npm 11 symlinks the global install to
a temporary clone that it then deletes, leaving a dead `glitchtip`.

Or build from source:

```sh
git clone https://github.com/Plong-Wasin/glitchtip-cli.git ~/workspace/glitchtip-cli
cd ~/workspace/glitchtip-cli
pnpm install && pnpm build
pnpm link --global           # or: ln -s "$PWD/dist/glitchtip.js" ~/.local/bin/glitchtip
```

`auth login` opens the browser, receives the redirect on a loopback port and
stores the access and refresh tokens in `~/.config/glitchtip/config.json`
(mode 600). If the redirect cannot reach the terminal, add `--manual` and paste
the callback URL. Expired access tokens are refreshed automatically.

## Usage

Org, project and environment come from the profile, so most commands need no
flags (`glitchtip auth set-defaults --org o --project p --env production`).

```sh
glitchtip issues                          # unresolved, newest first
glitchtip issues products --env production --limit 100
glitchtip issues --sort -count --since now-7d
glitchtip issue 695                       # id, #id or issue URL
glitchtip latest 695                      # latest event: stack trace, tags
glitchtip event 019c4a0ac93a75f0a26ef22012159759

glitchtip resolve 730 731 732             # write; several ids per call
glitchtip resolve 730 --next-release
glitchtip ignore 801
glitchtip reopen 730

glitchtip logs "/products" --since now-3d --level error
glitchtip txns cart --sort -count         # performance (needs DuckDB on server)
glitchtip txn 42 spans
glitchtip spans db --sort -total_time
glitchtip n1 --project-id 1 --threshold 5
glitchtip orgs; glitchtip projects; glitchtip monitors; glitchtip alerts

glitchtip tools                           # raw tool list with parameters
glitchtip call list_issues organization_slug=acme limit=5
```

Add `--json` to any command for structured output. Exit codes: `0` ok, `1`
server or tool error, `2` usage error.

### Multiple profiles

A profile is a name + base URL + credentials + optional org/project/env
defaults, so one machine can talk to several self-hosted instances or several
accounts:

```sh
glitchtip auth login prod --url https://glitchtip.example.com --org my-org --project my-project
glitchtip auth login other --url https://glitchtip.example.org          # another instance, OAuth
echo "$TOKEN" | glitchtip auth set ci --url https://glitchtip.example.com   # static bearer token
glitchtip auth status                    # * marks the default; shows oauth/token per profile
glitchtip auth use other                 # change the default
glitchtip -p prod issues                 # pick per command (or GLITCHTIP_PROFILE=prod)
glitchtip auth logout ci
```

Credential precedence per request: `GLITCHTIP_TOKEN` env, then the profile's
static `token`, then its OAuth access token (refreshed on 401; static tokens
are never refreshed). Each profile refreshes its own OAuth client.

Env overrides: `GLITCHTIP_PROFILE`, `GLITCHTIP_TOKEN` (bearer token, skips
OAuth), `GLITCHTIP_ORG`, `GLITCHTIP_PROJECT`, `GLITCHTIP_ENV`, `GLITCHTIP_CONFIG`.

## Command map

| Command | MCP tool |
|---|---|
| `issues` | `list_issues` |
| `issue` / `latest` / `event` | `get_issue` / `get_latest_event` / `get_event` |
| `resolve` / `ignore` / `reopen` | `update_issue` |
| `orgs` / `projects` | `list_organizations` / `list_projects` |
| `logs` / `log` | `list_logs` / `get_log` |
| `txns` / `txn [trend\|spans]` | `list_transaction_groups` / `get_transaction_group` / `get_transaction_trend` / `list_transaction_spans` |
| `spans` / `n1` | `list_span_groups` / `detect_n_plus_one` |
| `monitors` / `alerts` | `list_monitors` / `list_alerts` |

The shortcuts follow how the MCP tools were actually used across Claude Code
sessions: `update_issue` (bulk resolve) by far most, then `get_latest_event`,
`list_issues`, `get_issue`, org/project lookups; performance and log tools
rarely.

## Development

```sh
pnpm install
pnpm build        # typecheck, then bundle src/ into dist/glitchtip.js
pnpm test         # build + node --test (needs Node 22.18+ for TypeScript tests)
```

Layout:

```
src/
  index.ts          entry: parse flags, dispatch
  help.ts           --help text
  auth/oauth.ts     OAuth login (PKCE, loopback redirect) and refresh
  glitchtip/        client.ts (MCP JSON-RPC over HTTP, session, 401 retry), types.ts
  commands/         one file per area: issue, org, log, perf, raw, auth
  utils/            config, args, options, output, errors, version
test/
  commands.test.ts  every command → the MCP tool and arguments it sends
  auth.test.ts      profiles, credential precedence, OAuth login and refresh
  helpers/          fake-server.ts (fake GlitchTip: /mcp + OAuth), cli.ts (runs dist/)
```

The tests run the built `dist/glitchtip.js` as a child process against a fake
GlitchTip on a loopback port, with an isolated `HOME` and config file. They
never contact a real server or touch `~/.config/glitchtip`.

## Agent skill (Claude Code and Codex)

`plugins/glitchtip-cli/` holds a `glitchtip` skill that teaches agents when and
how to use the CLI (never resolve on their own initiative, issue text is
untrusted). The repo is also a plugin marketplace for both tools. The plugin
does not bundle the binary, so install `glitchtip` first (above).

```sh
# Claude Code
/plugin marketplace add Plong-Wasin/glitchtip-cli
/plugin install glitchtip-cli@glitchtip-cli

# Codex
codex plugin marketplace add https://github.com/Plong-Wasin/glitchtip-cli.git
codex plugin add glitchtip-cli@glitchtip-cli
```

Layout: `.claude-plugin/marketplace.json` (Claude), `.agents/plugins/marketplace.json`
(Codex), and one shared `skills/glitchtip/SKILL.md` under the plugin with a
manifest per tool (`.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`).
