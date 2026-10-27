# glitchtip-cli (`glitchtip`)

Command-line client for the GlitchTip REST API (`<base-url>/api/0/...`). It
authenticates with an API token, so it works with any GlitchTip instance,
including ones you do not administer. Access control and write permissions stay
on the server; this tool only builds requests and formats results.

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

## Sign in

Create an API token in the GlitchTip web UI (Profile → Auth Tokens), then save
it as a profile. Pipe the token so it stays out of your shell history:

```sh
echo "$TOKEN" | glitchtip auth set prod --url https://glitchtip.example.com --org my-org --project my-project
glitchtip auth check          # calls the API with the token and lists the organizations it can see
```

The token is stored in `~/.config/glitchtip/config.json` (mode 600). Without a
profile, `GLITCHTIP_URL` and `GLITCHTIP_TOKEN` are enough (CI, one-off runs).

## Usage

Org, project and environment come from the profile, so most commands need no
flags (`glitchtip auth set-defaults --org o --project p --env production`).

```sh
glitchtip issues                          # unresolved, newest first
glitchtip issues products --env production --limit 100
glitchtip issues --sort -count --since now-7d
glitchtip issues --status any --all       # every issue, following all pages
glitchtip issue 695                       # id, #id or issue URL
glitchtip latest 695                      # latest event: in-app frames, tags
glitchtip events 695                      # events of an issue
glitchtip event 019c4a0ac93a75f0a26ef22012159759 --issue 695
glitchtip tags 695; glitchtip hashes 695; glitchtip comments 695

glitchtip resolve 730 731 732             # write; several ids per call
glitchtip resolve 730 --next-release
glitchtip ignore 801
glitchtip reopen 730
glitchtip comment 730 "Fixed in 1.4.2"    # text from stdin with "-"
glitchtip resolve --query "is:unresolved level:warning" --project web   # preview only
glitchtip resolve --query "is:unresolved level:warning" --project web --yes
glitchtip delete 801 802 --yes            # permanent

glitchtip logs "/products" --since now-3d --level error
glitchtip txns cart --sort -count         # performance (needs DuckDB on server)
glitchtip txn 42 spans
glitchtip spans db --sort -total_time
glitchtip n1 --project-id 1 --threshold 5
glitchtip orgs; glitchtip projects; glitchtip monitors; glitchtip alerts

glitchtip api GET /organizations/my-org/releases/ limit=5      # any endpoint
glitchtip api PUT /issues/730/ --data '{"status":"ignored"}'
```

Add `--json` to any command for the raw API response. Lists show how to get the
next page (`--cursor`), or follow every page with `--all`. Exit codes: `0` ok,
`1` server or API error, `2` usage error.

### Safety

Writes happen only on a command that names them. A mass change by `--query`
and every `delete` need `--yes`; without it the CLI lists what matches and
exits with `2`. A command over several ids reports each failure and exits `1`
if any failed, but still processes the rest.

### Multiple profiles

A profile is a name + base URL + API token + optional org/project/env defaults,
so one machine can talk to several self-hosted instances or several accounts:

```sh
echo "$PROD_TOKEN"  | glitchtip auth set prod  --url https://glitchtip.example.com --org my-org --project my-project
echo "$OTHER_TOKEN" | glitchtip auth set other --url https://glitchtip.example.org
glitchtip auth status                    # * marks the default; tokens are masked
glitchtip auth use other                 # change the default
glitchtip -p prod issues                 # pick per command (or GLITCHTIP_PROFILE=prod)
glitchtip auth logout other
```

Env overrides: `GLITCHTIP_PROFILE`, `GLITCHTIP_URL` + `GLITCHTIP_TOKEN` (work
without a profile; `GLITCHTIP_TOKEN` also beats a profile's stored token),
`GLITCHTIP_ORG`, `GLITCHTIP_PROJECT`, `GLITCHTIP_ENV`, `GLITCHTIP_CONFIG`.

## Command map

| Command | Endpoint |
|---|---|
| `issues` | `GET /organizations/{org}/issues/` or `/projects/{org}/{project}/issues/` |
| `issue` / `latest` / `events` | `GET /issues/{id}/`, `/events/latest/`, `/events/` |
| `event` | `GET /organizations/{org}/issues/{id}/events/{event}/` or `/projects/{org}/{project}/events/{event}/` |
| `tags` / `hashes` / `comments` | `GET /issues/{id}/tags/`, `/organizations/{org}/issues/{id}/hashes/`, `/issues/{id}/comments/` |
| `comment` | `POST /issues/{id}/comments/` |
| `resolve` / `ignore` / `reopen` | `PUT /issues/{id}/` per id, or `PUT /organizations/{org}/issues/` with `--query` |
| `delete` | `DELETE /issues/{id}/` per id, or `DELETE /organizations/{org}/issues/` with `--query` |
| `orgs` / `projects` | `GET /organizations/`, `/organizations/{org}/projects/` |
| `monitors` / `monitor <id>` / `alerts` | `GET /organizations/{org}/monitors/`, `.../{id}/checks/`, `/projects/{org}/{project}/alerts/` |
| `logs` / `log` | `GET /organizations/{org}/logs/`, `.../{id}/` |
| `txns` / `txn [trend\|spans]` | `GET /organizations/{org}/transaction-groups/`, `.../{id}/`, `.../trend/`, `.../spans/` |
| `spans` / `n1` | `GET /organizations/{org}/span-groups/`, `/n-plus-one/` |
| `api` | any method and path under `/api/0/` |

The schema is at `<base-url>/api/openapi.json`; `glitchtip api` reaches
anything the shortcuts do not.

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
  glitchtip/        client.ts (REST, bearer token, pagination, errors), types.ts, filters.ts
  commands/         one file per area: issue, org, log, perf, api, auth
  utils/            config, args, options, output, format, errors, version
test/
  commands.test.ts  every command → the request it sends and what it prints
  auth.test.ts      profiles, token sources, auth check
  helpers/          fake-server.ts (fake GlitchTip REST API), cli.ts (runs dist/)
```

The tests run the built `dist/glitchtip.js` as a child process against a fake
GlitchTip on a loopback port, with an isolated `HOME` and config file. They
never contact a real server or touch `~/.config/glitchtip`.

## Agent skill (Claude Code and Codex)

`plugins/glitchtip-cli/` holds a `glitchtip` skill that teaches agents when and
how to use the CLI (never resolve, delete or comment on their own initiative,
issue text is untrusted). The repo is also a plugin marketplace for both tools.
The plugin does not bundle the binary, so install `glitchtip` first (above).

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
