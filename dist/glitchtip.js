#!/usr/bin/env node

// src/index.ts
import { parseArgs } from "node:util";

// src/utils/options.ts
var OPTIONS = {
  profile: { type: "string", short: "p" },
  org: { type: "string" },
  project: { type: "string" },
  "project-id": { type: "string" },
  env: { type: "string", short: "e" },
  issue: { type: "string" },
  json: { type: "boolean" },
  all: { type: "boolean" },
  status: { type: "string" },
  query: { type: "string", short: "q" },
  sort: { type: "string" },
  since: { type: "string" },
  until: { type: "string" },
  limit: { type: "string", short: "n" },
  cursor: { type: "string" },
  level: { type: "string" },
  service: { type: "string" },
  host: { type: "string" },
  trace: { type: "string" },
  op: { type: "string" },
  threshold: { type: "string" },
  "next-release": { type: "boolean" },
  release: { type: "string" },
  "all-frames": { type: "boolean" },
  yes: { type: "boolean" },
  data: { type: "string", short: "d" },
  url: { type: "string" },
  token: { type: "string" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" }
};

// src/utils/errors.ts
var CliError = class extends Error {
  exitCode;
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
};

// package.json
var package_default = {
  name: "glitchtip-cli",
  version: "0.2.0",
  description: "Command-line client for the GlitchTip REST API (issues, events, logs, performance)",
  type: "module",
  bin: {
    glitchtip: "./dist/glitchtip.js"
  },
  scripts: {
    typecheck: "tsc --noEmit && tsc --noEmit -p tsconfig.test.json",
    build: 'pnpm typecheck && esbuild src/index.ts --bundle --platform=node --target=node20 --format=esm --banner:js="#!/usr/bin/env node" --outfile=dist/glitchtip.js && chmod +x dist/glitchtip.js',
    test: 'pnpm build && node --test "test/*.test.ts"'
  },
  engines: {
    node: ">=20"
  },
  devDependencies: {
    "@types/node": "^20.19.0",
    esbuild: "^0.28.2",
    typescript: "^7.0.2"
  },
  private: true,
  license: "MIT",
  packageManager: "pnpm@12.3.4"
};

// src/utils/version.ts
var VERSION = package_default.version;

// src/utils/config.ts
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
var CONFIG_PATH = process.env.GLITCHTIP_CONFIG || join(homedir(), ".config", "glitchtip", "config.json");
function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return { defaultProfile: null, profiles: {} };
  const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  config.profiles ??= {};
  return config;
}
function saveConfig(config) {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true, mode: 448 });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", { mode: 384 });
  chmodSync(CONFIG_PATH, 384);
}
function resolveProfile(name) {
  const config = loadConfig();
  const profileName = name || process.env.GLITCHTIP_PROFILE || config.defaultProfile;
  if (!profileName && process.env.GLITCHTIP_URL && process.env.GLITCHTIP_TOKEN) {
    return { name: "env", url: process.env.GLITCHTIP_URL.replace(/\/+$/, ""), token: process.env.GLITCHTIP_TOKEN };
  }
  if (!profileName) {
    throw new CliError("No profile selected. Run `glitchtip auth set <name> --url <base-url>` (token on stdin), or set GLITCHTIP_URL and GLITCHTIP_TOKEN.");
  }
  const profile = config.profiles[profileName];
  if (!profile) {
    throw new CliError(`Unknown profile "${profileName}". Known: ${Object.keys(config.profiles).join(", ") || "(none)"}.`);
  }
  const token = process.env.GLITCHTIP_TOKEN || profile.token;
  if (!token) {
    throw new CliError(
      `Profile "${profileName}" has no API token. Create one in the GlitchTip web UI (Profile \u2192 Auth Tokens), then run \`glitchtip auth set ${profileName}\` with the token on stdin.`
    );
  }
  return { ...profile, name: profileName, url: profile.url.replace(/\/+$/, ""), token };
}
function maskToken(token) {
  return token ? `\u2026${token.slice(-4)}` : "(none)";
}

// src/help.ts
var HELP = `glitchtip ${VERSION} \u2014 GlitchTip REST API client

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

// src/commands/api-commands.ts
import { readFileSync as readFileSync3 } from "node:fs";

// src/glitchtip/client.ts
var MAX_PAGES = 50;
function buildUrl(profile, path, query = {}) {
  const url = new URL(profile.url + path);
  for (const [key, value] of Object.entries(query)) {
    if (value === void 0 || value === null || value === "") continue;
    for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(item));
  }
  return url.toString();
}
function nextCursor(link) {
  if (!link) return void 0;
  for (const part of link.split(/,\s*(?=<)/)) {
    if (!/rel="next"/.test(part)) continue;
    if (/results="false"/.test(part)) return void 0;
    const match = /cursor="([^"]+)"/.exec(part) ?? /[?&]cursor=([^&>]+)/.exec(part);
    return match ? decodeURIComponent(match[1]) : void 0;
  }
  return void 0;
}
function errorDetail(body) {
  try {
    const parsed = JSON.parse(body);
    const detail = parsed.detail ?? parsed.message;
    if (typeof detail === "string") return detail.replace(/\.+$/, "");
    return JSON.stringify(parsed).slice(0, 500);
  } catch {
    return body.slice(0, 300);
  }
}
async function api(profile, method, path, options = {}) {
  const url = buildUrl(profile, path, options.query);
  const headers = {
    Authorization: `Bearer ${profile.token}`,
    Accept: "application/json",
    "User-Agent": `glitchtip-cli/${VERSION}`
  };
  if (options.body !== void 0) headers["Content-Type"] = "application/json";
  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: options.body === void 0 ? void 0 : JSON.stringify(options.body)
    });
  } catch (error) {
    const cause = error instanceof Error ? error.cause : void 0;
    throw new CliError(`Cannot reach ${url}: ${cause?.message || error.message}`);
  }
  const text = await response.text();
  if (!response.ok) {
    const detail = errorDetail(text);
    switch (response.status) {
      case 401:
        throw new CliError(`401 Unauthorized for profile "${profile.name}" (${profile.url}): ${detail}. Check the API token (\`glitchtip auth check\`).`);
      case 403:
        throw new CliError(`403 Forbidden: ${detail}. The token may lack a scope for ${method} ${path}.`);
      case 404:
        throw new CliError(`404 Not found: ${method} ${path} (${detail}).`);
      case 429: {
        const retry = response.headers.get("retry-after");
        throw new CliError(`429 Too Many Requests.${retry ? ` Retry after ${retry}s.` : ""}`);
      }
      default:
        throw new CliError(`HTTP ${response.status} for ${method} ${path}: ${detail}`);
    }
  }
  const data = text ? JSON.parse(text) : null;
  return { data, next: nextCursor(response.headers.get("link")) };
}
async function list(profile, path, query, options = {}) {
  const items = [];
  let cursor = typeof query.cursor === "string" ? query.cursor : void 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const result = await api(profile, "GET", path, { query: { ...query, cursor } });
    items.push(...Array.isArray(result.data) ? result.data : []);
    cursor = result.next;
    if (!options.all || !cursor) break;
  }
  return { items, next: cursor };
}
async function projectId(profile, org, slug) {
  const { data } = await api(profile, "GET", `/api/0/projects/${org}/${slug}/`);
  return Number(data.id);
}

// src/utils/args.ts
import { readFileSync as readFileSync2 } from "node:fs";
function readStdin() {
  return readFileSync2(0, "utf8");
}
function parsePairs(pairs) {
  const result = {};
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq < 1) throw new CliError(`Expected key=value, got "${pair}".`, 2);
    result[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return result;
}
function requireArg(value, usage) {
  if (value === void 0 || value === "") throw new CliError(`Usage: ${usage}`, 2);
  return value;
}
function toInt(value, name) {
  if (value === void 0) return void 0;
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) throw new CliError(`--${name} must be an integer.`, 2);
  return n;
}
function toId(raw, usage) {
  const text = requireArg(raw, usage);
  const match = /^#?(\d+)$/.exec(text) ?? /\/issues\/(\d+)\/?(?:[?#].*)?$/.exec(text);
  if (!match) throw new CliError(`"${text}" is not an id or issue URL. Usage: ${usage}`, 2);
  return Number(match[1]);
}
function requireOrg(profile, opts) {
  const org = opts.org || process.env.GLITCHTIP_ORG || profile.org;
  if (!org) throw new CliError("No organization. Pass --org, or save one: `glitchtip auth set-defaults --org <slug>`.", 2);
  return org;
}
function projectSlug(profile, opts) {
  return opts.project || process.env.GLITCHTIP_PROJECT || profile.project;
}
function environment(profile, opts) {
  return opts.env || process.env.GLITCHTIP_ENV || profile.environment;
}

// src/utils/output.ts
function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}
function cell(value) {
  if (value === null || value === void 0) return "-";
  return (typeof value === "object" ? JSON.stringify(value) : String(value)).replace(/\s+/g, " ");
}
function truncate(text, max) {
  const chars = [...text];
  return max && chars.length > max ? chars.slice(0, max - 1).join("") + "\u2026" : text;
}
var width = (text) => [...text].length;
function printTable(rows, columns) {
  const cells = rows.map((row) => columns.map((c) => truncate(cell(c.get(row)), c.max)));
  const widths = columns.map((c, i) => Math.max(width(c.header), ...cells.map((r) => width(r[i]))));
  const line = (values) => values.map((v, i) => v + " ".repeat(widths[i] - width(v))).join("  ").trimEnd();
  console.log(line(columns.map((c) => c.header)));
  for (const row of cells) console.log(line(row));
}
function printFields(fields) {
  const shown = fields.filter(([, v]) => v !== void 0 && v !== null && v !== "");
  const pad = Math.max(0, ...shown.map(([k]) => k.length));
  for (const [key, value] of shown) console.log(`${(key + ":").padEnd(pad + 2)}${cell(value)}`);
}
function shortDate(iso) {
  return typeof iso === "string" ? iso.replace("T", " ").slice(0, 16) : "-";
}
function pageFooter(count, noun, next) {
  console.error(`
${count} ${noun}${next ? ` shown; more available: --cursor ${next}  (or --all)` : ""}`);
}

// src/commands/api-commands.ts
var METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
function normalizePath(path) {
  if (path.startsWith("/api/")) return path;
  return `/api/0/${path.replace(/^\/+/, "")}`;
}
function readBody(data) {
  const text = data === "-" ? readStdin() : data.startsWith("@") ? readFileSync3(data.slice(1), "utf8") : data;
  try {
    return JSON.parse(text);
  } catch {
    throw new CliError("--data must be valid JSON (or - for stdin, or @file).", 2);
  }
}
async function cmdApi(method, path, pairs, opts) {
  const usage = "glitchtip api <GET|POST|PUT|PATCH|DELETE> <path> [key=value ...] [--data JSON|@file|-] [--all]";
  const verb = requireArg(method, usage).toUpperCase();
  if (!METHODS.includes(verb)) throw new CliError(`Method must be one of: ${METHODS.join(", ")}.`, 2);
  const target = normalizePath(requireArg(path, usage));
  const query = parsePairs(pairs);
  const profile = resolveProfile(opts.profile);
  if (verb === "GET" && opts.all) {
    return printJson((await list(profile, target, query, { all: true })).items);
  }
  const { data, next } = await api(profile, verb, target, {
    query,
    body: opts.data === void 0 ? void 0 : readBody(opts.data)
  });
  if (data !== null && data !== void 0) printJson(data);
  if (next) console.error(`more: --cursor ${next}  (or --all)`);
}

// src/commands/auth-commands.ts
var normalizeUrl = (url) => url.replace(/\/+$/, "").replace(/\/(api(\/0)?|mcp)$/, "");
async function cmdAuth(sub, rest, opts) {
  const config = loadConfig();
  switch (sub) {
    case "set": {
      const name = requireArg(rest[0], "glitchtip auth set <profile> --url <base-url> [--token <token> | token on stdin]");
      const existing = config.profiles[name];
      const url = opts.url ?? existing?.url;
      if (!url) throw new CliError("--url is required for a new profile (e.g. https://glitchtip.example.com).", 2);
      let token = opts.token ?? existing?.token;
      if (!opts.token && !process.stdin.isTTY) token = readStdin().trim() || token;
      if (!token) throw new CliError("Pass --token or pipe the API token on stdin.", 2);
      config.profiles[name] = {
        ...existing,
        url: normalizeUrl(url),
        org: opts.org ?? existing?.org,
        project: opts.project ?? existing?.project,
        environment: opts.env ?? existing?.environment,
        token: token.replace(/^Bearer\s+/i, "")
      };
      config.defaultProfile ??= name;
      saveConfig(config);
      console.log(`Saved profile "${name}" \u2192 ${CONFIG_PATH}`);
      return;
    }
    case "check": {
      const profile = resolveProfile(rest[0] ?? opts.profile);
      const { data } = await api(profile, "GET", "/api/0/organizations/", { query: { limit: 100 } });
      console.log(`OK: profile "${profile.name}" (${profile.url}) can see ${data.length} organization(s): ${data.map((o) => o.slug).join(", ") || "(none)"}`);
      return;
    }
    case "set-defaults": {
      const name = rest[0] ?? config.defaultProfile;
      const profile = name ? config.profiles[name] : void 0;
      if (!name || !profile) throw new CliError("No such profile. Run `glitchtip auth set` first.");
      if (opts.org !== void 0) profile.org = opts.org;
      if (opts.project !== void 0) profile.project = opts.project;
      if (opts.env !== void 0) profile.environment = opts.env;
      saveConfig(config);
      console.log(`Profile "${name}": org=${profile.org ?? "-"} project=${profile.project ?? "-"} env=${profile.environment ?? "-"}`);
      return;
    }
    case "use": {
      const name = requireArg(rest[0], "glitchtip auth use <profile>");
      if (!config.profiles[name]) throw new CliError(`Unknown profile "${name}".`);
      config.defaultProfile = name;
      saveConfig(config);
      console.log(`Default profile: ${name}`);
      return;
    }
    case "logout":
    case "remove": {
      const name = requireArg(rest[0] ?? config.defaultProfile ?? void 0, "glitchtip auth logout <profile>");
      delete config.profiles[name];
      if (config.defaultProfile === name) config.defaultProfile = Object.keys(config.profiles)[0] ?? null;
      saveConfig(config);
      console.log(`Removed profile "${name}".`);
      return;
    }
    case "login":
      throw new CliError("Browser login was removed: the CLI uses the REST API with an API token. Create one in the GlitchTip web UI (Profile \u2192 Auth Tokens), then run `glitchtip auth set <profile> --url <base-url>` with the token on stdin.", 2);
    case "status":
    case void 0: {
      const names = Object.keys(config.profiles);
      if (names.length === 0) return console.log(`No profiles in ${CONFIG_PATH}. Run \`glitchtip auth set <name> --url <base-url>\`.`);
      for (const name of names) {
        const p = config.profiles[name];
        const scope = [p.org, p.project, p.environment].filter(Boolean).join("/");
        console.log(`${name === config.defaultProfile ? "*" : " "} ${name.padEnd(10)} ${p.url}  token ${maskToken(p.token)}${scope ? `  [${scope}]` : ""}`);
      }
      return;
    }
    default:
      throw new CliError(`Unknown auth command "${sub}". Try: set, check, set-defaults, use, logout, status.`, 2);
  }
}

// src/utils/format.ts
function printIssue(issue) {
  printFields([
    ["Issue", `#${issue.id}  ${issue.shortId}`],
    ["Title", issue.title],
    ["Culprit", issue.culprit],
    ["Status", `${issue.status}  (${issue.level})`],
    ["Project", issue.project.slug ?? issue.project.name],
    ["Events", `${issue.count} events, ${issue.userCount ?? 0} users, ${issue.numComments} comments`],
    ["First seen", `${shortDate(issue.firstSeen)}${issue.firstRelease?.version ? `  in ${issue.firstRelease.version}` : ""}`],
    ["Last seen", `${shortDate(issue.lastSeen)}${issue.lastRelease?.version ? `  in ${issue.lastRelease.version}` : ""}`],
    ["URL", issue.permalink]
  ]);
}
function printFrame(frame) {
  const where = `${frame.absPath ?? frame.filename ?? frame.module ?? "?"}${frame.lineNo ? `:${frame.lineNo}` : ""}`;
  console.log(`  ${frame.inApp ? "*" : " "} ${where}${frame.function ? ` in ${frame.function}` : ""}`);
  const code = frame.context?.find(([line]) => line === frame.lineNo)?.[1];
  if (code !== void 0) console.log(`        > ${code.trim()}`);
}
function printException(value, allFrames) {
  console.log(`
Exception: ${value.type ?? "Error"}: ${value.value ?? ""}`);
  const frames = value.stacktrace?.frames ?? [];
  if (frames.length === 0) return;
  const app = frames.filter((frame) => frame.inApp);
  const shown = allFrames ? frames : app.length > 0 ? app : frames.slice(-5);
  const hidden = frames.length - shown.length;
  console.log(`  (most recent call last; * = in-app${hidden > 0 ? `; ${hidden} other frame(s) hidden, --all-frames shows them` : ""})`);
  for (const frame of shown) printFrame(frame);
}
function printEvent(event, options = {}) {
  printFields([
    ["Title", event.title],
    ["Event", `${event.eventID}  ${shortDate(event.dateCreated)}${event.platform ? `  ${event.platform}` : ""}`],
    ["Issue", `#${event.groupID}`],
    ["Message", event.message && event.message !== event.title ? event.message : void 0],
    ["User", event.user ? [event.user.email, event.user.username, event.user.id, event.user.ip_address].filter(Boolean).join(" ") : void 0],
    ["Tags", event.tags?.length ? event.tags.map((t) => `${t.key}=${t.value}`).join("  ") : void 0]
  ]);
  for (const entry of event.entries ?? []) {
    if (entry.type === "exception") {
      const values = entry.data?.values ?? [];
      for (const value of values) printException(value, Boolean(options.allFrames));
    } else if (entry.type === "request") {
      const request = entry.data;
      if (request?.url) console.log(`
Request: ${request.method ?? ""} ${request.url}`.replace("  ", " "));
    }
  }
}

// src/commands/issue-commands.ts
var STATUSES = ["unresolved", "resolved", "ignored", "any"];
async function cmdIssues(sub, rest, opts) {
  const profile = resolveProfile(opts.profile);
  const org = requireOrg(profile, opts);
  const slug = projectSlug(profile, opts);
  const status = opts.status ?? "unresolved";
  if (!STATUSES.includes(status)) throw new CliError(`--status must be one of: ${STATUSES.join(", ")}.`, 2);
  const text = opts.query ?? ([sub, ...rest].filter(Boolean).join(" ") || void 0);
  const query = [status === "any" ? void 0 : `is:${status}`, text].filter(Boolean).join(" ");
  const path = slug ? `/api/0/projects/${org}/${slug}/issues/` : `/api/0/organizations/${org}/issues/`;
  const { items, next } = await list(profile, path, {
    query: query || void 0,
    environment: environment(profile, opts),
    sort: opts.sort,
    start: opts.since,
    end: opts.until,
    limit: toInt(opts.limit, "limit") ?? 25,
    cursor: opts.cursor
  }, { all: opts.all });
  if (opts.json) return printJson(items);
  printTable(items, [
    { header: "ID", get: (i) => i.id },
    { header: "STATUS", get: (i) => i.status },
    { header: "LEVEL", get: (i) => i.level },
    { header: "COUNT", get: (i) => i.count },
    { header: "LAST SEEN", get: (i) => shortDate(i.lastSeen) },
    { header: "PROJECT", get: (i) => i.project.slug ?? i.project.name },
    { header: "TITLE", get: (i) => i.title, max: 80 }
  ]);
  pageFooter(items.length, "issue(s)", next);
}
async function cmdIssue(sub, opts) {
  const profile = resolveProfile(opts.profile);
  const id = toId(sub, "glitchtip issue <id|url>");
  const { data } = await api(profile, "GET", `/api/0/issues/${id}/`);
  if (opts.json) return printJson(data);
  printIssue(data);
}
async function cmdLatest(sub, opts) {
  const profile = resolveProfile(opts.profile);
  const id = toId(sub, "glitchtip latest <issue-id|url>");
  const { data } = await api(profile, "GET", `/api/0/issues/${id}/events/latest/`);
  if (opts.json) return printJson(data);
  printEvent(data, { allFrames: opts["all-frames"] });
}
async function cmdEvents(sub, opts) {
  const profile = resolveProfile(opts.profile);
  const id = toId(sub, "glitchtip events <issue-id|url>");
  const { items, next } = await list(profile, `/api/0/issues/${id}/events/`, {
    limit: toInt(opts.limit, "limit") ?? 25,
    cursor: opts.cursor
  }, { all: opts.all });
  if (opts.json) return printJson(items);
  printTable(items, [
    { header: "EVENT", get: (e) => e.eventID },
    { header: "DATE", get: (e) => shortDate(e.dateCreated) },
    { header: "TITLE", get: (e) => e.title, max: 80 }
  ]);
  pageFooter(items.length, "event(s)", next);
}
async function cmdEvent(sub, opts) {
  const profile = resolveProfile(opts.profile);
  const eventId = requireArg(sub, "glitchtip event <event-id> [--issue <id> | --project <slug>]");
  const org = requireOrg(profile, opts);
  let path;
  if (opts.issue) {
    path = `/api/0/organizations/${org}/issues/${toId(opts.issue, "glitchtip event <event-id> --issue <id>")}/events/${eventId}/`;
  } else {
    const slug = projectSlug(profile, opts);
    if (!slug) throw new CliError("An event is looked up through its project or issue: pass --project <slug> or --issue <id>.", 2);
    path = `/api/0/projects/${org}/${slug}/events/${eventId}/`;
  }
  const { data } = await api(profile, "GET", path);
  if (opts.json) return printJson(data);
  printEvent(data, { allFrames: opts["all-frames"] });
}
async function cmdTags(sub, opts) {
  const profile = resolveProfile(opts.profile);
  const id = toId(sub, "glitchtip tags <issue-id|url>");
  const { data } = await api(profile, "GET", `/api/0/issues/${id}/tags/`);
  if (opts.json) return printJson(data);
  printTable(data, [
    { header: "TAG", get: (t) => t.key },
    { header: "VALUES", get: (t) => `${t.uniqueValues} unique / ${t.totalValues}` },
    { header: "TOP", get: (t) => t.topValues.slice(0, 3).map((v) => `${v.value} (${v.count})`).join(", "), max: 90 }
  ]);
}
async function cmdHashes(sub, opts) {
  const profile = resolveProfile(opts.profile);
  const org = requireOrg(profile, opts);
  const id = toId(sub, "glitchtip hashes <issue-id|url>");
  const { data } = await api(profile, "GET", `/api/0/organizations/${org}/issues/${id}/hashes/`);
  if (opts.json) return printJson(data);
  printTable(data, [
    { header: "HASH", get: (h) => h.id },
    { header: "LATEST EVENT", get: (h) => h.latestEvent?.eventID },
    { header: "DATE", get: (h) => shortDate(h.latestEvent?.dateCreated) }
  ]);
}
async function cmdComments(sub, opts) {
  const profile = resolveProfile(opts.profile);
  const id = toId(sub, "glitchtip comments <issue-id|url>");
  const { data } = await api(profile, "GET", `/api/0/issues/${id}/comments/`);
  if (opts.json) return printJson(data);
  for (const comment of data) {
    const who = comment.user?.name || comment.user?.username || comment.user?.email || "unknown";
    console.log(`${shortDate(comment.dateCreated)}  ${who}
  ${(comment.data.text ?? "").replace(/\n/g, "\n  ")}
`);
  }
}
async function cmdComment(sub, rest, opts) {
  const profile = resolveProfile(opts.profile);
  const usage = "glitchtip comment <issue-id|url> <text | ->";
  const id = toId(sub, usage);
  const text = (rest[0] === "-" ? readStdin() : rest.join(" ")).trim();
  if (!text) throw new CliError(`Usage: ${usage}`, 2);
  const { data } = await api(profile, "POST", `/api/0/issues/${id}/comments/`, { body: { data: { text } } });
  if (opts.json) return printJson(data);
  console.log(`Commented on #${id}.`);
}
function selection(args, opts, usage) {
  if (args.length > 0 && opts.query !== void 0) throw new CliError("Pass issue ids or --query, not both.", 2);
  if (args.length === 0 && opts.query === void 0) throw new CliError(`Usage: ${usage}`, 2);
  return { ids: args.map((arg) => toId(arg, usage)), byQuery: args.length === 0 };
}
async function bulkQuery(profile, org, opts) {
  const slug = projectSlug(profile, opts);
  return {
    query: opts.query,
    project: slug ? [await projectId(profile, org, slug)] : void 0,
    environment: environment(profile, opts),
    start: opts.since,
    end: opts.until
  };
}
async function requireConfirmation(profile, org, filters, verb, opts) {
  if (opts.yes) return;
  const { items, next } = await list(profile, `/api/0/organizations/${org}/issues/`, { ...filters, limit: 25 });
  printTable(items, [
    { header: "ID", get: (i) => i.id },
    { header: "STATUS", get: (i) => i.status },
    { header: "TITLE", get: (i) => i.title, max: 80 }
  ]);
  throw new CliError(`--query would ${verb} ${items.length}${next ? "+" : ""} issue(s) (first 25 shown). Re-run with --yes to apply.`, 2);
}
async function cmdSetStatus(status, args, opts) {
  const verb = { resolved: "resolve", ignored: "ignore", unresolved: "reopen" }[status];
  const usage = `glitchtip ${verb} <id|url>... | --query <q> --yes${status === "resolved" ? " [--next-release | --release <version>]" : ""}`;
  const choice = selection(args, opts, usage);
  const profile = resolveProfile(opts.profile);
  const statusDetails = status === "resolved" && (opts["next-release"] || opts.release) ? { inNextRelease: opts["next-release"] ? true : void 0, inRelease: opts.release } : void 0;
  const body = { status, ...statusDetails ? { statusDetails } : {} };
  if (choice.byQuery) {
    const org = requireOrg(profile, opts);
    const filters = await bulkQuery(profile, org, opts);
    await requireConfirmation(profile, org, filters, verb, opts);
    await api(profile, "PUT", `/api/0/organizations/${org}/issues/`, { query: filters, body });
    console.log(`Issues matching "${opts.query}" \u2192 ${status}`);
    return;
  }
  let failed = 0;
  for (const id of choice.ids) {
    try {
      const { data } = await api(profile, "PUT", `/api/0/issues/${id}/`, { body });
      if (opts.json) printJson(data);
      else console.log(`#${id} \u2192 ${status}`);
    } catch (error) {
      failed++;
      console.error(`glitchtip: #${id}: ${error.message}`);
    }
  }
  if (failed > 0) throw new CliError(`${failed} of ${choice.ids.length} update(s) failed.`);
}
async function cmdDelete(args, opts) {
  const usage = "glitchtip delete <id|url>... --yes | glitchtip delete --query <q> --yes";
  const choice = selection(args, opts, usage);
  const profile = resolveProfile(opts.profile);
  if (choice.byQuery) {
    const org = requireOrg(profile, opts);
    const filters = await bulkQuery(profile, org, opts);
    await requireConfirmation(profile, org, filters, "permanently delete", opts);
    await api(profile, "DELETE", `/api/0/organizations/${org}/issues/`, { query: filters });
    console.log(`Deleted issues matching "${opts.query}".`);
    return;
  }
  if (!opts.yes) throw new CliError(`Deleting ${choice.ids.map((id) => `#${id}`).join(" ")} is permanent. Re-run with --yes.`, 2);
  let failed = 0;
  for (const id of choice.ids) {
    try {
      await api(profile, "DELETE", `/api/0/issues/${id}/`);
      console.log(`#${id} deleted`);
    } catch (error) {
      failed++;
      console.error(`glitchtip: #${id}: ${error.message}`);
    }
  }
  if (failed > 0) throw new CliError(`${failed} of ${choice.ids.length} delete(s) failed.`);
}

// src/commands/org-commands.ts
async function cmdOrgs(opts) {
  const profile = resolveProfile(opts.profile);
  const { items, next } = await list(profile, "/api/0/organizations/", { limit: toInt(opts.limit, "limit"), cursor: opts.cursor }, { all: opts.all });
  if (opts.json) return printJson(items);
  printTable(items, [
    { header: "ID", get: (o) => o.id },
    { header: "SLUG", get: (o) => o.slug },
    { header: "NAME", get: (o) => o.name }
  ]);
  pageFooter(items.length, "organization(s)", next);
}
async function cmdProjects(opts) {
  const profile = resolveProfile(opts.profile);
  const org = requireOrg(profile, opts);
  const { items, next } = await list(profile, `/api/0/organizations/${org}/projects/`, { limit: toInt(opts.limit, "limit"), cursor: opts.cursor }, { all: opts.all });
  if (opts.json) return printJson(items);
  printTable(items, [
    { header: "ID", get: (p) => p.id },
    { header: "SLUG", get: (p) => p.slug },
    { header: "NAME", get: (p) => p.name },
    { header: "PLATFORM", get: (p) => p.platform },
    { header: "FIRST EVENT", get: (p) => shortDate(p.firstEvent) }
  ]);
  pageFooter(items.length, "project(s)", next);
}
async function cmdMonitors(opts) {
  const profile = resolveProfile(opts.profile);
  const org = requireOrg(profile, opts);
  const { data } = await api(profile, "GET", `/api/0/organizations/${org}/monitors/`);
  if (opts.json) return printJson(data);
  printTable(data, [
    { header: "ID", get: (m) => m.id },
    { header: "NAME", get: (m) => m.name },
    { header: "TYPE", get: (m) => m.monitorType },
    { header: "UP", get: (m) => m.isUp === null ? "-" : m.isUp ? "up" : "DOWN" },
    { header: "EVERY", get: (m) => `${m.interval}s` },
    { header: "URL", get: (m) => m.url, max: 60 }
  ]);
}
async function cmdMonitor(sub, opts) {
  const profile = resolveProfile(opts.profile);
  const org = requireOrg(profile, opts);
  const id = toId(sub, "glitchtip monitor <monitor-id>");
  const { items, next } = await list(profile, `/api/0/organizations/${org}/monitors/${id}/checks/`, { limit: toInt(opts.limit, "limit") ?? 25, cursor: opts.cursor }, { all: opts.all });
  if (opts.json) return printJson(items);
  printTable(items, [
    { header: "CHECKED", get: (c) => shortDate(c.startCheck) },
    { header: "RESULT", get: (c) => c.isUp ? "up" : "DOWN" },
    { header: "REASON", get: (c) => c.reason },
    { header: "RESPONSE MS", get: (c) => c.responseTime }
  ]);
  pageFooter(items.length, "check(s)", next);
}
async function cmdAlerts(opts) {
  const profile = resolveProfile(opts.profile);
  const org = requireOrg(profile, opts);
  const slug = projectSlug(profile, opts);
  if (!slug) throw new CliError("Alerts belong to a project: pass --project <slug> or set a default project.", 2);
  const { data } = await api(profile, "GET", `/api/0/projects/${org}/${slug}/alerts/`);
  if (opts.json) return printJson(data);
  printTable(data, [
    { header: "ID", get: (a) => a.id },
    { header: "NAME", get: (a) => a.name },
    { header: "KIND", get: (a) => a.uptime ? "uptime" : "issues" },
    { header: "WHEN", get: (a) => a.quantity && a.timespanMinutes ? `${a.quantity} events / ${a.timespanMinutes} min` : "-" }
  ]);
}

// src/glitchtip/filters.ts
async function projectFilter(profile, org, opts) {
  const id = toInt(opts["project-id"], "project-id");
  if (id !== void 0) return [id];
  if (opts.project) return [await projectId(profile, org, opts.project)];
  return void 0;
}

// src/commands/log-commands.ts
async function cmdLogs(sub, rest, opts) {
  const profile = resolveProfile(opts.profile);
  const org = requireOrg(profile, opts);
  const text = [sub, ...rest].filter(Boolean).join(" ") || void 0;
  const { items, next } = await list(profile, `/api/0/organizations/${org}/logs/`, {
    project: await projectFilter(profile, org, opts),
    level: opts.level ? [opts.level] : void 0,
    service: opts.service,
    environment: environment(profile, opts),
    host: opts.host,
    traceId: opts.trace,
    query: text,
    start: opts.since,
    end: opts.until,
    limit: toInt(opts.limit, "limit") ?? 50,
    cursor: opts.cursor
  }, { all: opts.all });
  if (opts.json) return printJson(items);
  printTable(items, [
    { header: "TIME", get: (l) => shortDate(l.timestamp) },
    { header: "LEVEL", get: (l) => l.level },
    { header: "SERVICE", get: (l) => l.service },
    { header: "HOST", get: (l) => l.host },
    { header: "BODY", get: (l) => l.body, max: 100 }
  ]);
  pageFooter(items.length, "log(s)", next);
}
async function cmdLog(sub, opts) {
  const profile = resolveProfile(opts.profile);
  const org = requireOrg(profile, opts);
  const id = requireArg(sub, "glitchtip log <log-id>");
  const { data } = await api(profile, "GET", `/api/0/organizations/${org}/logs/${id}/`);
  if (opts.json) return printJson(data);
  printFields([
    ["Log", data.id],
    ["Time", data.timestamp],
    ["Level", data.level],
    ["Service", data.service],
    ["Host", data.host],
    ["Environment", data.environment],
    ["Trace", data.traceID],
    ["Body", data.body]
  ]);
  if (data.data && typeof data.data === "object" && Object.keys(data.data).length > 0) {
    console.log(`
Data:
${JSON.stringify(data.data, null, 2)}`);
  }
}

// src/commands/perf-commands.ts
var ms = (value) => typeof value === "number" ? Math.round(value * 10) / 10 : value;
var spanColumns = [
  { header: "OP", get: (s) => s.op },
  { header: "COUNT", get: (s) => s.count },
  { header: "AVG MS", get: (s) => ms(s.avgDuration) },
  { header: "P95 MS", get: (s) => ms(s.p95Duration) },
  { header: "TOTAL MS", get: (s) => ms(s.totalTime) },
  { header: "DESCRIPTION", get: (s) => s.description, max: 80 }
];
async function cmdPerf(command, sub, rest, opts) {
  const profile = resolveProfile(opts.profile);
  const org = requireOrg(profile, opts);
  const project = await projectFilter(profile, org, opts);
  const range = { start: opts.since, end: opts.until };
  const limit = toInt(opts.limit, "limit");
  if (command === "txns") {
    const text = [sub, ...rest].filter(Boolean).join(" ") || void 0;
    const { items, next } = await list(profile, `/api/0/organizations/${org}/transaction-groups/`, {
      project,
      query: text,
      sort: opts.sort,
      limit: limit ?? 25,
      cursor: opts.cursor,
      ...range
    }, { all: opts.all });
    if (opts.json) return printJson(items);
    printTable(items, [
      { header: "ID", get: (t) => t.id },
      { header: "OP", get: (t) => t.op },
      { header: "COUNT", get: (t) => t.count },
      { header: "AVG MS", get: (t) => ms(t.avgDuration) },
      { header: "P95 MS", get: (t) => ms(t.p95) },
      { header: "ERRORS", get: (t) => t.errorCount },
      { header: "TRANSACTION", get: (t) => t.transaction, max: 80 }
    ]);
    return pageFooter(items.length, "transaction group(s)", next);
  }
  if (command === "txn") {
    const usage = "glitchtip txn <group-id> [trend|spans]";
    const id = toId(sub, usage);
    const base = `/api/0/organizations/${org}/transaction-groups/${id}/`;
    if (rest[0] === void 0) {
      const { data: data2 } = await api(profile, "GET", base);
      if (opts.json) return printJson(data2);
      return printFields([
        ["Group", `#${data2.id}  ${data2.op}`],
        ["Transaction", data2.transaction],
        ["Count", data2.count],
        ["Avg / p50 / p95 ms", [ms(data2.avgDuration), ms(data2.p50), ms(data2.p95)].join(" / ")],
        ["Errors", `${data2.errorCount} (${Math.round(data2.errorRate * 1e3) / 10}%)`]
      ]);
    }
    if (rest[0] === "trend") {
      const { data: data2 } = await api(profile, "GET", `${base}trend/`, { query: range });
      if (opts.json) return printJson(data2);
      return printTable(data2, [
        { header: "DATE", get: (p) => p.date },
        { header: "COUNT", get: (p) => p.count },
        { header: "AVG MS", get: (p) => ms(p.avgDuration) },
        { header: "TOTAL MS", get: (p) => ms(p.totalTime) }
      ]);
    }
    if (rest[0] === "spans") {
      const { data: data2 } = await api(profile, "GET", `${base}spans/`, { query: range });
      if (opts.json) return printJson(data2);
      return printTable(data2, spanColumns);
    }
    throw new CliError(`Usage: ${usage}`, 2);
  }
  if (command === "spans") {
    const { data: data2 } = await api(profile, "GET", `/api/0/organizations/${org}/span-groups/`, {
      query: { project, op: opts.op ?? sub, sort: opts.sort, limit, ...range }
    });
    if (opts.json) return printJson(data2);
    return printTable(data2, spanColumns);
  }
  const threshold = opts.threshold === void 0 ? void 0 : Number(opts.threshold);
  if (threshold !== void 0 && Number.isNaN(threshold)) throw new CliError("--threshold must be a number.", 2);
  const { data } = await api(profile, "GET", `/api/0/organizations/${org}/n-plus-one/`, {
    query: { project, op: opts.op, threshold, limit, ...range }
  });
  if (opts.json) return printJson(data);
  printTable(data, [
    { header: "SPANS/TXN", get: (n) => ms(n.spansPerTxn) },
    { header: "TXNS", get: (n) => n.transactionCount },
    { header: "AVG MS", get: (n) => ms(n.avgDuration) },
    { header: "TRANSACTION", get: (n) => n.transactionName, max: 50 },
    { header: "SPAN", get: (n) => n.description, max: 70 }
  ]);
}

// src/index.ts
function glueDashValues(argv) {
  const takesValue = /* @__PURE__ */ new Set();
  const known = /* @__PURE__ */ new Set();
  for (const [name, spec] of Object.entries(OPTIONS)) {
    known.add(`--${name}`);
    if ("short" in spec) known.add(`-${spec.short}`);
    if (spec.type === "string") takesValue.add(`--${name}`);
  }
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (takesValue.has(arg) && next !== void 0 && next.startsWith("-") && next.length > 1 && !known.has(next.split("=")[0])) {
      out.push(`${arg}=${next}`);
      i++;
    } else {
      out.push(arg);
    }
  }
  return out;
}
async function main() {
  const { values, positionals } = parseArgs({ args: glueDashValues(process.argv.slice(2)), allowPositionals: true, options: OPTIONS });
  const opts = values;
  if (opts.version) return console.log(VERSION);
  const [command, sub, ...rest] = positionals;
  if (opts.help || !command || command === "help") return console.log(HELP);
  const ids = [sub, ...rest].filter((x) => Boolean(x));
  switch (command) {
    case "issues":
      return cmdIssues(sub, rest, opts);
    case "issue":
      return cmdIssue(sub, opts);
    case "latest":
      return cmdLatest(sub, opts);
    case "events":
      return cmdEvents(sub, opts);
    case "event":
      return cmdEvent(sub, opts);
    case "tags":
      return cmdTags(sub, opts);
    case "hashes":
      return cmdHashes(sub, opts);
    case "comments":
      return cmdComments(sub, opts);
    case "comment":
      return cmdComment(sub, rest, opts);
    case "resolve":
      return cmdSetStatus("resolved", ids, opts);
    case "ignore":
      return cmdSetStatus("ignored", ids, opts);
    case "reopen":
      return cmdSetStatus("unresolved", ids, opts);
    case "delete":
      return cmdDelete(ids, opts);
    case "orgs":
      return cmdOrgs(opts);
    case "projects":
      return cmdProjects(opts);
    case "monitors":
      return cmdMonitors(opts);
    case "monitor":
      return cmdMonitor(sub, opts);
    case "alerts":
      return cmdAlerts(opts);
    case "logs":
      return cmdLogs(sub, rest, opts);
    case "log":
      return cmdLog(sub, opts);
    case "txns":
    case "txn":
    case "spans":
    case "n1":
      return cmdPerf(command, sub, rest, opts);
    case "api":
      return cmdApi(sub, rest[0], rest.slice(1), opts);
    case "auth":
      return cmdAuth(sub, rest, opts);
    default:
      throw new CliError(`Unknown command "${command}". Run \`glitchtip --help\`.`, 2);
  }
}
main().catch((error) => {
  if (error instanceof CliError) {
    console.error(`glitchtip: ${error.message}`);
    process.exit(error.exitCode);
  }
  const code = error?.code;
  if (typeof code === "string" && code.startsWith("ERR_PARSE_ARGS")) {
    console.error(`glitchtip: ${error.message}`);
    process.exit(2);
  }
  console.error(error);
  process.exit(1);
});
