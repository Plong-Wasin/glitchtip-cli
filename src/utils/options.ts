// Every flag the CLI accepts. Commands read them from `Opts`.
export const OPTIONS = {
  profile: { type: 'string', short: 'p' },
  org: { type: 'string' },
  project: { type: 'string' },
  'project-id': { type: 'string' },
  env: { type: 'string', short: 'e' },
  issue: { type: 'string' },
  json: { type: 'boolean' },
  all: { type: 'boolean' },
  status: { type: 'string' },
  query: { type: 'string', short: 'q' },
  sort: { type: 'string' },
  since: { type: 'string' },
  until: { type: 'string' },
  limit: { type: 'string', short: 'n' },
  cursor: { type: 'string' },
  level: { type: 'string' },
  service: { type: 'string' },
  host: { type: 'string' },
  trace: { type: 'string' },
  op: { type: 'string' },
  threshold: { type: 'string' },
  'next-release': { type: 'boolean' },
  release: { type: 'string' },
  'all-frames': { type: 'boolean' },
  yes: { type: 'boolean' },
  data: { type: 'string', short: 'd' },
  url: { type: 'string' },
  token: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const;

export type Opts = {
  -readonly [K in keyof typeof OPTIONS]?: (typeof OPTIONS)[K]['type'] extends 'boolean' ? boolean : string;
};
